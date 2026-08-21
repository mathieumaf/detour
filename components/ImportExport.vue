<script lang="ts" setup>
import { ref } from 'vue';
import { useProxyState } from '@/composables/useProxyState';
import type { ImportSkip } from '@/utils/proxy';

const { exportConfig, importConfig } = useProxyState();
const fileInput = ref<HTMLInputElement | null>(null);
const message = ref('');
const messageOk = ref(false);
const skipped = ref<ImportSkip[]>([]);

function pickFile() {
  message.value = '';
  skipped.value = [];
  fileInput.value?.click();
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  // Clear the value so picking the same file again still fires @change.
  input.value = '';
  if (!file) return;
  try {
    const result = await importConfig(file);
    skipped.value = result.skipped;
    if (result.source === 'switchyomega') {
      message.value = `Imported ${result.state.profiles.length} profiles and ${result.state.rules.length} rules from SwitchyOmega.`;
    } else {
      message.value = 'Configuration imported.';
    }
    messageOk.value = true;
  } catch (err) {
    skipped.value = [];
    message.value = (err as Error)?.message || 'Import failed.';
    messageOk.value = false;
  }
}
</script>

<template>
  <div class="transfer">
    <div class="row">
      <button class="xfer-btn" type="button" @click="exportConfig">Export</button>
      <button class="xfer-btn" type="button" @click="pickFile">Import</button>
      <input
        ref="fileInput"
        class="file"
        type="file"
        accept="application/json,.json,.bak"
        @change="onFile"
      />
    </div>
    <p v-if="message" class="result" :class="messageOk ? 'ok' : 'fail'">{{ message }}</p>
    <div v-if="skipped.length" class="skipped">
      <p class="note warn">
        Skipped {{ skipped.length }} incompatible
        {{ skipped.length === 1 ? 'item' : 'items' }}:
      </p>
      <ul>
        <li v-for="(item, index) in skipped" :key="index">
          <span class="kind">{{ item.kind }}</span>
          {{ item.name }} — {{ item.reason }}
        </li>
      </ul>
    </div>
    <p class="note">
      Saves all profiles, rules, and health settings to a JSON file, passwords included.
      Import accepts Detour backups and SwitchyOmega options JSON.
    </p>
  </div>
</template>

<style scoped>
.transfer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row {
  display: flex;
  gap: 8px;
}

.xfer-btn {
  flex: 1;
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

.xfer-btn:hover {
  border-color: var(--accent);
}

.file {
  display: none;
}

.result {
  margin: 0;
  font-size: 12px;
}

.result.ok {
  color: var(--accent);
}

.result.fail {
  color: var(--warn);
}

.skipped ul {
  margin: 4px 0 0;
  padding: 0 0 0 18px;
  max-height: 160px;
  overflow: auto;
  font-size: 11px;
  line-height: 1.45;
  color: var(--muted);
}

.skipped li {
  margin: 0 0 4px;
}

.kind {
  display: inline-block;
  margin-right: 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--warn);
}
</style>
