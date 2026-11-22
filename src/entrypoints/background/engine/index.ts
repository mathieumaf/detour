import { activeProfile, isProfileValid } from '@/core';
import type { ProxyProfile, ProxyState } from '@/core';
import type { ProxyBackend } from './backend';
import { createChromiumBackend } from './chromium';
import { createFirefoxBackend } from './firefox';

// The proxy engine: one contract, two backends. See backend.ts for the
// contract and chromium.ts / firefox.ts for how each browser fulfils it.

let backend: ProxyBackend | null = null;

function engine(): ProxyBackend {
  if (!backend) throw new Error('The proxy engine was used before startEngine().');
  return backend;
}

// Pick the backend for this browser and let it register its listeners. Must
// run synchronously in the first turn of the background, before any await.
export function startEngine(firefox: boolean, stateReady: Promise<void>): void {
  backend = firefox ? createFirefoxBackend() : createChromiumBackend();
  backend.start(stateReady);
}

export function abortEngineStartup(): void {
  engine().abortStartup();
}

// Make the browser match the state: route when Detour is on and the active
// profile is usable, otherwise hand routing back to the browser.
export async function applyState(state: ProxyState): Promise<void> {
  const on = state.enabled && isProfileValid(activeProfile(state));
  if (on) await engine().routeByState(state);
  else await engine().release();
  setBadge(on);
}

// Route everything through one profile, whatever the stored state says.
export async function applyProfile(profile: ProxyProfile): Promise<void> {
  await engine().routeByProfile(profile);
}

function setBadge(on: boolean) {
  void chrome.action.setBadgeText({ text: on ? 'ON' : '' });
  void chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
}
