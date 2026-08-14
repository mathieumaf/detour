# Detour — Store listing

Single source of truth for the Chrome Web Store and Firefox Add-ons (AMO)
listings. Keep both stores in sync by editing here first, then copy each field
into the dashboard. Character limits are noted per field — stay within them.

---

## Shared positioning

**One-liner:** A simple, intuitive proxy switcher — save profiles, add
auto-switch rules, and switch from your toolbar.

**Tone:** plain, honest, privacy-first. No hype, no "best ever", no emoji in the
description body.

---

## Chrome Web Store

### Name (max 75)
Detour — Proxy Switcher

### Summary / short description (max 132)
Switch HTTP, HTTPS, or SOCKS proxy profiles from your toolbar. Auto-switch
rules, auth, a bypass list, and a connection test.

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
- Dedicated settings page to create, rename, duplicate, or delete profiles,
  with import/export of all profiles and rules to a JSON file for backup or
  moving between machines.
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
profiles from your toolbar — with authentication (including SOCKS), auto-switch
rules, a bypass list, a connection test, and import/export. No data collection.

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
- Dedicated settings page to create, rename, duplicate, or delete profiles,
  with import/export of all profiles and rules to a JSON file for backup or
  moving between machines.
- An ON badge on the toolbar icon shows at a glance when the proxy is active.

Privacy:
Detour collects no data. There is no analytics, no tracking, and no remote code.
Your proxy details and credentials stay in your browser's local storage and are
never sent to us or anyone else. Detour is open source.

### Screenshot captions (English (US))

1. Switch between saved proxy profiles directly from the toolbar, toggle the
   active proxy, and test the connection.
2. Create profiles and auto-switch rules: send a host through one proxy,
   private networks Direct, everything else through another.
3. HTTP, HTTPS, and SOCKS support, authentication, named profiles, auto-switch
   rules, bypass lists, connection testing, and no data collection.

### Categories
Privacy & Security / Other

---

## Permission justifications (for store review)

Reviewers ask why each permission is needed. Reuse these verbatim.

- **proxy** — core feature: apply and release the proxy configuration.
- **storage** — persist the user's proxy profiles, routing rules, and active
  selection locally between sessions.
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
