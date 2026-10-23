import {
  applyCommand,
  COMMAND_TOGGLE,
  loadState,
  saveState,
  STORAGE_KEY,
} from '@/utils/proxy';
import type { ProxyProfile, ProxyState } from '@/utils/proxy';
import { ctx, handledAuth } from './context';
import {
  applyState,
  registerFirefoxProxyListener,
  releaseFirefoxStartupHold,
  resetFirefoxRouting,
  setFirefoxBackend,
} from './engine';
import { registerAuthHandler } from './auth';
import { testProxy } from './test';
import { registerHealthAlarm, syncHealthAlarm } from './health';

// `options.firefox` is for tests. Production uses the build target, and the
// default branch is only evaluated when the caller does not pass a target
// (so unit tests never touch `import.meta.env`).
export function startBackground(options?: { firefox?: boolean }): Promise<void> {
  const firefox =
    options && typeof options.firefox === 'boolean'
      ? options.firefox
      : import.meta.env.FIREFOX;

  setFirefoxBackend(firefox);
  // A restarted worker has a fresh module graph. Tests call this more than
  // once in the same isolate, so drop any listener retained from a previous run.
  resetFirefoxRouting();

  let resolveStateReady!: () => void;
  let stateResolved = false;
  const stateReady = new Promise<void>((resolve) => {
    resolveStateReady = resolve;
  });
  const markStateReady = () => {
    if (stateResolved) return;
    stateResolved = true;
    resolveStateReady();
  };

  // Proxy and auth listeners go on before any await. The event that woke this
  // worker is delivered to listeners registered in the first turn; waiting for
  // storage first drops it.
  registerAuthHandler(stateReady, firefox);
  registerFirefoxProxyListener(stateReady);

  const ready = init(markStateReady);
  registerHealthAlarm(ready);
  registerStateChanges(ready);
  registerMessages(ready);
  registerCommands(ready);
  return ready;
}

async function init(markStateReady: () => void) {
  // Cold start: nothing is known until loadState settles. Clear anything a
  // previous test left on the shared module.
  ctx.state = null;
  try {
    ctx.state = await loadState();
    // Firefox installs its route synchronously inside applyState, before that
    // function's first await. Release held proxy/auth events only after that,
    // so they cannot observe a still-empty route and fall through to direct.
    const applied = applyState(ctx.state);
    markStateReady();
    await applied;
    await syncHealthAlarm(ctx.state);
  } catch (error) {
    releaseFirefoxStartupHold();
    markStateReady();
    throw error;
  }
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

function registerCommands(ready: Promise<unknown>) {
  // Commands fire with the popup closed. Persist the same enabled /
  // activeProfileId fields the popup writes; the storage listener re-applies
  // the engine and badge.
  chrome.commands.onCommand.addListener((command) => {
    const toggleVersion =
      command === COMMAND_TOGGLE ? ++ctx.userToggleVersion : ctx.userToggleVersion;
    void ready.then(async () => {
      const current = await loadState();
      if (command === COMMAND_TOGGLE && toggleVersion !== ctx.userToggleVersion) return;
      const next = applyCommand(command, current);
      if (!next) return;
      if (command === COMMAND_TOGGLE && toggleVersion !== ctx.userToggleVersion) return;
      ctx.state = next;
      await saveState(next);
    });
  });
}
