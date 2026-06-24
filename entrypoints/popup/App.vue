<script lang="ts" setup>
import { onMounted } from 'vue';
import { useProxyState } from './composables/useProxyState';
import ProxyForm from './components/ProxyForm.vue';
import BypassList from './components/BypassList.vue';
import ConnectionTest from './components/ConnectionTest.vue';

const { enabled, valid, controlWarning, toggle, load } = useProxyState();

onMounted(load);
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
      <ProxyForm />
      <BypassList />
      <p v-if="controlWarning" class="note warn">{{ controlWarning }}</p>
      <ConnectionTest />
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
</style>
