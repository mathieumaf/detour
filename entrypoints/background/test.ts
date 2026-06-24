import { isProfileValid, DEFAULT_STATE } from '@/utils/proxy';
import type { ProxyProfile, TestResult } from '@/utils/proxy';
import { ctx, handledAuth } from './context';
import { enableProxy, applyState } from './engine';

// Temporarily route through the given profile, fetch our exit IP, then restore
// the previous proxy state. Lets the user verify a proxy before enabling it.
export async function testProxy(profile: ProxyProfile): Promise<TestResult> {
  if (!isProfileValid(profile)) {
    return { ok: false, error: 'Fill in host and port first.' };
  }

  const previous = ctx.state;
  ctx.testProfile = profile;
  handledAuth.clear();
  const started = Date.now();

  try {
    await enableProxy(profile);
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
    // Restore whatever was active before the test (ctx.state is set on startup).
    await applyState(previous ?? DEFAULT_STATE);
  }
}
