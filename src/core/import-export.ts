import { DEFAULT_STATE } from './types';
import type { ProxyState } from './types';
import { sanitizeProfile } from './profile';
import { clearHealthRuntime, isRecord, normalizeState } from './state';
import { importSwitchyOmega, isSwitchyOmegaExport, type ImportResult } from './switchyomega';

// Serialize and parse proxy state for the Import / Export buttons. The exported
// file is versioned so future model changes can migrate older files. Parsing is
// defensive: anything missing or malformed falls back to a default instead of
// throwing. A file is rejected only when it has no proxy config at all: no
// profiles, and no proxy host.

export const EXPORT_VERSION = 4;

export interface ExportFile {
  app: 'detour';
  version: number;
  exportedAt: string;
  state: ProxyState;
}

export function buildExport(state: ProxyState, now: Date = new Date()): string {
  const file: ExportFile = {
    app: 'detour',
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    // Health counters and the last failover belong to this browser session.
    state: { ...state, ...clearHealthRuntime() },
  };
  return JSON.stringify(file, null, 2);
}

function hasProfiles(state: unknown): state is Record<string, unknown> {
  return isRecord(state) && Array.isArray(state.profiles) && state.profiles.some(isRecord);
}

// A single profile has to name its server. `sanitizeProfile` fills in every
// missing field, so without this check any object, even `{}`, would import as a
// blank profile and replace the whole configuration.
function isProfile(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value.host === 'string' && value.host.trim() !== '';
}

// A Detour export. v2+ files carry a full `state`; v1 files carry a single
// `profile`, and a bare profile object is accepted the same way.
function parseDetourImport(raw: Record<string, unknown>): ProxyState {
  if (hasProfiles(raw.state)) {
    return { ...normalizeState(raw.state), ...clearHealthRuntime() };
  }

  const profile = raw.profile ?? raw;
  if (!isProfile(profile)) {
    throw new Error('No proxy config found in this file.');
  }
  const imported = sanitizeProfile(profile, 0);
  return {
    ...DEFAULT_STATE,
    activeProfileId: imported.id,
    profiles: [imported],
  };
}

// Parse an imported file. SwitchyOmega backup / options JSON is detected and
// mapped; everything else is read as a Detour export.
export function parseImportedFile(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('Not a valid JSON file.');
  }
  if (!isRecord(data)) {
    throw new Error('No proxy config found in this file.');
  }
  if (isSwitchyOmegaExport(data)) return importSwitchyOmega(data);
  return { source: 'detour', skipped: [], state: parseDetourImport(data) };
}
