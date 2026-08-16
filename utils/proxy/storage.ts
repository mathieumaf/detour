import { STORAGE_KEY, DEFAULT_PROFILE, DEFAULT_STATE } from './types';
import type { ProxyProfile, ProxyState } from './types';
import { sanitizeRules } from './rules';
import {
  sanitizeFailoverEvent,
  sanitizeHealthCheck,
  sanitizeHealthStatus,
} from './health';

function sanitizeProfile(raw: Partial<ProxyProfile>, index: number): ProxyProfile {
  const port = Number(raw.port);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `profile-${index}`,
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : index === 0
          ? DEFAULT_PROFILE.name
          : `Profile ${index + 1}`,
    scheme:
      raw.scheme === 'http' || raw.scheme === 'https' || raw.scheme === 'socks4' || raw.scheme === 'socks5'
        ? raw.scheme
        : DEFAULT_PROFILE.scheme,
    host: typeof raw.host === 'string' ? raw.host : '',
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PROFILE.port,
    username: typeof raw.username === 'string' ? raw.username : '',
    password: typeof raw.password === 'string' ? raw.password : '',
    bypassList: Array.isArray(raw.bypassList)
      ? raw.bypassList.filter((item): item is string => typeof item === 'string')
      : [...DEFAULT_PROFILE.bypassList],
  };
}

export async function loadState(): Promise<ProxyState> {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  const stored = res[STORAGE_KEY] as
    | (Partial<ProxyState> & { profile?: Partial<ProxyProfile> })
    | undefined;
  // Version 1 stored one `profile`. Treat it as the first profile so existing
  // users upgrade without losing their active proxy configuration.
  const profiles = Array.isArray(stored?.profiles) && stored.profiles.length
    ? stored.profiles.map((profile, index) => sanitizeProfile(profile, index))
    : [sanitizeProfile(stored?.profile ?? DEFAULT_PROFILE, 0)];
  const activeProfileId = profiles.some((profile) => profile.id === stored?.activeProfileId)
    ? stored!.activeProfileId!
    : (profiles[0]?.id ?? DEFAULT_PROFILE.id);
  const profileIds = new Set(profiles.map((profile) => profile.id));
  return {
    enabled: stored?.enabled ?? DEFAULT_STATE.enabled,
    activeProfileId,
    profiles,
    // Missing rules (pre-1.5 state) become an empty list.
    rules: sanitizeRules(stored?.rules, profileIds),
    // Missing health fields (pre-1.6 state) preserve the opt-in default: off.
    healthCheck: sanitizeHealthCheck(stored?.healthCheck, profileIds),
    healthStatus: sanitizeHealthStatus(stored?.healthStatus, profileIds),
    lastFailover: sanitizeFailoverEvent(stored?.lastFailover),
  };
}

export async function saveState(state: ProxyState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}
