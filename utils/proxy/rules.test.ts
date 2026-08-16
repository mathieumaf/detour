import { describe, expect, test } from 'bun:test';
import { DIRECT_ACTION, DEFAULT_STATE, type ProxyProfile, type ProxyState } from './types';
import { isValidHostPattern, matchHostPattern } from './bypass';
import { dropRulesForProfile, resolveProxyDecision, resolveRoute, sanitizeRules } from './rules';
import { buildPacScript, evaluatePac, pacReturnForDecision, pacReturnForProfile } from './pac';
import { buildExport, parseImport } from './transfer';

const work: ProxyProfile = {
  id: 'work',
  name: 'Work',
  scheme: 'https',
  host: 'proxy.work.example',
  port: 8443,
  username: '',
  password: '',
  bypassList: ['<local>'],
};

const home: ProxyProfile = {
  id: 'home',
  name: 'Home',
  scheme: 'socks5',
  host: '10.8.0.1',
  port: 1080,
  username: '',
  password: '',
  bypassList: ['*.internal.example.com'],
};

function state(partial: Partial<ProxyState> = {}): ProxyState {
  return {
    enabled: true,
    activeProfileId: home.id,
    profiles: [work, home],
    rules: [
      { id: 'r1', match: 'github.com', action: work.id },
      { id: 'r2', match: '<private>', action: DIRECT_ACTION },
      { id: 'r3', match: '10.0.0.0/8', action: DIRECT_ACTION },
    ],
    healthCheck: { ...DEFAULT_STATE.healthCheck },
    healthStatus: { ...DEFAULT_STATE.healthStatus },
    lastFailover: null,
    ...partial,
  };
}

describe('isValidHostPattern', () => {
  test('accepts hosts, wildcards, CIDR, and shorthands', () => {
    expect(isValidHostPattern('github.com')).toBe(true);
    expect(isValidHostPattern('*.example.com')).toBe(true);
    expect(isValidHostPattern('.example.com')).toBe(true);
    expect(isValidHostPattern('10.0.0.0/8')).toBe(true);
    expect(isValidHostPattern('<local>')).toBe(true);
    expect(isValidHostPattern('<PRIVATE>')).toBe(true);
    expect(isValidHostPattern('::1/128')).toBe(true);
  });

  test('rejects empty, spaced, or malformed CIDR', () => {
    expect(isValidHostPattern('')).toBe(false);
    expect(isValidHostPattern('  ')).toBe(false);
    expect(isValidHostPattern('foo bar')).toBe(false);
    expect(isValidHostPattern('10.0.0.0/99')).toBe(false);
    expect(isValidHostPattern('not-cidr/x')).toBe(false);
  });
});

describe('matchHostPattern', () => {
  test('exact host, wildcard, and leading-dot', () => {
    expect(matchHostPattern('https://github.com/foo', 'github.com')).toBe(true);
    expect(matchHostPattern('https://www.github.com/', 'github.com')).toBe(false);
    expect(matchHostPattern('https://api.example.com/', '*.example.com')).toBe(true);
    expect(matchHostPattern('https://example.com/', '*.example.com')).toBe(false);
    expect(matchHostPattern('https://example.com/', '.example.com')).toBe(true);
    expect(matchHostPattern('https://a.example.com/', '.example.com')).toBe(true);
  });

  test('<local>, <private>, and CIDR match IP literals only', () => {
    expect(matchHostPattern('http://localhost/', '<local>')).toBe(true);
    expect(matchHostPattern('http://intranet/', '<local>')).toBe(true);
    expect(matchHostPattern('http://10.1.2.3/', '<private>')).toBe(true);
    expect(matchHostPattern('http://8.8.8.8/', '<private>')).toBe(false);
    expect(matchHostPattern('http://10.9.0.1/', '10.0.0.0/8')).toBe(true);
    expect(matchHostPattern('http://11.0.0.1/', '10.0.0.0/8')).toBe(false);
    // Hostnames are not DNS-resolved for CIDR / <private>.
    expect(matchHostPattern('https://github.com/', '10.0.0.0/8')).toBe(false);
  });
});

