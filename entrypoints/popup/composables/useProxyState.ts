import { reactive, ref, computed } from 'vue';
import {
  loadState,
  saveState,
  testProxy,
  authSupported,
  isProfileValid,
  parseBypassList,
  formatBypassList,
  DEFAULT_PROFILE,
  type ProxyProfile,
  type TestResult,
} from '@/utils/proxy';

// Single shared store for the popup. Defined at module scope so every component
// (form, bypass list, test) reads and mutates the same reactive state without
// prop-drilling — the popup only ever has one instance.

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

async function load() {
  const s = await loadState();
  enabled.value = s.enabled;
  Object.assign(profile, s.profile);
  bypassText.value = formatBypassList(profile.bypassList);
  await checkControl();
}

async function save() {
  // Editing the target invalidates any previous test result.
  testResult.value = null;
  const next = snapshot();
  profile.bypassList = next.bypassList;
  // Can't be active with an invalid target — flip off rather than apply garbage.
  if (enabled.value && !valid.value) enabled.value = false;
  await saveState({ enabled: enabled.value, profile: next });
  await checkControl();
}

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
  };
}
