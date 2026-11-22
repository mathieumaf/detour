# Security policy

Detour decides where a browser's traffic goes and holds proxy passwords. A bug
here can expose someone's real IP address or their credentials, so reports are
taken seriously.

## Reporting a vulnerability

Write to **detour@mafille.me**. Please do not open a public issue.

Include the browser and Detour versions, what you observed, and the steps to
reproduce it. A profile configuration that triggers the problem helps a lot.
Leave real hosts and passwords out.

This is a one-person project. Expect a first answer within a week. If the
report is confirmed, the fix ships as a patch release to both stores, and you
are credited in the release notes unless you prefer otherwise.

## Supported versions

Only the latest version published on the Chrome Web Store and Firefox Add-ons
is supported. Both stores update extensions automatically.

## What Detour promises

These are the properties a change must not break. The
[threat model](docs/security/threat-model.md) explains where each one is
enforced.

1. **No silent direct connections.** While Detour is on, a request goes
   directly only when a rule or a bypass list says so. This holds while the
   background is starting up.
2. **Credentials go to the proxy and nowhere else.** A saved password is given
   only in answer to a proxy authentication challenge, and only to the proxy
   the request is routed through. It is never sent to a website.
3. **Off means off.** When Detour is off it leaves the browser's own proxy
   settings alone, and nothing running in the background turns it back on.
4. **Configuration is data.** A stored state or an imported file cannot run
   code, in the extension or in the generated PAC script.
5. **Nothing leaves the browser.** No analytics and no remote code. The one
   request Detour makes itself is the connection test to `api.ipify.org`,
   which is also what health checks use.
6. **Permissions do not grow by accident.** The packaging check fails when the
   manifest's permissions differ from the reviewed list.

## What counts

Reportable, with the highest severity first:

- A way to make Detour send traffic directly, or through a proxy the user did
  not choose, without the user asking for it.
- A way for a website, a proxy, or another extension to obtain a saved
  password.
- A crafted import file or stored value that runs code, or that changes
  routing beyond what its visible contents say.
- A way to publish a build the maintainer did not approve (CI, release
  workflow, dependencies).

Known and accepted:

- Passwords are stored unencrypted in the browser's local extension storage.
  Anyone who can read the browser profile on disk can read them. Extensions
  have no better place to keep a secret that must be usable without a prompt.
- An exported backup contains the passwords in plain text. The settings page
  says so next to the button.
- The connection test tells `api.ipify.org` the exit address of the proxy being
  tested.
- Chromium cannot authenticate a SOCKS proxy. The settings page disables the
  credential fields there.
- While a connection test or a health-check probe is in flight (8 seconds at
  most), all traffic follows the profile being tested and routing rules are
  paused. The threat model lists this under known gaps.

A proxy you configure sees the traffic you send through it. That is what a
proxy is, and choosing a trustworthy one is outside Detour's control.
