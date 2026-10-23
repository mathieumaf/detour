import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { startHarness, type Harness } from './harness';
import { hostResolverRules, HOSTS } from './hosts';
import { waitForExtensionWorker } from './extension';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = path.join(repoRoot, '.output', 'chrome-mv3');

type WorkerFixtures = {
  harness: Harness;
  extensionContext: BrowserContext;
  extensionId: string;
};

export async function launchExtensionContext(userDataDir: string): Promise<BrowserContext> {
  if (!existsSync(path.join(extensionPath, 'manifest.json'))) {
    throw new Error(
      `Chromium build not found at ${extensionPath}. Run \`bun run build\` before the e2e tests.`,
    );
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    // Playwright's default Chromium args include --disable-extensions, which
    // blocks --load-extension. Drop only that switch.
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      `--host-resolver-rules=${hostResolverRules()}`,
    ],
  });
  context.on('serviceworker', logExtensionErrors);
  for (const worker of context.serviceWorkers()) logExtensionErrors(worker);
  return context;
}

export const test = base.extend<{}, WorkerFixtures>({
  harness: [
    async ({}, use) => {
      const harness = await startHarness();
      await use(harness);
      await harness.close();
    },
    { scope: 'worker' },
  ],

  // Persistent context is required for extensions. `channel: 'chromium'` selects
  // Playwright's full Chromium (new headless). The default headless shell cannot
  // load extensions, and branded Chrome ignores --load-extension. Do not set
  // Playwright's `proxy` option: it would install a command-line proxy and hide
  // the extension's chrome.proxy.settings.
  extensionContext: [
    async ({ harness }, use) => {
      const context = await launchExtensionContext('');
      await waitForExtensionWorker(context);
      await assertHostMapping(context, harness);

      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],

  extensionId: [
    async ({ extensionContext }, use) => {
      const worker = await waitForExtensionWorker(extensionContext);
      await use(new URL(worker.url()).host);
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';

function logExtensionErrors(worker: Worker): void {
  if (!worker.url().startsWith('chrome-extension://')) return;
  worker.on('console', (message) => {
    if (message.type() === 'error') console.error(`[extension] ${message.text()}`);
  });
}

// Proves the host-resolver rules reach the local target while Detour is still off.
async function assertHostMapping(context: BrowserContext, harness: Harness): Promise<void> {
  const page = await context.newPage();
  try {
    const url = `http://${HOSTS.direct}:${harness.target.port}/resolver-check`;
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const body = await page.locator('body').innerText();
    if (response?.status() !== 200 || !body.includes('via=direct')) {
      throw new Error(
        `Host ${HOSTS.direct} did not reach the local target before tests started ` +
          `(HTTP ${response?.status() ?? 'none'}).\n${body}`,
      );
    }
  } finally {
    await page.close();
  }
}
