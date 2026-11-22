import { STORAGE_KEY, normalizeState } from '@/core';
import type { ProxyState } from '@/core';

// chrome.storage.local holds the whole ProxyState under one key. It is the
// single source of truth: the popup, the settings page, and the background
// all read it through loadState and react to chrome.storage.onChanged.

export async function loadState(): Promise<ProxyState> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeState(stored[STORAGE_KEY]);
}

export async function saveState(state: ProxyState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}