describe('resolveRoute / resolveProxyDecision', () => {
  test('first match wins: github.com → work, private/CIDR → direct, else home', () => {
    const s = state();
    expect(resolveRoute('https://github.com/mathieumaf/detour', s)).toEqual(work);
    expect(resolveRoute('http://10.1.2.3/', s)).toBe(DIRECT_ACTION);
    expect(resolveRoute('http://192.168.1.4/', s)).toBe(DIRECT_ACTION);
    expect(resolveRoute('https://example.com/', s)).toEqual(home);
  });

  test('skips a rule whose profile is missing or incomplete', () => {
    const s = state({
      rules: [
        { id: 'bad', match: 'github.com', action: 'missing' },
        { id: 'ok', match: 'github.com', action: work.id },
      ],
    });
    expect(resolveRoute('https://github.com/', s)).toEqual(work);
  });

  test('profile bypass still applies after a rule selects that profile', () => {
    const s = state({
      rules: [{ id: 'r', match: '*.internal.example.com', action: home.id }],
    });
    // home is selected, but its bypass list skips this host.
    expect(resolveProxyDecision('https://git.internal.example.com/', s)).toBe(DIRECT_ACTION);
    expect(resolveProxyDecision('https://other.example.com/', s)).toEqual(home);
  });

  test('empty rules fall back to the active profile (and its bypass)', () => {
    const s = state({ rules: [] });
    expect(resolveRoute('https://github.com/', s)).toEqual(home);
    expect(resolveProxyDecision('https://git.internal.example.com/', s)).toBe(DIRECT_ACTION);
  });
});

describe('sanitizeRules / dropRulesForProfile', () => {
  test('drops empty matches and unknown actions; missing list → []', () => {
    const ids = new Set([work.id]);
    expect(sanitizeRules(undefined, ids)).toEqual([]);
    expect(
      sanitizeRules(
        [
          { id: 'a', match: 'github.com', action: work.id },
          { id: 'b', match: '', action: DIRECT_ACTION },
          { id: 'c', match: 'x.com', action: 'gone' },
          { match: '<private>', action: DIRECT_ACTION },
        ],
        ids,
      ),
    ).toEqual([
      { id: 'a', match: 'github.com', action: work.id },
      { id: 'rule-3', match: '<private>', action: DIRECT_ACTION },
    ]);
  });

  test('dropRulesForProfile removes only that profile’s actions', () => {
    const rules = [
      { id: '1', match: 'a.com', action: work.id },
      { id: '2', match: 'b.com', action: DIRECT_ACTION },
      { id: '3', match: 'c.com', action: home.id },
    ];
    expect(dropRulesForProfile(rules, work.id)).toEqual([
      { id: '2', match: 'b.com', action: DIRECT_ACTION },
      { id: '3', match: 'c.com', action: home.id },
    ]);
  });
});

describe('PAC generation', () => {
  const urls = [
    'https://github.com/foo',
    'http://10.1.2.3/',
    'http://192.168.0.9/',
    'https://example.com/',
    'http://localhost/',
    'https://git.internal.example.com/',
    'http://8.8.8.8/',
  ];

  test('FindProxyForURL agrees with resolveProxyDecision for the issue scenario', () => {
    const s = state();
    const script = buildPacScript(s);
    expect(script).toContain('function FindProxyForURL');
    for (const url of urls) {
      expect(evaluatePac(script, url)).toBe(pacReturnForDecision(url, s));
    }
    expect(evaluatePac(script, 'https://github.com/foo')).toBe(pacReturnForProfile(work));
    expect(evaluatePac(script, 'http://10.1.2.3/')).toBe('DIRECT');
    expect(evaluatePac(script, 'https://example.com/')).toBe(pacReturnForProfile(home));
  });

  test('no-rule PAC still honours the active profile bypass', () => {
    const s = state({ rules: [] });
    const script = buildPacScript(s);
    expect(evaluatePac(script, 'https://git.internal.example.com/')).toBe('DIRECT');
    expect(evaluatePac(script, 'https://example.com/')).toBe(pacReturnForProfile(home));
  });
});

describe('import/export', () => {
  test('round-trips rules and health settings, and accepts a v2 file', () => {
    const s = state({
      enabled: false,
      healthCheck: {
        enabled: true,
        intervalSeconds: 120,
        failureThreshold: 3,
        fallbackProfileId: work.id,
      },
    });
    const parsed = parseImport(buildExport(s));
    expect(parsed.rules).toEqual(s.rules);
    expect(parsed.healthCheck).toEqual(s.healthCheck);
    expect(parsed.profiles.map((p) => p.id)).toEqual([work.id, home.id]);

    const v2 = {
      app: 'detour',
      version: 2,
      exportedAt: '2026-01-01T00:00:00.000Z',
      state: { enabled: false, activeProfileId: work.id, profiles: [work] },
    };
    const imported = parseImport(JSON.stringify(v2));
    expect(imported.rules).toEqual([]);
    expect(imported.healthCheck).toEqual(DEFAULT_STATE.healthCheck);
    expect(imported.profiles[0]?.id).toBe(work.id);
  });

  test('DEFAULT_STATE has an empty rule list', () => {
    expect(DEFAULT_STATE.rules).toEqual([]);
  });
});
