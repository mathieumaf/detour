import type { ProxyProfile, TestResult } from '@/core';

// Messages the popup and settings page send to the background.
export interface TestProxyMessage {
  type: 'test-proxy';
  profile: ProxyProfile;
}

export interface SetProxyEnabledMessage {
  type: 'set-proxy-enabled';
  enabled: boolean;
}

export type BackgroundMessage = TestProxyMessage | SetProxyEnabledMessage;

// Ask the background to test the given profile and report the exit IP.
// The profile must be a plain object: chrome.runtime.sendMessage clones its
// argument with structured clone, which throws on Vue reactive proxies.
export function testProxy(profile: ProxyProfile): Promise<TestResult> {
  const message: TestProxyMessage = { type: 'test-proxy', profile };
  return chrome.runtime.sendMessage(message);
}

// Explicit user toggles go through the background so they are serialized with
// health-check writes. That keeps Off authoritative even when a probe
// completes at the same moment.
export function setProxyEnabled(enabled: boolean): Promise<void> {
  const message: SetProxyEnabledMessage = { type: 'set-proxy-enabled', enabled };
  return chrome.runtime.sendMessage(message);
}
