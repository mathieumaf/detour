import { describe, expect, test } from 'bun:test';
import { authSupported, isProfileValid, isValidPort, sanitizeProfile } from './profile';
import { DEFAULT_PROFILE } from './types';

describe('authSupported', () => {
  test('Chromium authenticates HTTP and HTTPS proxies only', () => {
    expect(authSupported('http', false)).toBe(true);
    expect(authSupported('https', false)).toBe(true);
    expect(authSupported('socks4', false)).toBe(false);
    expect(authSupported('socks5', false)).toBe(false);
  });

  test('Firefox authenticates every scheme', () => {
    for (const scheme of ['http', 'https', 'socks4', 'socks5'] as const) {
      expect(authSupported(scheme, true)).toBe(true);
    }
  });
});

describe('isProfileValid', () => {
  test('needs a host and a port in range', () => {
    expect(isProfileValid({ ...DEFAULT_PROFILE, host: 'proxy.example' })).toBe(true);
    expect(isProfileValid({ ...DEFAULT_PROFILE, host: '   ' })).toBe(false);
    expect(isProfileValid({ ...DEFAULT_PROFILE, host: 'proxy.example', port: 0 })).toBe(false);
    expect(isProfileValid({ ...DEFAULT_PROFILE, host: 'proxy.example', port: 65536 })).toBe(false);
    expect(isProfileValid({ ...DEFAULT_PROFILE, host: 'proxy.example', port: 80.5 })).toBe(false);
  });

  test('isValidPort accepts 1 to 65535', () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
    expect(isValidPort(Number.NaN)).toBe(false);
  });
});

describe('sanitizeProfile', () => {
  test('keeps a well-formed profile as it is', () => {
    const profile = {
      id: 'work',
      name: 'Work',
      scheme: 'socks5',
      host: 'proxy.example',
      port: 1080,
      username: 'user',
      password: 'secret',
      bypassList: ['<local>', '*.example.com'],
    };
    expect(sanitizeProfile(profile, 3)).toEqual({ ...profile, scheme: 'socks5' });
  });

  test('backfills every missing or malformed field', () => {
    expect(sanitizeProfile({}, 0)).toEqual({
      id: 'profile-0',
      name: 'Default profile',
      scheme: 'http',
      host: '',
      port: 8080,
      username: '',
      password: '',
      bypassList: ['<local>'],
    });
    expect(
      sanitizeProfile(
        {
          id: '',
          name: '   ',
          scheme: 'ftp',
          host: 42,
          port: '70000',
          username: null,
          password: undefined,
          bypassList: ['ok.example', 7, null],
        },
        2,
      ),
    ).toEqual({
      id: 'profile-2',
      name: 'Profile 3',
      scheme: 'http',
      host: '',
      port: 8080,
      username: '',
      password: '',
      bypassList: ['ok.example'],
    });
  });

  test('trims the name and host, and accepts a numeric string port', () => {
    const profile = sanitizeProfile({ name: ' Home ', host: ' 10.0.0.1 ', port: '3128' }, 0);
    expect(profile.name).toBe('Home');
    expect(profile.host).toBe('10.0.0.1');
    expect(profile.port).toBe(3128);
  });

  test('does not share the default bypass list between profiles', () => {
    const first = sanitizeProfile({}, 0);
    first.bypassList.push('mutated');
    expect(sanitizeProfile({}, 1).bypassList).toEqual(['<local>']);
    expect(DEFAULT_PROFILE.bypassList).toEqual(['<local>']);
  });
});
