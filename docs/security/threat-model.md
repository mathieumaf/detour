# Threat model

What Detour protects, from whom, and where in the code each protection lives.
[SECURITY.md](../../SECURITY.md) states the promises; this page is the
reasoning behind them. Update it when a change adds a permission, a network
request, a new source of input, or a new way to publish.

## The system

Detour is a browser extension and nothing else. There is no server, no account,
and no telemetry. It is built from this repository by GitHub Actions and
distributed through the Chrome Web Store and Firefox Add-ons.

At run time it has three parts:

- the **popup** and the **settings page**, which edit one stored value;
- the **background** (a service worker in Chromium, an event page in Firefox),
  which applies that value to the browser's proxy configuration and answers
  proxy authentication challenges;
- `chrome.storage.local`, which holds the value.

Its manifest asks for `proxy`, `storage`, `alarms`, `webRequest`, the
browser's proxy-authentication permission (`webRequestAuthProvider` in
Chromium, `webRequestBlocking` in Firefox), and host access to `<all_urls>`.
Host access is needed because the proxy applies to every site and an
authentication challenge can come with any request.

## What is worth protecting

| Asset                   | Why it matters                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Routing                 | Users turn Detour on to hide their address or to reach a network. A request that goes the wrong way defeats that silently. |
| Proxy credentials       | Usernames and passwords for the user's proxies, stored in `chrome.storage.local` and in exported backups.                  |
| The saved configuration | Profiles and rules the user built. Losing them, or having them altered, changes routing.                                   |
| The published extension | Whoever can publish a build controls every user's proxy settings.                                                          |
| Store credentials       | The Add-ons API key and the Chrome Web Store service account key, held as GitHub Actions secrets.                          |

## Who is on the other side

| Actor                             | Trust                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| The user                          | Trusted. They choose the proxies and the rules.                                                        |
| Websites the user visits          | Untrusted. They control URLs, hostnames, and their own responses.                                      |
| A configured proxy                | Trusted with the traffic sent to it, and with its own credentials. Nothing more.                       |
| The author of an imported file    | Untrusted. A backup or SwitchyOmega file can come from anywhere.                                       |
| Other extensions                  | Untrusted. They cannot read Detour's storage or send it messages, but can take over the proxy setting. |
| Someone with access to the device | Out of scope. They can read the browser profile, including stored passwords.                           |
| A pull request author             | Untrusted until merged. Their code runs in CI.                                                         |
| Dependencies                      | Trusted as pinned in `bun.lock`. A malicious update is a supply-chain risk.                            |
| `api.ipify.org`                   | Untrusted. Its response is displayed, never executed.                                                  |

## Where untrusted input enters

**Imported files.** `parseImportedFile` (`src/core/import-export.ts`) and
`importSwitchyOmega` (`src/core/switchyomega.ts`) take arbitrary JSON. Every
value passes through `sanitizeProfile`, `sanitizeRules`, and
`sanitizeHealthCheck` before it is stored. Unknown fields are dropped, types
are checked, and references to missing profiles are removed.

**Stored state.** Read back through `normalizeState` (`src/core/state.ts`) on
every load, with the same sanitizers. A corrupt or outdated value becomes a
valid state or the default one.

**Text that becomes code.** With routing rules on Chromium, Detour generates a
PAC script (`src/core/pac.ts`). Rule patterns and bypass entries are embedded
with `JSON.stringify`, and a proxy host is reduced to host characters by
`safePacHost`. `pac.test.ts` has a case for a pattern that tries to break out
of the script.

**Request details.** `auth.ts` and the Firefox backend receive the URL of each
request. They use it only to match patterns (`src/core/patterns.ts`), which
parse it with `URL` and compare the host. Matching never resolves DNS and
never evaluates a pattern as code or as a regular expression.

**Messages.** The background accepts two messages (`src/utils/messaging.ts`).
The manifest declares no `externally_connectable` and no content scripts, so
only Detour's own pages can send them. The handler still checks the type and
coerces `enabled` to a boolean.

