# Detour

A simple, intuitive proxy switcher browser extension. Toggle a proxy on/off
from the toolbar popup. Supports **HTTP, HTTPS, SOCKS4, and SOCKS5**, with
authentication for HTTP/HTTPS proxies.

Built with [WXT](https://wxt.dev) + Vue (MV3).

## Install

- **Chrome / Edge / Brave / Opera / Vivaldi / Arc** — [Chrome Web Store](https://chromewebstore.google.com/detail/detour/ajfhkoilhlahkkbmnbcfoolbfhpfdpjp)
- **Firefox** — [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/detour-proxy/)

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

- **Profiles** — save several named proxy configurations and switch the active
  one from Settings. The active profile is the fallback the popup toggle
  applies when no routing rule matches.
- **Rules** — an ordered list on the settings page. First match wins: send a
  host through a chosen profile or Direct (`github.com`, `*.example.com`,
  `<local>`, `<private>`, `10.0.0.0/8`). Unmatched hosts use the active
  profile. Chromium compiles the list into a PAC script; Firefox evaluates it
  per request. The popup stays a toggle + profile picker.
- **Popup vs. settings** — the toolbar popup is a quick switch: connection
  status, the on/off toggle, a one-line summary of the configured proxy, and a
  connection test. The full configuration — server, credentials, bypass list,
  routing rules, health checks, and import/export — lives on a dedicated
  settings page opened from the popup's Settings button.
- **Health and failover** — optionally test the active profile on a configurable
  interval while Detour is on. After the chosen number of consecutive failures,
  Detour tests one configured fallback profile and switches to it if healthy;
  otherwise it turns off and uses Direct. An explicit user Off always wins.
- **Background service worker** applies the proxy when enabled, and releases it
  (falling back to system settings) when disabled. With no rules, Chromium uses
  `chrome.proxy.settings` in `fixed_servers` mode. With rules, it installs a
  generated PAC (`FindProxyForURL`). Firefox always uses `proxy.onRequest`.
  Optional health checks are scheduled with the browser alarms API only while
  the proxy is active.
- **Proxy authentication** for HTTP/HTTPS is supplied through
  `webRequest.onAuthRequired` (using the MV3 `webRequestAuthProvider`
  permission).
- **Bypass list** lets you list hosts that connect directly, skipping the
  proxy. `<local>` covers localhost and dotless hostnames, `<private>` covers
  loopback plus RFC 1918 / link-local / unique-local ranges (IPv4 and IPv6),
  `10.0.0.0/8` matches a CIDR range, `*.example.com` matches subdomains, and a
  bare host matches itself. Chromium consumes the list natively (with `<private>`
  expanded to its ranges); Firefox applies it per-request in the
  `proxy.onRequest` listener.
- **Import / Export** — the settings page saves all proxy profiles, routing
  rules, and health settings (including passwords) to a JSON file and loads
  them back, for backup or moving between machines. Import also accepts a
  SwitchyOmega backup/options JSON file: named HTTP/HTTPS/SOCKS profiles and
  host / wildcard / `<local>` / `<private>` / CIDR auto-switch rules are
  mapped; unsupported rows (regex, PAC, per-protocol proxies, extra switch
  profiles) are listed after import instead of dropped quietly.
- **Keyboard shortcuts** — bind Toggle Detour and Next profile in the browser's
  shortcut page (linked from Settings). They write the same `enabled` /
  `activeProfileId` state as the popup and work while the popup is closed.
  Cycling profiles does not turn Detour on if you turned it off.
- **State** lives in `chrome.storage.local` as the single source of truth shared
  between the popup, the settings page, and the background worker. The popup and
  settings page subscribe to storage changes, so an edit in one is reflected in
  the other.
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
bun test             # unit tests (routing, PAC, health/failover, commands, SwitchyOmega import)
```

Load an unpacked Chromium build from `.output/chrome-mv3` via
`chrome://extensions` (Developer mode → Load unpacked). For Firefox, load
`.output/firefox-mv3/manifest.json` via `about:debugging` → This Firefox → Load
Temporary Add-on.

## License

[MIT](LICENSE.md) © Mathieu Mafille

Privacy policy: [PRIVACY.md](PRIVACY.md) — Detour collects no data.
