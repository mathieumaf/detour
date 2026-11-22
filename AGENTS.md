# Detour

A Manifest V3 browser extension (WXT, Vue, TypeScript) that switches proxies in
Chromium and Firefox. One codebase, two builds.

- `docs/architecture.md`: read before changing `src/`. It says where a change
  belongs and what the cold-start code must keep true.
- `docs/testing.md`: read before adding or debugging a test.
- `docs/releasing.md`: read before touching `.github/workflows/` or `scripts/`.

## Proof

Run with Bun 1.4.5 and Node 26. Each command exits 0 when the change is good.

| Command                    | Proves                                     | Expected                                            |
| -------------------------- | ------------------------------------------ | --------------------------------------------------- |
| `bun run check`            | lint, formatting, types, unit tests        | ends with `0 fail`; no file under the coverage gate |
| `bun run test:e2e:chrome`  | real routing and UI in Chrome              | `0 fail`, 2 skipped (Firefox-only tests)            |
| `bun run test:e2e:firefox` | the same in Firefox                        | `0 fail`, 1 skipped (Chrome-only test)              |
| `bun run package`          | both store packages are correct            | three `✔` lines, one per zip                        |
| `bun run package:verify`   | the sources zip rebuilds the Firefox build | `✔ ... rebuilds ... exactly.`                       |

`bun run browsers` downloads the pinned Chrome and Firefox once. The
end-to-end suite and the screenshots need them.

To look at a UI change, run `bun run screenshots` (Chrome) or
`bun run build:firefox && DETOUR_BROWSER=firefox bun e2e/screenshots.ts`. It
writes `popup-*.png` and `settings-*.png` to `.output/screenshots/`.

Everything above is safe by construction: the browsers are the pinned test
builds with a throwaway profile, the proxies are fake servers on `127.0.0.1`,
and the credentials are made up (`e2e/servers.ts`, `e2e/screenshots.ts`). Use
those for any new proof.

Off limits, because they act on the real world:

- `bun run submit:firefox` and `bun run submit:chrome` upload to the stores.
  Prove packaging with `bun run package` instead.
- Running the Release workflow without `dry_run`, and changing repository
  secrets.
- Loading a build into the user's own browser profile, or testing against
  their real proxies and passwords. Use the end-to-end suite.

## Code Review Rules

Flag a change when:

- **It leaks traffic.** A request can leave directly while Detour is on: a
  listener registered after an `await` in `startup.ts`, `stateReady` resolved
  before the route is installed, or the Firefox listener answering before the
  state has loaded. A request Detour does not handle must get `undefined` in
  Firefox, never `{ type: 'direct' }`.
- **It hands out credentials.** `auth.ts` answers a challenge that is not
  `isProxy`, or with a profile other than the one the request is routed
  through. A password reaches a log, an error message, or a URL.
- **It loses saved configuration.** A `ProxyState` change that an older stored
  shape cannot load through `normalizeState`, an import that replaces profiles
  with defaults, or a migration that rewrites storage instead of upgrading on
  read.
- **It overrides the user.** Background work (a health check, a connection
  test, a command) switches the proxy back on after an explicit Off, or writes
  a state it did not re-read after an `await`.
- **It lets the matchers drift.** `core/patterns.ts` changes without the PAC
  runtime in `core/pac.ts`, or user text reaches the PAC script without
  `JSON.stringify` or `safePacHost`.

Skip generated or third-party content: `CHANGELOG.md`, the PNGs under `store/`,
and `src/core/fixtures/*.json`. Review `bun.lock`: it picks the dependency
versions that ship.

Cite file:line for every finding, and post at most 3 nits.

## Risk

When paths overlap, the higher tier wins.

**High**

- `src/entrypoints/background/**`: credentials and where traffic goes.
- `src/core/state.ts`, `src/core/import-export.ts`, `src/core/switchyomega.ts`,
  `src/utils/storage.ts`: reading, migrating, and replacing stored data.
- `src/core/pac.ts`: generates code the browser runs.
- `wxt.config.ts`: the manifest and its permissions.
- `.github/**`, `scripts/**`, `release-please-config.json`,
  `.release-please-manifest.json`: CI, packaging, and publishing.
- `package.json`, `bun.lock`: dependencies.
- `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `docs/security/**`, `PRIVACY.md`,
  `store/permissions.md`: they steer review, or are promises made to users and
  stores.

**Low**

- `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `docs/**` outside
  `docs/security/`, `store/listing.md`, and store artwork.
- Tests and their helpers: `**/*.test.ts`, `e2e/**`, `src/core/fixtures/**`,
  `src/entrypoints/background/fake-browser.ts`.

**Medium**

- Everything else, including the rest of `src/`.
