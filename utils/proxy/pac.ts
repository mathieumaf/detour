import { DIRECT_ACTION } from './types';
import type { ProxyProfile, ProxyState } from './types';
import { resolveProxyDecision } from './rules';
import { isProfileValid } from './validation';

// Chromium's chrome.proxy.settings is process-wide, so rules are compiled
// into a PAC script (FindProxyForURL). Matching here is a JS port of
// isBypassed() — IP literals only, no DNS — so Chrome and Firefox agree.

function safePacHost(host: string): string {
  return host.trim().replace(/[^\w.\-:[\]]/g, '');
}

export function pacReturnForProfile(profile: ProxyProfile): string {
  const host = safePacHost(profile.host);
  const port = profile.port;
  switch (profile.scheme) {
    case 'https':
      return `HTTPS ${host}:${port}`;
    case 'socks4':
      return `SOCKS ${host}:${port}`;
    case 'socks5':
      return `SOCKS5 ${host}:${port}`;
    default:
      return `PROXY ${host}:${port}`;
  }
}

// Compact PAC helpers. Function declarations so FindProxyForURL is hoisted
// when tests evaluate the script via `new Function`.
const PAC_RUNTIME = `function parseIpv4(s) {
  var parts = s.split(".");
  if (parts.length !== 4) return null;
  var bytes = [];
  for (var i = 0; i < 4; i++) {
    if (!/^\\d{1,3}$/.test(parts[i])) return null;
    var n = +parts[i];
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}
function parseIpv6(input) {
  var zone = input.indexOf("%");
  var s = zone === -1 ? input : input.slice(0, zone);
  var halves = s.split("::");
  if (halves.length > 2) return null;
  function toGroups(part) {
    if (part === "") return [];
    var groups = [];
    var tokens = part.split(":");
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t.indexOf(".") !== -1) {
        if (i !== tokens.length - 1) return null;
        var v4 = parseIpv4(t);
        if (!v4) return null;
        groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(t)) return null;
        groups.push(parseInt(t, 16));
      }
    }
    return groups;
  }
  var head = toGroups(halves[0] || "");
  if (!head) return null;
  var groups;
  if (halves.length === 1) groups = head;
  else {
    var tail = toGroups(halves[1] || "");
    if (!tail) return null;
    var missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = head.concat(Array(missing).fill(0), tail);
  }
  if (groups.length !== 8) return null;
  var bytes = [];
  for (var g = 0; g < groups.length; g++) {
    bytes.push((groups[g] >> 8) & 255, groups[g] & 255);
  }
  return bytes;
}
function parseIp(input) {
  var s = String(input || "").replace(/^\\[|\\]$/g, "");
  if (s.indexOf(":") !== -1) return parseIpv6(s);
  if (/^\\d{1,3}(\\.\\d{1,3}){3}$/.test(s)) return parseIpv4(s);
  return null;
}
function parseCidr(entry) {
  var slash = entry.indexOf("/");
  if (slash === -1) return null;
  if (!/^\\d+$/.test(entry.slice(slash + 1))) return null;
  var bytes = parseIp(entry.slice(0, slash));
  if (!bytes) return null;
  var prefix = +entry.slice(slash + 1);
  return prefix <= bytes.length * 8 ? { bytes: bytes, prefix: prefix } : null;
}
function ipInCidr(host, net) {
  if (host.length !== net.bytes.length) return false;
  var bits = net.prefix;
  for (var i = 0; i < host.length && bits > 0; i++) {
    var take = Math.min(8, bits);
    var mask = (255 << (8 - take)) & 255;
    if ((host[i] & mask) !== (net.bytes[i] & mask)) return false;
    bits -= take;
  }
  return true;
}
var PRIVATE = ${JSON.stringify([
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
])};
function matchPat(host, ip, raw) {
  var entry = String(raw || "").replace(/^\\s+|\\s+$/g, "").toLowerCase();
  if (!entry) return false;
  if (entry === "<local>") {
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1" || (!ip && host.indexOf(".") === -1);
  }
  if (entry === "<private>") {
    if (!ip) return false;
    for (var i = 0; i < PRIVATE.length; i++) {
      var net = parseCidr(PRIVATE[i]);
      if (net && ipInCidr(ip, net)) return true;
    }
    return false;
  }
  if (entry.indexOf("/") !== -1) {
    var cidr = parseCidr(entry);
    return !!(cidr && ip && ipInCidr(ip, cidr));
  }
  if (entry.indexOf("*.") === 0) {
    var wild = entry.substring(1);
    return host.length >= wild.length && host.substring(host.length - wild.length) === wild;
  }
  if (entry.charAt(0) === ".") {
    var suffix = entry.substring(1);
    return host === suffix || (host.length > suffix.length && host.substring(host.length - suffix.length - 1) === "." + suffix);
  }
  return host === entry;
}
function decide(host, ip, bypass, proxy) {
  for (var i = 0; i < bypass.length; i++) {
    if (matchPat(host, ip, bypass[i])) return "DIRECT";
  }
  return proxy;
}
`;

export function buildPacScript(state: ProxyState): string {
  const fallback = state.profiles.find((p) => p.id === state.activeProfileId) ?? state.profiles[0];
  const lines: string[] = [
    '// Generated by Detour. Do not edit.',
    PAC_RUNTIME,
    'function FindProxyForURL(url, host) {',
    '  host = String(host || "").toLowerCase();',
    '  if (host.charAt(0) === "[" && host.charAt(host.length - 1) === "]") host = host.slice(1, -1);',
    '  var ip = parseIp(host);',
  ];

  for (const rule of state.rules) {
    const match = JSON.stringify(rule.match);
    if (rule.action === DIRECT_ACTION) {
      lines.push(`  if (matchPat(host, ip, ${match})) return "DIRECT";`);
      continue;
    }
    const profile = state.profiles.find((item) => item.id === rule.action);
    if (!profile || !isProfileValid(profile)) continue;
    const bypass = JSON.stringify(profile.bypassList);
    const proxy = JSON.stringify(pacReturnForProfile(profile));
    lines.push(`  if (matchPat(host, ip, ${match})) return decide(host, ip, ${bypass}, ${proxy});`);
  }

  if (fallback && isProfileValid(fallback)) {
    const bypass = JSON.stringify(fallback.bypassList);
    const proxy = JSON.stringify(pacReturnForProfile(fallback));
    lines.push(`  return decide(host, ip, ${bypass}, ${proxy});`);
  } else {
    lines.push('  return "DIRECT";');
  }
  lines.push('}');
  return lines.join('\n');
}

// Evaluate a generated PAC in-process (unit tests). Mirrors what Chromium
// calls as FindProxyForURL(url, host).
export function evaluatePac(script: string, url: string): string {
  const host = new URL(url).hostname;
  const fn = new Function(`${script}\nreturn FindProxyForURL;`) as () => (
    url: string,
    host: string,
  ) => string;
  return fn()(url, host);
}

export function pacReturnForDecision(
  url: string,
  state: ProxyState,
): string {
  const decision = resolveProxyDecision(url, state);
  return decision === DIRECT_ACTION ? 'DIRECT' : pacReturnForProfile(decision);
}
