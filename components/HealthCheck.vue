<script lang="ts" setup>
import { useProxyState } from '@/composables/useProxyState';
import {
  DIRECT_ACTION,
  HEALTH_MAX_FAILURE_THRESHOLD,
  HEALTH_MAX_INTERVAL_SECONDS,
  HEALTH_MIN_FAILURE_THRESHOLD,
  HEALTH_MIN_INTERVAL_SECONDS,
} from '@/utils/proxy';

const {
  activeProfileId,
  profiles,
  healthCheck,
  updateHealthCheck,
} = useProxyState();
</script>

<template>
  <div class="health">
    <label class="toggle-row">
      <input
        v-model="healthCheck.enabled"
        class="checkbox"
        type="checkbox"
        @change="updateHealthCheck"
      />
      <span>Health check while active</span>
    </label>

    <div v-if="healthCheck.enabled" class="settings-grid">
      <label class="field">
        <span class="label">Interval (seconds)</span>
        <input
          v-model.number="healthCheck.intervalSeconds"
          type="number"
          :min="HEALTH_MIN_INTERVAL_SECONDS"
          :max="HEALTH_MAX_INTERVAL_SECONDS"
          step="30"
          @change="updateHealthCheck"
        />
      </label>
      <label class="field">
        <span class="label">Failures before fallback</span>
        <input
          v-model.number="healthCheck.failureThreshold"
          type="number"
          :min="HEALTH_MIN_FAILURE_THRESHOLD"
          :max="HEALTH_MAX_FAILURE_THRESHOLD"
          @change="updateHealthCheck"
        />
      </label>
      <label class="field fallback">
        <span class="label">Fallback</span>
        <select
          v-model="healthCheck.fallbackProfileId"
          @change="updateHealthCheck"
        >
          <option :value="DIRECT_ACTION">Direct</option>
          <option
            v-for="item in profiles"
            :key="item.id"
            :value="item.id"
            :disabled="item.id === activeProfileId"
          >
            {{ item.name }}{{ item.id === activeProfileId ? ' (active)' : '' }}
          </option>
        </select>
      </label>
    </div>

    <p class="note">
      Checks the active profile only while Detour is on. After repeated failures,
      a healthy fallback is selected; otherwise Detour switches to Direct.
    </p>
  </div>
</template>

<style scoped>
.health {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.checkbox {
  width: 16px;
  height: 16px;
  padding: 0;
  accent-color: var(--accent);
}

.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.fallback {
  grid-column: 1 / -1;
}
</style>
