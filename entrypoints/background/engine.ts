import {
  activeProfile,
  isProfileValid,
  isBypassed,
  expandBypassForChromium,
  resolveProxyDecision,
  buildPacScript,
  DIRECT_ACTION,
} from '@/utils/proxy';
import type { ProxyState, ProxyProfile } from '@/utils/proxy';

// The proxy engine: two backends behind one contract. Chromium drives the
// global `proxy.settings` (fixed_servers, or a PAC when routing rules exist).
// Firefox registers a per-request `proxy.onRequest` listener, the only API
// that can authenticate SOCKS proxies.

export async function applyState(s: ProxyState) {
  const profile = activeProfile(s);
  if (s.enabled && isProfileValid(profile)) {
    await applyEnabled(s);
    setBadge(true);
  } else {
    await disableProxy();
    setBadge(false);
  }
}

// --- Firefox backend --------------------------------------------------------

type FirefoxProxyResult = FirefoxProxyInfo | { type: 'direct' };

interface FirefoxProxyInfo {
  type: 'http' | 'https' | 'socks' | 'socks4';
  host: string;
  port: number;
  username?: string;
  password?: string;
  proxyDNS?: boolean;
}

// The currently registered onRequest listener, if any.
let firefoxListener: ((details: { url: string }) => FirefoxProxyResult) | null =
  null;

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

function firefoxDecision(url: string, s: ProxyState): FirefoxProxyResult {
  const decision = resolveProxyDecision(url, s);
  return decision === DIRECT_ACTION ? { type: 'direct' } : toFirefoxProxyInfo(decision);
}

// --- Engine contract --------------------------------------------------------

// Apply a single profile with no rules. Used by the connection test so a
// trial doesn't pick up the user's auto-switch list.
export async function enableProxy(p: ProxyProfile) {
  if (import.meta.env.FIREFOX) {
    const proxyApi = browser.proxy as any;
    if (firefoxListener) proxyApi.onRequest.removeListener(firefoxListener);
    const info = toFirefoxProxyInfo(p);
    const bypass = p.bypassList;
    firefoxListener = ({ url }) =>
      isBypassed(url, bypass) ? { type: 'direct' } : info;
    proxyApi.onRequest.addListener(firefoxListener, { urls: ['<all_urls>'] });
    return;
  }

  await chrome.proxy.settings.set({
    scope: 'regular',
    value: {
      mode: 'fixed_servers',
      rules: {
        singleProxy: { scheme: p.scheme, host: p.host.trim(), port: p.port },
        bypassList: expandBypassForChromium(p.bypassList),
      },
    },
  });
}

async function applyEnabled(s: ProxyState) {
  if (import.meta.env.FIREFOX) {
    const proxyApi = browser.proxy as any;
    if (firefoxListener) proxyApi.onRequest.removeListener(firefoxListener);
    firefoxListener = ({ url }) => firefoxDecision(url, s);
    proxyApi.onRequest.addListener(firefoxListener, { urls: ['<all_urls>'] });
    return;
  }

  // Rules need per-URL routing; chrome.proxy.settings is process-wide, so
  // compile the list + fallback profile into a PAC. No rules → keep the
  // simpler fixed_servers path (native bypassList).
  if (s.rules.length > 0) {
    await chrome.proxy.settings.set({
      scope: 'regular',
      value: {
        mode: 'pac_script',
        pacScript: { data: buildPacScript(s), mandatory: true },
      },
    });
    return;
  }

  await enableProxy(activeProfile(s));
}

export async function disableProxy() {
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

function setBadge(on: boolean) {
  chrome.action.setBadgeText({ text: on ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
}
