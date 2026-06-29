<script lang="ts" setup>
import { useProxyState } from '@/composables/useProxyState';

const { valid, testing, testResult, runTest } = useProxyState();
</script>

<template>
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
</template>

<style scoped>
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
