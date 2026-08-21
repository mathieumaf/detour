import { reactive, ref, computed } from 'vue';
import {
  loadState,
  saveState,
  testProxy,
  setProxyEnabled,
  authSupported,
  isProfileValid,
  parseBypassList,
  formatBypassList,
  buildExport,
  parseImportedFile,
  DEFAULT_PROFILE,
  DEFAULT_HEALTH_CHECK,
  DIRECT_ACTION,
  STORAGE_KEY,
  dropRulesForProfile,
  sanitizeHealthCheck,
  type FailoverEvent,
  type HealthCheckSettings,
  type ImportResult,
  type ProxyProfile,
  type ProxyState,
  type RoutingRule,
  type TestResult,
} from '@/utils/proxy';

const enabled = ref(false);
const activeProfileId = ref(DEFAULT_PROFILE.id);
const profiles = ref<ProxyProfile[]>([]);
const rules = ref<RoutingRule[]>([]);
const healthCheck = reactive<HealthCheckSettings>({ ...DEFAULT_HEALTH_CHECK });
const healthStatus = reactive({ profileId: '', consecutiveFailures: 0 });
const lastFailover = ref<FailoverEvent | null>(null);
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

function copyRule(rule: RoutingRule): RoutingRule {
  return { ...rule };
}

function snapshot(): ProxyState {
  const current = profileSnapshot();
  return {
    enabled: enabled.value,
    activeProfileId: activeProfileId.value,
    profiles: profiles.value.map((item) =>
      item.id === current.id ? current : copyProfile(item),
    ),
    rules: rules.value.map(copyRule),
    healthCheck: { ...healthCheck },
    healthStatus: { ...healthStatus },
    lastFailover: lastFailover.value ? { ...lastFailover.value } : null,
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
  rules.value = (state.rules ?? []).map(copyRule);
  Object.assign(healthCheck, state.healthCheck ?? DEFAULT_HEALTH_CHECK);
  Object.assign(healthStatus, state.healthStatus ?? {
    profileId: '',
    consecutiveFailures: 0,
  });
  lastFailover.value = state.lastFailover ? { ...state.lastFailover } : null;
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

function clearHealthRuntime() {
  Object.assign(healthStatus, { profileId: '', consecutiveFailures: 0 });
  lastFailover.value = null;
}

async function save() {
  testResult.value = null;
  const next = profileSnapshot();
  next.name = next.name.trim() || DEFAULT_PROFILE.name;
  profile.name = next.name;
  profile.bypassList = next.bypassList;
  if (enabled.value && !valid.value) enabled.value = false;
  clearHealthRuntime();
  await persist(snapshot());
  await checkControl();
}

async function updateHealthCheck() {
  const profileIds = new Set(snapshot().profiles.map((item) => item.id));
  Object.assign(healthCheck, sanitizeHealthCheck(healthCheck, profileIds));
  clearHealthRuntime();
  await persist(snapshot());
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
  clearHealthRuntime();
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
  rules.value = dropRulesForProfile(current.rules, activeProfileId.value);
  if (healthCheck.fallbackProfileId === activeProfileId.value) {
    healthCheck.fallbackProfileId = DIRECT_ACTION;
  }
  const next = remaining[0];
  if (!next) return;
  applySelected(next);
  if (enabled.value && !valid.value) enabled.value = false;
  await persist(snapshot());
  await checkControl();
}

async function addRule() {
  rules.value = [
    ...snapshot().rules,
    { id: newId(), match: '', action: DIRECT_ACTION },
  ];
  await persist(snapshot());
}

async function updateRule(id: string, patch: Partial<Pick<RoutingRule, 'match' | 'action'>>) {
  rules.value = snapshot().rules.map((rule) =>
    rule.id === id ? { ...rule, ...patch } : rule,
  );
  await persist(snapshot());
}

async function deleteRule(id: string) {
  rules.value = snapshot().rules.filter((rule) => rule.id !== id);
  await persist(snapshot());
}

async function moveRule(id: string, delta: -1 | 1) {
  const list = snapshot().rules;
  const index = list.findIndex((rule) => rule.id === id);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= list.length) return;
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  if (!item) return;
  copy.splice(next, 0, item);
  rules.value = copy;
  await persist(snapshot());
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

async function importConfig(file: File): Promise<ImportResult> {
  const imported = parseImportedFile(await file.text());
  applyToView(imported.state);
  if (enabled.value && !valid.value) enabled.value = false;
  await persist(snapshot());
  await checkControl();
  return imported;
}

async function toggle() {
  if (!enabled.value && !valid.value) return;
  const previous = enabled.value;
  enabled.value = !previous;
  testResult.value = null;
  clearHealthRuntime();
  try {
    await setProxyEnabled(enabled.value);
  } catch (error) {
    enabled.value = previous;
    throw error;
  }
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
    rules,
    healthCheck,
    lastFailover,
    profile,
    bypassText,
    controlWarning,
    testing,
    testResult,
    valid,
    supportsAuth,
    load,
    save,
    updateHealthCheck,
    runTest,
    toggle,
    selectProfile,
    createProfile,
    duplicateProfile,
    deleteProfile,
    addRule,
    updateRule,
    deleteRule,
    moveRule,
    exportConfig,
    importConfig,
  };
}
