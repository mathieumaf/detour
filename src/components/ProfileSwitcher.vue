<script lang="ts" setup>
import { useProxyState } from '@/composables/useProxyState';

const {
  activeProfileId,
  profiles,
  profile,
  save,
  selectProfile,
  createProfile,
  duplicateProfile,
  deleteProfile,
} = useProxyState();

function onSelect(event: Event) {
  void selectProfile((event.target as HTMLSelectElement).value);
}
</script>

<template>
  <div class="profiles">
    <div class="picker">
      <label class="field select-field">
        <span class="label">Active profile</span>
        <select :value="activeProfileId" @change="onSelect">
          <option v-for="item in profiles" :key="item.id" :value="item.id">
            {{ item.name }}
          </option>
        </select>
      </label>
      <button class="small-btn" type="button" @click="createProfile">New</button>
    </div>

    <label class="field">
      <span class="label">Profile name</span>
      <input v-model.trim="profile.name" maxlength="80" @change="save" />
    </label>

    <div class="actions">
      <button class="small-btn" type="button" @click="duplicateProfile">Duplicate</button>
      <button
        class="small-btn danger"
        type="button"
        :disabled="profiles.length === 1"
        @click="deleteProfile"
      >
        Delete
      </button>
    </div>
  </div>
</template>

<style scoped>
.profiles {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.picker,
.actions {
  display: flex;
  gap: 8px;
  align-items: end;
}

.select-field {
  flex: 1;
}

.small-btn {
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

.small-btn:hover:not(:disabled) {
  border-color: var(--accent);
}

.small-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.danger:hover:not(:disabled) {
  border-color: var(--warn);
  color: var(--warn);
}
</style>
