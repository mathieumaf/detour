// Launches a real browser with the built extension loaded and gives the tests
// a small, browser-neutral handle on it. The same tests run against Chrome and
// Firefox; everything that differs between the two lives in this file.

import { existsSync } from 'node:fs';
import path from 'node:path';
import puppeteer, { TargetType, type Browser, type Page, type Viewport } from 'puppeteer';
import { activeProfile } from '../src/core/types';
import { isProfileValid } from '../src/core/profile';
import { hostResolverRules, localDomains } from './hosts';
import { STORAGE_KEY, type ProxyState } from './state';

export type BrowserName = 'chrome' | 'firefox';

// `bun run test:e2e:firefox` sets DETOUR_BROWSER=firefox. Chrome is the default.
export const BROWSER: BrowserName = process.env.DETOUR_BROWSER === 'firefox' ? 'firefox' : 'chrome';

const repoRoot = path.resolve(import.meta.dirname, '..');
const BUILD_DIR = { chrome: 'chrome-mv3', firefox: 'firefox-mv3' } as const;

// Firefox gives an extension a random origin per profile. Pinning it lets the
// suite open moz-extension:// pages without asking the browser for the UUID.
const FIREFOX_ADDON_ID = 'detour@mafille.me';
const FIREFOX_UUID = '7d1f3a52-6f0e-4c1b-9d1e-0c5b8f3a9e11';

export type ExtensionPage = 'options.html' | 'popup.html';

export interface Visit {
  status: number;
  body: string;
}

export interface Detour {
  browser: Browser;
  // Open one of the extension's own pages in a tab.
  openPage(file: ExtensionPage, viewport?: Viewport): Promise<Page>;
  // Write the stored state, as the settings page would, and return once the
  // background has applied it.
  setState(state: ProxyState): Promise<void>;
  // Wait until the background has applied a state the test did not write
  // itself (a click in the popup, a browser restart).
  waitForProxy(on: boolean): Promise<void>;
  readState(): Promise<ProxyState | undefined>;
  // Load a URL in a tab and report what answered.
  visit(url: string): Promise<Visit>;
  close(): Promise<void>;
}

export interface LaunchOptions {
  // Reuse a browser profile, to restart with the same storage (Chrome only:
  // Firefox forgets a temporary add-on when it quits).
  userDataDir?: string;
  firefoxPrefs?: Record<string, unknown>;
}

export async function launchDetour(options: LaunchOptions = {}): Promise<Detour> {
  const extensionPath = path.join(repoRoot, '.output', BUILD_DIR[BROWSER]);
  if (!existsSync(path.join(extensionPath, 'manifest.json'))) {
    throw new Error(
      `No ${BROWSER} build at ${extensionPath}. Run \`bun run build${
        BROWSER === 'firefox' ? ':firefox' : ''
      }\` first.`,
    );
  }

  const { browser, origin } =
    BROWSER === 'firefox'
      ? await launchFirefox(extensionPath, options)
      : await launchChrome(extensionPath, options);

  try {
    // Every read and write of extension state goes through one extension page.
    // It has the same access to chrome.* as the settings page a user opens.
    const control = await openExtensionPage(browser, `${origin}/options.html`);
    return createDetour(browser, origin, control);
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function launchChrome(
  extensionPath: string,
  options: LaunchOptions,
): Promise<{ browser: Browser; origin: string }> {
  const browser = await puppeteer.launch({
    browser: 'chrome',
    headless: true,
    // Loading an unpacked extension needs the pipe transport.
    pipe: true,
    enableExtensions: [extensionPath],
    userDataDir: options.userDataDir,
    args: [
      `--host-resolver-rules=${hostResolverRules()}`,
      // GitHub's Linux runners do not allow Chrome's sandbox.
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  });
  try {
    const worker = await browser.waitForTarget(
      (target) =>
        target.type() === TargetType.SERVICE_WORKER &&
        target.url().startsWith('chrome-extension://'),
      { timeout: 15_000 },
    );
    // URL.origin is "null" for a non-web scheme, so build the origin by hand.
    return { browser, origin: `chrome-extension://${new URL(worker.url()).host}` };
  } catch (error) {
    await browser.close();
    throw new Error('The extension service worker did not start.', { cause: error });
  }
}

async function launchFirefox(
  extensionPath: string,
  options: LaunchOptions,
): Promise<{ browser: Browser; origin: string }> {
  const browser = await puppeteer.launch({
    browser: 'firefox',
    headless: true,
    // Firefox only lets automation open moz-extension:// pages with this set.
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
    extraPrefsFirefox: {
      'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ADDON_ID]: FIREFOX_UUID }),
      'network.dns.localDomains': localDomains(),
      ...options.firefoxPrefs,
    },
  });
  try {
    // Installed as a temporary add-on, the way about:debugging does it. No
    // signature needed, and the manifest's permissions are granted.
    await browser.installExtension(extensionPath);
    return { browser, origin: `moz-extension://${FIREFOX_UUID}` };
  } catch (error) {
    await browser.close();
    throw new Error('Firefox did not install the extension.', { cause: error });
  }
}

// Firefox loads extension pages in a separate process and never reports the
// navigation as finished, so `page.goto` would wait forever. Start the
// navigation, then watch the document itself.
async function openExtensionPage(
  browser: Browser,
  url: string,
  viewport?: Viewport,
): Promise<Page> {
  const page = await browser.newPage();
  // Firefox refuses to resize a tab once it shows an extension page.
  if (viewport) await page.setViewport(viewport);
  page.goto(url, { timeout: 0 }).catch(() => undefined);
  await waitFor(
    `${url} to load`,
    async () =>
      (await page.evaluate(() => `${location.href} ${document.readyState}`)) === `${url} complete`,
  );
  return page;
}

function createDetour(browser: Browser, origin: string, control: Page): Detour {
  // The toolbar badge is the background's own "applied" signal: it is set
  // right after the proxy is routed or released, in both browsers.
  const badge = () => control.evaluate(() => chrome.action.getBadgeText({}));
  const write = (next: ProxyState) =>
    control.evaluate((key, value) => chrome.storage.local.set({ [key]: value }), STORAGE_KEY, next);

  async function waitForProxy(on: boolean): Promise<void> {
    const expected = on ? 'ON' : '';
    await waitFor(
      `the proxy to turn ${on ? 'on' : 'off'}`,
      async () => (await badge()) === expected,
    );
  }

  return {
    browser,
    openPage: (file, viewport) => openExtensionPage(browser, `${origin}/${file}`, viewport),
    waitForProxy,

    async setState(next) {
      const on = next.enabled && isProfileValid(activeProfile(next));
      if (on) {
        // Going from one active configuration to another leaves the badge on
        // throughout. Pass through "off" so "on" means this state is applied.
        await write({ ...next, enabled: false });
        await waitForProxy(false);
      }
      await write(next);
      await waitForProxy(on);
    },

    readState: () =>
      control.evaluate(async (key) => {
        const stored = await chrome.storage.local.get(key);
        return stored[key] as ProxyState | undefined;
      }, STORAGE_KEY),

    async visit(url) {
      const page = await browser.newPage();
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        const body = await page.evaluate(() => document.body.innerText);
        return { status: response?.status() ?? 0, body };
      } finally {
        await page.close();
      }
    },

    close: () => browser.close(),
  };
}

// Poll until `check` is true. Used where the browser gives no event to await.
export async function waitFor(
  what: string,
  check: () => Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      if (await check()) return;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}.`, { cause: lastError });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
