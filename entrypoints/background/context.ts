import type { ProxyState, ProxyProfile } from '@/utils/proxy';

// Shared mutable runtime state for the background. The worker can be torn down
// and restarted at any time, so the entrypoint rehydrates ctx.state from
// storage on startup. Kept on one object so every module sees the live value.
export const ctx = {
  state: null as ProxyState | null,
  // While a connectivity test runs, the profile being tried — so the auth path
  // uses its credentials instead of the saved ones.
  testProfile: null as ProxyProfile | null,
};

// Requests we've already answered an auth challenge for, so wrong credentials
// don't trigger an infinite re-prompt loop (Chromium / HTTP proxies).
export const handledAuth = new Set<string>();
