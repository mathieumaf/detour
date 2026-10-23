import { beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULT_STATE, DIRECT_ACTION, STORAGE_KEY, type ProxyProfile, type ProxyState } from '../../utils/proxy';
import { ctx, handledAuth } from './context';
import { applyState, enableProxy } from './engine';
import { startBackground } from './startup';

const work: ProxyProfile = {
  id: 'work',
  name: 'Work',
  scheme: 'http',
  host: 'proxy.work.example',
  port: 8080,
  username: 'work-user',
  password: 'work-pass',
  bypassList: [],
};

const home: ProxyProfile = {
  id: 'home',
  name: 'Home',
  scheme: 'socks5',
  host: 'socks.home.example',
  port: 1080,
  username: 'socks-user',
  password: 'socks-pass',
  bypassList: ['*.internal.example.com'],
};

function enabledState(): ProxyState {
  return {
    ...DEFAULT_STATE,
    enabled: true,
    activeProfileId: home.id,
    profiles: [work, home],
    rules: [
      { id: 'r1', match: 'github.com', action: work.id },
      { id: 'r2', match: '10.0.0.0/8', action: DIRECT_ACTION },
    ],
    healthCheck: { ...DEFAULT_STATE.healthCheck, enabled: false },
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Listener = (...args: any[]) => any;

interface AuthRegistration {
  fn: Listener;
  filter: { urls: string[] };
  extra: string[];
}

interface ProxyRegistration {
  fn: Listener;
  filter: { urls: string[] };
}

function installBrowser(firefox: boolean) {
  const storage = deferred<Record<string, unknown>>();
  const authListeners: AuthRegistration[] = [];
  const proxyListeners: ProxyRegistration[] = [];
  const removedProxyListeners: Listener[] = [];
  const proxySettings: unknown[] = [];

  const chrome = {
    storage: {
      local: {
        get: () => storage.promise,
        set: async () => undefined,
      },
      onChanged: { addListener: () => undefined },
    },
    webRequest: {
      onAuthRequired: {
        addListener: (fn: Listener, filter: { urls: string[] }, extra: string[]) => {
          authListeners.push({ fn, filter, extra });
        },
      },
    },
    alarms: {
      onAlarm: { addListener: () => undefined },
      get: async () => undefined,
      clear: async () => true,
      create: () => undefined,
    },
    action: {
      setBadgeText: () => undefined,
      setBadgeBackgroundColor: () => undefined,
    },
    runtime: { onMessage: { addListener: () => undefined } },
    commands: { onCommand: { addListener: () => undefined } },
    proxy: {
      settings: {
        set: async (value: unknown) => {
          proxySettings.push(value);
        },
        clear: async () => undefined,
      },
    },
  };

  const browser = {
    proxy: {
      onRequest: {
        addListener: (fn: Listener, filter: { urls: string[] }) => {
          proxyListeners.push({ fn, filter });
        },
        removeListener: (fn: Listener) => {
          removedProxyListeners.push(fn);
          const index = proxyListeners.findIndex((entry) => entry.fn === fn);
          if (index >= 0) proxyListeners.splice(index, 1);
        },
      },
    },
  };

  (globalThis as any).chrome = chrome;
  (globalThis as any).browser = browser;

  const ready = startBackground({ firefox });
  return { storage, authListeners, proxyListeners, removedProxyListeners, proxySettings, ready };
}

function authDetails(url: string, requestId = 'req-1', isProxy = true) {
  return { url, requestId, isProxy };
}

// True once `result` settles. A synchronous return value counts as already settled
// so a handler that answers before storage loads fails the cold-start assertion.
function track(result: unknown) {
  if (!result || typeof (result as Promise<unknown>).then !== 'function') {
    return { settled: () => true, promise: Promise.resolve(result) };
  }
  let settled = false;
  const promise = (result as Promise<unknown>).then((value) => {
    settled = true;
    return value;
  });
  return { settled: () => settled, promise };
}

async function stillPending(observed: { settled: () => boolean }) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(observed.settled()).toBe(false);
}

beforeEach(() => {
  ctx.state = null;
  ctx.testProfile = null;
  ctx.userToggleVersion = 0;
  handledAuth.clear();
});

describe('cold start', () => {
  test('Firefox proxies the request that arrives before storage loads', async () => {
    const { storage, proxyListeners, removedProxyListeners, authListeners, ready } =
      installBrowser(true);

    expect(proxyListeners).toHaveLength(1);
    expect(proxyListeners[0]?.filter).toEqual({ urls: ['<all_urls>'] });
    expect(authListeners[0]?.extra).toEqual(['blocking']);
    expect(removedProxyListeners).toHaveLength(0);

    const waking = track(proxyListeners[0]?.fn({ url: 'https://example.com/secret' }));
    const ruled = track(proxyListeners[0]?.fn({ url: 'https://github.com/detour' }));
    const directRule = track(proxyListeners[0]?.fn({ url: 'https://10.2.3.4/admin' }));
    const bypassed = track(proxyListeners[0]?.fn({ url: 'https://a.internal.example.com/' }));
    const auth = track(
      authListeners[0]?.fn(authDetails('https://github.com/detour', 'auth-1')),
    );

    await stillPending(waking);
    await stillPending(ruled);
    await stillPending(directRule);
    await stillPending(bypassed);
    await stillPending(auth);

    storage.resolve({ [STORAGE_KEY]: enabledState() });

    expect(await waking.promise).toEqual({
      type: 'socks',
      host: 'socks.home.example',
      port: 1080,
      username: 'socks-user',
      password: 'socks-pass',
      proxyDNS: true,
    });
    expect(await ruled.promise).toEqual({
      type: 'http',
      host: 'proxy.work.example',
      port: 8080,
      username: 'work-user',
      password: 'work-pass',
    });
    expect(await directRule.promise).toEqual({ type: 'direct' });
    expect(await bypassed.promise).toEqual({ type: 'direct' });
    expect(await auth.promise).toEqual({
      authCredentials: { username: 'work-user', password: 'work-pass' },
    });
    // Wrong credentials must not be retried forever. The second challenge for
    // the same request cancels instead of prompting.
    expect(await authListeners[0]?.fn(authDetails('https://github.com/detour', 'auth-1'))).toEqual({
      cancel: true,
    });
    expect(removedProxyListeners).toHaveLength(0);
    expect(proxyListeners).toHaveLength(1);
    await ready;
  });

  test('Firefox releases control when the loaded state is off', async () => {
    const { storage, proxyListeners, removedProxyListeners, authListeners, ready } =
      installBrowser(true);
    const waking = track(proxyListeners[0]?.fn({ url: 'https://example.com/' }));
    const auth = track(authListeners[0]?.fn(authDetails('https://example.com/', 'off-1')));
    await stillPending(waking);

    storage.resolve({
      [STORAGE_KEY]: { ...enabledState(), enabled: false },
    });

    // undefined — not { type: 'direct' } — lets Firefox keep the user's own proxy.
    expect(await waking.promise).toBeUndefined();
    expect(await auth.promise).toEqual({});
    expect(removedProxyListeners).toHaveLength(1);
    expect(proxyListeners).toHaveLength(0);
    await ready;

    // A connection test while Detour is off must install a listener again.
    // The saved "off" state is restored afterwards and releases that listener.
    await enableProxy(work);
    expect(proxyListeners).toHaveLength(1);
    await expect(proxyListeners[0]?.fn({ url: 'https://example.com/' })).resolves.toEqual({
      type: 'http',
      host: 'proxy.work.example',
      port: 8080,
      username: 'work-user',
      password: 'work-pass',
    });
    await applyState({ ...enabledState(), enabled: false });
    expect(proxyListeners).toHaveLength(0);
  });

  test('Firefox does not answer a held request with a proxy when storage fails', async () => {
    const { storage, proxyListeners, ready } = installBrowser(true);
    const waking = track(proxyListeners[0]?.fn({ url: 'https://example.com/' }));
    await stillPending(waking);

    storage.reject(new Error('storage unavailable'));

    const failed = expect(ready).rejects.toThrow('storage unavailable');
    expect(await waking.promise).toBeUndefined();
    await failed;
    expect(proxyListeners).toHaveLength(0);
  });

  test('Firefox connection test overrides the saved route without a listener gap', async () => {
    const { storage, proxyListeners, ready } = installBrowser(true);
    storage.resolve({ [STORAGE_KEY]: enabledState() });
    await ready;

    const listener = proxyListeners[0]?.fn;
    expect(typeof listener).toBe('function');
    await expect(listener!({ url: 'https://example.com/' })).resolves.toMatchObject({
      host: 'socks.home.example',
    });

    const trial: ProxyProfile = {
      ...work,
      host: 'trial.example',
      port: 9090,
      username: 'trial-user',
      password: 'trial-pass',
      bypassList: ['skip.example'],
    };
    await enableProxy(trial);
    // Same listener that was registered at startup. Swapping it out would drop
    // a request that was already inside onRequest.
    expect(proxyListeners.map((entry) => entry.fn)).toEqual([listener]);
    await expect(listener!({ url: 'https://example.com/' })).resolves.toEqual({
      type: 'http',
      host: 'trial.example',
      port: 9090,
      username: 'trial-user',
      password: 'trial-pass',
    });
    await expect(listener!({ url: 'https://skip.example/x' })).resolves.toEqual({
      type: 'direct',
    });

    await applyState(enabledState());
    await expect(listener!({ url: 'https://example.com/' })).resolves.toMatchObject({
      host: 'socks.home.example',
      proxyDNS: true,
    });
  });

  test('Chromium supplies stored proxy credentials when auth wakes a cold worker', async () => {
    const { storage, authListeners, proxyListeners, proxySettings, ready } = installBrowser(false);

    expect(proxyListeners).toHaveLength(0);
    expect(authListeners).toHaveLength(1);
    expect(authListeners[0]?.extra).toEqual(['asyncBlocking']);
    expect(authListeners[0]?.filter).toEqual({ urls: ['<all_urls>'] });

    const callbacks: unknown[] = [];
    authListeners[0]?.fn(authDetails('https://github.com/detour', 'cr-1'), (result: unknown) => {
      callbacks.push(result);
    });
    authListeners[0]?.fn(authDetails('https://github.com/detour', 'cr-1', false), (result: unknown) => {
      callbacks.push(result);
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callbacks).toEqual([]);
    expect(proxySettings).toHaveLength(0);

    storage.resolve({ [STORAGE_KEY]: enabledState() });

    await ready;
    expect(callbacks[0]).toEqual({
      authCredentials: { username: 'work-user', password: 'work-pass' },
    });
    // A website's own 401 is not a proxy challenge and must not receive the proxy password.
    expect(callbacks[1]).toEqual({});
    expect(proxySettings).toHaveLength(1);
    // Same request id was already answered, so a repeat cancels instead of looping.
    const repeat: unknown[] = [];
    authListeners[0]?.fn(authDetails('https://github.com/detour', 'cr-1'), (result: unknown) => {
      repeat.push(result);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repeat).toEqual([{ cancel: true }]);
  });
});
