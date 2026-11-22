import { HEALTH_ALARM, healthAlarmPeriodMinutes, runHealthCheck, type ProxyState } from '@/core';
import { loadState, saveState } from '@/utils/storage';
import { ctx } from './context';
import { testProxy } from './connection-test';

let checkRunning = false;

export async function syncHealthAlarm(state: ProxyState): Promise<void> {
  const periodInMinutes = healthAlarmPeriodMinutes(state);
  if (periodInMinutes === null) {
    await chrome.alarms.clear(HEALTH_ALARM);
    return;
  }

  const current = await chrome.alarms.get(HEALTH_ALARM);
  if (current?.periodInMinutes === periodInMinutes) return;
  await chrome.alarms.create(HEALTH_ALARM, { periodInMinutes });
}

export function registerHealthAlarm(ready: Promise<unknown>): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === HEALTH_ALARM) void ready.then(checkHealth);
  });
}

async function checkHealth(): Promise<void> {
  const initial = ctx.state;
  if (!initial || checkRunning) return;
  const toggleVersion = ctx.userToggleVersion;

  checkRunning = true;
  try {
    const next = await runHealthCheck(initial, {
      probe: testProxy,
      // Re-read the persisted state after each asynchronous probe. The storage
      // listener also updates ctx synchronously, covering an Off that races the
      // final read.
      getCurrentState: loadState,
    });
    if (!next) return;

    const persisted = await loadState();
    if (toggleVersion !== ctx.userToggleVersion) return;
    if (next.enabled && (!ctx.state?.enabled || !persisted.enabled)) return;

    // Update the in-memory source of truth before storage listeners run. The
    // storage change then follows the same applyState path as a manual change.
    ctx.state = next;
    await saveState(next);
  } finally {
    checkRunning = false;
  }
}
