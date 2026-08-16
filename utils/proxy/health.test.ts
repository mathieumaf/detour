import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_STATE,
  DIRECT_ACTION,
  type ProxyProfile,
  type ProxyState,
  type TestResult,
} from './types';
import { healthAlarmPeriodMinutes, runHealthCheck } from './health';

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

const backup: ProxyProfile = {
  ...office,
  id: 'backup',
  name: 'Backup',
  host: 'backup.example',
};

function state(partial: Partial<ProxyState> = {}): ProxyState {
  return {
    ...DEFAULT_STATE,
    enabled: true,
    activeProfileId: office.id,
    profiles: [office, backup],
    healthCheck: {
      enabled: true,
      intervalSeconds: 60,
      failureThreshold: 2,
      fallbackProfileId: backup.id,
    },
    healthStatus: { profileId: '', consecutiveFailures: 0 },
    ...partial,
  };
}

function result(ok: boolean): TestResult {
  return ok ? { ok: true, ip: '203.0.113.1', ms: 10 } : { ok: false, error: 'down' };
}

describe('proxy health checks', () => {
  test('waits for the configured consecutive-failure threshold', async () => {
    let current = state();
    const dependencies = {
      probe: async () => result(false),
      getCurrentState: () => current,
      now: () => 123,
    };

    const first = await runHealthCheck(current, dependencies);
    expect(first?.healthStatus).toEqual({
      profileId: office.id,
      consecutiveFailures: 1,
    });
    expect(first?.activeProfileId).toBe(office.id);

    current = first!;
    const second = await runHealthCheck(current, dependencies);
    expect(second?.activeProfileId).toBe(backup.id);
    expect(second?.lastFailover).toEqual({
      from: 'Office',
      to: 'Backup',
      at: 123,
    });
  });

  test('does not overwrite an explicit Off while a probe is running', async () => {
    let current = state();
    const checked = runHealthCheck(current, {
      probe: async () => {
        current = { ...current, enabled: false };
        return result(false);
      },
      getCurrentState: () => current,
    });

    expect(await checked).toBeNull();
    expect(current.enabled).toBe(false);
  });

  test('uses a healthy fallback and otherwise switches to Direct', async () => {
    let current = state({
      healthCheck: {
        enabled: true,
        intervalSeconds: 60,
        failureThreshold: 1,
        fallbackProfileId: backup.id,
      },
    });
    let fallbackHealthy = true;
    const dependencies = {
      probe: async (profile: ProxyProfile) =>
        result(profile.id === backup.id && fallbackHealthy),
      getCurrentState: () => current,
    };

    const fallback = await runHealthCheck(current, dependencies);
    expect(fallback?.enabled).toBe(true);
    expect(fallback?.activeProfileId).toBe(backup.id);

    fallbackHealthy = false;
    current = state();
    current.healthCheck.failureThreshold = 1;
    const direct = await runHealthCheck(current, dependencies);
    expect(direct?.enabled).toBe(false);
    expect(direct?.lastFailover?.to).toBe('Direct');

    current = state();
    current.healthCheck = {
      ...current.healthCheck,
      failureThreshold: 1,
      fallbackProfileId: DIRECT_ACTION,
    };
    const configuredDirect = await runHealthCheck(current, dependencies);
    expect(configuredDirect?.enabled).toBe(false);
  });

  test('schedules an alarm only while proxy and health check are on', () => {
    expect(healthAlarmPeriodMinutes(state())).toBe(1);
    expect(healthAlarmPeriodMinutes(state({ enabled: false }))).toBeNull();
    expect(
      healthAlarmPeriodMinutes(
        state({ healthCheck: { ...state().healthCheck, enabled: false } }),
      ),
    ).toBeNull();
  });
});
