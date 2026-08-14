<script lang="ts" setup>
import { useProxyState } from '@/composables/useProxyState';
import { DIRECT_ACTION, isValidHostPattern } from '@/utils/proxy';

const { rules, profiles, addRule, updateRule, deleteRule, moveRule } = useProxyState();

function onMatch(id: string, event: Event) {
  void updateRule(id, { match: (event.target as HTMLInputElement).value.trim() });
}

function onAction(id: string, event: Event) {
  void updateRule(id, { action: (event.target as HTMLSelectElement).value });
}
</script>

<template>
  <div class="rules">
    <p class="note">
      First match wins. Hosts that match none of these use the active profile.
      A chosen profile's bypass list still applies.
    </p>

    <p v-if="!rules.length" class="empty">
      No rules yet. Every host uses the active profile until you add one.
    </p>

    <div v-for="(rule, index) in rules" :key="rule.id" class="rule">
      <label class="field match">
        <span class="label">Match</span>
        <input
          :value="rule.match"
          placeholder="github.com, *.example.com, &lt;private&gt;"
          spellcheck="false"
          @change="onMatch(rule.id, $event)"
        />
      </label>
      <label class="field action">
        <span class="label">Action</span>
        <select :value="rule.action" @change="onAction(rule.id, $event)">
          <option :value="DIRECT_ACTION">Direct</option>
          <option v-for="item in profiles" :key="item.id" :value="item.id">
            {{ item.name }}
          </option>
        </select>
      </label>
      <div class="ops">
        <button
          class="small-btn"
          type="button"
          :disabled="index === 0"
          @click="moveRule(rule.id, -1)"
        >
          Up
        </button>
        <button
          class="small-btn"
          type="button"
          :disabled="index === rules.length - 1"
          @click="moveRule(rule.id, 1)"
        >
          Down
        </button>
        <button class="small-btn danger" type="button" @click="deleteRule(rule.id)">
          Delete
        </button>
      </div>
      <p v-if="rule.match && !isValidHostPattern(rule.match)" class="note warn">
        Use a host, <code>*.domain.tld</code>, CIDR, <code>&lt;local&gt;</code>,
        or <code>&lt;private&gt;</code>.
      </p>
    </div>

    <button class="small-btn add" type="button" @click="addRule">Add rule</button>
  </div>
</template>

<style scoped>
.rules {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.empty {
  margin: 0;
  padding: 14px 12px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
  text-align: center;
  background: var(--input-bg);
  border: 1px dashed var(--border);
  border-radius: 8px;
}

.rule {
  display: grid;
  grid-template-columns: 1fr 132px;
  gap: 6px 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

.rule:last-of-type {
  border-bottom: none;
  padding-bottom: 0;
}

.match input {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.ops {
  grid-column: 1 / -1;
  display: flex;
  gap: 6px;
}

.small-btn {
  padding: 6px 10px;
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

.add {
  align-self: flex-start;
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
