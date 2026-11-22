// How Detour routes real traffic. Every test here runs against both Chrome and
// Firefox: the two reach the same result through unrelated browser APIs
// (chrome.proxy.settings + PAC on one side, proxy.onRequest on the other).

import { afterAll, beforeAll, describe, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BROWSER, launchDetour, waitFor, type Detour } from './detour';
import { HOSTS } from './hosts';
import { AUTH_PASSWORD, AUTH_USERNAME, startServers, type Servers } from './servers';
import { DIRECT_ACTION, profile, state, type ProxyState } from './state';
import { expectTraffic } from './traffic';

let servers: Servers;
let detour: Detour;

beforeAll(async () => {
  servers = await startServers();
  detour = await launchDetour();
});

afterAll(async () => {
  await detour?.close();
  await servers?.close();
});

function httpState(
  port: number,
  extra: { enabled: boolean; bypassList?: string[]; username?: string; password?: string },
): ProxyState {
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

describe(`routing (${BROWSER})`, () => {
  test('before Detour is configured, traffic is direct', async () => {
    await expectTraffic(detour, servers, HOSTS.direct, 'direct');
  });

  test('an enabled profile sends traffic through the HTTP proxy', async () => {
    await detour.setState(httpState(servers.httpProxy.port, { enabled: true }));
    await expectTraffic(detour, servers, HOSTS.enabled, 'http-proxy');
  });

  test('turned off, a configured profile is left unused', async () => {
    await detour.setState(httpState(servers.httpProxy.port, { enabled: false }));
    await expectTraffic(detour, servers, HOSTS.direct, 'direct');
  });

  test('a rule proxies the host it matches, and a Direct rule stays direct', async () => {
    await detour.setState(
      state({
        enabled: true,
        profiles: [
          profile({
            id: 'socks',
            name: 'SOCKS',
            scheme: 'socks5',
            host: '127.0.0.1',
            port: servers.socks.port,
          }),
          profile({ id: 'http', name: 'HTTP', host: '127.0.0.1', port: servers.httpProxy.port }),
        ],
        activeProfileId: 'socks',
        rules: [
          { id: 'matched', match: HOSTS.matched, action: 'http' },
          { id: 'other', match: HOSTS.other, action: DIRECT_ACTION },
        ],
      }),
    );
    await expectTraffic(detour, servers, HOSTS.matched, 'http-proxy');
    await expectTraffic(detour, servers, HOSTS.other, 'direct');
    // A host no rule matches uses the active profile.
    await expectTraffic(detour, servers, HOSTS.fallback, 'socks');
  });

  test('a host on the bypass list connects directly', async () => {
    await detour.setState(
      httpState(servers.httpProxy.port, { enabled: true, bypassList: [HOSTS.bypass] }),
    );
    await expectTraffic(detour, servers, HOSTS.bypass, 'direct');
    await expectTraffic(detour, servers, HOSTS.normal, 'http-proxy');
  });

  test('a bypass list still applies to a profile chosen by a rule', async () => {
    await detour.setState(
      state({
        enabled: true,
        profiles: [
          profile({
            id: 'socks',
            name: 'SOCKS',
            scheme: 'socks5',
            host: '127.0.0.1',
            port: servers.socks.port,
          }),
          profile({
            id: 'http',
            name: 'HTTP',
            host: '127.0.0.1',
            port: servers.httpProxy.port,
            bypassList: [HOSTS.bypass],
          }),
        ],
        activeProfileId: 'socks',
        rules: [
          { id: 'a', match: HOSTS.bypass, action: 'http' },
          { id: 'b', match: HOSTS.matched, action: 'http' },
        ],
      }),
    );
    await expectTraffic(detour, servers, HOSTS.bypass, 'direct');
    await expectTraffic(detour, servers, HOSTS.matched, 'http-proxy');
  });

  test('stored HTTP proxy credentials authenticate without a prompt', async () => {
    servers.authProxy.setCredentials(AUTH_USERNAME, AUTH_PASSWORD);
    await detour.setState(
      httpState(servers.authProxy.port, {
        enabled: true,
        username: AUTH_USERNAME,
        password: AUTH_PASSWORD,
      }),
    );
    await expectTraffic(detour, servers, HOSTS.auth, 'auth-proxy');
  });

  test('a SOCKS5 profile tunnels through the SOCKS proxy', async () => {
    await detour.setState(
      state({
        enabled: true,
        profiles: [
          profile({
            id: 'socks',
            name: 'SOCKS',
            scheme: 'socks5',
            host: '127.0.0.1',
            port: servers.socks.port,
          }),
        ],
      }),
    );
    await expectTraffic(detour, servers, HOSTS.socks, 'socks');
  });

  // Only Firefox can authenticate a SOCKS proxy. Chromium ignores the
  // credentials, which the settings page says next to the disabled fields.
  test.skipIf(BROWSER !== 'firefox')(
    'a SOCKS5 profile authenticates with its credentials',
    async () => {
      await detour.setState(
        state({
          enabled: true,
          profiles: [
            profile({
              id: 'socks',
              name: 'SOCKS',
              scheme: 'socks5',
              host: '127.0.0.1',
              port: servers.socksAuth.port,
              username: AUTH_USERNAME,
              password: AUTH_PASSWORD,
            }),
          ],
        }),
      );
      await expectTraffic(detour, servers, HOSTS.socks, 'socks-auth');
    },
  );

  test('turning Detour off releases the proxy again', async () => {
    await detour.setState(httpState(servers.httpProxy.port, { enabled: true }));
    await expectTraffic(detour, servers, HOSTS.enabled, 'http-proxy');
    await detour.setState(httpState(servers.httpProxy.port, { enabled: false }));
    await expectTraffic(detour, servers, HOSTS.enabled, 'direct');
  });
});

// The background is not a long-lived process. Chrome stops the service worker
// and Firefox suspends the event page; both start it again for the next event,
// with nothing in memory. These tests cover that cold start, which is where a
// request can leak past the proxy or meet a password prompt.
describe(`cold start (${BROWSER})`, () => {
  function authState(port: number, password: string): ProxyState {
    return httpState(port, { enabled: true, username: AUTH_USERNAME, password });
  }

  test.skipIf(BROWSER !== 'chrome')(
    'a restarted browser still routes and authenticates from storage',
    async () => {
      // Closing the browser and opening the same profile is a real restart:
      // storage survives, the worker boots from scratch, and it has to apply
      // the proxy again. The password changes before shutdown, so the new
      // worker can only answer the challenge from storage.
      const userDataDir = await mkdtemp(path.join(tmpdir(), 'detour-e2e-'));
      const rotated = `${AUTH_PASSWORD}-restart`;
      try {
        const first = await launchDetour({ userDataDir });
        try {
          servers.authProxy.setCredentials(AUTH_USERNAME, AUTH_PASSWORD);
          await first.setState(authState(servers.authProxy.port, AUTH_PASSWORD));
          await expectTraffic(first, servers, HOSTS.cold, 'auth-proxy');

          servers.authProxy.setCredentials(AUTH_USERNAME, rotated);
          await first.setState(authState(servers.authProxy.port, rotated));
        } finally {
          await first.close();
        }

        const restarted = await launchDetour({ userDataDir });
        try {
          await restarted.waitForProxy(true);
          await expectTraffic(restarted, servers, HOSTS.cold, 'auth-proxy');
        } finally {
          await restarted.close();
        }
      } finally {
        servers.authProxy.setCredentials(AUTH_USERNAME, AUTH_PASSWORD);
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  test.skipIf(BROWSER !== 'firefox')(
    'a suspended background still proxies and authenticates the request that wakes it',
    async () => {
      // Firefox suspends an idle event page after 30 s. One second is enough
      // here. The request that wakes it must wait for the stored state and
      // then go through the proxy, not slip out directly.
      const idle = await launchDetour({
        firefoxPrefs: { 'extensions.background.idle.timeout': 1_000 },
      });
      try {
        servers.authProxy.setCredentials(AUTH_USERNAME, AUTH_PASSWORD);
        await idle.setState(authState(servers.authProxy.port, AUTH_PASSWORD));
        const control = await idle.openPage('options.html');
        await waitFor(
          'the background to be suspended',
          () => control.evaluate(() => chrome.extension.getBackgroundPage() === null),
          15_000,
        );
        await expectTraffic(idle, servers, HOSTS.cold, 'auth-proxy');
      } finally {
        await idle.close();
      }
    },
    60_000,
  );
});
