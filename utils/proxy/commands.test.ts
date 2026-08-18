import { describe, expect, test } from 'bun:test';
import { DEFAULT_STATE, type ProxyProfile, type ProxyState } from './types';
import {
  COMMAND_NEXT_PROFILE,
  COMMAND_TOGGLE,
  applyCommand,
  cycleNamedProfile,
  nextNamedProfileId,
  toggleProxyState,
} from './commands';

const office: ProxyProfile = {
  id: 'office',
  name: 'Office',
  scheme: 'https',
  host: 'office.example',
  port: 8443,
  username: '',
  password: '',
  bypassList: [],
};

const home: ProxyProfile = {
  ...office,
  id: 'home',
  name: 'Home',
  host: 'home.example',
};

const incomplete: ProxyProfile = {
  ...office,
  id: 'draft',
  name: 'Draft',
  host: '',
};

function state(partial: Partial<ProxyState> = {}): ProxyState {
  return {
    ...DEFAULT_STATE,
    enabled: true,
    activeProfileId: office.id,
    profiles: [office, home],
    healthCheck: {
      enabled: true,
      intervalSeconds: 60,
      failureThreshold: 2,
      fallbackProfileId: home.id,
    },
    healthStatus: { profileId: office.id, consecutiveFailures: 1 },
    lastFailover: { from: 'Office', to: 'Home', at: 1 },
    ...partial,
  };
}

describe('toggleProxyState', () => {
  test('turns a valid active profile off and on', () => {
    const off = toggleProxyState(state({ enabled: true }));
    expect(off?.enabled).toBe(false);
    expect(toggleProxyState(off!)?.enabled).toBe(true);
  });

  test('refuses to turn on an incomplete active profile', () => {
    expect(
      toggleProxyState(
        state({
          enabled: false,
          activeProfileId: incomplete.id,
          profiles: [incomplete, home],
        }),
      ),
    ).toBeNull();
  });

  test('always allows Off, even when the active profile is incomplete', () => {
    const next = toggleProxyState(
      state({
        enabled: true,
        activeProfileId: incomplete.id,
        profiles: [incomplete],
      }),
    );
    expect(next?.enabled).toBe(false);
  });
});

describe('cycleNamedProfile', () => {
  test('wraps to the first valid named profile', () => {
    expect(nextNamedProfileId(state({ activeProfileId: home.id }))).toBe(office.id);
    expect(cycleNamedProfile(state())?.activeProfileId).toBe(home.id);
  });

  test('skips incomplete profiles and leaves enabled unchanged', () => {
    const current = state({
      enabled: false,
      profiles: [office, incomplete, home],
    });
    const next = cycleNamedProfile(current);
    expect(next?.activeProfileId).toBe(home.id);
    expect(next?.enabled).toBe(false);
    expect(next?.healthCheck).toEqual(current.healthCheck);
    expect(next?.rules).toEqual(current.rules);
  });

  test('does not enable a user-off proxy', () => {
    const next = applyCommand(COMMAND_NEXT_PROFILE, state({ enabled: false }));
    expect(next?.enabled).toBe(false);
    expect(next?.activeProfileId).toBe(home.id);
  });

  test('is a no-op when there is no different valid profile', () => {
    expect(cycleNamedProfile(state({ profiles: [office] }))).toBeNull();
    expect(
      cycleNamedProfile(state({ profiles: [office, incomplete] })),
    ).toBeNull();
  });

  test('moves from an incomplete current profile to the next valid one', () => {
    expect(
      nextNamedProfileId(
        state({
          activeProfileId: incomplete.id,
          profiles: [incomplete, home],
        }),
      ),
    ).toBe(home.id);
  });
});

describe('applyCommand', () => {
  test('routes toggle and next-profile, and ignores unknown commands', () => {
    expect(applyCommand(COMMAND_TOGGLE, state())?.enabled).toBe(false);
    expect(applyCommand(COMMAND_NEXT_PROFILE, state())?.activeProfileId).toBe(home.id);
    expect(applyCommand('unknown', state())).toBeNull();
  });
});
