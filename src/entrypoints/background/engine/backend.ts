import type { ProxyProfile, ProxyState } from '@/core';

// What the rest of the background needs from a browser's proxy API. Chromium
// and Firefox route traffic in unrelated ways; each has one backend here.
export interface ProxyBackend {
  // Called once, synchronously, in the first turn of the background. The
  // stored state is not known yet; `stateReady` resolves when it is. A backend
  // that sees requests itself must hold them until then rather than guess.
  start(stateReady: Promise<void>): void;

  // Route by the whole state: routing rules first, then the active profile,
  // each profile honouring its own bypass list.
  routeByState(state: ProxyState): Promise<void>;

  // Route everything through one profile and ignore the rules. The connection
  // test uses this, so a trial never picks up the user's auto-switch list.
  routeByProfile(profile: ProxyProfile): Promise<void>;

  // Stop routing. The browser falls back to its own (system) proxy settings.
  release(): Promise<void>;

  // Loading the stored state failed before any route was installed.
  abortStartup(): void;
}
