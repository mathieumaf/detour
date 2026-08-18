# Chrome Web Store — permission justifications

Paste these into the CWS Privacy tab when a new permission is added, or when
CWS asks again on publish.

- **`alarms`** is the justification already accepted on CWS for 1.6.0. Use it
  verbatim.
- The other permissions already live on the dashboard. The text below is
  recovered from `listing.md` and `PRIVACY.md` so the next field is not a
  surprise publish failure. Do not invent new claims; if a purpose changes,
  update `listing.md`, `PRIVACY.md`, and this file together.

## alarms

Used to schedule periodic health checks of the active proxy. When the user enables health checks, Detour uses chrome.alarms to re-test the proxy on the interval they chose and, after repeated failures, switch to one fallback profile or Direct.

## proxy

core feature: apply and release the proxy configuration.

## storage

persist the user's proxy profiles, routing rules, and active selection and health-check settings locally between sessions.

## webRequest

detect proxy authentication challenges (onAuthRequired).

## webRequestAuthProvider (Chromium) / webRequestBlocking (Firefox)

supply the saved username/password in response to a proxy auth challenge.

## Host permission `<all_urls>`

the proxy routes traffic for every site, and auth challenges can originate from any request, so access is not limited to a specific host.

## Data collection

none. (AMO data-collection disclosure: "No data collected".)
