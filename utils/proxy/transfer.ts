import { DEFAULT_PROFILE } from './types';
import type { ProxyProfile, ProxyScheme } from './types';

// Serialize/parse a proxy profile for the Import/Export buttons. The exported
// file is versioned so future model changes can migrate older files, and
// parsing is defensive: anything missing or malformed falls back to the
// DEFAULT_PROFILE value rather than throwing, mirroring loadState().

export const EXPORT_VERSION = 1;

export interface ExportFile {
  app: 'detour';
  version: number;
  exportedAt: string;
  profile: ProxyProfile;
}

const SCHEMES: readonly ProxyScheme[] = ['http', 'https', 'socks4', 'socks5'];

// Coerce an untrusted object into a valid ProxyProfile, backfilling defaults.
function sanitizeProfile(raw: Record<string, unknown>): ProxyProfile {
  const port = Number(raw.port);
  return {
    scheme: SCHEMES.includes(raw.scheme as ProxyScheme)
      ? (raw.scheme as ProxyScheme)
      : DEFAULT_PROFILE.scheme,
    host: typeof raw.host === 'string' ? raw.host.trim() : '',
    port:
      Number.isInteger(port) && port >= 1 && port <= 65535
        ? port
        : DEFAULT_PROFILE.port,
    username: typeof raw.username === 'string' ? raw.username : '',
    password: typeof raw.password === 'string' ? raw.password : '',
    bypassList: Array.isArray(raw.bypassList)
      ? raw.bypassList.filter((h): h is string => typeof h === 'string')
      : [...DEFAULT_PROFILE.bypassList],
  };
}

export function buildExport(profile: ProxyProfile): string {
  const file: ExportFile = {
    app: 'detour',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    profile,
  };
  return JSON.stringify(file, null, 2);
}

// Parse the contents of an imported file into a profile. Accepts either the
// wrapped export shape ({ app, version, profile }) or a bare profile object,
// so a hand-written or older file still works. Throws only when the input
// isn't JSON or carries no usable object.
export function parseImport(text: string): ProxyProfile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not a valid JSON file.');
  }
  const raw = (data as { profile?: unknown })?.profile ?? data;
  if (!raw || typeof raw !== 'object') {
    throw new Error('No proxy config found in this file.');
  }
  return sanitizeProfile(raw as Record<string, unknown>);
}
