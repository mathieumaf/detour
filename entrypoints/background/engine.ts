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
//
// `browser.proxy.onRequest` must be registered in the first turn of a Firefox
// event page. Registering it only after storage loads drops the request that
// woke the background (and anything else that arrives during the load) onto
// the browser default, which is a direct leak while a profile is active.
// The listener is therefore installed synchronously and waits for state.

// Set from the build target at startup. Tests pass the target explicitly so
// both backends can run under Bun, where `import.meta.env.FIREFOX` is unset.
let firefoxBackend: boolean | null = null;

export function setFirefoxBackend(firefox: boolean) {
  firefoxBackend = firefox;
}

function isFirefox(): boolean {
  if (firefoxBackend !== null) return firefoxBackend;
  return import.meta.env.FIREFOX;
}

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

type FirefoxRoute =
  | { kind: 'state'; state: ProxyState }
  | { kind: 'profile'; profile: ProxyProfile };

// The listener stays registered only while Detour is handling requests.
// `route === null` means "not our decision": return undefined so Firefox keeps
// the browser / system proxy instead of forcing a direct connection.
let firefoxRoute: FirefoxRoute | null = null;
let firefoxListener: ((details: { url: string }) => Promise<FirefoxProxyResult | undefined>) | null =
  null;
let firefoxStateReady: Promise<void> = Promise.resolve();

export function resetFirefoxRouting() {
  firefoxListener = null;
  firefoxRoute = null;
}

export function registerFirefoxProxyListener(stateReady: Promise<void>) {
  firefoxStateReady = stateReady;
  if (!isFirefox()) return;
  attachFirefoxListener();
}

// Storage failed before a route was installed. Drop the startup listener so a
// held request falls through to the browser default and later requests do not
// keep waking the event page.
export function releaseFirefoxStartupHold() {
  if (!isFirefox() || firefoxRoute) return;
  detachFirefoxListener();
}

function firefoxProxyEvents(): {
  addListener: (
    listener: (details: { url: string }) => Promise<FirefoxProxyResult | undefined>,
    filter: { urls: string[] },
  ) => void;
  removeListener: (
    listener: (details: { url: string }) => Promise<FirefoxProxyResult | undefined>,
  ) => void;
} {
  return (browser.proxy as any).onRequest;
}

function attachFirefoxListener() {
  if (!isFirefox() || firefoxListener) return;
  const stateReady = firefoxStateReady;
  const listener = (details: { url: string }) =>
    resolveFirefoxRequest(details.url, stateReady);
  firefoxListener = listener;
  firefoxProxyEvents().addListener(listener, { urls: ['<all_urls>'] });
}

function detachFirefoxListener() {
  if (!firefoxListener) return;
  firefoxProxyEvents().removeListener(firefoxListener);
  firefoxListener = null;
}

function setFirefoxRoute(route: FirefoxRoute) {
  firefoxRoute = route;
  attachFirefoxListener();
}

function clearFirefoxRoute() {
  firefoxRoute = null;
  detachFirefoxListener();
}

async function resolveFirefoxRequest(
  url: string,
  stateReady: Promise<void>,
): Promise<FirefoxProxyResult | undefined> {
  await stateReady;
  const route = firefoxRoute;
  if (!route) return undefined;
  if (route.kind === 'profile') {
    return isBypassed(url, route.profile.bypassList)
      ? { type: 'direct' }
      : toFirefoxProxyInfo(route.profile);
  }
  return firefoxDecision(url, route.state);
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

function firefoxDecision(url: string, s: ProxyState): FirefoxProxyResult {
  const decision = resolveProxyDecision(url, s);
  return decision === DIRECT_ACTION ? { type: 'direct' } : toFirefoxProxyInfo(decision);
}

// --- Engine contract --------------------------------------------------------

// Apply a single profile with no rules. Used by the connection test so a
// trial doesn't pick up the user's auto-switch list.
export async function enableProxy(p: ProxyProfile) {
  if (isFirefox()) {
    setFirefoxRoute({ kind: 'profile', profile: p });
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
  if (isFirefox()) {
    setFirefoxRoute({ kind: 'state', state: s });
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
  if (isFirefox()) {
    clearFirefoxRoute();
    return;
  }

  // Release control so the browser falls back to the system proxy settings.
  await chrome.proxy.settings.clear({ scope: 'regular' });
}

function setBadge(on: boolean) {
  chrome.action.setBadgeText({ text: on ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
}
