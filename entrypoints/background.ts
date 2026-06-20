import {
  loadState,
  isProfileValid,
  authSupported,
  STORAGE_KEY,
  type ProxyState,
  type ProxyProfile,
} from '@/utils/proxy';

// In-memory mirror of the persisted state. The service worker can be torn down
// and restarted at any time, so we always rehydrate from storage on startup.
let state: ProxyState;

// Tracks requests we've already answered an auth challenge for, so that wrong
// credentials don't trigger an infinite re-prompt loop.
const handledAuth = new Set<string>();

export default defineBackground(() => {
  void init();
});

async function init() {
  state = await loadState();
  await applyState(state);

  // React to changes coming from the popup.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    void loadState().then((next) => {
      state = next;
      handledAuth.clear();
      return applyState(next);
    });
  });

  // Supply proxy credentials for HTTP/HTTPS proxies. Requires the
  // `webRequestAuthProvider` permission (MV3) to run without webRequestBlocking.
  chrome.webRequest.onAuthRequired.addListener(
    handleAuth,
    { urls: ['<all_urls>'] },
    ['asyncBlocking'],
  );
}

async function applyState(s: ProxyState) {
  if (s.enabled && isProfileValid(s.profile)) {
    await enableProxy(s.profile);
    setBadge(true);
  } else {
    await disableProxy();
    setBadge(false);
  }
}

async function enableProxy(p: ProxyProfile) {
  await chrome.proxy.settings.set({
    scope: 'regular',
    value: {
      mode: 'fixed_servers',
      rules: {
        singleProxy: { scheme: p.scheme, host: p.host.trim(), port: p.port },
        bypassList: ['<local>'],
      },
    },
  });
}

async function disableProxy() {
  // Release control so the browser falls back to the system proxy settings.
  await chrome.proxy.settings.clear({ scope: 'regular' });
}

function handleAuth(
  details: chrome.webRequest.OnAuthRequiredDetails,
  asyncCallback?: (response: chrome.webRequest.BlockingResponse) => void,
): chrome.webRequest.BlockingResponse | undefined {
  const done = asyncCallback ?? (() => {});
  const p = state?.profile;

  // Only answer proxy challenges while active and able to authenticate.
  if (
    !details.isProxy ||
    !state?.enabled ||
    !p ||
    !authSupported(p.scheme) ||
    !p.username
  ) {
    done({});
    return;
  }

  // Already tried for this request → the credentials are wrong; stop here.
  if (handledAuth.has(details.requestId)) {
    handledAuth.delete(details.requestId);
    done({ cancel: true });
    return;
  }

  handledAuth.add(details.requestId);
  done({ authCredentials: { username: p.username, password: p.password } });
}

function setBadge(on: boolean) {
  chrome.action.setBadgeText({ text: on ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
}
