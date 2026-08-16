import type { ProxyProfile, TestResult } from './types';

// Messages exchanged between the popup and the background worker.
export interface TestProxyMessage {
  type: 'test-proxy';
  profile: ProxyProfile;
}

export interface SetProxyEnabledMessage {
  type: 'set-proxy-enabled';
  enabled: boolean;
}

// Ask the background worker to test the given profile and report the exit IP.
// The profile must be a plain object — chrome.runtime.sendMessage clones its
// argument via structured clone, which throws on Vue reactive proxies.
export function testProxy(profile: ProxyProfile): Promise<TestResult> {
  const message: TestProxyMessage = { type: 'test-proxy', profile };
  return chrome.runtime.sendMessage(message) as Promise<TestResult>;
}

// Route explicit user toggles through the background worker so they are
// serialized with health-check writes. This makes Off authoritative even when
// a probe completes at the same moment.
export function setProxyEnabled(enabled: boolean): Promise<void> {
  const message: SetProxyEnabledMessage = { type: 'set-proxy-enabled', enabled };
  return chrome.runtime.sendMessage(message) as Promise<void>;
}
