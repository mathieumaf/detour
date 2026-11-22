// Builders for the value the extension keeps in chrome.storage.local. They
// reuse the extension's own types, so a model change breaks the suite at
// compile time instead of at run time.

import { DEFAULT_HEALTH_CHECK, DIRECT_ACTION } from '../src/core/types';
import type { ProxyProfile, ProxyState } from '../src/core/types';

export { DIRECT_ACTION, STORAGE_KEY } from '../src/core/types';
export type { ProxyProfile, ProxyState } from '../src/core/types';

export function profile(
  partial: Partial<ProxyProfile> & Pick<ProxyProfile, 'host' | 'port'>,
): ProxyProfile {
  return {
    id: 'default',
    name: 'Default profile',
    scheme: 'http',
    username: '',
    password: '',
    bypassList: [],
    ...partial,
  };
}

export function state(partial: Partial<ProxyState> & Pick<ProxyState, 'profiles'>): ProxyState {
  return {
    enabled: false,
    activeProfileId: partial.profiles[0]?.id ?? 'default',
    rules: [],
    healthCheck: { ...DEFAULT_HEALTH_CHECK, fallbackProfileId: DIRECT_ACTION },
    healthStatus: { profileId: '', consecutiveFailures: 0 },
    lastFailover: null,
    ...partial,
  };
}
