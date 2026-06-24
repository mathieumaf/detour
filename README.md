# Detour

A simple, intuitive proxy switcher browser extension. Toggle a proxy on/off
from the toolbar popup. Supports **HTTP, HTTPS, SOCKS4, and SOCKS5**, with
authentication for HTTP/HTTPS proxies.

Built with [WXT](https://wxt.dev) + Vue (MV3).

## Browser support

| Browser | Proxy | HTTP/HTTPS auth | SOCKS auth |
| --- | --- | --- | --- |
| Chrome / Edge / Brave / Opera / Vivaldi / Arc | ✅ | ✅ | ❌ (browser limitation) |
| Firefox | ✅ | ✅ | ✅ |
| Safari | — | — | — (no `proxy` API) |

The whole Chromium family shares one build (`chrome.proxy.settings`). Firefox
uses a separate engine (`proxy.onRequest`), which is the only API that can
authenticate SOCKS proxies — so the full HTTP/HTTPS/SOCKS4/SOCKS5 + auth feature
set is complete on Firefox. Safari's WebExtensions have no `proxy` API, so it's
out of scope (it would require a native Network Extension).

## How it works

- **Background service worker** applies the proxy via `chrome.proxy.settings`
  when enabled, and releases it (falling back to system settings) when disabled.
- **Proxy authentication** for HTTP/HTTPS is supplied through
  `webRequest.onAuthRequired` (using the MV3 `webRequestAuthProvider`
  permission).
- **Bypass list** lets you list hosts that connect directly, skipping the
  proxy. `<local>` covers localhost and dotless hostnames, `*.example.com`
  matches subdomains, and a bare host matches itself. Chromium consumes the list
  natively; Firefox applies it per-request in the `proxy.onRequest` listener.
- **State** lives in `chrome.storage.local` as the single source of truth shared
  between the popup and the background worker.
- The toolbar icon shows an **ON** badge while the proxy is active.

## Known limitation (Chromium only)

Chromium browsers cannot authenticate **SOCKS** proxies — username/password are
ignored for SOCKS4/SOCKS5 (a long-standing browser limitation, not an extension
bug). On those browsers the UI disables the credential fields and shows a note
when a SOCKS scheme is selected. **Firefox has no such limitation** — SOCKS auth
works there.

## Development

```sh
bun install
bun run dev          # launches Chrome with the extension loaded
bun run dev:firefox  # launches Firefox with the extension loaded
bun run build        # production build → .output/chrome-mv3
bun run build:firefox
bun run compile      # type-check
```

Load an unpacked Chromium build from `.output/chrome-mv3` via
`chrome://extensions` (Developer mode → Load unpacked). For Firefox, load
`.output/firefox-mv3/manifest.json` via `about:debugging` → This Firefox → Load
Temporary Add-on.
