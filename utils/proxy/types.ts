// The proxy data model and its defaults. Shared verbatim between the popup and
// the background worker; persisted as a single object in chrome.storage.local.

export type ProxyScheme = 'http' | 'https' | 'socks4' | 'socks5';

export interface ProxyProfile {
  id: string;
  name: string;
  scheme: ProxyScheme;
  host: string;
  port: number;
  username: string;
  password: string;
  // Hosts that skip the proxy and connect directly. Chromium consumes this
  // verbatim as its proxy bypassList; Firefox has no such field, so we apply
  // it ourselves in the onRequest listener via isBypassed().
  bypassList: string[];
}

// A host pattern that selects a profile or Direct. Evaluated top-down;
// first match wins. Unmatched hosts fall back to the active profile.
export const DIRECT_ACTION = 'direct';

export interface RoutingRule {
  id: string;
  // Same pattern language as the bypass list: exact host, *.domain.tld,
  // .domain.tld, CIDR, <local>, <private>.
  match: string;
  // Profile id, or DIRECT_ACTION.
  action: string;
}

export interface HealthCheckSettings {
  enabled: boolean;
  intervalSeconds: number;
  failureThreshold: number;
  // Profile id, or DIRECT_ACTION.
  fallbackProfileId: string;
}

export interface FailoverEvent {
  from: string;
  to: string;
  at: number;
}

export interface HealthCheckStatus {
  profileId: string;
  consecutiveFailures: number;
}

export interface ProxyState {
  enabled: boolean;
  activeProfileId: string;
  profiles: ProxyProfile[];
  rules: RoutingRule[];
  healthCheck: HealthCheckSettings;
  healthStatus: HealthCheckStatus;
  lastFailover: FailoverEvent | null;
}

export interface TestResult {
  ok: boolean;
  ip?: string;
  ms?: number;
  error?: string;
}

export const STORAGE_KEY = 'proxyState';
export const DEFAULT_HEALTH_CHECK: HealthCheckSettings = {
  enabled: false,
  intervalSeconds: 60,
  failureThreshold: 2,
  fallbackProfileId: DIRECT_ACTION,
};

export const DEFAULT_PROFILE: ProxyProfile = {
  id: 'default',
  name: 'Default profile',
  scheme: 'http',
  host: '',
  port: 8080,
  username: '',
  password: '',
  bypassList: ['<local>'],
};

export const DEFAULT_STATE: ProxyState = {
  enabled: false,
  activeProfileId: DEFAULT_PROFILE.id,
  profiles: [{ ...DEFAULT_PROFILE, bypassList: [...DEFAULT_PROFILE.bypassList] }],
  rules: [],
  healthCheck: { ...DEFAULT_HEALTH_CHECK },
  healthStatus: { profileId: '', consecutiveFailures: 0 },
  lastFailover: null,
};

export function activeProfile(state: ProxyState): ProxyProfile {
  return (
    state.profiles.find((profile) => profile.id === state.activeProfileId) ??
    state.profiles[0] ??
    DEFAULT_PROFILE
  );
}
