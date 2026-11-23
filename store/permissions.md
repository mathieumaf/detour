# Chrome Web Store — Privacy tab

The text on the Chrome Web Store dashboard's Privacy tab, field by field. It is
what reviewers read, so keep it here and on the dashboard identical: edit this
file first, then paste each field into the dashboard.

A change on the Privacy tab is saved as a draft and goes to review with the next
package. Click **Save draft**, never **Submit for review**: the release
workflow submits the draft together with the new version.

If a purpose changes, update `listing.md`, `PRIVACY.md`, and this file
together. Firefox Add-ons asks for no justifications. Its data disclosure comes
from the manifest's `data_collection_permissions`, which says Detour collects
nothing, and its privacy policy field is covered in `listing.md`.

## Single purpose description

Detour is a proxy switcher: it routes the browser's traffic through proxy servers the user configures. The user saves servers (HTTP, HTTPS, SOCKS4, or SOCKS5) as named profiles with bypass lists and, for HTTP and HTTPS, optional credentials. The user picks the active profile from the toolbar, can send chosen hosts through a specific profile or directly, can test a profile's connection, and can turn on health checks that switch to a fallback profile or Direct when the active proxy stops responding.

## Permission justifications

### proxy

Detour's core function is to route the browser's traffic through a user-configured proxy. The "proxy" permission is required to apply the proxy settings when the user turns it on and to clear them when the user turns it off.

### storage

Used to save the user's proxy profiles (scheme, host, port, optional credentials, and bypass list), routing rules, health-check settings and status, the active profile, and the on/off state in chrome.storage.local, so they persist between sessions and stay in sync between the popup, the settings page, and the background service worker. The stored data stays on the user's device and is never sent to the developer or any third party; saved credentials are only given to the proxy that asks for them.

### alarms

Used to schedule periodic health checks of the active proxy. When the user enables health checks, Detour uses chrome.alarms to re-test the proxy on the interval they chose and, after repeated failures, switch to one fallback profile or Direct.

### webRequest

Required to detect proxy authentication challenges (onAuthRequired) so Detour can supply the username and password the user entered for HTTP/HTTPS proxies. It is used only to answer proxy auth prompts; request contents are never read, stored, or transmitted.

### webRequestAuthProvider

Required on Manifest V3 to asynchronously provide the proxy username and password in response to an authentication challenge. Without it, authenticated HTTP/HTTPS proxies could not be used.

### Host permission

A proxy applies to every outgoing request, and proxy authentication challenges can occur for any destination. The host permission is needed so Detour can route all traffic through the proxy and answer auth prompts regardless of the site. Detour does not read, modify, collect, or transmit page content.

## Data usage

- **Data collected:** none. Every category is left unticked.
- **Certifications:** all three are ticked:
  - I do not sell or transfer user data to third parties, apart from the
    approved use cases
  - I do not use or transfer user data for purposes that are unrelated to my
    item's single purpose
  - I do not use or transfer user data to determine creditworthiness or for
    lending purposes
- **Privacy policy URL:** https://github.com/mathieumaf/detour/blob/main/PRIVACY.md
