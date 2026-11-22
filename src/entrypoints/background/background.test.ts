// The background as a whole, on a fake browser: what it does to the proxy
// when it starts, when storage changes, and when a message, a keyboard
// command, or a health-check alarm arrives. cold-start.test.ts covers the
// narrower question of events that arrive before the state has loaded.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  COMMAND_NEXT_PROFILE,
  COMMAND_TOGGLE,
  DEFAULT_STATE,
  DIRECT_ACTION,
  HEALTH_ALARM,
  STORAGE_KEY,
  type ProxyProfile,
  type ProxyState,
  type TestResult,
} from '../../core';
import { ctx, handledAuth } from './context';
import { installFakeBrowser, settle, type FakeBrowser } from './fake-browser';
import { startBackground } from './startup';

const office: ProxyProfile = {
  id: 'office',
  name: 'Office',
  scheme: 'http',
  host: 'office.example',
  port: 8080,
  username: '',
  password: '',
  bypassList: ['<local>'],
};

const backup: ProxyProfile = { ...office, id: 'backup', name: 'Backup', host: 'backup.example' };

function stateWith(partial: Partial<ProxyState> = {}): ProxyState {
  return {
    ...DEFAULT_STATE,
    enabled: true,
    activeProfileId: office.id,
    profiles: [office, backup],
    ...partial,
  };
}

const watched: ProxyState['healthCheck'] = {
  enabled: true,
  intervalSeconds: 120,
  failureThreshold: 2,
  fallbackProfileId: backup.id,
};

let fake: FakeBrowser;
const realFetch = globalThis.fetch;

async function start(state: ProxyState, firefox = false): Promise<void> {
  fake = installFakeBrowser({ state });
  await startBackground({ firefox });
}

function stored(): ProxyState {
  return fake.stored[STORAGE_KEY] as ProxyState;
}

async function write(state: ProxyState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  await settle();
}

// The proxy host Chromium was last told to use. null after a clear().
function appliedHost(): string | null {
  const last = fake.proxySettings.at(-1) as
    { value: { mode: string; rules?: { singleProxy: { host: string } } } } | null | undefined;
  if (!last) return null;
  return last.value.mode === 'pac_script' ? 'pac' : (last.value.rules?.singleProxy.host ?? null);
}

// A probe goes out through whichever proxy is applied at that moment, so the
// fake network fails the request when that proxy is on the `down` list.
function stubNetwork(down: string[] = []): string[] {
  const probed: string[] = [];
  globalThis.fetch = (async () => {
    const host = appliedHost() ?? 'direct';
    probed.push(host);
    if (down.includes(host)) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify({ ip: '203.0.113.7' }));
  }) as unknown as typeof fetch;
  return probed;
}

