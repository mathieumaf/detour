import { describe, expect, test } from 'bun:test';
import { DIRECT_ACTION, DEFAULT_STATE } from './types';
import { buildExport, parseImport, parseImportedFile } from './transfer';
import { resolveRoute } from './rules';

const backupPath = new URL('./fixtures/switchyomega-backup.json', import.meta.url);
const realPath = new URL('./fixtures/switchyomega-real.json', import.meta.url);

async function load(url: URL): Promise<string> {
  return Bun.file(url).text();
}

describe('SwitchyOmega import', () => {
  test('maps HTTP/SOCKS profiles, auth, bypass, and host-like rules from a backup', async () => {
    const result = parseImportedFile(await load(backupPath));
    expect(result.source).toBe('switchyomega');

    const proxy = result.state.profiles.find((profile) => profile.id === 'proxy');
    const socks = result.state.profiles.find((profile) => profile.id === 'socks');
    expect(proxy).toEqual({
      id: 'proxy',
      name: 'proxy',
      scheme: 'http',
      host: 'proxy.example.com',
      port: 8080,
      username: 'alice',
      password: 's3cret',
      bypassList: ['127.0.0.1', '[::1]', 'localhost', '192.0.2.0/24'],
    });
    expect(socks).toEqual({
      id: 'socks',
      name: 'socks',
      scheme: 'socks5',
      host: '127.0.0.1',
      port: 1080,
      username: '',
      password: '',
      bypassList: ['<local>'],
    });
    expect(result.state.profiles.map((profile) => profile.id)).toEqual(['proxy', 'socks']);
    expect(result.state.enabled).toBe(false);
    expect(result.state.healthCheck).toEqual(DEFAULT_STATE.healthCheck);

    expect(result.state.rules).toEqual([
      { id: 'so-rule-0', match: 'github.com', action: 'proxy' },
      { id: 'so-rule-1', match: '.internal.example.com', action: 'socks' },
      { id: 'so-rule-2', match: '<local>', action: DIRECT_ACTION },
      { id: 'so-rule-3', match: '<private>', action: DIRECT_ACTION },
      { id: 'so-rule-4', match: '10.0.0.0/8', action: DIRECT_ACTION },
      { id: 'so-rule-5', match: '.extracted.example', action: 'proxy' },
      { id: 'so-rule-6', match: 'via-virtual.example', action: 'proxy' },
    ]);

    expect(resolveRoute('https://github.com/mathieumaf/detour', result.state)).toMatchObject({
      id: 'proxy',
    });
    expect(resolveRoute('https://git.internal.example.com/', result.state)).toMatchObject({
      id: 'socks',
    });
    expect(resolveRoute('http://10.1.2.3/', result.state)).toBe(DIRECT_ACTION);
    expect(resolveRoute('https://via-virtual.example/', result.state)).toMatchObject({
      id: 'proxy',
    });
  });

  test('lists incompatible profiles and rules instead of dropping them quietly', async () => {
    const result = parseImportedFile(await load(backupPath));
    const names = result.skipped.map((item) => item.name);

    expect(result.skipped.some((item) => item.kind === 'profile' && item.name === 'pac')).toBe(
      true,
    );
    expect(result.skipped.some((item) => item.kind === 'profile' && item.name === 'split')).toBe(
      true,
    );
    expect(result.skipped.some((item) => item.name === 'other switch')).toBe(true);
    expect(result.skipped.some((item) => item.name === 'alias')).toBe(true);
    expect(names.some((name) => name.includes('*.google.com.*'))).toBe(true);
    expect(names.some((name) => name.includes('foo\\.bar\\..*'))).toBe(true);
    expect(names.some((name) => name.includes('^https://secret/'))).toBe(true);
    expect(names.some((name) => name.includes('login'))).toBe(true);
    expect(names.some((name) => name.includes('TimeCondition') || name.includes('9'))).toBe(true);
    expect(names.some((name) => name.includes('via-pac.example'))).toBe(true);
    expect(result.skipped.some((item) => item.name === 'auto switch default')).toBe(true);

    expect(result.skipped.find((item) => item.name === 'pac')?.reason).toMatch(/PAC/i);
    expect(result.skipped.find((item) => item.name === 'split')?.reason).toMatch(/Per-protocol/);
    expect(result.skipped.find((item) => item.name.includes('via-pac.example'))?.reason).toMatch(
      /pac/,
    );
  });

  test('Detour export after import keeps v4 shape and round-trips the mapped state', async () => {
    const imported = parseImportedFile(await load(backupPath));
    const exported = buildExport(imported.state);
    const file = JSON.parse(exported) as { app: string; version: number };
    expect(file.app).toBe('detour');
    expect(file.version).toBe(4);
    expect(exported).not.toContain('schemaVersion');
    expect(exported).not.toContain('profileType');

    const roundTrip = parseImportedFile(exported);
    expect(roundTrip.source).toBe('detour');
    expect(roundTrip.skipped).toEqual([]);
    expect(roundTrip.state.profiles).toEqual(imported.state.profiles);
    expect(roundTrip.state.rules).toEqual(imported.state.rules);
    expect(parseImport(exported).profiles.map((profile) => profile.id)).toEqual(['proxy', 'socks']);
  });

  test('imports a real SwitchyOmega backup: HTTP + SOCKS profiles and compatible wildcards', async () => {
    const result = parseImportedFile(await load(realPath));
    expect(result.source).toBe('switchyomega');
    expect(result.state.profiles).toEqual([
      {
        id: 'GAE-Proxy',
        name: 'GAE-Proxy',
        scheme: 'http',
        host: '127.0.0.1',
        port: 8087,
        username: '',
        password: '',
        bypassList: ['<local>'],
      },
      {
        id: 'X-Tunnel',
        name: 'X-Tunnel',
        scheme: 'socks5',
        host: '127.0.0.1',
        port: 1080,
        username: '',
        password: '',
        bypassList: ['<local>'],
      },
    ]);
    expect(result.state.rules).toEqual([
      { id: 'so-rule-0', match: '.ggpht.com', action: 'GAE-Proxy' },
      { id: 'so-rule-1', match: '.wikipedia.org', action: 'GAE-Proxy' },
    ]);
    expect(result.skipped.some((item) => item.name === 'X-Tunnel自动切换')).toBe(true);
    expect(
      result.skipped.some((item) => item.name === '__ruleListOf_GAE-Proxy自动切换'),
    ).toBe(true);
    expect(result.skipped.some((item) => item.name.includes('*.google.com.*'))).toBe(true);
    expect(result.skipped.some((item) => item.name.includes('*.google*.com'))).toBe(true);
    expect(resolveRoute('https://foo.wikipedia.org/', result.state)).toMatchObject({
      id: 'GAE-Proxy',
    });
  });

  test('accepts a single FixedProfile export and leaves Detour JSON on the existing path', () => {
    const single = parseImportedFile(
      JSON.stringify({
        profileType: 'FixedProfile',
        name: 'office',
        fallbackProxy: { scheme: 'https', host: 'office.example', port: 8443 },
        bypassList: [{ conditionType: 'BypassCondition', pattern: '<local>' }],
      }),
    );
    expect(single.source).toBe('switchyomega');
    expect(single.state.profiles).toEqual([
      {
        id: 'office',
        name: 'office',
        scheme: 'https',
        host: 'office.example',
        port: 8443,
        username: '',
        password: '',
        bypassList: ['<local>'],
      },
    ]);

    const detour = {
      app: 'detour',
      version: 4,
      exportedAt: '2026-01-01T00:00:00.000Z',
      state: {
        enabled: true,
        activeProfileId: 'work',
        profiles: [
          {
            id: 'work',
            name: 'Work',
            scheme: 'http',
            host: 'proxy.work.example',
            port: 8080,
            username: '',
            password: '',
            bypassList: ['<local>'],
          },
        ],
        rules: [{ id: 'r1', match: 'github.com', action: 'work' }],
      },
    };
    const parsed = parseImportedFile(JSON.stringify(detour));
    expect(parsed.source).toBe('detour');
    expect(parsed.skipped).toEqual([]);
    expect(parsed.state.enabled).toBe(true);
    expect(parsed.state.profiles[0]?.id).toBe('work');
    expect(parsed.state.rules).toEqual([{ id: 'r1', match: 'github.com', action: 'work' }]);
  });

  test('keeps IPv6 bypass literals and lists port- or scheme-qualified bypass entries', () => {
    const result = parseImportedFile(
      JSON.stringify({
        schemaVersion: 2,
        '+p': {
          profileType: 'FixedProfile',
          name: 'p',
          fallbackProxy: { scheme: 'http', host: '127.0.0.1', port: 8080 },
          bypassList: [
            { conditionType: 'BypassCondition', pattern: '::1' },
            { conditionType: 'BypassCondition', pattern: 'example.com:8080' },
            { conditionType: 'BypassCondition', pattern: 'http://only.example' },
          ],
        },
      }),
    );
    expect(result.state.profiles[0]?.bypassList).toEqual(['::1']);
    expect(result.skipped.some((item) => item.name.includes('example.com:8080'))).toBe(true);
    expect(result.skipped.some((item) => item.name.includes('http://only.example'))).toBe(true);
  });

  test('throws when a SwitchyOmega file has no importable proxy profiles', () => {
    expect(() =>
      parseImportedFile(
        JSON.stringify({
          schemaVersion: 2,
          '+pac': {
            profileType: 'PacProfile',
            name: 'pac',
            pacScript: 'function FindProxyForURL() { return "DIRECT"; }',
          },
        }),
      ),
    ).toThrow(/No importable proxy profiles/);
  });
});
