<script lang="ts" setup>
import { useProxyState } from '@/composables/useProxyState';
import type { ProxyScheme } from '@/utils/proxy';

const SCHEMES: { value: ProxyScheme; label: string }[] = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
  { value: 'socks4', label: 'SOCKS4' },
  { value: 'socks5', label: 'SOCKS5' },
];

const { profile, supportsAuth, save } = useProxyState();
</script>

<template>
  <div class="proxy-form">
    <label class="field">
      <span class="label">Type</span>
      <select v-model="profile.scheme" @change="save">
        <option v-for="s in SCHEMES" :key="s.value" :value="s.value">
          {{ s.label }}
        </option>
      </select>
    </label>

    <div class="row">
      <label class="field host">
        <span class="label">Host</span>
        <input
          v-model.trim="profile.host"
          placeholder="127.0.0.1"
          spellcheck="false"
          @change="save"
        />
      </label>
      <label class="field port">
        <span class="label">Port</span>
        <input
          v-model.number="profile.port"
          type="number"
          min="1"
          max="65535"
          @change="save"
        />
      </label>
    </div>

    <label class="field">
      <span class="label">Username <em>(optional)</em></span>
      <input
        v-model="profile.username"
        autocomplete="off"
        spellcheck="false"
        :disabled="!supportsAuth"
        @change="save"
      />
    </label>

    <label class="field">
      <span class="label">Password <em>(optional)</em></span>
      <input
        v-model="profile.password"
        type="password"
        autocomplete="off"
        :disabled="!supportsAuth"
        @change="save"
      />
    </label>

    <p v-if="!supportsAuth" class="note">
      Chrome can't authenticate SOCKS proxies — username and password are
      ignored for SOCKS.
    </p>
  </div>
</template>

<style scoped>
.proxy-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.row {
  display: flex;
  gap: 10px;
}

.host {
  flex: 1 1 auto;
}

.port {
  width: 84px;
  flex: 0 0 auto;
}
</style>
