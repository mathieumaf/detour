import { DEFAULT_PROFILE, DEFAULT_STATE } from './types';
import type { ProxyProfile, ProxyScheme, ProxyState } from './types';
import { sanitizeRules } from './rules';

// Serialize/parse proxy state for the Import/Export buttons. The exported
// file is versioned so future model changes can migrate older files, and
// parsing is defensive: anything missing or malformed falls back to defaults
// (including rules: [] for pre-v3 files) rather than throwing.

export const EXPORT_VERSION = 3;

export interface ExportFile {
  app: 'detour';
  version: number;
  exportedAt: string;
  state: ProxyState;
}

const SCHEMES: readonly ProxyScheme[] = ['http', 'https', 'socks4', 'socks5'];

// Coerce an untrusted object into a valid ProxyProfile, backfilling defaults.
function sanitizeProfile(raw: Record<string, unknown>, index: number): ProxyProfile {
  const port = Number(raw.port);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `imported-${index}`,
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : index === 0
          ? DEFAULT_PROFILE.name
          : `Profile ${index + 1}`,
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

export function buildExport(state: ProxyState): string {
  const file: ExportFile = {
    app: 'detour',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    state,
  };
  return JSON.stringify(file, null, 2);
}

// Parse the contents of an imported file into a state. Version 1 exports and
// bare profiles remain accepted, and are imported as one active profile.
export function parseImport(text: string): ProxyState {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not a valid JSON file.');
  }
  const raw = data as { state?: unknown; profile?: unknown };
  if (!raw || typeof raw !== 'object') {
    throw new Error('No proxy config found in this file.');
  }
  if (raw.state && typeof raw.state === 'object') {
    const state = raw.state as {
      enabled?: unknown;
      activeProfileId?: unknown;
      profiles?: unknown;
      rules?: unknown;
    };
    if (Array.isArray(state.profiles) && state.profiles.length) {
      const profiles = state.profiles
        .filter((profile): profile is Record<string, unknown> => !!profile && typeof profile === 'object')
        .map((profile, index) => sanitizeProfile(profile, index));
      if (profiles.length) {
        const activeProfileId = profiles.some((profile) => profile.id === state.activeProfileId)
          ? state.activeProfileId as string
          : (profiles[0]?.id ?? DEFAULT_PROFILE.id);
        const profileIds = new Set(profiles.map((profile) => profile.id));
        return {
          enabled: state.enabled === true,
          activeProfileId,
          profiles,
          rules: sanitizeRules(state.rules, profileIds),
        };
      }
    }
  }

  const profile = raw.profile ?? data;
  if (!profile || typeof profile !== 'object') {
    throw new Error('No proxy config found in this file.');
  }
  const imported = sanitizeProfile(profile as Record<string, unknown>, 0);
  return {
    ...DEFAULT_STATE,
    activeProfileId: imported.id,
    profiles: [imported],
  };
}
