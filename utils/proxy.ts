// Shared proxy model + persistence. Single source of truth for the popup and
// the background service worker, kept in sync through chrome.storage.local.

export type ProxyScheme = 'http' | 'https' | 'socks4' | 'socks5';

export interface ProxyProfile {
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
  bypassList: ['<local>'],
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

// Parse the bypass textarea (one entry per line, commas also accepted) into a
// clean, de-duplicated list. Empty lines and surrounding whitespace are dropped.
export function parseBypassList(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\n,]/)) {
    const entry = part.trim();
    if (entry) seen.add(entry);
  }
  return [...seen];
}

// Render a bypass list back into textarea content.
export function formatBypassList(list: string[]): string {
  return list.join('\n');
}

// Does this URL match any bypass entry? Mirrors a pragmatic subset of Chromium's
// proxy bypass rules so Firefox (which has no native bypassList) behaves the same:
//   <local>          localhost, 127.0.0.1, ::1, and dotless hostnames
//   example.com      that exact host
//   *.example.com    any subdomain of example.com (not the bare domain)
//   .example.com     example.com and its subdomains
export function isBypassed(url: string, bypassList: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  for (const raw of bypassList) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry === '<local>') {
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '[::1]' ||
        !host.includes('.')
      )
        return true;
    } else if (entry.startsWith('*.')) {
      if (host.endsWith(entry.slice(1))) return true; // ".example.com" suffix
    } else if (entry.startsWith('.')) {
      const suffix = entry.slice(1);
      if (host === suffix || host.endsWith('.' + suffix)) return true;
    } else if (host === entry) {
      return true;
    }
  }
  return false;
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
