# Testing

Three layers, each answering a different question.

| Layer      | Question                                               | Command            | Time |
| ---------- | ------------------------------------------------------ | ------------------ | ---- |
| Unit       | Is each decision right?                                | `bun run test`     | <1 s |
| End-to-end | Does a real browser route real traffic the way we say? | `bun run test:e2e` | 20 s |
| Packaging  | Is what we would upload to the stores correct?         | `bun run package`  | 5 s  |

CI runs all three on every pull request, and the end-to-end layer on both
Chrome and Firefox.

## Unit tests

`bun run test` runs every `*.test.ts` with coverage. Tests sit next to the code
they cover.

- `src/core/*.test.ts` covers the model: patterns, routing, PAC generation,
  state migration, health-check logic, commands, import and export.
- `src/entrypoints/background/background.test.ts` runs the whole background on
  a fake browser: startup, storage changes, messages, keyboard commands,
  connection tests, health checks and failover.
- `src/entrypoints/background/cold-start.test.ts` covers events that arrive
  before the stored state has loaded.
- `scripts/zip.test.ts` covers the zip helpers used for packaging.

`fake-browser.ts` is the fake those background tests share. It keeps real
storage semantics (values are copied, changes notify listeners) and records
what the background asked the browser to do. Reach for it instead of writing a
new stub.

### Coverage gate

`bunfig.toml` fails the run when any source file drops below 90% of lines or
80% of functions. If you add code to `src/core` or the background, add the test
in the same change.

## End-to-end tests

The suite in `e2e/` loads the built extension into a real browser and watches
where traffic goes. It uses [Puppeteer](https://pptr.dev), which drives Chrome
and Firefox through one API and pins the build of each.

```sh
bun run browsers           # once: download the pinned Chrome and Firefox
bun run test:e2e           # both browsers
bun run test:e2e:chrome    # one of them
bun run test:e2e:firefox
```

Each command builds the extension first. To run one test, build once and call
the runner directly:

```sh
bun run build:firefox
DETOUR_BROWSER=firefox bun test ./e2e/routing.e2e.ts --timeout 30000 -t "bypass"
```

### How it knows where traffic went

`e2e/servers.ts` starts five servers on `127.0.0.1`: a target, an HTTP proxy, an
HTTP proxy that demands a password, a SOCKS5 proxy, and a SOCKS5 proxy that
demands a password. None of the proxies forward. Each answers with its own name
(`via=http-proxy`), and the target answers `via=direct`. So the body of a page
proves which path the browser took, and each server's request log proves no
other server was asked. `expectTraffic` in `e2e/traffic.ts` checks both.

The browsers are launched so that the test hostnames in `e2e/hosts.ts` resolve
to `127.0.0.1`. The suite never touches the network.

### One suite, two browsers

`e2e/detour.ts` hides what differs between the browsers behind a small handle:

- `setState(state)` writes the stored state, as the settings page would, and
  returns once the background has applied it.
- `visit(url)` loads a page and returns the status and body.
- `openPage('options.html')` opens one of the extension's pages.

The tests are written against that handle and run unchanged on both. A test
that only makes sense in one browser says so with `test.skipIf`.

`setState` needs to know when the background is done. It watches the toolbar
badge, which the background sets right after it routes or releases the proxy.

### Files

- `routing.e2e.ts`: profiles, rules, bypass lists, proxy authentication, SOCKS,
  and cold start (a browser restart in Chrome, a suspended background in
  Firefox).
- `settings.e2e.ts`: the popup and the settings page, driven through their
  controls: saving a server, switching profiles, editing rules, health
  settings, import and export.
- `ui.ts`: helpers that find a control by its label and type into it.

### Firefox specifics

Three things in `detour.ts` exist because of how Firefox treats automation:

- The extension is installed as a temporary add-on, the way `about:debugging`
  does it. Firefox forgets a temporary add-on on restart, so the Firefox
  cold-start test suspends the background instead of restarting the browser.
- Firefox only lets automation open `moz-extension://` pages when
  `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` is set.
- Firefox never reports a navigation to an extension page as finished, so
  `openExtensionPage` starts the navigation and then watches the document.

It also refuses the native file chooser on extension pages. `chooseFile` in
`ui.ts` builds the file in the page instead, on both browsers.

### What the end-to-end suite does not cover

- **Connection tests and health checks.** They call `api.ipify.org` over HTTPS
  through the proxy. Faking that needs a TLS-terminating proxy and a trusted
  test certificate. `background.test.ts` covers them on the fake browser.
- **Keyboard shortcuts.** Automation cannot press a browser-level extension
  shortcut. The command handlers are unit-tested.
- **The stores.** Nothing here uploads anything. See
  [releasing](releasing.md#checking-credentials-without-publishing) for the dry
  run.

## Packaging checks

`bun run package` builds and zips both browsers, then `scripts/package.ts`
checks every package: valid zip timestamps, the version in the manifest, the
permission list, that every file the manifest names is present, and that no
stray file is included.

`bun run package:verify` unpacks the sources zip into an empty directory,
installs, builds, and compares the result with the Firefox package byte for
byte. That is what a Firefox Add-ons reviewer does, so a failure here is a
rejected submission caught early.

## Writing a test

Start from the question the layers answer. A wrong decision is a unit test in
`src/core`. A wrong reaction to a browser event is a case in
`background.test.ts`. If the browser itself has to cooperate (routing,
authentication, a page saving a setting), add an end-to-end test and make it
run on both browsers unless the behavior exists in only one.

In an end-to-end test, write the starting state with `detour.setState`, then
assert with `expectTraffic`. Give each test its own hostname from `hosts.ts`
when it would otherwise share one with a neighbor.
