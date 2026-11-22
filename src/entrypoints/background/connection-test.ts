import { isProfileValid, DEFAULT_STATE } from '@/core';
import type { ProxyProfile, TestResult } from '@/core';
import { ctx, handledAuth } from './context';
import { applyProfile, applyState } from './engine';

// Temporarily route through the given profile, fetch our exit IP, then restore
// the previous proxy state. Lets the user verify a proxy before enabling it.
//
// Tests run one at a time. Each one takes over the browser's proxy for its
// duration, so two at once would measure each other.
export function testProxy(profile: ProxyProfile): Promise<TestResult> {
  const result = testQueue.then(() => runTest(profile));
  testQueue = result.then(done, done);
  return result;
}

let testQueue: Promise<void> = Promise.resolve();

function done() {}

async function runTest(profile: ProxyProfile): Promise<TestResult> {
  if (!isProfileValid(profile)) {
    return { ok: false, error: 'Fill in host and port first.' };
  }

  const previous = ctx.state;
  ctx.testProfile = profile;
  handledAuth.clear();
  const started = Date.now();

  try {
    await applyProfile(profile);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('https://api.ipify.org?format=json', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { ip } = (await res.json()) as { ip: string };
      return { ok: true, ip, ms: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const message =
      (err as Error)?.name === 'AbortError'
        ? 'Timed out after 8s.'
        : (err as Error)?.message || 'Connection failed.';
    return { ok: false, error: message };
  } finally {
    ctx.testProfile = null;
    handledAuth.clear();
    // Restore the live state. It may have changed while fetch was in flight;
    // most importantly, an explicit user Off must never be undone here.
    await applyState(ctx.state ?? previous ?? DEFAULT_STATE);
  }
}
