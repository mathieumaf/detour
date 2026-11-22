import { DIRECT_ACTION, isBypassed, resolveProxyDecision } from '@/core';
import type { ProxyProfile, ProxyState } from '@/core';
import type { ProxyBackend } from './backend';

// Firefox asks the extension about every request through proxy.onRequest. It
// is the only API that can authenticate a SOCKS proxy.
//
// The listener must be registered in the first turn of the event page. If it
// were registered only after storage loads, the request that woke the
// background (and anything else arriving during the load) would fall through
// to the browser default: a direct connection while a profile is active. So
// the listener goes on synchronously and each request waits for the state.

type FirefoxProxyResult = FirefoxProxyInfo | { type: 'direct' };

interface FirefoxProxyInfo {
  type: 'http' | 'https' | 'socks' | 'socks4';
  host: string;
  port: number;
  username?: string;
  password?: string;
  proxyDNS?: boolean;
}

type RequestListener = (details: { url: string }) => Promise<FirefoxProxyResult | undefined>;

// proxy.onRequest is Firefox-only, so the shared browser types do not have it.
interface FirefoxProxyApi {
  onRequest: {
    addListener(listener: RequestListener, filter: { urls: string[] }): void;
    removeListener(listener: RequestListener): void;
  };
}

type Route = { kind: 'state'; state: ProxyState } | { kind: 'profile'; profile: ProxyProfile };

function proxyEvents(): FirefoxProxyApi['onRequest'] {
  return (browser.proxy as unknown as FirefoxProxyApi).onRequest;
}

function toProxyInfo(profile: ProxyProfile): FirefoxProxyInfo {
  // Firefox calls SOCKS5 "socks" and carries credentials inline.
  const type =
    profile.scheme === 'socks5' ? 'socks' : profile.scheme === 'socks4' ? 'socks4' : profile.scheme;
  const info: FirefoxProxyInfo = { type, host: profile.host.trim(), port: profile.port };
  if (profile.username) {
    info.username = profile.username;
    info.password = profile.password;
  }
  if (type === 'socks') info.proxyDNS = true; // resolve DNS through the proxy
  return info;
}

function decide(url: string, route: Route): FirefoxProxyResult {
  if (route.kind === 'profile') {
    return isBypassed(url, route.profile.bypassList)
      ? { type: 'direct' }
      : toProxyInfo(route.profile);
  }
  const decision = resolveProxyDecision(url, route.state);
  return decision === DIRECT_ACTION ? { type: 'direct' } : toProxyInfo(decision);
}

export function createFirefoxBackend(): ProxyBackend {
  // The listener stays registered only while Detour is handling requests.
  // No route means "not our decision": the listener answers undefined, so
  // Firefox keeps the user's own proxy settings instead of going direct.
  let route: Route | null = null;
  let listener: RequestListener | null = null;
  let stateReady: Promise<void> = Promise.resolve();

  function attach() {
    if (listener) return;
    const ready = stateReady;
    listener = async (details) => {
      await ready;
      return route ? decide(details.url, route) : undefined;
    };
    proxyEvents().addListener(listener, { urls: ['<all_urls>'] });
  }

  function detach() {
    if (!listener) return;
    proxyEvents().removeListener(listener);
    listener = null;
  }

  // The three routing methods below take effect before they return, with no
  // await in front of the change. Startup relies on that: it installs the
  // route and only then releases the requests that were waiting for state.
  return {
    start(ready) {
      stateReady = ready;
      attach();
    },

    routeByState(state) {
      route = { kind: 'state', state };
      attach();
      return Promise.resolve();
    },

    routeByProfile(profile) {
      route = { kind: 'profile', profile };
      attach();
      return Promise.resolve();
    },

    release() {
      route = null;
      detach();
      return Promise.resolve();
    },

    // Drop the startup listener so a held request falls through to the
    // browser default and later requests stop waking the event page.
    abortStartup() {
      if (!route) detach();
    },
  };
}
