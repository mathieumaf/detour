// Bypass list: hosts that connect directly instead of through the proxy.
// The textarea helpers keep storage and UI in sync; isBypassed() lets Firefox
// (which has no native bypassList) match the same rules Chromium applies.

// Parse the bypass textarea (one entry per line, commas also accepted) into a
// clean, de-duplicated list. Empty lines and surrounding whitespace are dropped.
export function parseBypassList(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\n,]/)) {
    const entry = part.trim();
    if (entry) seen.add(entry);
  }
  return [...seen];
}

// Render a bypass list back into textarea content.
export function formatBypassList(list: string[]): string {
  return list.join('\n');
}

// --- IP / CIDR parsing ------------------------------------------------------
// Firefox has no native bypassList, so we match IPs ourselves. Chromium supports
// CIDR natively; we only expand the <private> shorthand for it (see below).

// Parse an IPv4 or IPv6 literal into its bytes (4 or 16), or null if not an IP.
function parseIp(input: string): number[] | null {
  const s = input.trim();
  if (s.includes(':')) return parseIpv6(s);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return parseIpv4(s);
  return null;
}

function parseIpv4(s: string): [number, number, number, number] | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  const bytes: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const part = parts[i];
    if (part === undefined || !/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes[i] = n;
  }
  return bytes;
}

function parseIpv6(input: string): number[] | null {
  // Drop any zone id (e.g. fe80::1%eth0).
  const zone = input.indexOf('%');
  const s = zone === -1 ? input : input.slice(0, zone);

  const halves = s.split('::');
  if (halves.length > 2) return null; // at most one "::" run

  // Expand a colon-separated half into 16-bit groups, supporting a trailing
  // embedded IPv4 (e.g. ::ffff:192.168.0.1).
  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    const tokens = part.split(':');
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === undefined) return null;
      if (t.includes('.')) {
        if (i !== tokens.length - 1) return null; // IPv4 only allowed last
        const v4 = parseIpv4(t);
        if (!v4) return null;
        groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(t)) return null;
        groups.push(parseInt(t, 16));
      }
    }
    return groups;
  };

  const head = toGroups(halves[0] ?? '');
  if (!head) return null;

  let groups: number[];
  if (halves.length === 1) {
    groups = head; // no "::" — must be a full address
  } else {
    const tail = toGroups(halves[1] ?? '');
    if (!tail) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null; // "::" must stand in for at least one group
    groups = [...head, ...Array(missing).fill(0), ...tail];
  }
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) bytes.push((g >> 8) & 0xff, g & 0xff);
  return bytes;
}

interface Cidr {
  bytes: number[];
  prefix: number;
}

// Parse "addr/prefix" into a network, or null if malformed.
function parseCidr(entry: string): Cidr | null {
  const slash = entry.indexOf('/');
  if (slash === -1) return null;
  if (!/^\d+$/.test(entry.slice(slash + 1))) return null;
  const bytes = parseIp(entry.slice(0, slash));
  if (!bytes) return null;
  const prefix = Number(entry.slice(slash + 1));
  return prefix <= bytes.length * 8 ? { bytes, prefix } : null;
}

// Is the host IP inside the network? Different IP versions never match.
function ipInCidr(host: number[], net: Cidr): boolean {
  if (host.length !== net.bytes.length) return false;
  let bits = net.prefix;
  for (let i = 0; i < host.length && bits > 0; i++) {
    const take = Math.min(8, bits);
    const mask = (0xff << (8 - take)) & 0xff;
    const hostByte = host[i];
    const netByte = net.bytes[i];
    if (hostByte === undefined || netByte === undefined) return false;
    if ((hostByte & mask) !== (netByte & mask)) return false;
    bits -= take;
  }
  return true;
}

// The <private> shorthand: loopback, RFC 1918 / link-local IPv4, and IPv6
// loopback / unique-local / link-local. Chromium has no such keyword, so we
// expand it to these concrete ranges for it (see expandBypassForChromium).
export const PRIVATE_CIDRS = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
];

const PRIVATE_NETS: Cidr[] = PRIVATE_CIDRS.map((c) => parseCidr(c)!);

// Chromium understands CIDR ranges and <local> natively, but not our <private>
// shorthand — expand it to the concrete ranges before handing over the list.
export function expandBypassForChromium(list: string[]): string[] {
  const out: string[] = [];
  for (const entry of list) {
    if (entry.trim().toLowerCase() === '<private>') out.push(...PRIVATE_CIDRS);
    else out.push(entry);
  }
  return out;
}

// Does this URL match any bypass entry? Mirrors a pragmatic subset of Chromium's
// proxy bypass rules so Firefox (which has no native bypassList) behaves the same:
//   <local>          localhost, loopback, and dotless hostnames
//   <private>        loopback + RFC 1918 / link-local / unique-local IP ranges
//   10.0.0.0/8       any IP in the CIDR range (IPv4 or IPv6)
//   example.com      that exact host
//   *.example.com    any subdomain of example.com (not the bare domain)
//   .example.com     example.com and its subdomains
export function isBypassed(url: string, bypassList: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  // URL hostnames wrap IPv6 in brackets ([::1]); strip them for IP matching.
  const hostIp = parseIp(host.replace(/^\[|\]$/g, ''));

  for (const raw of bypassList) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry === '<local>') {
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '[::1]' ||
        // A dotless hostname, but not an IP literal (e.g. a bare IPv6).
        (!hostIp && !host.includes('.'))
      )
        return true;
    } else if (entry === '<private>') {
      if (hostIp && PRIVATE_NETS.some((net) => ipInCidr(hostIp, net))) return true;
    } else if (entry.includes('/')) {
      const net = parseCidr(entry);
      if (net && hostIp && ipInCidr(hostIp, net)) return true;
    } else if (entry.startsWith('*.')) {
      if (host.endsWith(entry.slice(1))) return true; // ".example.com" suffix
    } else if (entry.startsWith('.')) {
      const suffix = entry.slice(1);
      if (host === suffix || host.endsWith('.' + suffix)) return true;
    } else if (host === entry) {
      return true;
    }
  }
  return false;
}
