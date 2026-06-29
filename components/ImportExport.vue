<script lang="ts" setup>
import { ref } from 'vue';
import { useProxyState } from '@/composables/useProxyState';

const { exportConfig, importConfig } = useProxyState();
const fileInput = ref<HTMLInputElement | null>(null);
const message = ref('');
const messageOk = ref(false);

function pickFile() {
  message.value = '';
  fileInput.value?.click();
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  // Clear the value so picking the same file again still fires @change.
  input.value = '';
  if (!file) return;
  try {
    await importConfig(file);
    message.value = 'Configuration imported.';
    messageOk.value = true;
  } catch (err) {
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
        accept="application/json,.json"
        @change="onFile"
      />
    </div>
    <p v-if="message" class="result" :class="messageOk ? 'ok' : 'fail'">{{ message }}</p>
    <p class="note">Saves your proxy config to a JSON file, password included.</p>
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
</style>
