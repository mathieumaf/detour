import { expect, type BrowserContext, type Worker } from '@playwright/test';
import { activeProfile, STORAGE_KEY, type E2EState } from './state';

export async function waitForExtensionWorker(context: BrowserContext): Promise<Worker> {
  const existing = extensionWorker(context);
  if (existing) return existing;
  try {
    return await context.waitForEvent('serviceworker', {
      predicate: (worker) => worker.url().startsWith('chrome-extension://'),
      timeout: 15_000,
    });
  } catch {
    throw new Error(
      'The extension service worker did not start. Use Playwright’s Chromium channel; branded Chrome ignores --load-extension.',
    );
  }
}

export function extensionWorker(context: BrowserContext): Worker | undefined {
  return context.serviceWorkers().find((worker) => worker.url().startsWith('chrome-extension://'));
}

// Writes the same storage record the options page writes. The background
// storage listener applies it; we wait until chrome.proxy.settings agrees.
export async function setProxyState(context: BrowserContext, state: E2EState): Promise<void> {
  const worker = await waitForExtensionWorker(context);
  await worker.evaluate(
    async ({ key, next }) => {
      await chrome.storage.local.set({ [key]: next });
    },
    { key: STORAGE_KEY, next: state },
  );
  await waitForProxy(context, state);
}

export async function readStoredState(context: BrowserContext): Promise<E2EState | undefined> {
  const worker = await waitForExtensionWorker(context);
  return worker.evaluate(async (key) => {
    const stored = await chrome.storage.local.get(key);
    return stored[key] as E2EState | undefined;
  }, STORAGE_KEY);
}

export async function readPacScript(context: BrowserContext): Promise<string> {
  const worker = await waitForExtensionWorker(context);
  return worker.evaluate(async () => {
    const details = await chrome.proxy.settings.get({});
    return details.value.pacScript?.data ?? '';
  });
}

export function expectedSignature(state: E2EState): string {
  if (!state.enabled) return 'system';
  const active = activeProfile(state);
  if (!active.host.trim()) return 'system';
  if (state.rules.length > 0) return 'pac_script';
  return `fixed:${active.scheme}:${active.host}:${active.port}`;
}

export async function waitForProxy(context: BrowserContext, state: E2EState): Promise<void> {
  const expected = expectedSignature(state);
  await expect
    .poll(async () => normalizeSignature(await readProxySignature(context), expected), {
      timeout: 10_000,
      message: `proxy settings did not become ${expected}`,
    })
    .toBe(expected);
}

async function readProxySignature(context: BrowserContext): Promise<string> {
  const worker = extensionWorker(context);
  if (!worker) return 'no-worker';
  try {
    return await worker.evaluate(async () => {
      const details = await chrome.proxy.settings.get({});
      if (
        details.levelOfControl === 'not_controllable' ||
        details.levelOfControl === 'controlled_by_other_extensions'
      ) {
        return `blocked:${details.levelOfControl}`;
      }
      const value = details.value;
      if (value.mode === 'fixed_servers') {
        const proxy = value.rules?.singleProxy;
        const scheme = proxy?.scheme || 'http';
        return `fixed:${scheme}:${proxy?.host ?? ''}:${proxy?.port ?? ''}`;
      }
      return value.mode;
    });
  } catch {
    return 'unavailable';
  }
}

function normalizeSignature(actual: string, expected: string): string {
  // With no system proxy configured, a cleared setting reports either mode.
  if (expected === 'system' && (actual === 'system' || actual === 'direct')) return 'system';
  return actual;
}
