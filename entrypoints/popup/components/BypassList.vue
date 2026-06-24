<script lang="ts" setup>
import { useProxyState } from '../composables/useProxyState';

const { bypassText, save } = useProxyState();
</script>

<template>
  <div class="bypass-list">
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
  </div>
</template>

<style scoped>
.bypass-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

textarea.bypass {
  resize: vertical;
  min-height: 56px;
  line-height: 1.45;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.note code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--card);
  border: 1px solid var(--border);
}
</style>
