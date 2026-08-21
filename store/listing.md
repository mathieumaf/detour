# Detour — Store listing

Single source of truth for the Chrome Web Store and Firefox Add-ons (AMO)
listings. Keep both stores in sync by editing here first, then copy each field
into the dashboard. Character limits are noted per field — stay within them.

---

## Shared positioning

**One-liner:** A simple, intuitive proxy switcher — save profiles, add
auto-switch rules, check proxy health, import SwitchyOmega backups, and switch
from your toolbar or keyboard.

**Tone:** plain, honest, privacy-first. No hype, no "best ever", no emoji in the
description body.

---

## Chrome Web Store

### Name (max 75)
Detour — Proxy Switcher

### Summary / short description (max 132)
Switch HTTP, HTTPS, or SOCKS proxy profiles from your toolbar, with auto-switch
rules, health checks, failover, auth, and bypass.

The CWS short summary and the package `description` in `package.json` /
`wxt.config.ts` are the same 129-character string. It already names the 1.6.0
pillars and sits 3 characters under the limit — there is not enough room to
add shortcuts or SwitchyOmega import without dropping a pillar. Leave it; the
detailed description and screenshots carry 1.7.0.

### Detailed description (max 16,000)
Detour is a simple, intuitive proxy switcher. Save configurations as named
profiles, switch the active one from the toolbar, and toggle it on or off — no
digging through system settings.

Features:
- Save multiple named proxy profiles and switch the active one directly from
  the toolbar popup.
- Toggle the active proxy on or off in one click.
- Supports HTTP, HTTPS, SOCKS4, and SOCKS5 proxies.
- Username/password authentication for HTTP and HTTPS proxies.
- Auto-switch rules: an ordered list that sends matching hosts through a
  chosen profile or Direct. First match wins; everything else uses the active
  profile. Match an exact host, *.example.com, <local>, <private>, or a CIDR
  such as 10.0.0.0/8.
- Bypass list: choose hosts that connect directly, skipping the selected
  proxy. Use <local> for localhost, <private> for all private networks,
  *.example.com for subdomains, or 10.0.0.0/8 for an IP range.
- Built-in connection test that reports your exit IP and latency before you
  commit.
- Optional health checks while the proxy is active. After repeated failures,
  Detour switches to one chosen fallback profile, or Direct if the fallback is
  unavailable.
- Keyboard shortcuts: bind Toggle Detour and Next profile in the browser's
  shortcut page (linked from Settings). They work while the popup is closed.
  Cycling profiles does not turn Detour on if you turned it off.
- Dedicated settings page to create, rename, duplicate, or delete profiles,
  with export of all profiles, rules, and health settings to a JSON file for
  backup or moving between machines. Import accepts a Detour backup or a
  SwitchyOmega options JSON file: named HTTP, HTTPS, and SOCKS profiles and
  compatible host rules are mapped; unsupported rows (PAC, regex, per-protocol
  proxies) are listed after import instead of dropped quietly.
- An ON badge on the toolbar icon shows at a glance when the proxy is active.

Privacy:
Detour collects no data. There is no analytics, no tracking, and no remote code.
Your proxy details and credentials stay in your browser's local storage and are
never sent to us or anyone else. Detour is open source.

Note: Chromium-based browsers cannot authenticate SOCKS proxies — username and
password are ignored for SOCKS4/SOCKS5. This is a long-standing browser
limitation, not a Detour bug; HTTP/HTTPS proxy authentication works normally.

### Category
Tools / Productivity

---

## Firefox Add-ons (AMO)

### Name (max 50)
Detour — Proxy Switcher

### Summary (max 250)
A simple, intuitive proxy switcher. Save and switch HTTP, HTTPS, or SOCKS
profiles from your toolbar or keyboard — with authentication (including SOCKS),
auto-switch rules, health checks, failover, bypass, and SwitchyOmega import. No
data collection.

