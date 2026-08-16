import {
  HEALTH_ALARM,
  healthAlarmPeriodMinutes,
  runHealthCheck,
  saveState,
  type ProxyState,
} from '@/utils/proxy';
import { ctx } from './context';
import { testProxy } from './test';

let checkRunning = false;

export async function syncHealthAlarm(state: ProxyState): Promise<void> {
  const periodInMinutes = healthAlarmPeriodMinutes(state);
  if (periodInMinutes === null) {
    await chrome.alarms.clear(HEALTH_ALARM);
    return;
  }

  const current = await chrome.alarms.get(HEALTH_ALARM);
  if (current?.periodInMinutes === periodInMinutes) return;
  chrome.alarms.create(HEALTH_ALARM, { periodInMinutes });
}

export function registerHealthAlarm(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === HEALTH_ALARM) void checkHealth();
  });
}

async function checkHealth(): Promise<void> {
  const initial = ctx.state;
  if (!initial || checkRunning) return;

  checkRunning = true;
  try {
    const next = await runHealthCheck(initial, {
      probe: testProxy,
      getCurrentState: () => ctx.state,
    });
    if (!next) return;

    // Update the in-memory source of truth before storage listeners run. The
    // storage change then follows the same applyState path as a manual change.
    ctx.state = next;
    await saveState(next);
  } finally {
    checkRunning = false;
  }
}
