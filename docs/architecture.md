# Architecture

Detour is a Manifest V3 extension built with [WXT](https://wxt.dev) and Vue. One
codebase produces a Chromium build and a Firefox build. This page explains how
the parts fit together and where a change belongs.

## The shape of it

```
 popup ─┐                                   ┌─ Chromium: chrome.proxy.settings
        ├─ chrome.storage.local ─ background ┤
 options┘      (ProxyState)        engine    └─ Firefox:  proxy.onRequest
```

There is one piece of state, `ProxyState`, stored under one key in
`chrome.storage.local`. The pages write it. The background reads it and makes
the browser match. Nothing else is shared: no in-memory state crosses between a
page and the background.

The code follows the same split.

| Folder                        | What lives there                                               | Touches browser APIs |
| ----------------------------- | -------------------------------------------------------------- | -------------------- |
| `src/core/`                   | The model and every decision: patterns, routing, PAC, health   | no                   |
| `src/utils/`                  | `loadState` / `saveState`, and the messages pages send         | yes, thinly          |
| `src/entrypoints/background/` | Applies state to the browser, answers auth, runs health checks | yes                  |
| `src/entrypoints/popup/`      | The toolbar popup                                              | through `utils`      |
| `src/entrypoints/options/`    | The settings page                                              | through `utils`      |
| `src/components/`             | Vue components the two pages are built from                    | no                   |
| `src/composables/`            | `useProxyState`, the reactive copy of the state the pages edit | through `utils`      |

`src/core` is where to look first. It is plain TypeScript with no `chrome.*`
calls, so everything in it runs under `bun test`. If a change is a decision
("should this URL be proxied?", "what happens after two failed checks?"), it
belongs there, with a test next to it.

## Vocabulary

- **Profile**: one proxy server, with its credentials and bypass list.
- **Active profile**: the profile traffic uses when no rule matches.
- **Rule**: a pattern and an action. The action is a profile id or Direct.
- **Direct**: no proxy for this request.
- **Pattern**: a host matcher, shared by rules and bypass lists (`patterns.ts`).
- **Engine**: the background module that routes traffic. It has two
  **backends**, one per browser.
- **Cold start**: the background starting with nothing in memory, because the
  browser stopped it while it was idle.

## State

`src/core/types.ts` defines `ProxyState`:

```ts
interface ProxyState {
  enabled: boolean;
  activeProfileId: string;
  profiles: ProxyProfile[];
  rules: RoutingRule[];
  healthCheck: HealthCheckSettings; // what the user configured
  healthStatus: HealthCheckStatus; // failure counter for this session
  lastFailover: FailoverEvent | null; // shown in the popup for a while
}
```

Every read goes through `normalizeState` (`src/core/state.ts`). It accepts
whatever is in storage and returns a complete, consistent state: it upgrades
older shapes, backfills defaults, and drops anything that points at a profile
that no longer exists. Code that loads the state never checks for a missing
field.

A storage change event is the one place a state is used as it was written:
the background and the pages take the reported value as is, and the background
reloads it through `normalizeState` straight after. Every writer is this
extension, so the value is already in the current shape.

That function is also the migration path. When you add a field to `ProxyState`:

1. Add it to the type and to `DEFAULT_STATE`.
2. Sanitize it in `normalizeState`, so a state saved by an older version loads.
3. Add a case to `state.test.ts` for the old shape.
4. Decide whether it belongs in an export. `buildExport` writes the whole state
   minus the session-only parts.

Stored data is never rewritten in place by a migration. An old state is
upgraded on every read until the next save writes the new shape.

## From a click to the network

1. The user edits something on the settings page. `useProxyState` builds the
   next state and calls `saveState`.
2. `chrome.storage.onChanged` fires in the background (`startup.ts`). It reloads
   the state and calls `applyState`.
3. `applyState` (`engine/index.ts`) asks the backend to route by the state when
   Detour is on and the active profile is usable, and to release the proxy
   otherwise. Then it sets the toolbar badge.

The on/off toggle is the one exception to "pages write storage". The popup
sends a `set-proxy-enabled` message and the background does the write. That
puts user toggles and health-check writes in one place, in order, so a health
check that finishes late cannot undo an Off the user just asked for
(`ctx.userToggleVersion` is the guard).

## The engine

`engine/backend.ts` is the contract. Chromium and Firefox proxy traffic through
unrelated APIs, and each backend implements the same five methods.

**Chromium** (`engine/chromium.ts`) has one process-wide setting. With no rules,
Detour sets `fixed_servers` with the active profile and hands the bypass list
to the browser. With rules, it compiles the rule list and the active profile
into a PAC script (`core/pac.ts`), because a single fixed server cannot express
a decision per URL. The setting survives the service worker being stopped.

**Firefox** (`engine/firefox.ts`) asks the extension about every request
through `proxy.onRequest`. The listener calls `resolveProxyDecision` from
`core/rules.ts`. This is the only API that can authenticate a SOCKS proxy,
which is why SOCKS credentials work in Firefox and not in Chromium.

### Two matchers that must agree

A PAC script runs in a sandbox and cannot import code. So `core/pac.ts` carries
a hand-written ES5 copy of the matcher in `core/patterns.ts`. `pac.test.ts`
runs every pattern against every host through both and fails if they differ.
Change the two together, and add the new pattern to that table.

## Cold start

The browser stops the background when it is idle and starts it again for the
next event, with empty memory. Storage takes a moment to load. Two things can
go wrong in that moment, and both are the kind of bug users cannot see:

- In Firefox, a request arrives before the state is loaded. If the listener is
  not there yet, or answers without knowing the state, the request goes out
  **directly** while a proxy is supposed to be on.
- In either browser, the proxy asks for a password before the state is loaded.
  An answer without credentials shows the user a login prompt.

`startBackground` (`startup.ts`) is built around this:

1. In the first synchronous turn, before any `await`, it registers the auth
   listener and starts the engine. The Firefox backend attaches its request
   listener here.
2. Both listeners hold their events on a `stateReady` promise.
3. `init` loads the state and calls `applyState`. The Firefox backend installs
   its route synchronously inside that call. Only then is `stateReady`
   resolved, so a held request can never see an empty route.
4. If loading fails, the engine drops its startup listener and held events get
   the browser's default answer, never a guess.

Keep these properties when you touch `startup.ts`, `auth.ts`, or
`engine/firefox.ts`. `cold-start.test.ts` pins them down on a fake browser, and
the end-to-end suite checks them in real ones (a browser restart in Chrome, a
suspended event page in Firefox).

## Authentication

`auth.ts` answers `webRequest.onAuthRequired` for HTTP and HTTPS proxies. It
picks the profile the request is actually routed through (a matching rule, or
the active profile), and replies only to proxy challenges, never to a website's
own login. A request id it has already answered is cancelled on the second
challenge, which stops wrong credentials from looping.

## Connection test and health checks

`connection-test.ts` routes everything through one profile, fetches
`api.ipify.org`, and restores whatever the state says should be applied. Tests
are queued, because each one takes over the browser's proxy while it runs.

Health checks reuse it. `core/health.ts` holds the logic as a pure function
(`runHealthCheck`) that takes the probe as a parameter, and
`background/health.ts` wires it to the alarms API. After each probe it re-reads
the state, so a change the user made meanwhile is never overwritten.

## Adding things

**A new pattern form.** Implement it in `core/patterns.ts` and in the PAC
runtime in `core/pac.ts`, then add it to the tables in `patterns.test.ts` and
`pac.test.ts`. Document it in `docs/usage.md`.

**A new setting.** Follow the four steps under [State](#state), then add the
control to a component and a method to `useProxyState`.

**A new message from a page to the background.** Add its type to
`src/utils/messaging.ts` and handle it in `registerMessages` in `startup.ts`.
Test it in `background.test.ts` with `fake.sendMessage`.

**A new browser backend.** Implement `ProxyBackend` in a new file under
`engine/` and choose it in `startEngine`.

**A new permission.** Permissions trigger a store review and a prompt for every
user, so `scripts/package.ts` fails the build until its expected list is
updated. Change `wxt.config.ts`, that list, and `store/permissions.md` together.
