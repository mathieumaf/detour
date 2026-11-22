import { describe, expect, test } from 'bun:test';
import { home, makeState, work } from './fixtures/state';
import { dropRulesForProfile, resolveProxyDecision, resolveRoute, sanitizeRules } from './rules';
import { DEFAULT_STATE, DIRECT_ACTION } from './types';

describe('resolveRoute / resolveProxyDecision', () => {
  test('first match wins: github.com → work, private/CIDR → direct, else home', () => {
    const s = makeState();
    expect(resolveRoute('https://github.com/mathieumaf/detour', s)).toEqual(work);
    expect(resolveRoute('http://10.1.2.3/', s)).toBe(DIRECT_ACTION);
    expect(resolveRoute('http://192.168.1.4/', s)).toBe(DIRECT_ACTION);
    expect(resolveRoute('https://example.com/', s)).toEqual(home);
  });

  test('skips a rule whose profile is missing or incomplete', () => {
    const s = makeState({
      rules: [
        { id: 'bad', match: 'github.com', action: 'missing' },
        { id: 'ok', match: 'github.com', action: work.id },
      ],
    });
    expect(resolveRoute('https://github.com/', s)).toEqual(work);

    const incomplete = makeState({
      profiles: [{ ...work, host: '' }, home],
      rules: [{ id: 'r', match: 'github.com', action: work.id }],
    });
    expect(resolveRoute('https://github.com/', incomplete)).toEqual(home);
  });

  test('profile bypass still applies after a rule selects that profile', () => {
    const s = makeState({
      rules: [{ id: 'r', match: '*.internal.example.com', action: home.id }],
    });
    // home is selected, but its bypass list skips this host.
    expect(resolveProxyDecision('https://git.internal.example.com/', s)).toBe(DIRECT_ACTION);
    expect(resolveProxyDecision('https://other.example.com/', s)).toEqual(home);
  });

  test('empty rules fall back to the active profile (and its bypass)', () => {
    const s = makeState({ rules: [] });
    expect(resolveRoute('https://github.com/', s)).toEqual(home);
    expect(resolveProxyDecision('https://git.internal.example.com/', s)).toBe(DIRECT_ACTION);
  });

  test('the default state has no rules', () => {
    expect(DEFAULT_STATE.rules).toEqual([]);
  });
});

describe('sanitizeRules / dropRulesForProfile', () => {
  test('drops empty matches and unknown actions; missing list → []', () => {
    const ids = new Set([work.id]);
    expect(sanitizeRules(undefined, ids)).toEqual([]);
    expect(
      sanitizeRules(
        [
          { id: 'a', match: 'github.com', action: work.id },
          { id: 'b', match: '', action: DIRECT_ACTION },
          { id: 'c', match: 'x.com', action: 'gone' },
          { match: '<private>', action: DIRECT_ACTION },
          null,
          'not a rule',
        ],
        ids,
      ),
    ).toEqual([
      { id: 'a', match: 'github.com', action: work.id },
      { id: 'rule-3', match: '<private>', action: DIRECT_ACTION },
    ]);
  });

  test('gives a repeated rule id a fresh one, and trims the match', () => {
    expect(
      sanitizeRules(
        [
          { id: 'same', match: ' a.com ', action: DIRECT_ACTION },
          { id: 'same', match: 'b.com', action: DIRECT_ACTION },
        ],
        new Set(),
      ),
    ).toEqual([
      { id: 'same', match: 'a.com', action: DIRECT_ACTION },
      { id: 'rule-1', match: 'b.com', action: DIRECT_ACTION },
    ]);
  });

  test('dropRulesForProfile removes only that profile’s actions', () => {
    const rules = [
      { id: '1', match: 'a.com', action: work.id },
      { id: '2', match: 'b.com', action: DIRECT_ACTION },
      { id: '3', match: 'c.com', action: home.id },
    ];
    expect(dropRulesForProfile(rules, work.id)).toEqual([
      { id: '2', match: 'b.com', action: DIRECT_ACTION },
      { id: '3', match: 'c.com', action: home.id },
    ]);
  });
});
