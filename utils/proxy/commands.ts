import { activeProfile, type ProxyState } from './types';
import { isProfileValid } from './validation';

// Manifest command names. Keep these in sync with `wxt.config.ts`.
export const COMMAND_TOGGLE = 'toggle-detour';
export const COMMAND_NEXT_PROFILE = 'next-profile';

function clearHealthRuntime(): Pick<ProxyState, 'healthStatus' | 'lastFailover'> {
  return {
    healthStatus: { profileId: '', consecutiveFailures: 0 },
    lastFailover: null,
  };
}

// Flip enabled. Refuse to turn on when the active profile is incomplete —
// same gate as the popup toggle. Off is always allowed.
export function toggleProxyState(state: ProxyState): ProxyState | null {
  const enabled = !state.enabled;
  if (enabled && !isProfileValid(activeProfile(state))) return null;
  return { ...state, enabled, ...clearHealthRuntime() };
}

// Next configured profile, wrapping and skipping incomplete ones. Returns
// null when there is no different valid target (single profile, or only
// invalid peers). Does not change `enabled`.
export function nextNamedProfileId(state: ProxyState): string | null {
  const { profiles } = state;
  if (profiles.length === 0) return null;
  const currentIndex = profiles.findIndex((profile) => profile.id === state.activeProfileId);
  const start = currentIndex >= 0 ? currentIndex : -1;
  for (let step = 1; step <= profiles.length; step += 1) {
    const profile = profiles[(start + step) % profiles.length];
    if (profile && isProfileValid(profile) && profile.id !== state.activeProfileId) {
      return profile.id;
    }
  }
  return null;
}

export function cycleNamedProfile(state: ProxyState): ProxyState | null {
  const activeProfileId = nextNamedProfileId(state);
  if (!activeProfileId) return null;
  return { ...state, activeProfileId, ...clearHealthRuntime() };
}

export function applyCommand(command: string, state: ProxyState): ProxyState | null {
  switch (command) {
    case COMMAND_TOGGLE:
      return toggleProxyState(state);
    case COMMAND_NEXT_PROFILE:
      return cycleNamedProfile(state);
    default:
      return null;
  }
}
