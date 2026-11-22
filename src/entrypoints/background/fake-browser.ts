// An in-memory stand-in for the browser APIs the background uses, for unit
// tests. It keeps real storage semantics (values are copied, changes notify
// listeners) and records what the background asked the browser to do.
//
// Not imported by the extension.

import { STORAGE_KEY } from '@/core';

type Listener = (...args: any[]) => any;

export interface AuthRegistration {
  fn: Listener;
  filter: { urls: string[] };
  extra: string[];
}

export interface ProxyRegistration {
  fn: Listener;
  filter: { urls: string[] };
}

export interface FakeAlarm {
  name: string;
  periodInMinutes?: number;
}

export interface FakeBrowser {
  // What chrome.storage.local holds.
  stored: Record<string, unknown>;
  // With `holdStorage`, the first read stays pending until one of these is
  // called. That is the window a cold start has to survive.
  releaseStorage(): void;
  failStorage(error: unknown): void;

  authListeners: AuthRegistration[];
  // Firefox proxy.onRequest listeners currently registered, and those removed.
  proxyListeners: ProxyRegistration[];
  removedProxyListeners: Listener[];
  // Every chrome.proxy.settings.set() value, oldest first. `null` is a clear().
  proxySettings: unknown[];
  alarms: Map<string, FakeAlarm>;
  badge: string;
  // What chrome.proxy.settings.get reports about who controls the proxy.
  levelOfControl: string;
  // Messages sent with chrome.runtime.sendMessage, and the reply to give when
  // no listener answers. Set `messageReply` to an Error to make the send fail.
  sentMessages: unknown[];
  messageReply: unknown;

  // With `deferChanges`, storage change events wait here until delivered.
  deliverChanges(): void;

  // Deliver events the way the browser would.
  sendMessage(message: unknown): Promise<unknown>;
  fireAlarm(name: string): void;
  fireCommand(name: string): void;
}

export interface FakeBrowserOptions {
  // The stored proxy state, if any.
  state?: unknown;
  holdStorage?: boolean;
  // Hold storage change events until `deliverChanges()`. A real browser
  // delivers them some time after the write, not during it.
  deferChanges?: boolean;
}

function copy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export function installFakeBrowser(options: FakeBrowserOptions = {}): FakeBrowser {
  const stored: Record<string, unknown> = {};
  if (options.state !== undefined) stored[STORAGE_KEY] = copy(options.state);

  let openGate!: () => void;
  let failGate!: (error: unknown) => void;
  const gate: Promise<void> = options.holdStorage
    ? new Promise<void>((resolve, reject) => {
        openGate = resolve;
        failGate = reject;
      })
    : Promise.resolve();
  // A held read that fails is the test's point, not an unhandled rejection.
  gate.catch(() => undefined);

  const changeListeners: Listener[] = [];
  const deferredChanges: (() => void)[] = [];
  const messageListeners: Listener[] = [];
  const alarmListeners: Listener[] = [];
  const commandListeners: Listener[] = [];

  const fake: FakeBrowser = {
    stored,
    releaseStorage: () => openGate?.(),
    failStorage: (error) => failGate?.(error),
    authListeners: [],
    proxyListeners: [],
    removedProxyListeners: [],
    proxySettings: [],
    alarms: new Map(),
    badge: '',
    levelOfControl: 'controllable_by_this_extension',
    sentMessages: [],
    messageReply: undefined,

    deliverChanges() {
      for (const deliver of deferredChanges.splice(0)) deliver();
    },
    sendMessage(message) {
      return new Promise((resolve) => {
        const handled = messageListeners.some(
          (listener) => listener(copy(message), {}, resolve) === true,
        );
        if (!handled) resolve(undefined);
      });
    },
    fireAlarm(name) {
      for (const listener of alarmListeners) listener({ name });
    },
    fireCommand(name) {
      for (const listener of commandListeners) listener(name);
    },
  };

  const chrome = {
    storage: {
      local: {
        async get(key: string) {
          await gate;
          return key in stored ? { [key]: copy(stored[key]) } : {};
        },
        async set(items: Record<string, unknown>) {
          const changes: Record<string, { oldValue: unknown; newValue: unknown }> = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: copy(stored[key]), newValue: copy(value) };
            stored[key] = copy(value);
          }
          const deliver = () => {
            for (const listener of changeListeners) listener(changes, 'local');
          };
          if (options.deferChanges) deferredChanges.push(deliver);
          else deliver();
        },
      },
      onChanged: { addListener: (fn: Listener) => changeListeners.push(fn) },
    },
    webRequest: {
      onAuthRequired: {
        addListener: (fn: Listener, filter: { urls: string[] }, extra: string[]) => {
          fake.authListeners.push({ fn, filter, extra });
        },
      },
    },
    alarms: {
      onAlarm: { addListener: (fn: Listener) => alarmListeners.push(fn) },
      get: async (name: string) => fake.alarms.get(name),
      clear: async (name: string) => fake.alarms.delete(name),
      create: async (name: string, info: { periodInMinutes?: number }) => {
        fake.alarms.set(name, { name, ...info });
      },
    },
    action: {
      setBadgeText: async ({ text }: { text: string }) => {
        fake.badge = text;
      },
      setBadgeBackgroundColor: async () => undefined,
    },
    runtime: {
      onMessage: { addListener: (fn: Listener) => messageListeners.push(fn) },
      sendMessage: async (message: unknown) => {
        fake.sentMessages.push(copy(message));
        if (fake.messageReply instanceof Error) throw fake.messageReply;
        return messageListeners.length > 0 ? fake.sendMessage(message) : fake.messageReply;
      },
    },
    commands: { onCommand: { addListener: (fn: Listener) => commandListeners.push(fn) } },
    proxy: {
      settings: {
        set: async (details: unknown) => {
          fake.proxySettings.push(details);
        },
        clear: async () => {
          fake.proxySettings.push(null);
        },
        get: async () => ({ levelOfControl: fake.levelOfControl }),
      },
    },
  };

  const browser = {
    proxy: {
      onRequest: {
        addListener: (fn: Listener, filter: { urls: string[] }) => {
          fake.proxyListeners.push({ fn, filter });
        },
        removeListener: (fn: Listener) => {
          fake.removedProxyListeners.push(fn);
          const index = fake.proxyListeners.findIndex((entry) => entry.fn === fn);
          if (index >= 0) fake.proxyListeners.splice(index, 1);
        },
      },
    },
  };

  const scope = globalThis as unknown as { chrome: unknown; browser: unknown };
  scope.chrome = chrome;
  scope.browser = browser;
  return fake;
}

// Let pending promise callbacks and zero-delay timers run.
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