async function until(what: string, check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await settle();
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

beforeEach(() => {
  ctx.state = null;
  ctx.testProfile = null;
  ctx.userToggleVersion = 0;
  handledAuth.clear();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('applying the stored state', () => {
  test('routes through the active profile at startup', async () => {
    await start(stateWith());
    expect(fake.proxySettings).toEqual([
      {
        scope: 'regular',
        value: {
          mode: 'fixed_servers',
          rules: {
            singleProxy: { scheme: 'http', host: 'office.example', port: 8080 },
            bypassList: ['<local>'],
          },
        },
      },
    ]);
    expect(fake.badge).toBe('ON');
  });

  test('compiles routing rules into a PAC script', async () => {
    await start(stateWith({ rules: [{ id: 'r', match: 'example.com', action: DIRECT_ACTION }] }));
    const applied = fake.proxySettings.at(-1) as {
      value: { mode: string; pacScript: { data: string; mandatory: boolean } };
    };
    expect(applied.value.mode).toBe('pac_script');
    expect(applied.value.pacScript.mandatory).toBe(true);
    expect(applied.value.pacScript.data).toContain('function FindProxyForURL');
    expect(applied.value.pacScript.data).toContain('PROXY office.example:8080');
  });

  test('releases the proxy when Detour is off, or the profile has no server', async () => {
    await start(stateWith({ enabled: false }));
    expect(fake.proxySettings).toEqual([null]);
    expect(fake.badge).toBe('');

    await start(stateWith({ profiles: [{ ...office, host: '' }] }));
    expect(fake.proxySettings).toEqual([null]);
    expect(fake.badge).toBe('');
  });

  test('follows every change written to storage', async () => {
    await start(stateWith({ enabled: false }));

    await write(stateWith({ activeProfileId: backup.id }));
    expect(appliedHost()).toBe('backup.example');
    expect(fake.badge).toBe('ON');

    await write(stateWith({ enabled: false }));
    expect(appliedHost()).toBeNull();
    expect(fake.badge).toBe('');
  });

  test('starts the Firefox request listener only while it has something to route', async () => {
    await start(stateWith(), true);
    expect(fake.proxyListeners).toHaveLength(1);
    expect(fake.proxySettings).toEqual([]);

    await write(stateWith({ enabled: false }));
    expect(fake.proxyListeners).toHaveLength(0);
  });
});

describe('messages from the popup and settings page', () => {
  test('set-proxy-enabled switches the proxy and forgets the last failover', async () => {
    await start(
      stateWith({
        enabled: false,
        healthStatus: { profileId: office.id, consecutiveFailures: 1 },
        lastFailover: { from: 'Office', to: 'Backup', at: 1 },
      }),
    );

    await fake.sendMessage({ type: 'set-proxy-enabled', enabled: true });
    await settle();
    expect(stored().enabled).toBe(true);
    expect(stored().healthStatus).toEqual({ profileId: '', consecutiveFailures: 0 });
    expect(stored().lastFailover).toBeNull();
    expect(appliedHost()).toBe('office.example');

    await fake.sendMessage({ type: 'set-proxy-enabled', enabled: false });
    await settle();
    expect(stored().enabled).toBe(false);
    expect(appliedHost()).toBeNull();
  });

  test('test-proxy tries the given profile, reports the exit IP, and puts things back', async () => {
    await start(stateWith({ enabled: false }));
    const probed = stubNetwork();

    const result = (await fake.sendMessage({ type: 'test-proxy', profile: backup })) as TestResult;
    expect(result.ok).toBe(true);
    expect(result.ip).toBe('203.0.113.7');
    expect(typeof result.ms).toBe('number');
    // The probe went out through the profile under test, not the stored state.
    expect(probed).toEqual(['backup.example']);
    // Detour was off before the test, and is off again after it.
    expect(appliedHost()).toBeNull();
    expect(stored().enabled).toBe(false);
  });

  test('test-proxy restores the active profile when Detour is on', async () => {
    await start(stateWith());
    stubNetwork();
    await fake.sendMessage({ type: 'test-proxy', profile: backup });
    expect(appliedHost()).toBe('office.example');
  });

  test('test-proxy explains why a test failed', async () => {
    await start(stateWith({ enabled: false }));

    stubNetwork(['backup.example']);
    expect(await fake.sendMessage({ type: 'test-proxy', profile: backup })).toEqual({
      ok: false,
      error: 'Failed to fetch',
    });

    globalThis.fetch = (async () => new Response('', { status: 502 })) as unknown as typeof fetch;
    expect(await fake.sendMessage({ type: 'test-proxy', profile: backup })).toEqual({
      ok: false,
      error: 'HTTP 502',
    });

    globalThis.fetch = (async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }) as unknown as typeof fetch;
    expect(await fake.sendMessage({ type: 'test-proxy', profile: backup })).toEqual({
      ok: false,
      error: 'Timed out after 8s.',
    });
    expect(appliedHost()).toBeNull();
  });

  test('test-proxy refuses a profile with no server, without touching the proxy', async () => {
    await start(stateWith({ enabled: false }));
    const before = fake.proxySettings.length;
    expect(
      await fake.sendMessage({ type: 'test-proxy', profile: { ...backup, host: ' ' } }),
    ).toEqual({ ok: false, error: 'Fill in host and port first.' });
    expect(fake.proxySettings).toHaveLength(before);
  });

  test('a test never switches the proxy back on after the user turned it off', async () => {
    await start(stateWith());
    let finish!: () => void;
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        finish = () => resolve(new Response(JSON.stringify({ ip: '203.0.113.7' })));
      })) as unknown as typeof fetch;

    const testing = fake.sendMessage({ type: 'test-proxy', profile: backup });
    await until('the probe to start', () => typeof finish === 'function');
    await write(stateWith({ enabled: false }));
    finish();
    await testing;

    expect(appliedHost()).toBeNull();
    expect(fake.badge).toBe('');
  });

  test('ignores a message it does not know', async () => {
    await start(stateWith());
    const before = fake.proxySettings.length;
    expect(await fake.sendMessage({ type: 'something-else' })).toBeUndefined();
    expect(fake.proxySettings).toHaveLength(before);
  });
});

