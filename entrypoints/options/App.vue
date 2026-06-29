<script lang="ts" setup>
import { onMounted } from 'vue';
import { useProxyState } from '@/composables/useProxyState';
import ProxyForm from '@/components/ProxyForm.vue';
import BypassList from '@/components/BypassList.vue';
import ConnectionTest from '@/components/ConnectionTest.vue';
import ImportExport from '@/components/ImportExport.vue';

const { enabled, controlWarning, load } = useProxyState();

onMounted(load);
</script>

<template>
  <main class="page">
    <header class="head">
      <span class="dot" :class="{ on: enabled }" />
      <h1>Detour</h1>
      <span class="sub">Settings</span>
    </header>

    <section class="card">
      <h2>Proxy server</h2>
      <ProxyForm />
      <p v-if="controlWarning" class="note warn">{{ controlWarning }}</p>
      <ConnectionTest />
    </section>

    <section class="card">
      <h2>Bypass list</h2>
      <BypassList />
    </section>

    <section class="card">
      <h2>Backup</h2>
      <ImportExport />
    </section>

    <footer class="foot">
      Changes are saved automatically and apply to the active proxy immediately.
    </footer>
  </main>
</template>

<style scoped>
.page {
  max-width: 460px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.head h1 {
  font-size: 22px;
  font-weight: 600;
  margin: 0;
}

.dot {
  align-self: center;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--muted);
}

.dot.on {
  background: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
}

.sub {
  font-size: 13px;
  color: var(--muted);
}

.card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
}

.card h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--muted);
}

.foot {
  font-size: 11px;
  color: var(--muted);
  text-align: center;
}
</style>
