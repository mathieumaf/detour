import { DEFAULT_PROFILE, DEFAULT_STATE, DIRECT_ACTION } from './types';
import type { ProxyProfile, ProxyScheme, ProxyState, RoutingRule } from './types';
import { isValidHostPattern } from './bypass';
import { sanitizeRules } from './rules';

// One-shot SwitchyOmega → Detour mapper. Accepts an options/backup object
// (schemaVersion + "+name" profile keys) or a single exported profile.
// FixedProfiles and host-like SwitchProfile rules become proxyState;
// anything Detour cannot represent is listed in `skipped`.

export type ImportSource = 'detour' | 'switchyomega';

export interface ImportSkip {
  kind: 'profile' | 'rule';
  name: string;
  reason: string;
}

export interface ImportResult {
  state: ProxyState;
  source: ImportSource;
  skipped: ImportSkip[];
}

const SCHEMES: readonly ProxyScheme[] = ['http', 'https', 'socks4', 'socks5'];

const SKIP_PROFILE_TYPES: Record<string, string> = {
  PacProfile: 'PAC scripts are not supported.',
  AutoDetectProfile: 'Auto-detect PAC profiles are not supported.',
  RuleListProfile: 'Rule list / AutoProxy profiles are not supported.',
  SwitchyRuleListProfile: 'Rule list / AutoProxy profiles are not supported.',
  AutoProxyRuleListProfile: 'Rule list / AutoProxy profiles are not supported.',
  SystemProfile: 'The system proxy profile is not supported.',
  VirtualProfile: 'Virtual profiles are not imported; rules resolve to the target when possible.',
};

const SKIP_CONDITION_TYPES: Record<string, string> = {
  HostRegexCondition: 'regex host conditions are not supported.',
  UrlRegexCondition: 'regex URL conditions are not supported.',
  KeywordCondition: 'keyword conditions are not supported.',
  TimeCondition: 'time conditions are not supported.',
  WeekdayCondition: 'weekday conditions are not supported.',
  HostLevelsCondition: 'host-level conditions are not supported.',
  TrueCondition: 'match-all conditions are not supported.',
  FalseCondition: 'disabled rules are not imported.',
};

const SERVER_KEYS = ['fallbackProxy', 'proxyForHttps', 'proxyForHttp'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function skip(kind: ImportSkip['kind'], name: string, reason: string): ImportSkip {
  return { kind, name, reason };
}

export function isSwitchyOmegaExport(raw: Record<string, unknown>): boolean {
  if (raw.app === 'detour') return false;
  if (typeof raw.schemaVersion === 'number') return true;
  if (typeof raw.profileType === 'string') return true;
  for (const [key, value] of Object.entries(raw)) {
    if (
      key.startsWith('+') &&
      isRecord(value) &&
      typeof value.profileType === 'string'
    ) {
      return true;
    }
  }
  return false;
}

// Collect "+name" entries, or treat a lone profile object as one entry.
function omegaProfiles(raw: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  if (typeof raw.profileType === 'string') {
    const name =
      typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'imported';
    out.set(name, raw);
    return out;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('+') || !isRecord(value)) continue;
    const name =
      typeof value.name === 'string' && value.name.trim()
        ? value.name.trim()
        : key.slice(1);
    if (name) out.set(name, value);
  }
  return out;
}