**The connection test response.** One field, `ip`, shown as text by Vue, which
escapes it.

## Trust boundaries and how they are held

### A request must not slip past the proxy

When the browser restarts the background, storage takes a moment to load. A
request or an authentication challenge that arrives in that moment has to wait
for the state, not be answered without it.

- `startBackground` (`src/entrypoints/background/startup.ts`) registers the
  auth listener and starts the engine before its first `await`.
- The Firefox backend (`engine/firefox.ts`) holds each request on `stateReady`
  and installs its route before that promise resolves.
- If storage fails, held events get the browser's default answer.

Checked by `cold-start.test.ts`, and in real browsers by the cold-start tests
in `e2e/routing.e2e.ts`.

On Chromium the proxy setting lives in the browser and stays applied while the
service worker is stopped, so there is no window to cover.

### A password goes only to its proxy

`resolveAuth` (`src/entrypoints/background/auth.ts`) answers a challenge only
when `details.isProxy` is true, so a website's own login prompt never receives
proxy credentials. It picks the profile the current configuration routes the
request through, and cancels a second challenge for the same request so wrong credentials are not
replayed. In Firefox, SOCKS credentials travel inside the `ProxyInfo` returned
for that request.

Passwords are not logged. They are written to storage, to an export the user
asks for, and to the browser's authentication API.

### The user's Off is final

A health check and a connection test both change the proxy temporarily and
both finish asynchronously. Each re-reads the state after every `await`, and
`ctx.userToggleVersion` cancels a health-check result that a user toggle
overtook (`src/entrypoints/background/health.ts`). Covered in
`background.test.ts` and `health.test.ts`.

When Detour is off, Chromium's setting is cleared and the Firefox listener is
removed. The Firefox listener answers `undefined` when it has no route, which
leaves the user's own Firefox proxy settings in effect.

### Only reviewed code is published

- Pull request workflows run with a read-only token and no secrets
  (`.github/workflows/ci.yml`).
- Store secrets are read only by the two submit jobs in
  `.github/workflows/release.yml`, which run on `main` after a release pull
  request is merged, or when the maintainer starts the workflow by hand.
- Actions are pinned to commit SHAs, and dependencies install from `bun.lock`
  with `--frozen-lockfile`.
- `scripts/package.ts` refuses a package whose permissions differ from the
  reviewed list, whose version does not match, or that contains a stray file.
- `scripts/verify-sources.ts` rebuilds the Firefox package from the sources zip
  and compares it byte for byte, so the published build can be reproduced.

## Known gaps

- **Probes steer all traffic briefly.** A connection test, and each health-check
  probe, routes every request through the profile being tested until the
  request finishes (8 seconds at most). Routing rules are not applied during
  that time, and the tested profile's bypass list is. A user starts a
  connection test knowingly; a health check runs on its own every interval.
  Tracked in [#85](https://github.com/mathieumaf/detour/issues/85).
- **The challenger is not compared with the profile.** `resolveAuth` chooses
  credentials from the current configuration and does not check that the proxy
  asking is that profile's host and port. A request already in flight when the
  user switches profile can be challenged by the previous proxy and answered
  with the new profile's credentials.
- **Passwords are stored in plain text**, in extension storage and in exported
  backups. See "Known and accepted" in the security policy.
- **Two bypass implementations on Chromium.** Without rules, Chromium applies
  the bypass list itself. With rules, Detour's matcher does, inside the PAC
  script. They agree on the documented pattern forms, and are not guaranteed
  to agree on forms only Chromium understands, such as an entry with a port.
  Tracked in [#86](https://github.com/mathieumaf/detour/issues/86).

## Assumptions this repository cannot verify

- The maintainer's GitHub account and both store developer accounts use
  two-factor authentication.
- `main` is protected and requires the `CI gate` check, so nothing reaches the
  release workflow without passing CI.
- The Chrome Web Store service account can publish this one extension and
  nothing else.
- Each store's own review runs before a submitted version reaches users.
