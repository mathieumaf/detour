// Names the suite navigates to. The browsers are launched so that every one of
// them resolves to 127.0.0.1, which keeps the suite off the network. `.test`
// is a reserved TLD (RFC 2606). Hosts are listed one by one rather than with a
// wildcard, because Chromium's MAP rules are not consistent about
// `*.example.test`.

export const HOSTS = {
  ui: 'ui.detour.test',
  enabled: 'enabled.detour.test',
  direct: 'direct.detour.test',
  matched: 'matched.detour.test',
  other: 'other.detour.test',
  fallback: 'fallback.detour.test',
  bypass: 'bypass.detour.test',
  // A different parent from the bypass host, so "must be proxied" cannot be
  // satisfied by a bypass entry that matched as a suffix.
  normal: 'normal.other.test',
  auth: 'auth.detour.test',
  socks: 'socks.detour.test',
  cold: 'cold.detour.test',
  settings: 'settings.detour.test',
} as const;

// Chromium: --host-resolver-rules.
export function hostResolverRules(): string {
  return Object.values(HOSTS)
    .map((host) => `MAP ${host} 127.0.0.1`)
    .join(', ');
}

// Firefox: the network.dns.localDomains preference.
export function localDomains(): string {
  return Object.values(HOSTS).join(',');
}
