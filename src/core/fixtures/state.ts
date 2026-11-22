// Shared test data. Not imported by the extension.
import { DEFAULT_STATE, DIRECT_ACTION } from '../types';
import type { ProxyProfile, ProxyState } from '../types';

export const work: ProxyProfile = {
  id: 'work',
  name: 'Work',
  scheme: 'https',
  host: 'proxy.work.example',
  port: 8443,
  username: '',
  password: '',
  bypassList: ['<local>'],
};

export const home: ProxyProfile = {
  id: 'home',
  name: 'Home',
  scheme: 'socks5',
  host: '10.8.0.1',
  port: 1080,
  username: '',
  password: '',
  bypassList: ['*.internal.example.com'],
};

// Two profiles, `home` active, and three rules: github.com goes through
// `work`, private addresses and 10.0.0.0/8 connect directly.
export function makeState(partial: Partial<ProxyState> = {}): ProxyState {
  return {
    enabled: true,
    activeProfileId: home.id,
    profiles: [work, home],
    rules: [
      { id: 'r1', match: 'github.com', action: work.id },
      { id: 'r2', match: '<private>', action: DIRECT_ACTION },
      { id: 'r3', match: '10.0.0.0/8', action: DIRECT_ACTION },
    ],
    healthCheck: { ...DEFAULT_STATE.healthCheck },
    healthStatus: { ...DEFAULT_STATE.healthStatus },
    lastFailover: null,
    ...partial,
  };
}
