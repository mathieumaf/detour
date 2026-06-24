import { STORAGE_KEY, DEFAULT_PROFILE, DEFAULT_STATE } from './types';
import type { ProxyState } from './types';

export async function loadState(): Promise<ProxyState> {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  const stored = res[STORAGE_KEY] as Partial<ProxyState> | undefined;
  // Spreading DEFAULT_PROFILE first backfills fields absent from older stored
  // profiles (e.g. bypassList) so the model stays forward-compatible.
  return {
    enabled: stored?.enabled ?? DEFAULT_STATE.enabled,
    profile: { ...DEFAULT_PROFILE, ...stored?.profile },
  };
}

export async function saveState(state: ProxyState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}
