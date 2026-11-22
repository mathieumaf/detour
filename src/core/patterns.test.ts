import { describe, expect, test } from 'bun:test';
import {
  PRIVATE_CIDRS,
  expandBypassForChromium,
  formatBypassList,
  isBypassed,
  isValidHostPattern,
  matchHostPattern,
  parseBypassList,
} from './patterns';

describe('isValidHostPattern', () => {
  test('accepts hosts, wildcards, CIDR, and shorthands', () => {
    expect(isValidHostPattern('github.com')).toBe(true);
    expect(isValidHostPattern('*.example.com')).toBe(true);
    expect(isValidHostPattern('.example.com')).toBe(true);
    expect(isValidHostPattern('10.0.0.0/8')).toBe(true);
    expect(isValidHostPattern('<local>')).toBe(true);
    expect(isValidHostPattern('<PRIVATE>')).toBe(true);
    expect(isValidHostPattern('::1/128')).toBe(true);
  });

  test('rejects empty, spaced, or malformed CIDR', () => {
    expect(isValidHostPattern('')).toBe(false);
    expect(isValidHostPattern('  ')).toBe(false);
    expect(isValidHostPattern('foo bar')).toBe(false);
    expect(isValidHostPattern('10.0.0.0/99')).toBe(false);
    expect(isValidHostPattern('not-cidr/x')).toBe(false);
    expect(isValidHostPattern('10.0.0.999/8')).toBe(false);
    expect(isValidHostPattern('::1/129')).toBe(false);
  });
});

describe('matchHostPattern', () => {
  test('exact host, wildcard, and leading-dot', () => {
    expect(matchHostPattern('https://github.com/foo', 'github.com')).toBe(true);
    expect(matchHostPattern('https://www.github.com/', 'github.com')).toBe(false);
    expect(matchHostPattern('https://api.example.com/', '*.example.com')).toBe(true);
    expect(matchHostPattern('https://example.com/', '*.example.com')).toBe(false);
    expect(matchHostPattern('https://example.com/', '.example.com')).toBe(true);
    expect(matchHostPattern('https://a.example.com/', '.example.com')).toBe(true);
    expect(matchHostPattern('https://notexample.com/', '.example.com')).toBe(false);
  });

  test('ignores case and surrounding whitespace in the pattern', () => {
    expect(matchHostPattern('https://GitHub.com/', ' GITHUB.com ')).toBe(true);
    expect(matchHostPattern('https://api.example.com/', '*.EXAMPLE.com')).toBe(true);
  });

  test('<local>, <private>, and CIDR match IP literals only', () => {
    expect(matchHostPattern('http://localhost/', '<local>')).toBe(true);
    expect(matchHostPattern('http://intranet/', '<local>')).toBe(true);
    expect(matchHostPattern('http://127.0.0.1/', '<local>')).toBe(true);
    expect(matchHostPattern('http://[::1]/', '<local>')).toBe(true);
    expect(matchHostPattern('http://example.com/', '<local>')).toBe(false);
    expect(matchHostPattern('http://10.1.2.3/', '<private>')).toBe(true);
    expect(matchHostPattern('http://8.8.8.8/', '<private>')).toBe(false);
    expect(matchHostPattern('http://10.9.0.1/', '10.0.0.0/8')).toBe(true);
    expect(matchHostPattern('http://11.0.0.1/', '10.0.0.0/8')).toBe(false);
    // Hostnames are not DNS-resolved for CIDR / <private>.
    expect(matchHostPattern('https://github.com/', '10.0.0.0/8')).toBe(false);
  });

  test('<private> covers every private range, IPv4 and IPv6', () => {
    for (const host of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.1',
      '169.254.10.10',
      '[::1]',
      '[fd12:3456::1]',
      '[fe80::1]',
    ]) {
      expect(matchHostPattern(`http://${host}/`, '<private>')).toBe(true);
    }
    for (const host of ['172.32.0.1', '192.169.0.1', '1.1.1.1', '[2001:db8::1]']) {
      expect(matchHostPattern(`http://${host}/`, '<private>')).toBe(false);
    }
  });

  test('IPv6 CIDR ranges, and IP versions never cross-match', () => {
    expect(matchHostPattern('http://[2001:db8::42]/', '2001:db8::/32')).toBe(true);
    expect(matchHostPattern('http://[2001:db9::42]/', '2001:db8::/32')).toBe(false);
    expect(matchHostPattern('http://[::1]/', '0.0.0.0/0')).toBe(false);
    expect(matchHostPattern('http://10.0.0.1/', '::/0')).toBe(false);
    expect(matchHostPattern('http://1.2.3.4/', '0.0.0.0/0')).toBe(true);
  });

  test('a URL that does not parse matches nothing', () => {
    expect(matchHostPattern('not a url', 'github.com')).toBe(false);
  });
});

describe('isBypassed', () => {
  test('matches when any entry matches, and skips blank entries', () => {
    expect(isBypassed('https://b.com/', ['a.com', '', '  ', 'b.com'])).toBe(true);
    expect(isBypassed('https://c.com/', ['a.com', 'b.com'])).toBe(false);
    expect(isBypassed('https://c.com/', [])).toBe(false);
  });
});

describe('bypass list text', () => {
  test('parses lines and commas, trims, and removes duplicates', () => {
    expect(parseBypassList(' <local>\n*.example.com, 10.0.0.0/8\n\n<local>\n')).toEqual([
      '<local>',
      '*.example.com',
      '10.0.0.0/8',
    ]);
    expect(parseBypassList('')).toEqual([]);
  });

  test('formats one entry per line, and round-trips', () => {
    const list = ['<local>', '*.example.com'];
    expect(formatBypassList(list)).toBe('<local>\n*.example.com');
    expect(parseBypassList(formatBypassList(list))).toEqual(list);
  });
});

describe('expandBypassForChromium', () => {
  test('replaces <private> with its ranges and leaves the rest alone', () => {
    expect(expandBypassForChromium(['<local>', ' <PRIVATE> ', 'example.com'])).toEqual([
      '<local>',
      ...PRIVATE_CIDRS,
      'example.com',
    ]);
  });
});
