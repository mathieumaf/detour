# User guide

Detour has two surfaces. The **popup** behind the toolbar icon is for the things
you do often: turn the proxy on or off, pick a profile, test the connection. The
**settings page**, opened from the popup, is where you configure everything.
Settings save when you leave a field and take effect immediately.

## Profiles

A profile is one proxy server: a type (HTTP, HTTPS, SOCKS4, SOCKS5), a host, a
port, optional credentials, and a bypass list. Create as many as you need in
**Settings → Profiles**, and name them so you can tell them apart in the popup.

One profile is the **active profile**. When Detour is on, traffic goes through
it unless a rule says otherwise. A profile needs a host and a port before it
can be switched on; the toggle stays disabled until it has both.

## Patterns

Rules and bypass lists use the same pattern syntax to name hosts.

| Pattern         | Matches                                                          |
| --------------- | ---------------------------------------------------------------- |
| `example.com`   | exactly that host                                                |
| `*.example.com` | every subdomain of `example.com`, but not `example.com` itself   |
| `.example.com`  | `example.com` and every subdomain                                |
| `10.0.0.0/8`    | any IP address in the range, IPv4 or IPv6                        |
| `<local>`       | `localhost`, the loopback addresses, and hostnames without a dot |
| `<private>`     | loopback, private, and link-local address ranges                 |

Patterns look at the host in the address bar and never resolve DNS. So
`10.0.0.0/8` matches `http://10.1.2.3/`, and does not match a hostname that
happens to resolve to `10.1.2.3`. Patterns are case-insensitive.

## Rules

**Settings → Rules** is an ordered list. Each rule pairs a pattern with an
action: one of your profiles, or **Direct** (no proxy). For every request,
Detour walks the list from the top and uses the first rule that matches. A
request that matches no rule uses the active profile.

Use rules to keep one site on a different proxy, or to keep it off the proxy
entirely:

```
github.com        →  Work proxy
*.internal.corp   →  Direct
```

Order matters, so use **Up** and **Down** to arrange the list. A rule that
points at a profile with no host is skipped. Rules only apply while Detour is
on.

## Bypass list

Each profile has its own bypass list: one pattern per line, for hosts that
should connect directly whenever that profile is in use. A new profile starts
with `<local>`.

The bypass list belongs to the profile, so it also applies when a rule sends a
request to that profile.

## Authentication

Enter a username and password on the profile and Detour answers the proxy's
authentication prompt for you. If the credentials are wrong, the request is
cancelled after one attempt and the browser does not ask again in a loop.

Chromium browsers cannot authenticate a SOCKS proxy at all, so the fields are
disabled there when the type is SOCKS4 or SOCKS5. Firefox can.

## Connection test

**Test connection** sends one request through the selected profile and shows
the exit IP and the response time. It works whether Detour is on or off, and
puts the proxy back the way it was afterwards.

The test asks `https://api.ipify.org` which address the request came from. That
service sees an ordinary browser request arriving from the proxy's exit
address. Detour adds nothing about you or your configuration to it.

## Health checks and failover

In **Settings → Health and failover** you can have Detour repeat the connection
test in the background while it is on.

- **Interval**: how often to test, from 60 seconds to an hour.
- **Failures before fallback**: how many tests in a row must fail, from 1 to 10.
- **Fallback**: another profile, or Direct.

After that many consecutive failures, Detour tests the fallback profile. If it
works, it becomes the active profile. If it fails too, or the fallback is
Direct, Detour turns itself off. The popup shows what happened for the next ten
minutes.

Turning Detour off yourself always wins. A health check that was running at
that moment cannot turn it back on.

## Keyboard shortcuts

Detour has two commands and assigns no keys by default, because any default
would collide with something in one browser or another:

- **Toggle Detour** turns the proxy on or off.
- **Next profile** makes the next configured profile active. It does not turn
  Detour on if it is off.

Assign keys on the browser's shortcut page. **Settings → Keyboard shortcuts**
links to it.

## Import and export

**Export** saves every profile, rule, and health setting to
`detour-config.json`. The file contains your proxy passwords in plain text, so
treat it like a password.

**Import** replaces the current configuration with the file's. It accepts:

- a Detour export, from this version or an older one;
- a **SwitchyOmega** backup or options file. Fixed proxy profiles and
  auto-switch rules that name a host, a wildcard, or an IP range are converted.
  What Detour cannot represent (PAC scripts, regular-expression conditions, a
  different proxy per protocol) is listed after the import, so nothing is
  dropped silently.

## Troubleshooting

**"Another extension is controlling the proxy settings."** Chromium lets one
extension set the proxy at a time. Disable the other one, or Detour's settings
will not take effect.

**"Proxy settings are locked by your system or organization."** A policy set by
an administrator overrides extensions.

**A site still goes direct.** Check the profile's bypass list and the rules
above the one you expect to match. The first match wins.

**The SOCKS proxy asks for a password in Chrome.** Chromium cannot answer it.
Use an HTTP or HTTPS proxy, or Firefox.
