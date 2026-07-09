<script lang="ts" setup>
import { computed, onMounted } from 'vue';
import { useProxyState } from '@/composables/useProxyState';
import ConnectionTest from '@/components/ConnectionTest.vue';

const {
  enabled,
  activeProfileId,
  profiles,
  profile,
  valid,
  controlWarning,
  toggle,
  selectProfile,
  load,
} = useProxyState();

onMounted(load);

// One-line description of the configured target, shown in place of the full
// form — the form now lives on the options page.
const summary = computed(() =>
  valid.value
    ? `${profile.scheme.toUpperCase()} · ${profile.host}:${profile.port}`
    : 'Not configured',
);

function openOptions() {
  chrome.runtime.openOptionsPage();
}

function onProfileChange(event: Event) {
  void selectProfile((event.target as HTMLSelectElement).value);
}
</script>

<template>
  <main class="app">
    <header class="header">
      <div class="brand">
        <span class="dot" :class="{ on: enabled }" />
        <h1>Detour</h1>
      </div>
      <div class="actions">
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
      </div>
    </header>

    <p class="status" :class="{ active: enabled }">
      {{ enabled ? 'Proxy active' : 'Direct connection' }}
    </p>

    <div class="profile-row">
      <select
        class="profile-picker"
        :value="activeProfileId"
        aria-label="Active profile"
        @change="onProfileChange"
      >
        <option v-for="item in profiles" :key="item.id" :value="item.id">
          {{ item.name }}
        </option>
      </select>
      <button class="settings" type="button" @click="openOptions">Settings</button>
    </div>

    <div class="summary">
      <span class="summary-text" :class="{ unset: !valid }">
        {{ summary }}
      </span>
    </div>

    <p v-if="controlWarning" class="note warn">{{ controlWarning }}</p>

    <ConnectionTest />
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

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
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

.profile-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.profile-picker {
  min-width: 0;
  flex: 1;
  padding: 8px 9px;
  font: inherit;
  font-size: 12px;
  color: var(--fg);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 7px;
}

.settings {
  flex: 0 0 auto;
  padding: 8px 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  color: var(--fg);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 7px;
  cursor: pointer;
}

.settings:hover {
  border-color: var(--accent);
}

.summary {
  display: flex;
  align-items: center;
  width: 100%;
  margin-bottom: 12px;
  padding: 10px 12px;
  font-size: 13px;
  color: var(--fg);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.summary-text {
  font-variant-numeric: tabular-nums;
}

.summary-text.unset {
  color: var(--muted);
}
</style>
