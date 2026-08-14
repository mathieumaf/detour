import { DIRECT_ACTION, activeProfile } from './types';
import type { ProxyProfile, ProxyState, RoutingRule } from './types';
import { isBypassed, isValidHostPattern, matchHostPattern } from './bypass';
import { isProfileValid } from './validation';

// Coerce untrusted rule objects into RoutingRule values. Drops empty matches
// and actions that are neither Direct nor an existing profile id so older
// stored state and imported files can't point at a missing profile.
export function sanitizeRules(raw: unknown, profileIds: Set<string>): RoutingRule[] {
  if (!Array.isArray(raw)) return [];
  const out: RoutingRule[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const match = typeof rec.match === 'string' ? rec.match.trim() : '';
    if (!isValidHostPattern(match)) continue;
    const action = typeof rec.action === 'string' ? rec.action : '';
    if (action !== DIRECT_ACTION && !profileIds.has(action)) continue;
    const id =
      typeof rec.id === 'string' && rec.id && !seen.has(rec.id) ? rec.id : `rule-${i}`;
    seen.add(id);
    out.push({ id, match, action });
  }
  return out;
}

export function dropRulesForProfile(rules: RoutingRule[], profileId: string): RoutingRule[] {
  return rules.filter((rule) => rule.action !== profileId);
}

// First matching rule wins. A rule whose profile is missing or incomplete is
// skipped (treated as no match). Nothing matching → the active profile.
export function resolveRoute(url: string, state: ProxyState): ProxyProfile | typeof DIRECT_ACTION {
  for (const rule of state.rules) {
    if (!matchHostPattern(url, rule.match)) continue;
    if (rule.action === DIRECT_ACTION) return DIRECT_ACTION;
    const profile = state.profiles.find((item) => item.id === rule.action);
    if (profile && isProfileValid(profile)) return profile;
  }
  return activeProfile(state);
}

// Firefox onRequest / PAC both apply this: pick a profile (or Direct) from
// the rule list, then honour that profile's bypass list.
export function resolveProxyDecision(
  url: string,
  state: ProxyState,
): ProxyProfile | typeof DIRECT_ACTION {
  const route = resolveRoute(url, state);
  if (route === DIRECT_ACTION) return DIRECT_ACTION;
  if (isBypassed(url, route.bypassList)) return DIRECT_ACTION;
  return route;
}
