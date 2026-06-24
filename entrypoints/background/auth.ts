import { authSupported } from '@/utils/proxy';
import { ctx, handledAuth } from './context';

// Proxy authentication for HTTP/HTTPS. SOCKS auth is handled inline by Firefox's
// ProxyInfo (see engine.ts); Chromium can't do SOCKS auth at all. This path
// covers HTTP/HTTPS proxy challenges on both engines.

export function registerAuthHandler() {
  if (import.meta.env.FIREFOX) {
    chrome.webRequest.onAuthRequired.addListener(
      resolveAuth,
      { urls: ['<all_urls>'] },
      ['blocking'],
    );
  } else {
    // MV3 Chromium: `asyncBlocking` + the `webRequestAuthProvider` permission.
    chrome.webRequest.onAuthRequired.addListener(
      (details, asyncCallback): chrome.webRequest.BlockingResponse | undefined => {
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
  const p = ctx.testProfile ?? (ctx.state?.enabled ? ctx.state.profile : null);

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