function parseServer(raw: unknown): { scheme: ProxyScheme; host: string; port: number } | null {
  if (!isRecord(raw)) return null;
  const scheme = raw.scheme as ProxyScheme;
  if (!SCHEMES.includes(scheme)) return null;
  const host = typeof raw.host === 'string' ? raw.host.trim() : '';
  if (!host) return null;
  const port = Number(raw.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { scheme, host, port };
}

function sameServer(
  a: { scheme: string; host: string; port: number },
  b: { scheme: string; host: string; port: number },
): boolean {
  return a.scheme === b.scheme && a.host === b.host && a.port === b.port;
}

function pickAuth(auth: unknown, key: string): { username: string; password: string } {
  if (!isRecord(auth)) return { username: '', password: '' };
  const bucket = [auth[key], auth.all, auth.fallbackProxy].find(isRecord);
  return {
    username: typeof bucket?.username === 'string' ? bucket.username : '',
    password: typeof bucket?.password === 'string' ? bucket.password : '',
  };
}

// HostWildcard `*.example.com` matches the apex and every descendant — the
// same as Detour's `.example.com`. Extra * or ? in the rest of the pattern
// (e.g. `*.google.com.*`) cannot be represented.
function mapHostWildcardPattern(raw: string): string | null {
  const pattern = raw.trim();
  if (!pattern) return null;
  const lower = pattern.toLowerCase();
  if (lower === '<local>' || lower === '<private>') return lower;
  if (pattern === '*') return null;
  if (pattern.includes('/')) return isValidHostPattern(pattern) ? pattern : null;
  if (pattern.includes('://')) return null;

  let domain = pattern;
  if (domain.startsWith('**.')) domain = domain.slice(2);
  else if (domain.startsWith('*.')) domain = domain.slice(2);
  else if (domain.startsWith('.')) domain = domain.slice(1);
  else {
    if (/[*?]/.test(domain)) return null;
    return isValidHostPattern(domain) ? domain : null;
  }
  if (!domain || /[*?]/.test(domain) || !isValidHostPattern(domain)) return null;
  return `.${domain}`;
}

// True for `host:port` / `ipv4:port` / `[ipv6]:port`. Bare IPv6 (`::1`)
// has colons but is not port-qualified.
function hasPortSuffix(pattern: string): boolean {
  if (pattern.includes('/')) return false;
  const colon = pattern.lastIndexOf(':');
  if (colon <= 0) return false;
  const port = pattern.slice(colon + 1);
  if (!/^\d+$/.test(port)) return false;
  const host = pattern.slice(0, colon);
  return (host.startsWith('[') && host.endsWith(']')) || !host.includes(':');
}

// BypassCondition uses Chromium's bypass language, which Detour already
// shares. A leading space is Chromium's `<local>` shorthand. Scheme- or
// port-qualified entries have no Detour equivalent.
function mapBypassPattern(raw: string): string | null {
  if (raw === ' ' || raw.trim().toLowerCase() === '<local>') return '<local>';
  const pattern = raw.trim();
  if (!pattern) return null;
  if (pattern.toLowerCase() === '<private>') return '<private>';
  if (pattern.includes('://')) return null;
  if (hasPortSuffix(pattern)) return null;
  if (pattern.startsWith('.')) {
    const mapped = `*${pattern}`;
    return isValidHostPattern(mapped) ? mapped : null;
  }
  return isValidHostPattern(pattern) ? pattern : null;
}

// *://host/* → host, the only URL wildcard Detour can treat as a host rule.
function hostFromUrlWildcard(pattern: string): string | null {
  const match = pattern.trim().match(/^\*:\/\/((?:[\w?*._-])+?)\/\*$/);
  return match?.[1] ?? null;
}

function splitPatterns(pattern: string): string[] {
  return pattern.split('|').map((part) => part.trim()).filter(Boolean);
}

function mapFixedProfile(
  name: string,
  raw: Record<string, unknown>,
  skipped: ImportSkip[],
): ProxyProfile | null {
  const reserved = name.toLowerCase();
  if (reserved === 'direct' || reserved === 'system') {
    skipped.push(skip('profile', name, 'The built-in direct/system names cannot be imported as profiles.'));
    return null;
  }

  const parsed: { key: string; server: NonNullable<ReturnType<typeof parseServer>> }[] = [];
  for (const key of SERVER_KEYS) {
    const server = parseServer(raw[key]);
    if (server) parsed.push({ key, server });
  }
  if (!parsed[0]) {
    skipped.push(skip('profile', name, 'No HTTP/HTTPS/SOCKS server is configured.'));
    return null;
  }
  const fallback = parsed.find((item) => item.key === 'fallbackProxy') ?? parsed[0];
  if (parsed.some((item) => !sameServer(item.server, fallback.server))) {
    skipped.push(
      skip('profile', name, 'Per-protocol proxies (different HTTP/HTTPS servers) are not supported.'),
    );
    return null;
  }

  const bypassList: string[] = [];
  if (Array.isArray(raw.bypassList)) {
    for (const entry of raw.bypassList) {
      if (!isRecord(entry)) continue;
      const pattern = typeof entry.pattern === 'string' ? entry.pattern : '';
      const mapped = mapBypassPattern(pattern);
      if (mapped) {
        if (!bypassList.includes(mapped)) bypassList.push(mapped);
        continue;
      }
      if (!pattern.trim() && pattern !== ' ') continue;
      skipped.push(
        skip(
          'rule',
          `${name} bypass ${pattern.trim() || JSON.stringify(pattern)}`,
          'This bypass entry is not a host, wildcard, CIDR, <local>, or <private> pattern.',
        ),
      );
    }
  } else {
    bypassList.push(...DEFAULT_PROFILE.bypassList);
  }

  const auth = pickAuth(raw.auth, fallback.key);
  return {
    id: name,
    name,
    scheme: fallback.server.scheme,
    host: fallback.server.host,
    port: fallback.server.port,
    username: auth.username,
    password: auth.password,
    bypassList,
  };
}

function resolveTarget(
  profileName: string,
  profiles: Map<string, Record<string, unknown>>,
  importedIds: Set<string>,
  seen: Set<string> = new Set(),
): string | null {
  if (profileName.toLowerCase() === 'direct') return DIRECT_ACTION;
  if (importedIds.has(profileName)) return profileName;
  if (seen.has(profileName)) return null;
  seen.add(profileName);
  const raw = profiles.get(profileName);
  if (!raw) return null;
  if (raw.profileType === 'VirtualProfile') {
    const next = typeof raw.defaultProfileName === 'string' ? raw.defaultProfileName : '';
    return next ? resolveTarget(next, profiles, importedIds, seen) : null;
  }
  return null;
}

function mapConditionPatterns(
  condition: Record<string, unknown>,
): { patterns?: string[]; reason?: string } {
  const type = typeof condition.conditionType === 'string' ? condition.conditionType : '';
  if (SKIP_CONDITION_TYPES[type]) return { reason: SKIP_CONDITION_TYPES[type] };

  if (type === 'IpCondition') {
    const ip = typeof condition.ip === 'string' ? condition.ip.trim().replace(/^\[|\]$/g, '') : '';
    const prefix = Number(condition.prefixLength);
    const cidr = `${ip}/${prefix}`;
    return isValidHostPattern(cidr)
      ? { patterns: [cidr] }
      : { reason: 'this IP condition is not a valid CIDR pattern.' };
  }

  if (type === 'HostWildcardCondition' || type === 'BypassCondition') {
    const raw = typeof condition.pattern === 'string' ? condition.pattern : '';
    const patterns: string[] = [];
    for (const part of splitPatterns(raw)) {
      const mapped =
        type === 'BypassCondition' ? mapBypassPattern(part) : mapHostWildcardPattern(part);
      if (mapped) patterns.push(mapped);
      else {
        return {
          reason:
            type === 'BypassCondition'
              ? 'this bypass pattern is not a host, wildcard, CIDR, <local>, or <private> rule.'
              : 'this host wildcard cannot be expressed as a Detour host pattern.',
        };
      }
    }
    return patterns.length ? { patterns } : { reason: 'the condition has no usable pattern.' };
  }

  if (type === 'UrlWildcardCondition') {
    const raw = typeof condition.pattern === 'string' ? condition.pattern : '';
    const patterns: string[] = [];
    for (const part of splitPatterns(raw)) {
      const host = hostFromUrlWildcard(part);
      const mapped = host ? mapHostWildcardPattern(host) : null;
      if (!mapped) {
        return { reason: 'this URL wildcard is not a *://host/* pattern Detour can import.' };
      }
      patterns.push(mapped);
    }
    return patterns.length ? { patterns } : { reason: 'the condition has no usable pattern.' };
  }

  if (!type) return { reason: 'the rule has no condition type.' };
  return { reason: `${type} is not supported.` };
}

function chosenSwitchName(
  raw: Record<string, unknown>,
  switchNames: string[],
): string | undefined {
  const startup =
    typeof raw['-startupProfileName'] === 'string' ? raw['-startupProfileName'].trim() : '';
  if (startup && switchNames.includes(startup)) return startup;
  return switchNames[0];
}

export function importSwitchyOmega(raw: Record<string, unknown>): ImportResult {
  const skipped: ImportSkip[] = [];
  const all = omegaProfiles(raw);
  const profiles: ProxyProfile[] = [];
  const importedIds = new Set<string>();
  const switchNames: string[] = [];

  for (const [name, profile] of all) {
    const type = typeof profile.profileType === 'string' ? profile.profileType : '';
    if (type === 'SwitchProfile') {
      switchNames.push(name);
      continue;
    }
    if (type === 'FixedProfile') {
      const mapped = mapFixedProfile(name, profile, skipped);
      if (mapped) {
        profiles.push(mapped);
        importedIds.add(mapped.id);
      }
      continue;
    }
    const reason = SKIP_PROFILE_TYPES[type] ?? `profile type ${type || '(missing)'} is not supported.`;
    skipped.push(skip('profile', name, reason));
  }

  if (!profiles.length) {
    const details = skipped.length
      ? ` Skipped ${skipped.length} incompatible ${skipped.length === 1 ? 'item' : 'items'}: ${skipped
          .map((item) => `${item.name} (${item.reason})`)
          .join('; ')}`
      : '';
    throw new Error(`No importable proxy profiles in this SwitchyOmega file.${details}`);
  }

  const chosenSwitch = chosenSwitchName(raw, switchNames);
  for (const name of switchNames) {
    if (name === chosenSwitch) continue;
    skipped.push(
      skip(
        'profile',
        name,
        `Detour has one rule list; imported rules from "${chosenSwitch}".`,
      ),
    );
  }

  const rules: RoutingRule[] = [];
  if (chosenSwitch) {
    const switchProfile = all.get(chosenSwitch);
    const defaultName =
      typeof switchProfile?.defaultProfileName === 'string'
        ? switchProfile.defaultProfileName
        : 'direct';
    const defaultAction = resolveTarget(defaultName, all, importedIds);
    if (defaultName.toLowerCase() === 'direct') {
      skipped.push(
        skip(
          'rule',
          `${chosenSwitch} default`,
          'Unmatched hosts cannot fall back to Direct; they use the active profile.',
        ),
      );
    } else if (!defaultAction || defaultAction === DIRECT_ACTION) {
      skipped.push(
        skip(
          'rule',
          `${chosenSwitch} default → ${defaultName}`,
          'This auto-switch default is not an imported proxy profile.',
        ),
      );
    }

    const rawRules = Array.isArray(switchProfile?.rules) ? switchProfile.rules : [];
    for (const item of rawRules) {
      if (!isRecord(item)) continue;
      const profileName = typeof item.profileName === 'string' ? item.profileName : '';
      const condition = isRecord(item.condition) ? item.condition : {};
      const type = typeof condition.conditionType === 'string' ? condition.conditionType : 'condition';
      const labelPattern =
        typeof condition.pattern === 'string'
          ? condition.pattern
          : typeof condition.ip === 'string'
            ? `${condition.ip}/${condition.prefixLength ?? '?'}`
            : type;
      const label = `${chosenSwitch}: ${labelPattern} → ${profileName || '(none)'}`;

      const mapped = mapConditionPatterns(condition);
      if (!mapped.patterns) {
        skipped.push(skip('rule', label, mapped.reason ?? 'this condition is not supported.'));
        continue;
      }
      const action = resolveTarget(profileName, all, importedIds);
      if (!action) {
        skipped.push(
          skip(
            'rule',
            label,
            profileName.toLowerCase() === 'system'
              ? 'the system profile is not supported.'
              : `action "${profileName}" is not an imported profile or Direct.`,
          ),
        );
        continue;
      }
      for (const match of mapped.patterns) {
        rules.push({ id: `so-rule-${rules.length}`, match, action });
      }
    }
  }

  const startup =
    typeof raw['-startupProfileName'] === 'string' ? raw['-startupProfileName'].trim() : '';
  const activeProfileId = importedIds.has(startup)
    ? startup
    : (() => {
        if (!chosenSwitch) return profiles[0]!.id;
        const defaultName =
          typeof all.get(chosenSwitch)?.defaultProfileName === 'string'
            ? (all.get(chosenSwitch)!.defaultProfileName as string)
            : '';
        const resolved = resolveTarget(defaultName, all, importedIds);
        return resolved && resolved !== DIRECT_ACTION ? resolved : profiles[0]!.id;
      })();

  const profileIds = new Set(profiles.map((profile) => profile.id));
  return {
    source: 'switchyomega',
    skipped,
    state: {
      ...DEFAULT_STATE,
      activeProfileId,
      profiles,
      rules: sanitizeRules(rules, profileIds),
    },
  };
}
