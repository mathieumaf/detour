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

// Does this URL match any bypass entry? Mirrors a pragmatic subset of Chromium's
// proxy bypass rules so Firefox (which has no native bypassList) behaves the same:
//   <local>          localhost, 127.0.0.1, ::1, and dotless hostnames
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
  for (const raw of bypassList) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry === '<local>') {
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '[::1]' ||
        !host.includes('.')
      )
        return true;
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
