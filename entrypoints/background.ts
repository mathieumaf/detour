import {
  loadState,
  isProfileValid,
  authSupported,
  STORAGE_KEY,
  type ProxyState,
  type ProxyProfile,
  type TestResult,
} from '@/utils/proxy';

// In-memory mirror of the persisted state. The worker can be torn down and
// restarted at any time, so we always rehydrate from storage on startup.
let state: ProxyState;

// While a connectivity test runs, this holds the profile being tried so the
// auth path uses its credentials instead of the saved ones.
let testProfile: ProxyProfile | null = null;

// Tracks requests we've already answered an auth challenge for, so that wrong
// credentials don't trigger an infinite re-prompt loop (Chromium / HTTP proxies).
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

async function applyState(s: ProxyState) {
  if (s.enabled && isProfileValid(s.profile)) {
    await enableProxy(s.profile);
    setBadge(true);
  } else {
    await disableProxy();
    setBadge(false);
  }
}

// --- Proxy engine -----------------------------------------------------------
// Two backends behind one contract: Chromium drives the global
// `proxy.settings`; Firefox registers a per-request `proxy.onRequest` listener,
// which is the only API that can authenticate SOCKS proxies.

// Firefox-only: the currently registered onRequest listener, if any.
let firefoxListener: ((details: unknown) => FirefoxProxyInfo) | null = null;

interface FirefoxProxyInfo {
  type: 'http' | 'https' | 'socks' | 'socks4';
  host: string;
  port: number;
  username?: string;
  password?: string;
  proxyDNS?: boolean;
}

function toFirefoxProxyInfo(p: ProxyProfile): FirefoxProxyInfo {
  // Firefox uses "socks" for SOCKS5 and carries credentials inline.
  const type =
    p.scheme === 'socks5' ? 'socks' : p.scheme === 'socks4' ? 'socks4' : p.scheme;
  const info: FirefoxProxyInfo = { type, host: p.host.trim(), port: p.port };
  if (p.username) {
    info.username = p.username;
    info.password = p.password;
  }
  if (type === 'socks') info.proxyDNS = true; // resolve DNS through the proxy
  return info;
}

async function enableProxy(p: ProxyProfile) {
  if (import.meta.env.FIREFOX) {
    const proxyApi = browser.proxy as any;
    if (firefoxListener) proxyApi.onRequest.removeListener(firefoxListener);
    const info = toFirefoxProxyInfo(p);
    firefoxListener = () => info;
    proxyApi.onRequest.addListener(firefoxListener, { urls: ['<all_urls>'] });
    return;
  }

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
  if (import.meta.env.FIREFOX) {
    if (firefoxListener) {
      (browser.proxy as any).onRequest.removeListener(firefoxListener);
      firefoxListener = null;
    }
    return;
  }

  // Release control so the browser falls back to the system proxy settings.
  await chrome.proxy.settings.clear({ scope: 'regular' });
}

// --- Proxy authentication (HTTP/HTTPS) --------------------------------------
// SOCKS auth is handled inline by Firefox's ProxyInfo above; Chromium can't do
// SOCKS auth at all. This path covers HTTP/HTTPS proxy challenges on both.

function registerAuthHandler() {
  if (import.meta.env.FIREFOX) {
    chrome.webRequest.onAuthRequired.addListener(
      resolveAuth,
      { urls: ['<all_urls>'] },
      ['blocking'],
    );
  } else {
    // MV3 Chromium: `asyncBlocking` + the `webRequestAuthProvider` permission.
    chrome.webRequest.onAuthRequired.addListener(
      (
        details,
        asyncCallback,
      ): chrome.webRequest.BlockingResponse | undefined => {
        asyncCallback?.(resolveAuth(details));
        return undefined;
      },
      { urls: ['<all_urls>'] },
      ['asyncBlocking'],
    );
  }
}

function resolveAuth(
  details: chrome.webRequest.OnAuthRequiredDetails,
): chrome.webRequest.BlockingResponse {
  // A running test takes precedence; otherwise use the saved profile if active.
  const p = testProfile ?? (state?.enabled ? state.profile : null);

  if (!details.isProxy || !p || !authSupported(p.scheme) || !p.username) {
    return {};
  }

  // Already tried for this request → the credentials are wrong; stop here.
  if (handledAuth.has(details.requestId)) {
    handledAuth.delete(details.requestId);
    return { cancel: true };
  }

  handledAuth.add(details.requestId);
  return { authCredentials: { username: p.username, password: p.password } };
}

// --- Connectivity test ------------------------------------------------------

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
    const message =
      (err as Error)?.name === 'AbortError'
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
