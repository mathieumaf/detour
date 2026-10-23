import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { readPacScript, readStoredState, setProxyState, waitForExtensionWorker, waitForProxy } from './extension';
import { expect, launchExtensionContext, test } from './fixtures';
import { AUTH_PASSWORD, AUTH_USERNAME, type Harness } from './harness';
import { HOSTS } from './hosts';
import { DIRECT, profile, state, type E2EState } from './state';

// One browser for the file. Each test writes a full proxy state, so order
// doesn't leak settings — except the restart test, which has to run last
// because it reloads the extension.
test.describe.configure({ mode: 'serial' });

test.afterEach(async ({ extensionContext }) => {
  const pages = extensionContext.pages();
  for (const page of pages.slice(1)) await page.close().catch(() => undefined);
});

test('an enabled profile sends traffic through the HTTP proxy', async ({ extensionContext, harness }) => {
  const page = await extensionContext.newPage();
  await setProxyState(extensionContext, httpState(harness.httpProxy.port, { enabled: true }));
  await expectTraffic(page, harness, HOSTS.enabled, 'http-proxy');
});

test('direct mode leaves a configured profile unused', async ({ extensionContext, harness }) => {
  const page = await extensionContext.newPage();
  await setProxyState(extensionContext, httpState(harness.httpProxy.port, { enabled: false }));
  await expectTraffic(page, harness, HOSTS.direct, 'direct');
});

test('the popup toggle turns the proxy on and back off', async ({
  extensionContext,
  extensionId,
  harness,
}) => {
  const port = harness.httpProxy.port;
  await setProxyState(
    extensionContext,
    state({
      enabled: false,
      profiles: [
        profile({
          id: 'default',
          name: 'Default profile',
          host: '',
          port: 8080,
          bypassList: ['<local>'],
        }),
      ],
    }),
  );

  const options = await extensionContext.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByLabel('Host')).toHaveValue('');
  await options.getByLabel('Port').fill(String(port));
  await options.getByLabel('Port').press('Tab');
  await options.getByLabel('Host').fill('127.0.0.1');
  await options.getByLabel('Host').press('Tab');
  await expect
    .poll(async () => {
      const stored = await readStoredState(extensionContext);
      const current = stored?.profiles.find((item) => item.id === 'default') ?? stored?.profiles[0];
      return `${current?.host ?? ''}:${current?.port ?? ''}`;
    })
    .toBe(`127.0.0.1:${port}`);

  const popup = await extensionContext.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByText(`HTTP · 127.0.0.1:${port}`)).toBeVisible();
  await expect(popup.locator('button.switch')).toBeEnabled();
  await popup.locator('button.switch').click();
  await expect(popup.getByText('Proxy active')).toBeVisible();
  await waitForProxy(extensionContext, httpState(port, { enabled: true }));

  const page = await extensionContext.newPage();
  await expectTraffic(page, harness, HOSTS.ui, 'http-proxy');

  await popup.locator('button.switch').click();
  await expect(popup.getByText('Direct connection')).toBeVisible();
  await waitForProxy(extensionContext, httpState(port, { enabled: false }));
  await expectTraffic(page, harness, HOSTS.ui, 'direct');
});

test('a routing rule proxies the matched host and Direct rules stay direct', async ({
  extensionContext,
  harness,
}) => {
  const port = harness.httpProxy.port;
  const configured = state({
    enabled: true,
    profiles: [profile({ id: 'proxy', name: 'Proxy', host: '127.0.0.1', port })],
    rules: [
      { id: 'matched', match: HOSTS.matched, action: 'proxy' },
      { id: 'other', match: HOSTS.other, action: DIRECT },
    ],
  });
  await setProxyState(extensionContext, configured);

  const pac = await readPacScript(extensionContext);
  expect(pac).toContain(HOSTS.matched);
  expect(pac).toContain(`PROXY 127.0.0.1:${port}`);
  expect(pac).toContain('DIRECT');

  const page = await extensionContext.newPage();
  // Unmatched hosts use the active profile, which is the proxy.
  await expectTraffic(page, harness, HOSTS.matched, 'http-proxy');
  await expectTraffic(page, harness, HOSTS.other, 'direct');
  await expectTraffic(page, harness, HOSTS.fallback, 'http-proxy');
});

test('the bypass list connects that host directly', async ({ extensionContext, harness }) => {
  await setProxyState(
    extensionContext,
    httpState(harness.httpProxy.port, {
      enabled: true,
      bypassList: [HOSTS.bypass],
    }),
  );
  const page = await extensionContext.newPage();
  await expectTraffic(page, harness, HOSTS.bypass, 'direct');
  await expectTraffic(page, harness, HOSTS.normal, 'http-proxy');
});

test('stored HTTP proxy credentials authenticate without a prompt', async ({
  extensionContext,
  harness,
}) => {
  harness.authProxy.setCredentials(AUTH_USERNAME, AUTH_PASSWORD);
  await setProxyState(
    extensionContext,
    httpState(harness.authProxy.port, {
      enabled: true,
      username: AUTH_USERNAME,
      password: AUTH_PASSWORD,
    }),
  );
  const page = await extensionContext.newPage();
  await expectTraffic(page, harness, HOSTS.auth, 'auth-proxy');
});

