import {
  DEFAULT_HEALTH_CHECK,
  DIRECT_ACTION,
  activeProfile,
  type FailoverEvent,
  type HealthCheckSettings,
  type HealthCheckStatus,
  type ProxyProfile,
  type ProxyState,
  type TestResult,
} from './types';
import { isProfileValid } from './validation';

export const HEALTH_ALARM = 'proxy-health-check';
export const HEALTH_MIN_INTERVAL_SECONDS = 30;
export const HEALTH_MAX_INTERVAL_SECONDS = 3600;
export const HEALTH_MIN_FAILURE_THRESHOLD = 1;
export const HEALTH_MAX_FAILURE_THRESHOLD = 10;

export function sanitizeHealthCheck(
  raw: unknown,
  profileIds: ReadonlySet<string>,
): HealthCheckSettings {
  const value =
    raw && typeof raw === 'object' ? (raw as Partial<HealthCheckSettings>) : {};
  const interval = Number(value.intervalSeconds);
  const threshold = Number(value.failureThreshold);
  const fallbackProfileId =
    value.fallbackProfileId === DIRECT_ACTION ||
    (typeof value.fallbackProfileId === 'string' &&
      profileIds.has(value.fallbackProfileId))
      ? value.fallbackProfileId
      : DIRECT_ACTION;

  return {
    enabled: value.enabled === true,
    intervalSeconds:
      Number.isInteger(interval) &&
      interval >= HEALTH_MIN_INTERVAL_SECONDS &&
      interval <= HEALTH_MAX_INTERVAL_SECONDS
        ? interval
        : DEFAULT_HEALTH_CHECK.intervalSeconds,
    failureThreshold:
      Number.isInteger(threshold) &&
      threshold >= HEALTH_MIN_FAILURE_THRESHOLD &&
      threshold <= HEALTH_MAX_FAILURE_THRESHOLD
        ? threshold
        : DEFAULT_HEALTH_CHECK.failureThreshold,
    fallbackProfileId,
  };
}

export function sanitizeHealthStatus(
  raw: unknown,
  profileIds: ReadonlySet<string>,
): HealthCheckStatus {
  const value =
    raw && typeof raw === 'object' ? (raw as Partial<HealthCheckStatus>) : {};
  const failures = Number(value.consecutiveFailures);
  return {
    profileId:
      typeof value.profileId === 'string' && profileIds.has(value.profileId)
        ? value.profileId
        : '',
    consecutiveFailures:
      Number.isInteger(failures) && failures > 0 ? failures : 0,
  };
}

export function sanitizeFailoverEvent(raw: unknown): FailoverEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<FailoverEvent>;
  if (
    typeof value.from !== 'string' ||
    !value.from ||
    typeof value.to !== 'string' ||
    !value.to ||
    typeof value.at !== 'number' ||
    !Number.isFinite(value.at)
  ) {
    return null;
  }
  return { from: value.from, to: value.to, at: value.at };
}

export function healthAlarmPeriodMinutes(state: ProxyState): number | null {
  return state.enabled && state.healthCheck.enabled
    ? state.healthCheck.intervalSeconds / 60
    : null;
}

function resetStatus(): HealthCheckStatus {
  return { profileId: '', consecutiveFailures: 0 };
}

function fallbackProfile(
  state: ProxyState,
  failedProfileId: string,
): ProxyProfile | null {
  if (
    state.healthCheck.fallbackProfileId === DIRECT_ACTION ||
    state.healthCheck.fallbackProfileId === failedProfileId
  ) {
    return null;
  }
  const fallback = state.profiles.find(
    (profile) => profile.id === state.healthCheck.fallbackProfileId,
  );
  return fallback && isProfileValid(fallback) ? fallback : null;
}

function sameCheckedProfile(state: ProxyState, profileId: string): boolean {
  return (
    state.enabled &&
    state.healthCheck.enabled &&
    activeProfile(state).id === profileId
  );
}

export interface HealthCheckDependencies {
  probe: (profile: ProxyProfile) => Promise<TestResult>;
  getCurrentState: () => ProxyState | null;
  now?: () => number;
}

// Run one alarm tick. Every probe goes through the same dependency as the
// manual connection test. Returning null means storage should not be changed.
export async function runHealthCheck(
  initialState: ProxyState,
  dependencies: HealthCheckDependencies,
): Promise<ProxyState | null> {
  if (healthAlarmPeriodMinutes(initialState) === null) return null;

  const checkedProfile = activeProfile(initialState);
  if (!isProfileValid(checkedProfile)) return null;
  const result = await dependencies.probe(checkedProfile);
  const current = dependencies.getCurrentState();

  // State may change while fetch is in flight. In particular, an explicit Off
  // must win and must never be overwritten by a health result.
  if (!current || !sameCheckedProfile(current, checkedProfile.id)) return null;

  if (result.ok) {
    if (
      current.healthStatus.profileId !== checkedProfile.id ||
      current.healthStatus.consecutiveFailures === 0
    ) {
      return null;
    }
    return { ...current, healthStatus: resetStatus() };
  }

  const consecutiveFailures =
    current.healthStatus.profileId === checkedProfile.id
      ? current.healthStatus.consecutiveFailures + 1
      : 1;
  if (consecutiveFailures < current.healthCheck.failureThreshold) {
    return {
      ...current,
      healthStatus: {
        profileId: checkedProfile.id,
        consecutiveFailures,
      },
    };
  }

  const fallback = fallbackProfile(current, checkedProfile.id);
  if (fallback) {
    const fallbackResult = await dependencies.probe(fallback);
    const latest = dependencies.getCurrentState();
    if (!latest || !sameCheckedProfile(latest, checkedProfile.id)) return null;
    if (fallbackResult.ok) {
      return {
        ...latest,
        enabled: true,
        activeProfileId: fallback.id,
        healthStatus: resetStatus(),
        lastFailover: {
          from: checkedProfile.name,
          to: fallback.name,
          at: (dependencies.now ?? Date.now)(),
        },
      };
    }
  }

  const latest = dependencies.getCurrentState();
  if (!latest || !sameCheckedProfile(latest, checkedProfile.id)) return null;
  return {
    ...latest,
    enabled: false,
    healthStatus: resetStatus(),
    lastFailover: {
      from: checkedProfile.name,
      to: 'Direct',
      at: (dependencies.now ?? Date.now)(),
    },
  };
}
