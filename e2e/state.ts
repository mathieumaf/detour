// Shape written to chrome.storage.local under `proxyState` — the same object
// the popup and options page persist (see utils/proxy/types.ts). The background
// sanitizes it on read, so these builders only need to stay compatible.

export const STORAGE_KEY = 'proxyState';
export const DIRECT = 'direct';

export interface E2EProfile {
  id: string;
  name: string;
  scheme: 'http' | 'https' | 'socks4' | 'socks5';
  host: string;
  port: number;
  username: string;
  password: string;
  bypassList: string[];
}

export interface E2ERule {
  id: string;
  match: string;
  action: string;
}

export interface E2EState {
  enabled: boolean;
  activeProfileId: string;
  profiles: E2EProfile[];
  rules: E2ERule[];
  healthCheck: {
    enabled: boolean;
    intervalSeconds: number;
    failureThreshold: number;
    fallbackProfileId: string;
  };
  healthStatus: { profileId: string; consecutiveFailures: number };
  lastFailover: null;
}

export function profile(partial: Partial<E2EProfile> & Pick<E2EProfile, 'host' | 'port'>): E2EProfile {
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

export function state(partial: Partial<E2EState> & Pick<E2EState, 'profiles'>): E2EState {
  const profiles = partial.profiles;
  const first = profiles[0];
  return {
    enabled: false,
    activeProfileId: first?.id ?? 'default',
    rules: [],
    healthCheck: {
      enabled: false,
      intervalSeconds: 60,
      failureThreshold: 2,
      fallbackProfileId: DIRECT,
    },
    healthStatus: { profileId: '', consecutiveFailures: 0 },
    lastFailover: null,
    ...partial,
    profiles,
  };
}

export function activeProfile(current: E2EState): E2EProfile {
  const found = current.profiles.find((item) => item.id === current.activeProfileId) ?? current.profiles[0];
  if (!found) throw new Error('e2e proxy state has no profiles');
  return found;
}
