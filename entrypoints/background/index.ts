import { loadState, STORAGE_KEY } from '@/utils/proxy';
import type { ProxyProfile } from '@/utils/proxy';
import { ctx, handledAuth } from './context';
import { applyState } from './engine';
import { registerAuthHandler } from './auth';
import { testProxy } from './test';
import { registerHealthAlarm, syncHealthAlarm } from './health';

export default defineBackground(() => {
  void init();
});

async function init() {
  ctx.state = await loadState();
  await applyState(ctx.state);
  await syncHealthAlarm(ctx.state);
  registerHealthAlarm();

  // React to changes coming from the popup.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    void loadState().then((next) => {
      ctx.state = next;
      handledAuth.clear();
      return Promise.all([applyState(next), syncHealthAlarm(next)]);
    });
  });

  registerAuthHandler();

  // Connectivity test requested from the popup.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'test-proxy') {
      testProxy(msg.profile as ProxyProfile).then(sendResponse);
      return true; // keep the channel open for the async response
    }
    return undefined;
  });
}
