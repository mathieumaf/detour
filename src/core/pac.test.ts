import { describe, expect, test } from 'bun:test';
import { home, makeState, work } from './fixtures/state';
import { buildPacScript, pacReturnForProfile } from './pac';
import { resolveProxyDecision } from './rules';
import { DIRECT_ACTION } from './types';
import type { ProxyState } from './types';

// Run a generated PAC script the way Chromium does: FindProxyForURL(url, host).
function evaluatePac(script: string, url: string, host = new URL(url).hostname): string {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- evaluating the generated script is the point of the test
  const load = new Function(`${script}\nreturn FindProxyForURL;`) as () => (
    url: string,
    host: string,
  ) => string;
  return load()(url, host);
}

// What the TypeScript matcher decides, in PAC vocabulary.
function expectedPacReturn(url: string, state: ProxyState): string {
  const decision = resolveProxyDecision(url, state);
  return decision === DIRECT_ACTION ? 'DIRECT' : pacReturnForProfile(decision);
}

describe('pacReturnForProfile', () => {
  test('names each scheme the way PAC expects', () => {
    const base = { ...work, host: 'proxy.example', port: 3128 };
    expect(pacReturnForProfile({ ...base, scheme: 'http' })).toBe('PROXY proxy.example:3128');
    expect(pacReturnForProfile({ ...base, scheme: 'https' })).toBe('HTTPS proxy.example:3128');
    expect(pacReturnForProfile({ ...base, scheme: 'socks4' })).toBe('SOCKS proxy.example:3128');
    expect(pacReturnForProfile({ ...base, scheme: 'socks5' })).toBe('SOCKS5 proxy.example:3128');
  });

  test('strips anything that is not a host character', () => {
    const hostile = { ...work, scheme: 'http' as const, host: ' evil.example"; DIRECT\n', port: 1 };
    expect(pacReturnForProfile(hostile)).toBe('PROXY evil.exampleDIRECT:1');
  });
});

describe('buildPacScript', () => {
  const urls = [
    'https://github.com/foo',
    'http://10.1.2.3/',
    'http://192.168.0.9/',
    'https://example.com/',
    'http://localhost/',
    'https://git.internal.example.com/',
    'http://8.8.8.8/',
  ];

  test('routes rules first, then the active profile and its bypass list', () => {
    const s = makeState();
    const script = buildPacScript(s);
    expect(script).toContain('function FindProxyForURL');
    for (const url of urls) {
      expect(evaluatePac(script, url)).toBe(expectedPacReturn(url, s));
    }
    expect(evaluatePac(script, 'https://github.com/foo')).toBe(pacReturnForProfile(work));
    expect(evaluatePac(script, 'http://10.1.2.3/')).toBe('DIRECT');
    expect(evaluatePac(script, 'https://example.com/')).toBe(pacReturnForProfile(home));
  });

  test('with no rules, still honours the active profile bypass', () => {
    const s = makeState({ rules: [] });
    const script = buildPacScript(s);
    expect(evaluatePac(script, 'https://git.internal.example.com/')).toBe('DIRECT');
    expect(evaluatePac(script, 'https://example.com/')).toBe(pacReturnForProfile(home));
  });

  test('skips a rule whose profile is missing or incomplete', () => {
    const s = makeState({
      profiles: [{ ...work, host: '' }, home],
      rules: [
        { id: 'a', match: 'github.com', action: work.id },
        { id: 'b', match: 'gitlab.com', action: 'gone' },
      ],
    });
    const script = buildPacScript(s);
    expect(evaluatePac(script, 'https://github.com/')).toBe(pacReturnForProfile(home));
    expect(evaluatePac(script, 'https://gitlab.com/')).toBe(pacReturnForProfile(home));
  });

  test('falls back to DIRECT when the active profile is incomplete', () => {
    const s = makeState({ profiles: [work, { ...home, host: '' }], rules: [] });
    expect(evaluatePac(buildPacScript(s), 'https://example.com/')).toBe('DIRECT');
  });

  test('a hostile rule pattern cannot break out of the script', () => {
    const s = makeState({
      rules: [{ id: 'x', match: '"); return "PROXY evil:1"; ("', action: DIRECT_ACTION }],
    });
    const script = buildPacScript(s);
    expect(evaluatePac(script, 'https://example.com/')).toBe(pacReturnForProfile(home));
  });
});

// PAC_RUNTIME is a hand-written ES5 port of patterns.ts. Every pattern is
// checked against every host, as a Direct rule and as a bypass entry, so the
// two implementations cannot drift apart unnoticed.
describe('PAC matcher agrees with the TypeScript matcher', () => {
  const patterns = [
    '<local>',
    '<private>',
    '<PRIVATE>',
    '10.0.0.0/8',
    '192.168.1.10/32',
    '0.0.0.0/0',
    'fd00::/8',
    'FD00::/8',
    '::1/128',
    '2001:db8::/32',
    '::ffff:10.0.0.0/104',
    'example.com',
    'EXAMPLE.net',
    '*.example.com',
    '.example.org',
    ' spaced.example ',
    '10.0.0.0/99',
    'not-cidr/x',
  ];
  const hosts = [
    'localhost',
    'intranet',
    '127.0.0.1',
    '[::1]',
    '10.1.2.3',
    '172.20.0.1',
    '172.32.0.1',
    '192.168.1.10',
    '192.168.1.11',
    '169.254.1.1',
    '8.8.8.8',
    '[fd12::1]',
    '[fe80::1]',
    '[2001:db8::1]',
    '[2001:db9::1]',
    '[::ffff:10.0.0.1]',
    'example.com',
    'a.example.com',
    'a.b.example.com',
    'notexample.com',
    'example.org',
    'sub.example.org',
    'example.net',
    'spaced.example',
  ];

  test('as a Direct rule', () => {
    for (const pattern of patterns) {
      const s = makeState({
        profiles: [work, { ...home, bypassList: [] }],
        rules: [{ id: 'r', match: pattern, action: DIRECT_ACTION }],
      });
      const script = buildPacScript(s);
      for (const host of hosts) {
        const url = `http://${host}/`;
        expect(`${pattern} ~ ${host} → ${evaluatePac(script, url)}`).toBe(
          `${pattern} ~ ${host} → ${expectedPacReturn(url, s)}`,
        );
      }
    }
  });

  test('as a bypass entry', () => {
    for (const pattern of patterns) {
      const s = makeState({ profiles: [work, { ...home, bypassList: [pattern] }], rules: [] });
      const script = buildPacScript(s);
      for (const host of hosts) {
        const url = `http://${host}/`;
        expect(`${pattern} ~ ${host} → ${evaluatePac(script, url)}`).toBe(
          `${pattern} ~ ${host} → ${expectedPacReturn(url, s)}`,
        );
      }
    }
  });

  test('whether or not Chromium passes IPv6 hosts in brackets', () => {
    const s = makeState({ profiles: [work, { ...home, bypassList: [] }] });
    const script = buildPacScript(s);
    for (const host of ['::1', 'fd12::1', '2001:db8::1']) {
      const url = `http://[${host}]/`;
      expect(evaluatePac(script, url, host)).toBe(evaluatePac(script, url, `[${host}]`));
      expect(evaluatePac(script, url, host)).toBe(expectedPacReturn(url, s));
    }
  });
});
