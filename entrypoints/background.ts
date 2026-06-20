import {
  loadState,
  isProfileValid,
  authSupported,
  STORAGE_KEY,
  type ProxyState,
  type ProxyProfile,
  type TestResult,
} from '@/utils/proxy';

// In-memory mirror of the persisted state. The service worker can be torn down
// and restarted at any time, so we always rehydrate from storage on startup.
let state: ProxyState;

// While a connectivity test runs, this holds the profile being tried so the
// auth handler uses its credentials instead of the saved ones.
let testProfile: ProxyProfile | null = null;

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

  // Connectivity test requested from the popup.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'test-proxy') {
      testProxy(msg.profile as ProxyProfile).then(sendResponse);
      return true; // keep the channel open for the async response
    }
    return undefined;
  });
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
  // A running test takes precedence; otherwise use the saved profile if active.
  const p = testProfile ?? (state?.enabled ? state.profile : null);

  // Only answer proxy challenges when we have credentials we can supply.
  if (!details.isProxy || !p || !authSupported(p.scheme) || !p.username) {
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

// Temporarily route through the given profile, fetch our exit IP, then restore
// the previous proxy state. Lets the user verify a proxy before enabling it.
async function testProxy(profile: ProxyProfile): Promise<TestResult> {
  if (!isProfileValid(profile)) {
    return { ok: false, error: 'Fill in host and port first.' };
  }

  const previous = state;
  testProfile = profile;
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
    const name = (err as Error)?.name;
    const message =
      name === 'AbortError'
        ? 'Timed out after 8s.'
        : (err as Error)?.message || 'Connection failed.';
    return { ok: false, error: message };
  } finally {
    testProfile = null;
    handledAuth.clear();
    await applyState(previous); // restore whatever was active before the test
  }
}

function setBadge(on: boolean) {
  chrome.action.setBadgeText({ text: on ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
}
