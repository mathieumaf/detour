import type { ProxyProfile, ProxyScheme } from './types';

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
