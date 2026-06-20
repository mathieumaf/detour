// Shared proxy model + persistence. Single source of truth for the popup and
// the background service worker, kept in sync through chrome.storage.local.

export type ProxyScheme = 'http' | 'https' | 'socks4' | 'socks5';

export interface ProxyProfile {
  scheme: ProxyScheme;
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface ProxyState {
  enabled: boolean;
  profile: ProxyProfile;
}

export interface TestResult {
  ok: boolean;
  ip?: string;
  ms?: number;
  error?: string;
}

export const STORAGE_KEY = 'proxyState';

export const DEFAULT_PROFILE: ProxyProfile = {
  scheme: 'http',
  host: '',
  port: 8080,
  username: '',
  password: '',
};

export const DEFAULT_STATE: ProxyState = {
  enabled: false,
  profile: { ...DEFAULT_PROFILE },
};

// Whether the current browser can authenticate a proxy of this scheme.
// Firefox authenticates every scheme (SOCKS credentials ride in ProxyInfo);
// Chromium can only authenticate HTTP/HTTPS proxies, never SOCKS.
export function authSupported(scheme: ProxyScheme): boolean {
  if (import.meta.env.FIREFOX) return true;
  return scheme === 'http' || scheme === 'https';
}

export function isProfileValid(p: ProxyProfile): boolean {
  return (
    p.host.trim() !== '' &&
    Number.isInteger(p.port) &&
    p.port >= 1 &&
    p.port <= 65535
  );
}

export async function loadState(): Promise<ProxyState> {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  const stored = res[STORAGE_KEY] as Partial<ProxyState> | undefined;
  return {
    enabled: stored?.enabled ?? DEFAULT_STATE.enabled,
    profile: { ...DEFAULT_PROFILE, ...stored?.profile },
  };
}

export async function saveState(state: ProxyState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

// Ask the background worker to test the given profile and report the exit IP.
export function testProxy(profile: ProxyProfile): Promise<TestResult> {
  return chrome.runtime.sendMessage({ type: 'test-proxy', profile }) as Promise<TestResult>;
}
