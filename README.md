# Detour

A simple, intuitive proxy switcher browser extension. Toggle a proxy on/off
from the toolbar popup. Supports **HTTP, HTTPS, SOCKS4, and SOCKS5**, with
authentication for HTTP/HTTPS proxies.

Built with [WXT](https://wxt.dev) + Vue, targeting Chrome/Chromium (MV3).

## How it works

- **Background service worker** applies the proxy via `chrome.proxy.settings`
  when enabled, and releases it (falling back to system settings) when disabled.
- **Proxy authentication** for HTTP/HTTPS is supplied through
  `webRequest.onAuthRequired` (using the MV3 `webRequestAuthProvider`
  permission).
- **State** lives in `chrome.storage.local` as the single source of truth shared
  between the popup and the background worker.
- The toolbar icon shows an **ON** badge while the proxy is active.

## Known limitation

Chrome cannot authenticate **SOCKS** proxies — username/password are ignored for
SOCKS4/SOCKS5 (a long-standing browser limitation, not an extension bug). The UI
disables the credential fields and shows a note when a SOCKS scheme is selected.
Authenticated SOCKS would require a Firefox build (`browser.proxy.onRequest`),
which is a candidate for a future version.

## Development

```sh
bun install
bun run dev          # launches Chrome with the extension loaded
bun run build        # production build → .output/chrome-mv3
bun run compile      # type-check
```

Load an unpacked build manually from `.output/chrome-mv3` via
`chrome://extensions` (Developer mode → Load unpacked).
