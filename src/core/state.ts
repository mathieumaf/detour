import { DEFAULT_PROFILE } from './types';
import type { ProxyState } from './types';
import { sanitizeProfile } from './profile';
import { sanitizeRules } from './rules';
import { sanitizeFailoverEvent, sanitizeHealthCheck, sanitizeHealthStatus } from './health';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Turn whatever is in storage (or the `state` of an exported file) into a
// complete, internally consistent ProxyState. This is the only migration path:
// every reader goes through it, so older shapes are upgraded in one place and
// nothing downstream has to defend against missing fields.
//
//   - no value at all        → the default state (first run)
//   - v1 `{ profile }`       → that profile becomes the only, active profile
//   - missing rules (< 1.5)  → an empty rule list
//   - missing health (< 1.6) → health checks off
//
// Rules, the fallback profile, and the health status may only point at
// profiles that exist; anything dangling is dropped.
export function normalizeState(raw: unknown): ProxyState {
  const stored = isRecord(raw) ? raw : {};
  const listed = Array.isArray(stored.profiles) ? stored.profiles.filter(isRecord) : [];
  const profiles = listed.length
    ? listed.map((profile, index) => sanitizeProfile(profile, index))
    : [sanitizeProfile(isRecord(stored.profile) ? stored.profile : { ...DEFAULT_PROFILE }, 0)];
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const activeProfileId =
    typeof stored.activeProfileId === 'string' && profileIds.has(stored.activeProfileId)
      ? stored.activeProfileId
      : (profiles[0]?.id ?? DEFAULT_PROFILE.id);

  return {
    enabled: stored.enabled === true,
    activeProfileId,
    profiles,
    rules: sanitizeRules(stored.rules, profileIds),
    healthCheck: sanitizeHealthCheck(stored.healthCheck, profileIds),
    healthStatus: sanitizeHealthStatus(stored.healthStatus, profileIds),
    lastFailover: sanitizeFailoverEvent(stored.lastFailover),
  };
}

// Health counters and the last failover describe one running session. They are
// cleared whenever the user changes what Detour should be doing.
export function clearHealthRuntime(): Pick<ProxyState, 'healthStatus' | 'lastFailover'> {
  return {
    healthStatus: { profileId: '', consecutiveFailures: 0 },
    lastFailover: null,
  };
}
