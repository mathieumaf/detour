import type { ProxyProfile, TestResult } from './types';

// Messages exchanged between the popup and the background worker.
export interface TestProxyMessage {
  type: 'test-proxy';
  profile: ProxyProfile;
}

// Ask the background worker to test the given profile and report the exit IP.
// The profile must be a plain object — chrome.runtime.sendMessage clones its
// argument via structured clone, which throws on Vue reactive proxies.
export function testProxy(profile: ProxyProfile): Promise<TestResult> {
  const message: TestProxyMessage = { type: 'test-proxy', profile };
  return chrome.runtime.sendMessage(message) as Promise<TestResult>;
}