### Description
Detour is a simple, intuitive proxy switcher. Save configurations as named
profiles, switch the active one from the toolbar, and toggle it on or off — no
digging through system settings.

Features:
- Save multiple named proxy profiles and switch the active one directly from
  the toolbar popup.
- Toggle the active proxy on or off in one click.
- Supports HTTP, HTTPS, SOCKS4, and SOCKS5 proxies.
- Username/password authentication for every scheme — including SOCKS, which
  Firefox supports natively.
- Auto-switch rules: an ordered list that sends matching hosts through a
  chosen profile or Direct. First match wins; everything else uses the active
  profile. Match an exact host, *.example.com, <local>, <private>, or a CIDR
  such as 10.0.0.0/8.
- Bypass list: choose hosts that connect directly, skipping the selected
  proxy. Use <local> for localhost, <private> for all private networks,
  *.example.com for subdomains, or 10.0.0.0/8 for an IP range.
- Built-in connection test that reports your exit IP and latency before you
  commit.
- Optional health checks while the proxy is active. After repeated failures,
  Detour switches to one chosen fallback profile, or Direct if the fallback is
  unavailable.
- Keyboard shortcuts: bind Toggle Detour and Next profile in the browser's
  shortcut page (linked from Settings). They work while the popup is closed.
  Cycling profiles does not turn Detour on if you turned it off.
- Dedicated settings page to create, rename, duplicate, or delete profiles,
  with export of all profiles, rules, and health settings to a JSON file for
  backup or moving between machines. Import accepts a Detour backup or a
  SwitchyOmega options JSON file: named HTTP, HTTPS, and SOCKS profiles and
  compatible host rules are mapped; unsupported rows (PAC, regex, per-protocol
  proxies) are listed after import instead of dropped quietly.
- An ON badge on the toolbar icon shows at a glance when the proxy is active.

Privacy:
Detour collects no data. There is no analytics, no tracking, and no remote code.
Your proxy details and credentials stay in your browser's local storage and are
never sent to us or anyone else. Detour is open source.

### Screenshot captions (English (US))

1. Switch profiles from the toolbar, test the connection, and see when Detour
   automatically falls back to another profile or Direct.
2. Configure automatic health checks and a fallback, plus host rules that send
   traffic through a chosen profile or Direct.
3. HTTP, HTTPS, and SOCKS support, authentication, named profiles, auto-switch
   rules, health checks and failover, keyboard shortcuts, SwitchyOmega import,
   bypass lists, and no data collection.

### Categories
Privacy & Security / Other

---

## Permission justifications (for store review)

Reviewers ask why each permission is needed. Reuse these verbatim. CWS
Privacy-tab paste text (including the accepted `alarms` justification) is in
[permissions.md](permissions.md).

- **proxy** — core feature: apply and release the proxy configuration.
- **storage** — persist the user's proxy profiles, routing rules, and active
  selection and health-check settings locally between sessions.
- **alarms** — Used to schedule periodic health checks of the active proxy.
  When the user enables health checks, Detour uses chrome.alarms to re-test
  the proxy on the interval they chose and, after repeated failures, switch
  to one fallback profile or Direct.
- **webRequest** — detect proxy authentication challenges (onAuthRequired).
- **webRequestAuthProvider** (Chromium) / **webRequestBlocking** (Firefox) —
  supply the saved username/password in response to a proxy auth challenge.
- **host permissions `<all_urls>`** — the proxy routes traffic for every site,
  and auth challenges can originate from any request, so access is not limited
  to a specific host.

Data collection: none. (AMO data-collection disclosure: "No data collected".)

---

## Browser support note (reference)

| Browser | Proxy | HTTP/HTTPS auth | SOCKS auth |
| --- | --- | --- | --- |
| Chrome / Edge / Brave / Opera / Vivaldi / Arc | yes | yes | no (browser limitation) |
| Firefox | yes | yes | yes |
| Safari | — | — | — (no proxy API) |

Keep this listing in step with README.md and any new features shipped.
