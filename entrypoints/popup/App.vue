<script lang="ts" setup>
import { computed, onMounted } from 'vue';
import { useProxyState } from '@/composables/useProxyState';
import ConnectionTest from '@/components/ConnectionTest.vue';

const { enabled, profile, valid, controlWarning, toggle, load } = useProxyState();

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
          class="gear"
          type="button"
          title="Settings"
          aria-label="Settings"
          @click="openOptions"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-2.82-1.17l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 13H4.5a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.17-2.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 11 4.6V4.5a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 11h.1a2 2 0 1 1 0 4h-.1Z"
            />
          </svg>
        </button>
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

    <button class="summary" type="button" @click="openOptions">
      <span class="summary-text" :class="{ unset: !valid }">{{ summary }}</span>
      <span class="summary-edit">Edit</span>
    </button>

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

.gear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}

.gear:hover {
  color: var(--fg);
  background: var(--card);
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

.summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  margin-bottom: 12px;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  color: var(--fg);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.summary:hover {
  border-color: var(--accent);
}

.summary-text {
  font-variant-numeric: tabular-nums;
}

.summary-text.unset {
  color: var(--muted);
}

.summary-edit {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
}
</style>
