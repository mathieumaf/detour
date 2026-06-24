<script lang="ts" setup>
import { reactive, ref, computed, onMounted } from 'vue';
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
  type ProxyScheme,
  type TestResult,
} from '@/utils/proxy';

const SCHEMES: { value: ProxyScheme; label: string }[] = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
  { value: 'socks4', label: 'SOCKS4' },
  { value: 'socks5', label: 'SOCKS5' },
];

const enabled = ref(false);
const profile = reactive<ProxyProfile>({ ...DEFAULT_PROFILE });
// Raw textarea content; parsed into profile.bypassList on save.
const bypassText = ref('');
const controlWarning = ref('');
const testing = ref(false);
const testResult = ref<TestResult | null>(null);

const valid = computed(() => isProfileValid(profile));
const supportsAuth = computed(() => authSupported(profile.scheme));

onMounted(async () => {
  const s = await loadState();
  enabled.value = s.enabled;
  Object.assign(profile, s.profile);
  bypassText.value = formatBypassList(profile.bypassList);
  void checkControl();
});

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

async function save() {
  // Editing the target invalidates any previous test result.
  testResult.value = null;
  const next = snapshot();
  profile.bypassList = next.bypassList;
  // Can't be active with an invalid target — flip off rather than apply garbage.
  if (enabled.value && !valid.value) enabled.value = false;
  await saveState({ enabled: enabled.value, profile: next });
  void checkControl();
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
</script>

<template>
  <main class="app">
    <header class="header">
      <div class="brand">
        <span class="dot" :class="{ on: enabled }" />
        <h1>Detour</h1>
      </div>
      <button
        class="switch"
        :class="{ on: enabled }"
        :disabled="!enabled && !valid"
        :aria-pressed="enabled"
        type="button"
        @click="toggle"
      >
        <span class="knob" />
      </button>
    </header>

    <p class="status" :class="{ active: enabled }">
      {{ enabled ? 'Proxy active' : 'Direct connection' }}
    </p>

    <form class="form" @submit.prevent>
      <label class="field">
        <span class="label">Type</span>
        <select v-model="profile.scheme" @change="save">
          <option v-for="s in SCHEMES" :key="s.value" :value="s.value">
            {{ s.label }}
          </option>
        </select>
      </label>

      <div class="row">
        <label class="field host">
          <span class="label">Host</span>
          <input
            v-model.trim="profile.host"
            placeholder="127.0.0.1"
            spellcheck="false"
            @change="save"
          />
        </label>
        <label class="field port">
          <span class="label">Port</span>
          <input
            v-model.number="profile.port"
            type="number"
            min="1"
            max="65535"
            @change="save"
          />
        </label>
      </div>

      <label class="field">
        <span class="label">Username <em>(optional)</em></span>
        <input
          v-model="profile.username"
          autocomplete="off"
          spellcheck="false"
          :disabled="!supportsAuth"
          @change="save"
        />
      </label>

      <label class="field">
        <span class="label">Password <em>(optional)</em></span>
        <input
          v-model="profile.password"
          type="password"
          autocomplete="off"
          :disabled="!supportsAuth"
          @change="save"
        />
      </label>

      <p v-if="!supportsAuth" class="note">
        Chrome can't authenticate SOCKS proxies — username and password are
        ignored for SOCKS.
      </p>

      <label class="field">
        <span class="label">Bypass list <em>(one per line)</em></span>
        <textarea
          v-model="bypassText"
          class="bypass"
          rows="3"
          placeholder="&lt;local&gt;&#10;*.example.com"
          spellcheck="false"
          @change="save"
        />
      </label>
      <p class="note">
        Hosts that connect directly, skipping the proxy.
        <code>&lt;local&gt;</code> covers localhost; <code>*.example.com</code>
        matches subdomains.
      </p>

      <p v-if="controlWarning" class="note warn">{{ controlWarning }}</p>

      <div class="test">
        <button
          class="test-btn"
          type="button"
          :disabled="!valid || testing"
          @click="runTest"
        >
          {{ testing ? 'Testing…' : 'Test connection' }}
        </button>
        <p
          v-if="testResult"
          class="result"
          :class="testResult.ok ? 'ok' : 'fail'"
        >
          <template v-if="testResult.ok">
            ✓ Connected · {{ testResult.ip }} · {{ testResult.ms }} ms
          </template>
          <template v-else>✗ {{ testResult.error }}</template>
        </p>
      </div>
    </form>
  </main>
</template>

<style scoped>
.app {
  padding: 14px 16px 18px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand h1 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--muted);
  transition: background 0.2s;
}

.dot.on {
  background: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
}

.switch {
  position: relative;
  width: 46px;
  height: 26px;
  border: none;
  border-radius: 999px;
  background: var(--border);
  cursor: pointer;
  padding: 0;
  transition: background 0.2s;
}

.switch.on {
  background: var(--accent);
}

.switch:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}

.switch.on .knob {
  transform: translateX(20px);
}

.status {
  margin: 4px 0 14px;
  font-size: 12px;
  color: var(--muted);
}

.status.active {
  color: var(--accent);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.row {
  display: flex;
  gap: 10px;
}

.host {
  flex: 1 1 auto;
}

.port {
  width: 84px;
  flex: 0 0 auto;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
}

.label em {
  font-style: normal;
  opacity: 0.7;
}

select,
input,
textarea {
  width: 100%;
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  color: var(--fg);
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  transition: border-color 0.15s;
}

select:focus,
input:focus,
textarea:focus {
  border-color: var(--accent);
}

textarea.bypass {
  resize: vertical;
  min-height: 56px;
  line-height: 1.45;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

input:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.note {
  margin: 2px 0 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--muted);
}

.note.warn {
  color: var(--warn);
}

.note code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--card);
  border: 1px solid var(--border);
}

.test {
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.test-btn {
  padding: 9px 12px;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  color: var(--fg);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.test-btn:hover:not(:disabled) {
  border-color: var(--accent);
}

.test-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.result {
  margin: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.result.ok {
  color: var(--accent);
}

.result.fail {
  color: var(--warn);
}
</style>
