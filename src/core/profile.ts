import { DEFAULT_PROFILE } from './types';
import type { ProxyProfile, ProxyScheme } from './types';

export const PROXY_SCHEMES: readonly ProxyScheme[] = ['http', 'https', 'socks4', 'socks5'];

function isProxyScheme(value: unknown): value is ProxyScheme {
  return PROXY_SCHEMES.includes(value as ProxyScheme);
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

// Whether a browser can authenticate a proxy of this scheme. Firefox
// authenticates every scheme (SOCKS credentials ride in ProxyInfo); Chromium
// can only authenticate HTTP/HTTPS proxies, never SOCKS.
export function authSupported(scheme: ProxyScheme, firefox: boolean): boolean {
  return firefox || scheme === 'http' || scheme === 'https';
}

// A profile is usable once it names a server. Everything else has a default.
export function isProfileValid(profile: ProxyProfile): boolean {
  return profile.host.trim() !== '' && isValidPort(profile.port);
}

// Coerce an untrusted object (stored state, an imported file) into a valid
// profile, backfilling defaults. `index` only feeds the fallback id and name.
export function sanitizeProfile(raw: Record<string, unknown>, index: number): ProxyProfile {
  const port = Number(raw.port);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `profile-${index}`,
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : index === 0
          ? DEFAULT_PROFILE.name
          : `Profile ${index + 1}`,
    scheme: isProxyScheme(raw.scheme) ? raw.scheme : DEFAULT_PROFILE.scheme,
    host: typeof raw.host === 'string' ? raw.host.trim() : '',
    port: isValidPort(port) ? port : DEFAULT_PROFILE.port,
    username: typeof raw.username === 'string' ? raw.username : '',
    password: typeof raw.password === 'string' ? raw.password : '',
    bypassList: Array.isArray(raw.bypassList)
      ? raw.bypassList.filter((item): item is string => typeof item === 'string')
      : [...DEFAULT_PROFILE.bypassList],
  };
}
