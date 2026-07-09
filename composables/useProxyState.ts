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

const enabled = ref(false);
const activeProfileId = ref(DEFAULT_PROFILE.id);
const profiles = ref<ProxyProfile[]>([]);
const profile = reactive<ProxyProfile>({
  ...DEFAULT_PROFILE,
  bypassList: [...DEFAULT_PROFILE.bypassList],
});
const bypassText = ref('');
const controlWarning = ref('');
const testing = ref(false);
const testResult = ref<TestResult | null>(null);

const valid = computed(() => isProfileValid(profile));
const supportsAuth = computed(() => authSupported(profile.scheme));

function copyProfile(source: ProxyProfile): ProxyProfile {
  return { ...source, bypassList: [...source.bypassList] };
}

function profileSnapshot(): ProxyProfile {
  return { ...profile, bypassList: parseBypassList(bypassText.value) };
}

function snapshot(): ProxyState {
  const current = profileSnapshot();
  return {
    enabled: enabled.value,
    activeProfileId: activeProfileId.value,
    profiles: profiles.value.map((item) =>
      item.id === current.id ? current : copyProfile(item),
    ),
  };
}

let lastWritten = '';

function applyToView(state: ProxyState) {
  const nextProfiles = state.profiles.map(copyProfile);
  const selected =
    nextProfiles.find((item) => item.id === state.activeProfileId) ?? nextProfiles[0];
  if (!selected) return;
  enabled.value = state.enabled;
  activeProfileId.value = selected.id;
  profiles.value = nextProfiles;
  Object.assign(profile, copyProfile(selected));
  bypassText.value = formatBypassList(selected.bypassList);
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
  testResult.value = null;
  const next = profileSnapshot();
  next.name = next.name.trim() || DEFAULT_PROFILE.name;
  profile.name = next.name;
  profile.bypassList = next.bypassList;
  if (enabled.value && !valid.value) enabled.value = false;
  await persist(snapshot());
  await checkControl();
}

function applySelected(next: ProxyProfile) {
  activeProfileId.value = next.id;
  Object.assign(profile, copyProfile(next));
  bypassText.value = formatBypassList(next.bypassList);
  testResult.value = null;
}

function newId(): string {
  return crypto.randomUUID();
}

function unusedName(base: string): string {
  const names = new Set(profiles.value.map((item) => item.name));
  if (!names.has(base)) return base;
  let number = 2;
  while (names.has(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}

async function selectProfile(id: string) {
  if (id === activeProfileId.value) return;
  const next = snapshot().profiles.find((item) => item.id === id);
  if (!next) return;
  applySelected(next);
  if (enabled.value && !valid.value) enabled.value = false;
  await persist(snapshot());
  await checkControl();
}

async function createProfile() {
  const next: ProxyProfile = {
    ...DEFAULT_PROFILE,
    id: newId(),
    name: unusedName('New profile'),
    bypassList: [...DEFAULT_PROFILE.bypassList],
  };
  profiles.value = [...snapshot().profiles, next];
  applySelected(next);
  if (enabled.value) enabled.value = false;
  await persist(snapshot());
  await checkControl();
}

async function duplicateProfile() {
  const source = profileSnapshot();
  const next: ProxyProfile = {
    ...source,
    id: newId(),
    name: unusedName(`${source.name} copy`),
    bypassList: [...source.bypassList],
  };
  profiles.value = [...snapshot().profiles, next];
  applySelected(next);
  await persist(snapshot());
  await checkControl();
}

async function deleteProfile() {
  if (profiles.value.length <= 1) return;
  const current = snapshot();
  const remaining = current.profiles.filter((item) => item.id !== activeProfileId.value);
  profiles.value = remaining;
  applySelected(remaining[0]);
  if (enabled.value && !valid.value) enabled.value = false;
  await persist(snapshot());
  await checkControl();
}

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
    testResult.value = await testProxy(profileSnapshot());
  } catch (err) {
    testResult.value = { ok: false, error: (err as Error)?.message || 'Test failed.' };
  } finally {
    testing.value = false;
  }
}

function exportConfig() {
  const blob = new Blob([buildExport(snapshot())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'detour-config.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function importConfig(file: File): Promise<void> {
  const imported = parseImport(await file.text());
  applyToView(imported);
  if (enabled.value && !valid.value) enabled.value = false;
  await persist(snapshot());
  await checkControl();
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
    activeProfileId,
    profiles,
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
    selectProfile,
    createProfile,
    duplicateProfile,
    deleteProfile,
    exportConfig,
    importConfig,
  };
}
