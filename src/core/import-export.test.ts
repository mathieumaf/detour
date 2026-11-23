import { describe, expect, test } from 'bun:test';
import { home, makeState, work } from './fixtures/state';
import { EXPORT_VERSION, buildExport, parseImportedFile } from './import-export';
import { DEFAULT_STATE } from './types';

describe('buildExport', () => {
  test('writes a versioned Detour file', () => {
    const file = JSON.parse(buildExport(makeState(), new Date('2026-01-02T03:04:05.000Z')));
    expect(file.app).toBe('detour');
    expect(file.version).toBe(EXPORT_VERSION);
    expect(file.exportedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(file.state.profiles.map((profile: { id: string }) => profile.id)).toEqual([
      work.id,
      home.id,
    ]);
  });

  test('leaves this session’s health counters and failover out of the file', () => {
    const file = JSON.parse(
      buildExport(
        makeState({
          healthStatus: { profileId: home.id, consecutiveFailures: 2 },
          lastFailover: { from: 'Home', to: 'Work', at: 1 },
        }),
      ),
    );
    expect(file.state.healthStatus).toEqual({ profileId: '', consecutiveFailures: 0 });
    expect(file.state.lastFailover).toBeNull();
  });

  test('includes passwords, which is what makes a backup restorable', () => {
    const state = makeState({ profiles: [{ ...work, username: 'u', password: 'p' }, home] });
    expect(JSON.parse(buildExport(state)).state.profiles[0].password).toBe('p');
  });
});

describe('parseImportedFile', () => {
  test('round-trips profiles, rules, and health settings', () => {
    const state = makeState({
      enabled: false,
      healthCheck: {
        enabled: true,
        intervalSeconds: 120,
        failureThreshold: 3,
        fallbackProfileId: work.id,
      },
    });
    const result = parseImportedFile(buildExport(state));
    expect(result.source).toBe('detour');
    expect(result.skipped).toEqual([]);
    expect(result.state).toEqual(state);
  });

  test('accepts a v2 file, which has no rules or health settings', () => {
    const v2 = {
      app: 'detour',
      version: 2,
      exportedAt: '2026-01-01T00:00:00.000Z',
      state: { enabled: false, activeProfileId: work.id, profiles: [work] },
    };
    const { state } = parseImportedFile(JSON.stringify(v2));
    expect(state.rules).toEqual([]);
    expect(state.healthCheck).toEqual(DEFAULT_STATE.healthCheck);
    expect(state.profiles).toEqual([work]);
  });

  test('accepts a v1 file, which has a single profile', () => {
    const v1 = { app: 'detour', version: 1, profile: { ...home, id: undefined, name: undefined } };
    const { state } = parseImportedFile(JSON.stringify(v1));
    expect(state.enabled).toBe(false);
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]).toMatchObject({
      id: 'profile-0',
      name: 'Default profile',
      scheme: 'socks5',
      host: '10.8.0.1',
      port: 1080,
    });
    expect(state.activeProfileId).toBe('profile-0');
  });

  test('accepts a bare profile object', () => {
    const { state } = parseImportedFile(JSON.stringify(work));
    expect(state.profiles).toEqual([work]);
    expect(state.activeProfileId).toBe(work.id);
  });

  test('never imports health counters or a failover from the file', () => {
    const file = JSON.parse(buildExport(makeState()));
    file.state.healthStatus = { profileId: home.id, consecutiveFailures: 5 };
    file.state.lastFailover = { from: 'a', to: 'b', at: 1 };
    const { state } = parseImportedFile(JSON.stringify(file));
    expect(state.healthStatus).toEqual({ profileId: '', consecutiveFailures: 0 });
    expect(state.lastFailover).toBeNull();
  });

  test('reads a file that starts with a byte-order mark', () => {
    const { state } = parseImportedFile(`\uFEFF${buildExport(makeState())}`);
    expect(state.profiles).toHaveLength(2);
  });

  test('rejects text that is not JSON', () => {
    expect(() => parseImportedFile('not json')).toThrow('Not a valid JSON file.');
  });

  test('rejects JSON that is not an object', () => {
    for (const text of ['null', '42', '"profile"', '[]']) {
      expect(() => parseImportedFile(text)).toThrow('No proxy config found in this file.');
    }
  });

  // Each of these used to replace the whole configuration with one blank profile.
  test('rejects an object with no proxy config in it', () => {
    const files = [
      {},
      { hello: 'world' },
      { app: 'detour', state: { profiles: [] } },
      { app: 'detour', version: 1, profile: {} },
      { app: 'detour', version: 1, profile: { name: 'Work', port: 8080 } },
      { host: '   ' },
      { host: 42 },
    ];
    for (const file of files) {
      expect(() => parseImportedFile(JSON.stringify(file))).toThrow(
        'No proxy config found in this file.',
      );
    }
  });
});
