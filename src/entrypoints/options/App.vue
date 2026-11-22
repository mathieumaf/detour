<script lang="ts" setup>
import { onMounted } from 'vue';
import { useProxyState } from '@/composables/useProxyState';
import ProxyForm from '@/components/ProxyForm.vue';
import ProfileSwitcher from '@/components/ProfileSwitcher.vue';
import BypassList from '@/components/BypassList.vue';
import RuleList from '@/components/RuleList.vue';
import ConnectionTest from '@/components/ConnectionTest.vue';
import ImportExport from '@/components/ImportExport.vue';
import HealthCheck from '@/components/HealthCheck.vue';

const { enabled, controlWarning, load } = useProxyState();

onMounted(load);

// Chrome has no commands.openShortcutSettings; tabs.create can open the
// chrome:// shortcuts page. Firefox 140+ (our min version) has the API.
const shortcutSettingsHref = import.meta.env.FIREFOX
  ? 'https://support.mozilla.org/kb/manage-extension-shortcuts-firefox'
  : 'chrome://extensions/shortcuts';

function openShortcutSettings() {
  const commands = chrome.commands as typeof chrome.commands & {
    openShortcutSettings?: () => Promise<void>;
  };
  if (typeof commands.openShortcutSettings === 'function') {
    void commands.openShortcutSettings();
    return;
  }
  void chrome.tabs.create({ url: shortcutSettingsHref });
}
</script>

<template>
  <main class="page">
    <header class="head">
      <span class="dot" :class="{ on: enabled }" />
      <h1>Detour</h1>
      <span class="sub">Settings</span>
    </header>

    <section class="card">
      <h2>Profiles</h2>
      <ProfileSwitcher />
    </section>

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
      <h2>Health and failover</h2>
      <HealthCheck />
    </section>

    <section class="card">
      <h2>Rules</h2>
      <RuleList />
    </section>

    <section class="card">
      <h2>Backup</h2>
      <ImportExport />
    </section>

    <section class="card">
      <h2>Keyboard shortcuts</h2>
      <p class="note">
        Shortcuts are assigned in the browser.
        <a :href="shortcutSettingsHref" @click.prevent="openShortcutSettings">
          Open shortcut settings
        </a>
      </p>
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
