import { loadState, saveState, STORAGE_KEY } from '@/utils/proxy';
import type { ProxyProfile, ProxyState } from '@/utils/proxy';
import { ctx, handledAuth } from './context';
import { applyState } from './engine';
import { registerAuthHandler } from './auth';
import { testProxy } from './test';
import { registerHealthAlarm, syncHealthAlarm } from './health';

export default defineBackground(() => {
  // MV3 event listeners must be registered synchronously so a cold-start alarm
  // is not lost while storage and the proxy engine are being initialized.
  const ready = init();
  registerHealthAlarm(ready);
  registerStateChanges(ready);
  registerAuthHandler();
  registerMessages(ready);
});

async function init() {
  ctx.state = await loadState();
  await applyState(ctx.state);
  await syncHealthAlarm(ctx.state);
}

function registerStateChanges(ready: Promise<unknown>) {
  // React to changes coming from the popup or settings page.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    const changed = changes[STORAGE_KEY].newValue as ProxyState | undefined;
    // Make an explicit Off visible immediately to in-flight probes, before the
    // defensive migration read below completes.
    if (changed) ctx.state = changed;
    void ready.then(async () => {
      const next = await loadState();
      ctx.state = next;
      handledAuth.clear();
      await Promise.all([applyState(next), syncHealthAlarm(next)]);
    });
  });
}

function registerMessages(ready: Promise<unknown>) {
  // Connectivity test requested from the popup.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'test-proxy') {
      void ready
        .then(() => testProxy(msg.profile as ProxyProfile))
        .then(sendResponse);
      return true; // keep the channel open for the async response
    }
    if (msg?.type === 'set-proxy-enabled') {
      // Increment before any await so an in-flight health check is cancelled
      // synchronously. Writes then originate from this worker in call order.
      const toggleVersion = ++ctx.userToggleVersion;
      void ready
        .then(async () => {
          const current = await loadState();
          if (toggleVersion !== ctx.userToggleVersion) return;
          const next: ProxyState = {
            ...current,
            enabled: msg.enabled === true,
            healthStatus: { profileId: '', consecutiveFailures: 0 },
            lastFailover: null,
          };
          ctx.state = next;
          await saveState(next);
        })
        .then(() => sendResponse());
      return true;
    }
    return undefined;
  });
}