test('a SOCKS5 profile tunnels HTTP through the local SOCKS proxy', async ({
  extensionContext,
  harness,
}) => {
  await setProxyState(
    extensionContext,
    state({
      enabled: true,
      profiles: [
        profile({
          id: 'socks',
          name: 'SOCKS',
          scheme: 'socks5',
          host: '127.0.0.1',
          port: harness.socks.port,
        }),
      ],
    }),
  );
  const page = await extensionContext.newPage();
  await expectTraffic(page, harness, HOSTS.socks, 'socks');
});

test('a restarted browser still routes and authenticates from storage', async ({ harness }) => {
  // chrome.runtime.reload() under this headless Chromium unloads the extension
  // and never starts another service worker. Closing the browser and opening
  // the same profile is the cold start that matches a real restart: storage
  // survives, the worker boots from scratch, and it must reapply the proxy.
  //
  // The password changes before shutdown. Chromium's auth cache does not
  // survive the process, and even if it did it would hold the old password.
  // The new worker has to answer the challenge from storage.
  //
  // Another agent is fixing background cold-start (register listeners before
  // state loads; do not answer auth while ctx.state is still null). If this
  // fails on main for that reason, keep the test and mark it test.fail() —
  // do not patch the engine here.
  test.setTimeout(45_000);
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'detour-e2e-'));
  const rotated = `${AUTH_PASSWORD}-restart`;
  const next = authState(harness.authProxy.port, rotated);

  const first = await launchExtensionContext(userDataDir);
  try {
    harness.authProxy.setCredentials(AUTH_USERNAME, AUTH_PASSWORD);
    await setProxyState(first, authState(harness.authProxy.port, AUTH_PASSWORD));
    const page = await first.newPage();
    await expectTraffic(page, harness, HOSTS.cold, 'auth-proxy');

    harness.authProxy.setCredentials(AUTH_USERNAME, rotated);
    await setProxyState(first, next);
    await expect
      .poll(async () => (await readStoredState(first))?.profiles[0]?.password)
      .toBe(rotated);
  } finally {
    await first.close();
  }

  const restarted = await launchExtensionContext(userDataDir);
  try {
    await waitForExtensionWorker(restarted);
    await waitForProxy(restarted, next);
    const page = await restarted.newPage();
    await expectTraffic(page, harness, HOSTS.cold, 'auth-proxy');
  } finally {
    await restarted.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});

function httpState(
  port: number,
  extra: { enabled: boolean; bypassList?: string[]; username?: string; password?: string },
): E2EState {
  return state({
    enabled: extra.enabled,
    profiles: [
      profile({
        host: '127.0.0.1',
        port,
        bypassList: extra.bypassList ?? [],
        username: extra.username ?? '',
        password: extra.password ?? '',
      }),
    ],
  });
}

function authState(port: number, password: string): E2EState {
  return httpState(port, {
    enabled: true,
    username: AUTH_USERNAME,
    password,
  });
}

type Via = 'direct' | 'http-proxy' | 'auth-proxy' | 'socks';

async function expectTraffic(page: Page, harness: Harness, host: string, via: Via): Promise<void> {
  const path = uniquePath(via);
  const url = `http://${host}:${harness.target.port}${path}`;
  let status = 0;
  let body = '';
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    status = response?.status() ?? 0;
    body = await page.locator('body').innerText();
  } catch (error) {
    throw new Error(
      `Navigation to ${url} failed (${(error as Error).message}).\n${observed(harness, path)}`,
    );
  }

  const actual = body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('via='))
    ?.slice('via='.length);
  if (status !== 200 || actual !== via) {
    throw new Error(
      `Expected via=${via} HTTP 200 for ${url}, got via=${actual ?? 'missing'} HTTP ${status}.\n` +
        `Body: ${body.slice(0, 400)}\n${observed(harness, path)}`,
    );
  }
  assertObserved(harness, path, via);
}

function assertObserved(harness: Harness, path: string, via: Via): void {
  const targetHit = saw(harness.target.requests, path);
  const httpHit = saw(harness.httpProxy.requests, path);
  const authHit = harness.authProxy.requests.some(
    (request) => request.url.includes(path) && request.authorized,
  );
  const socksHit = saw(harness.socks.requests, path);

  if (via === 'direct') {
    expect(targetHit, observed(harness, path)).toBe(true);
    expect(httpHit).toBe(false);
    expect(authHit).toBe(false);
    expect(socksHit).toBe(false);
    return;
  }
  expect(targetHit, `${via} should not reach the target\n${observed(harness, path)}`).toBe(false);
  if (via === 'http-proxy') expect(httpHit).toBe(true);
  if (via === 'auth-proxy') expect(authHit).toBe(true);
  if (via === 'socks') expect(socksHit).toBe(true);
}

function saw(requests: { url: string }[], path: string): boolean {
  return requests.some((request) => request.url.includes(path));
}

function observed(harness: Harness, path: string): string {
  const lines: string[] = [];
  for (const [name, server] of [
    ['target', harness.target],
    ['http-proxy', harness.httpProxy],
    ['auth-proxy', harness.authProxy],
    ['socks', harness.socks],
  ] as const) {
    const hits = server.requests.filter((request) => request.url.includes(path));
    lines.push(
      `${name}: ${
        hits.map((request) => `${request.url} auth=${request.authorized}`).join(' | ') || 'none'
      }`,
    );
  }
  return lines.join('\n');
}

let sequence = 0;
function uniquePath(label: string): string {
  sequence += 1;
  return `/e2e/${label}-${sequence}-${Math.random().toString(16).slice(2)}`;
}
