import { DIRECT_ACTION, authSupported, resolveRoute } from '@/utils/proxy';
import type { ProxyProfile, ProxyState } from '@/utils/proxy';
import { ctx, handledAuth } from './context';

// Proxy authentication for HTTP/HTTPS. SOCKS auth is handled inline by Firefox's
// ProxyInfo (see engine.ts); Chromium can't do SOCKS auth at all. This path
// covers HTTP/HTTPS proxy challenges on both engines.
//
// The listener is registered synchronously (so the challenge that woke a
// Chromium service worker or a Firefox event page is delivered) and answers
// only after storage has rehydrated `ctx.state`. Returning an empty response
// before that shows the browser's native auth prompt.

export function registerAuthHandler(stateReady: Promise<void>, firefox: boolean) {
  if (firefox) {
    // Firefox accepts a Promise from a blocking onAuthRequired listener.
    // @types/chrome only models the synchronous BlockingResponse return.
    const listener = ((details: chrome.webRequest.OnAuthRequiredDetails) =>
      resolveAuthWhenReady(details, stateReady)) as unknown as Parameters<
      typeof chrome.webRequest.onAuthRequired.addListener
    >[0];
    chrome.webRequest.onAuthRequired.addListener(listener, { urls: ['<all_urls>'] }, ['blocking']);
    return;
  }

  // MV3 Chromium: `asyncBlocking` + the `webRequestAuthProvider` permission.
  // The callback may run after the first turn; the request stays held until then.
  chrome.webRequest.onAuthRequired.addListener(
    (details, asyncCallback): undefined => {
      void resolveAuthWhenReady(details, stateReady).then((result) => {
        asyncCallback?.(result);
      });
      return undefined;
    },
    { urls: ['<all_urls>'] },
    ['asyncBlocking'],
  );
}

function profileForRequest(url: string, state: ProxyState): ProxyProfile | null {
  const route = resolveRoute(url, state);
  return route === DIRECT_ACTION ? null : route;
}

async function resolveAuthWhenReady(
  details: chrome.webRequest.OnAuthRequiredDetails,
  stateReady: Promise<void>,
): Promise<chrome.webRequest.BlockingResponse> {
  try {
    await stateReady;
    return resolveAuth(details);
  } catch {
    // Don't leave the request hanging if startup failed. An empty response is
    // the same "no credentials" answer the handler used to give for null state.
    return {};
  }
}

function resolveAuth(
  details: chrome.webRequest.OnAuthRequiredDetails,
): chrome.webRequest.BlockingResponse {
  // A running test takes precedence; otherwise pick the profile the request
  // would actually use (a matching rule, or the active fallback).
  const p = ctx.testProfile ?? (ctx.state?.enabled ? profileForRequest(details.url, ctx.state) : null);

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
