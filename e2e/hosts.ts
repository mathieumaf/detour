// Names the suite navigates to. Chromium is launched with host-resolver rules
// that map every one of these to 127.0.0.1, so nothing here can leave the machine.
// `.test` is a reserved TLD (RFC 2606). Hosts are explicit rather than a wildcard:
// Chromium's MAP rules are not consistent about `*.example.test`.

export const HOSTS = {
  ui: 'ui.detour.test',
  enabled: 'enabled.detour.test',
  direct: 'direct.detour.test',
  matched: 'matched.detour.test',
  other: 'other.detour.test',
  fallback: 'fallback.detour.test',
  bypass: 'bypass.detour.test',
  // Distinct parent from the bypass host. Chromium's bypass list can treat a
  // bare host as a suffix, so the "must be proxied" host lives on another name.
  normal: 'normal.other.test',
  auth: 'auth.detour.test',
  socks: 'socks.detour.test',
  cold: 'cold.detour.test',
} as const;

export function hostResolverRules(): string {
  return Object.values(HOSTS)
    .map((host) => `MAP ${host} 127.0.0.1`)
    .join(', ');
}
