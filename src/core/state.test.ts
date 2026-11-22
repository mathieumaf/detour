import { describe, expect, test } from 'bun:test';
import { home, makeState, work } from './fixtures/state';
import { clearHealthRuntime, normalizeState } from './state';
import { DEFAULT_STATE, DIRECT_ACTION, activeProfile } from './types';

describe('normalizeState', () => {
  test('nothing stored is the default state', () => {
    expect(normalizeState(undefined)).toEqual(DEFAULT_STATE);
    expect(normalizeState(null)).toEqual(DEFAULT_STATE);
    expect(normalizeState('corrupt')).toEqual(DEFAULT_STATE);
    expect(normalizeState([])).toEqual(DEFAULT_STATE);
  });

  test('a complete state survives unchanged', () => {
    const state = makeState({
      healthCheck: {
        enabled: true,
        intervalSeconds: 120,
        failureThreshold: 3,
        fallbackProfileId: work.id,
      },
      healthStatus: { profileId: home.id, consecutiveFailures: 1 },
      lastFailover: { from: 'Work', to: 'Home', at: 1_700_000_000_000 },
    });
    expect(normalizeState(state)).toEqual(state);
    // And it is stable: normalizing twice changes nothing.
    expect(normalizeState(normalizeState(state))).toEqual(state);
  });

  test('upgrades a v1 state, which stored a single profile', () => {
    const v1 = {
      enabled: true,
      profile: {
        scheme: 'socks5',
        host: '10.0.0.1',
        port: 1080,
        username: '',
        password: '',
        bypassList: ['<local>'],
      },
    };
    const state = normalizeState(v1);
    expect(state.enabled).toBe(true);
    expect(state.profiles).toHaveLength(1);
    expect(state.activeProfileId).toBe('profile-0');
    expect(activeProfile(state)).toMatchObject({
      name: 'Default profile',
      scheme: 'socks5',
      host: '10.0.0.1',
      port: 1080,
    });
    expect(state.rules).toEqual([]);
    expect(state.healthCheck).toEqual(DEFAULT_STATE.healthCheck);
  });

  test('a state saved before rules and health checks gets their defaults', () => {
    const state = normalizeState({ enabled: true, activeProfileId: work.id, profiles: [work] });
    expect(state.rules).toEqual([]);
    expect(state.healthCheck).toEqual(DEFAULT_STATE.healthCheck);
    expect(state.healthStatus).toEqual({ profileId: '', consecutiveFailures: 0 });
    expect(state.lastFailover).toBeNull();
  });

  test('an active profile that no longer exists falls back to the first', () => {
    const state = normalizeState(makeState({ activeProfileId: 'gone' }));
    expect(state.activeProfileId).toBe(work.id);
  });

  test('drops rules, fallback, and health status that point at missing profiles', () => {
    const state = normalizeState({
      enabled: true,
      activeProfileId: work.id,
      profiles: [work],
      rules: [
        { id: 'keep', match: 'a.com', action: work.id },
        { id: 'direct', match: 'b.com', action: DIRECT_ACTION },
        { id: 'dangling', match: 'c.com', action: home.id },
      ],
      healthCheck: {
        enabled: true,
        intervalSeconds: 300,
        failureThreshold: 4,
        fallbackProfileId: home.id,
      },
      healthStatus: { profileId: home.id, consecutiveFailures: 2 },
    });
    expect(state.rules.map((rule) => rule.id)).toEqual(['keep', 'direct']);
    expect(state.healthCheck).toEqual({
      enabled: true,
      intervalSeconds: 300,
      failureThreshold: 4,
      fallbackProfileId: DIRECT_ACTION,
    });
    expect(state.healthStatus.profileId).toBe('');
  });

  test('ignores profile entries that are not objects', () => {
    const state = normalizeState({ profiles: [null, 'nope', work, 12] });
    expect(state.profiles).toEqual([work]);
    expect(state.activeProfileId).toBe(work.id);
    // Nothing usable at all: back to one default profile.
    expect(normalizeState({ profiles: [null, 'nope'] }).profiles).toEqual(DEFAULT_STATE.profiles);
  });

  test('only a literal true turns the proxy on', () => {
    expect(normalizeState({ enabled: 'yes', profiles: [work] }).enabled).toBe(false);
    expect(normalizeState({ enabled: 1, profiles: [work] }).enabled).toBe(false);
    expect(normalizeState({ profiles: [work] }).enabled).toBe(false);
  });

  test('never hands out the shared default objects', () => {
    const state = normalizeState(undefined);
    state.profiles[0]!.bypassList.push('mutated');
    state.healthCheck.enabled = true;
    expect(normalizeState(undefined)).toEqual(DEFAULT_STATE);
  });
});

describe('clearHealthRuntime', () => {
  test('resets the failure counter and forgets the last failover', () => {
    expect(clearHealthRuntime()).toEqual({
      healthStatus: { profileId: '', consecutiveFailures: 0 },
      lastFailover: null,
    });
  });
});