describe('keyboard commands', () => {
  test('toggle switches Detour off and on', async () => {
    await start(stateWith());

    fake.fireCommand(COMMAND_TOGGLE);
    await until('Detour to turn off', () => !stored().enabled);
    await settle();
    expect(appliedHost()).toBeNull();

    fake.fireCommand(COMMAND_TOGGLE);
    await until('Detour to turn on', () => stored().enabled);
    await settle();
    expect(appliedHost()).toBe('office.example');
  });

  test('toggle cannot switch on a profile with no server', async () => {
    const incomplete = stateWith({ enabled: false, profiles: [{ ...office, host: '' }] });
    await start(incomplete);
    fake.fireCommand(COMMAND_TOGGLE);
    await settle();
    await settle();
    expect(stored()).toEqual(incomplete);
  });

  test('next-profile moves to the next profile and leaves Detour on', async () => {
    await start(stateWith());
    fake.fireCommand(COMMAND_NEXT_PROFILE);
    await until('the next profile', () => stored().activeProfileId === backup.id);
    await settle();
    expect(stored().enabled).toBe(true);
    expect(appliedHost()).toBe('backup.example');
  });
});

describe('health checks', () => {
  test('schedules the alarm only while Detour is on and health checks are enabled', async () => {
    await start(stateWith({ healthCheck: watched }));
    expect(fake.alarms.get(HEALTH_ALARM)).toEqual({ name: HEALTH_ALARM, periodInMinutes: 2 });

    await write(stateWith({ healthCheck: watched, enabled: false }));
    expect(fake.alarms.has(HEALTH_ALARM)).toBe(false);

    await write(stateWith({ healthCheck: { ...watched, enabled: false } }));
    expect(fake.alarms.has(HEALTH_ALARM)).toBe(false);
  });

  test('a healthy proxy changes nothing', async () => {
    await start(stateWith({ healthCheck: watched }));
    const probed = stubNetwork();
    const before = stored();

    fake.fireAlarm(HEALTH_ALARM);
    await until('the probe', () => probed.length === 1);
    await settle();
    expect(stored()).toEqual(before);
    expect(appliedHost()).toBe('office.example');
  });

  test('fails over to the fallback profile after enough consecutive failures', async () => {
    await start(stateWith({ healthCheck: watched }));
    stubNetwork(['office.example']);

    fake.fireAlarm(HEALTH_ALARM);
    await until(
      'the first failure to be counted',
      () => stored().healthStatus.consecutiveFailures === 1,
    );
    expect(stored().activeProfileId).toBe(office.id);

    fake.fireAlarm(HEALTH_ALARM);
    await until('the failover', () => stored().activeProfileId === backup.id);
    await settle();
    expect(stored().enabled).toBe(true);
    expect(stored().lastFailover).toMatchObject({ from: 'Office', to: 'Backup' });
    expect(stored().healthStatus).toEqual({ profileId: '', consecutiveFailures: 0 });
    expect(appliedHost()).toBe('backup.example');
  });

  test('switches Detour off when the fallback is down too', async () => {
    await start(stateWith({ healthCheck: { ...watched, failureThreshold: 1 } }));
    stubNetwork(['office.example', 'backup.example']);

    fake.fireAlarm(HEALTH_ALARM);
    await until('Detour to turn off', () => !stored().enabled);
    await settle();
    expect(stored().lastFailover).toMatchObject({ from: 'Office', to: 'Direct' });
    expect(appliedHost()).toBeNull();
    expect(fake.alarms.has(HEALTH_ALARM)).toBe(false);
  });

  test('an alarm with another name is ignored', async () => {
    await start(stateWith({ healthCheck: watched }));
    const probed = stubNetwork();
    fake.fireAlarm('something-else');
    await settle();
    expect(probed).toEqual([]);
  });

  test('the user switching Detour off during a probe wins over the result', async () => {
    await start(stateWith({ healthCheck: { ...watched, failureThreshold: 1 } }));
    let fail!: () => void;
    globalThis.fetch = (() =>
      new Promise<Response>((_resolve, reject) => {
        fail = () => reject(new TypeError('Failed to fetch'));
      })) as unknown as typeof fetch;

    fake.fireAlarm(HEALTH_ALARM);
    await until('the probe to start', () => typeof fail === 'function');
    await fake.sendMessage({ type: 'set-proxy-enabled', enabled: false });
    fail();
    await settle();
    await settle();

    // No failover is recorded and nothing switches the proxy back on.
    expect(stored().enabled).toBe(false);
    expect(stored().activeProfileId).toBe(office.id);
    expect(stored().lastFailover).toBeNull();
    expect(appliedHost()).toBeNull();
  });
});
