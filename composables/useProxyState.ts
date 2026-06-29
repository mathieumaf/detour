import { reactive, ref, computed } from 'vue';
import {
  loadState,
  saveState,
  testProxy,
  authSupported,
  isProfileValid,
  parseBypassList,
  formatBypassList,
  buildExport,
  parseImport,
  DEFAULT_PROFILE,
  STORAGE_KEY,
  type ProxyProfile,
  type ProxyState,
  type TestResult,
} from '@/utils/proxy';

// Shared store for a single page (popup or options). Defined at module scope so
// every component reads and mutates the same reactive state without prop-
// drilling. The popup and options page are separate documents with their own
// instance of this module, so each subscribes to chrome.storage below to stay
// in sync with edits made in the other — otherwise a stale `enabled` flag from
// one view would clobber the proxy when the other view saves.

const enabled = ref(false);
const profile = reactive<ProxyProfile>({ ...DEFAULT_PROFILE });
// Raw textarea content; parsed into profile.bypassList on save.
const bypassText = ref('');
const controlWarning = ref('');
const testing = ref(false);
const testResult = ref<TestResult | null>(null);

const valid = computed(() => isProfileValid(profile));
const supportsAuth = computed(() => authSupported(profile.scheme));

// A plain, fully-detached copy of the profile. Vue's reactive() wraps nested
// objects (here, bypassList) in Proxies, which the structured-clone used by
// chrome.storage / sendMessage can't serialize — so we rebuild a flat object.
function snapshot(): ProxyProfile {
  return {
    scheme: profile.scheme,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    password: profile.password,
    bypassList: parseBypassList(bypassText.value),
  };
}

// Serialized form of our most recent write, so the storage listener can tell
// our own change apart from one made by the other view and skip re-applying it
// (which would reformat fields mid-edit).
let lastWritten = '';

function applyToView(s: ProxyState) {
  enabled.value = s.enabled;
  Object.assign(profile, { ...DEFAULT_PROFILE, ...s.profile });
  bypassText.value = formatBypassList(profile.bypassList);
}

async function persist(state: ProxyState) {
  lastWritten = JSON.stringify(state);
  await saveState(state);
}

async function load() {
  applyToView(await loadState());
  await checkControl();
}

async function save() {
  // Editing the target invalidates any previous test result.
  testResult.value = null;
  const next = snapshot();
  profile.bypassList = next.bypassList;
  // Can't be active with an invalid target — flip off rather than apply garbage.
  if (enabled.value && !valid.value) enabled.value = false;
  await persist({ enabled: enabled.value, profile: next });
  await checkControl();
}

// Mirror edits made in the other view (e.g. toggling in the popup while the
// options page is open). Ignoring our own writes keeps the active field from
// being reformatted out from under the cursor.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEY]) return;
  const next = changes[STORAGE_KEY].newValue as ProxyState | undefined;
  if (!next || JSON.stringify(next) === lastWritten) return;
  applyToView(next);
  testResult.value = null;
  void checkControl();
});

async function runTest() {
  if (!valid.value || testing.value) return;
  testing.value = true;
  testResult.value = null;
  try {
    testResult.value = await testProxy(snapshot());
  } catch (err) {
    testResult.value = { ok: false, error: (err as Error)?.message || 'Test failed.' };
  } finally {
    testing.value = false;
  }
}

// Download the current profile (including unsaved edits) as a JSON file.
function exportConfig() {
  const blob = new Blob([buildExport(snapshot())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'detour-config.json';
  a.click();
  URL.revokeObjectURL(url);
}

// Load a profile from a previously exported file and apply it. Throws on a
// malformed file so the caller can surface the message; never enables a proxy
// that the imported profile leaves invalid (save() handles that).
async function importConfig(file: File): Promise<void> {
  const imported = parseImport(await file.text());
  Object.assign(profile, imported);
  bypassText.value = formatBypassList(profile.bypassList);
  await save();
}

async function toggle() {
  if (!enabled.value && !valid.value) return;
  enabled.value = !enabled.value;
  await save();
}

async function checkControl() {
  try {
    const { levelOfControl } = await chrome.proxy.settings.get({});
    if (levelOfControl === 'controlled_by_other_extensions')
      controlWarning.value = 'Another extension is controlling the proxy settings.';
    else if (levelOfControl === 'not_controllable')
      controlWarning.value = 'Proxy settings are locked by your system or organization.';
    else controlWarning.value = '';
  } catch {
    controlWarning.value = '';
  }
}

export function useProxyState() {
  return {
    enabled,
    profile,
    bypassText,
    controlWarning,
    testing,
    testResult,
    valid,
    supportsAuth,
    load,
    save,
    runTest,
    toggle,
    exportConfig,
    importConfig,
  };
}
