// The state the popup and the settings page share, on a fake browser.

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  DEFAULT_STATE,
  DIRECT_ACTION,
  STORAGE_KEY,
  buildExport,
  type ProxyProfile,
  type ProxyState,
} from '../core';
import {
  installFakeBrowser,
  settle,
  type FakeBrowser,
} from '../entrypoints/background/fake-browser';
import type * as PageState from './useProxyState';

const office: ProxyProfile = {
  id: 'office',
  name: 'Office',
  scheme: 'http',
  host: 'office.example',
  port: 8080,
  username: '',
  password: '',
  bypassList: [],
};
const backup: ProxyProfile = { ...office, id: 'backup', name: 'Backup', host: 'backup.example' };

function initial(): ProxyState {
  return { ...DEFAULT_STATE, activeProfileId: office.id, profiles: [office, backup] };
}

let fake: FakeBrowser;

// The composable keeps one state per page and subscribes to storage when it
// is first imported. A fresh import per test gives each test its own page.
let pageNumber = 0;
async function openPage() {
  pageNumber += 1;
  const module = (await import(`./useProxyState.ts?page=${pageNumber}`)) as typeof PageState;
  const page = module.useProxyState();
  await page.load();
  return page;
}

function stored(): ProxyState {
  return fake.stored[STORAGE_KEY] as ProxyState;
}

beforeEach(() => {
  fake = installFakeBrowser({ state: initial(), deferChanges: true });
});

describe('useProxyState', () => {
  test('loads the stored state into the page', async () => {
    const page = await openPage();
    expect(page.profile.name).toBe('Office');
    expect(page.profiles.value.map((item) => item.id)).toEqual(['office', 'backup']);
    expect(page.valid.value).toBe(true);
  });

  test('keeps every edit when several are saved before storage reports the first', async () => {
    const page = await openPage();

    // Three edits in a row, as when tabbing through the health settings. The
    // storage events for the earlier saves arrive after the later edits.
    page.healthCheck.enabled = true;
    await page.updateHealthCheck();
    page.healthCheck.intervalSeconds = 120;
    await page.updateHealthCheck();
    page.healthCheck.failureThreshold = 4;
    await page.updateHealthCheck();
    fake.deliverChanges();
    await settle();

    page.healthCheck.fallbackProfileId = 'backup';
    await page.updateHealthCheck();
    fake.deliverChanges();
    await settle();

    const expected = {
      enabled: true,
      intervalSeconds: 120,
      failureThreshold: 4,
      fallbackProfileId: 'backup',
    };
    expect({ ...page.healthCheck }).toEqual(expected);
    expect(stored().healthCheck).toEqual(expected);
  });

  test('shows a change made somewhere else', async () => {
    const page = await openPage();
    await chrome.storage.local.set({ [STORAGE_KEY]: { ...initial(), activeProfileId: 'backup' } });
    fake.deliverChanges();
    await settle();
    expect(page.activeProfileId.value).toBe('backup');
    expect(page.profile.host).toBe('backup.example');
  });

  test('deleting a profile drops its rules and its role as fallback', async () => {
    fake.stored[STORAGE_KEY] = {
      ...initial(),
      activeProfileId: 'backup',
      rules: [
        { id: 'a', match: 'a.example', action: 'backup' },
        { id: 'b', match: 'b.example', action: 'office' },
      ],
      healthCheck: { ...DEFAULT_STATE.healthCheck, fallbackProfileId: 'backup' },
    };
    const page = await openPage();

    await page.deleteProfile();

    expect(stored().profiles.map((item) => item.id)).toEqual(['office']);
    expect(stored().rules).toEqual([{ id: 'b', match: 'b.example', action: 'office' }]);
    expect(stored().healthCheck.fallbackProfileId).toBe('direct');
    expect(stored().activeProfileId).toBe('office');
  });

  test('never deletes the last profile', async () => {
    fake.stored[STORAGE_KEY] = { ...initial(), profiles: [office] };
    const page = await openPage();
    await page.deleteProfile();
    expect(page.profiles.value).toHaveLength(1);
  });

  test('switches Detour off when the selected profile has no server', async () => {
    fake.stored[STORAGE_KEY] = {
      ...initial(),
      enabled: true,
      profiles: [office, { ...backup, host: '' }],
    };
    const page = await openPage();
    await page.selectProfile('backup');
    expect(stored().activeProfileId).toBe('backup');
    expect(stored().enabled).toBe(false);
  });

  test('saves an edited server, with a trimmed name and a parsed bypass list', async () => {
    const page = await openPage();
    page.profile.name = '   ';
    page.profile.host = 'new.example';
    page.profile.port = 3128;
    page.bypassText.value = '<local>\n*.corp.example, <local>';
    await page.save();

    expect(stored().profiles[0]).toMatchObject({
      name: 'Default profile',
      host: 'new.example',
      port: 3128,
      bypassList: ['<local>', '*.corp.example'],
    });
  });

  test('switches Detour off when a save leaves the active profile without a server', async () => {
    fake.stored[STORAGE_KEY] = { ...initial(), enabled: true };
    const page = await openPage();
    page.profile.host = '';
    await page.save();
    expect(stored().enabled).toBe(false);
  });

  test('creates a blank profile, selects it, and switches Detour off', async () => {
    fake.stored[STORAGE_KEY] = { ...initial(), enabled: true };
    const page = await openPage();

    await page.createProfile();
    expect(stored().profiles.map((item) => item.name)).toEqual(['Office', 'Backup', 'New profile']);
    expect(stored().activeProfileId).toBe(stored().profiles[2]!.id);
    expect(page.profile.name).toBe('New profile');
    // A new profile has no server yet, so it cannot stay switched on.
    expect(stored().enabled).toBe(false);

    await page.createProfile();
    expect(stored().profiles[3]?.name).toBe('New profile 2');
    expect(new Set(stored().profiles.map((item) => item.id)).size).toBe(4);
  });

  test('duplicates the selected profile under a new name and id', async () => {
    const page = await openPage();
    await page.duplicateProfile();
    const copy = stored().profiles[2]!;
    expect(copy).toMatchObject({ name: 'Office copy', host: 'office.example', port: 8080 });
    expect(copy.id).not.toBe('office');
    expect(stored().activeProfileId).toBe(copy.id);
  });

  test('adds, edits, reorders, and deletes rules', async () => {
    const page = await openPage();

    await page.addRule();
    await page.addRule();
    const [first, second] = stored().rules;
    expect(first).toMatchObject({ match: '', action: DIRECT_ACTION });

    await page.updateRule(first!.id, { match: 'a.example' });
    await page.updateRule(second!.id, { match: 'b.example', action: 'backup' });
    expect(stored().rules.map((rule) => `${rule.match}>${rule.action}`)).toEqual([
      'a.example>direct',
      'b.example>backup',
    ]);

    await page.moveRule(second!.id, -1);
    expect(stored().rules.map((rule) => rule.match)).toEqual(['b.example', 'a.example']);
    // Already first: nothing to move.
    await page.moveRule(second!.id, -1);
    await page.moveRule('missing', 1);
    expect(stored().rules.map((rule) => rule.match)).toEqual(['b.example', 'a.example']);

    await page.deleteRule(second!.id);
    expect(stored().rules.map((rule) => rule.match)).toEqual(['a.example']);
  });

  test('asks the background to switch the proxy, and shows the result at once', async () => {
    const page = await openPage();
    await page.toggle();
    expect(page.enabled.value).toBe(true);
    expect(fake.sentMessages).toEqual([{ type: 'set-proxy-enabled', enabled: true }]);

    await page.toggle();
    expect(page.enabled.value).toBe(false);
    expect(fake.sentMessages.at(-1)).toEqual({ type: 'set-proxy-enabled', enabled: false });
  });

  test('puts the toggle back when the background cannot be reached', async () => {
    const page = await openPage();
    fake.messageReply = new Error('no background');
    await expect(page.toggle()).rejects.toThrow('no background');
    expect(page.enabled.value).toBe(false);
  });

  test('does not switch on a profile with no server', async () => {
    fake.stored[STORAGE_KEY] = { ...initial(), profiles: [{ ...office, host: '' }] };
    const page = await openPage();
    await page.toggle();
    expect(page.enabled.value).toBe(false);
    expect(fake.sentMessages).toEqual([]);
  });

  test('tests the profile as edited on screen, and reports the answer', async () => {
    const page = await openPage();
    page.profile.host = 'edited.example';
    fake.messageReply = { ok: true, ip: '203.0.113.7', ms: 12 };

    await page.runTest();
    expect(page.testResult.value).toEqual({ ok: true, ip: '203.0.113.7', ms: 12 });
    expect(page.testing.value).toBe(false);
    expect(fake.sentMessages).toEqual([
      { type: 'test-proxy', profile: { ...office, host: 'edited.example' } },
    ]);

    fake.messageReply = new Error('no background');
    await page.runTest();
    expect(page.testResult.value).toEqual({ ok: false, error: 'no background' });
  });

  test('imports a backup, replacing what was there', async () => {
    const page = await openPage();
    const backupFile = buildExport({
      ...initial(),
      enabled: true,
      activeProfileId: 'only',
      profiles: [{ ...office, id: 'only', name: 'Imported' }],
      rules: [{ id: 'r', match: 'a.example', action: DIRECT_ACTION }],
    });

    const result = await page.importConfig(new File([backupFile], 'detour-config.json'));
    expect(result.source).toBe('detour');
    expect(stored().profiles.map((item) => item.name)).toEqual(['Imported']);
    expect(stored().rules).toHaveLength(1);
    expect(stored().enabled).toBe(true);
    expect(page.profile.name).toBe('Imported');
  });

  test('leaves the configuration alone when a file cannot be imported', async () => {
    const page = await openPage();
    const before = stored();
    await expect(page.importConfig(new File(['not json'], 'notes.txt'))).rejects.toThrow(
      'Not a valid JSON file.',
    );
    expect(stored()).toEqual(before);
  });

  test('exports the configuration as a downloadable Detour backup', async () => {
    const page = await openPage();
    const anchor = { href: '', download: '', clicked: 0, click: () => (anchor.clicked += 1) };
    const blobs: Blob[] = [];
    const scope = globalThis as unknown as { document?: unknown };
    const createObjectURL = URL.createObjectURL.bind(URL);
    scope.document = { createElement: () => anchor };
    URL.createObjectURL = (blob: Blob) => {
      blobs.push(blob);
      return createObjectURL(blob);
    };
    try {
      page.exportConfig();
    } finally {
      delete scope.document;
      URL.createObjectURL = createObjectURL;
    }

    expect(anchor.clicked).toBe(1);
    expect(anchor.download).toBe('detour-config.json');
    const file = JSON.parse(await blobs[0]!.text()) as { app: string; state: ProxyState };
    expect(file.app).toBe('detour');
    expect(file.state.profiles.map((item) => item.name)).toEqual(['Office', 'Backup']);
  });

  test('warns when something else controls the proxy settings', async () => {
    fake.levelOfControl = 'controlled_by_other_extensions';
    const taken = await openPage();
    expect(taken.controlWarning.value).toBe('Another extension is controlling the proxy settings.');

    fake.levelOfControl = 'not_controllable';
    const locked = await openPage();
    expect(locked.controlWarning.value).toBe(
      'Proxy settings are locked by your system or organization.',
    );

    fake.levelOfControl = 'controllable_by_this_extension';
    const free = await openPage();
    expect(free.controlWarning.value).toBe('');
  });

  test('offers SOCKS credentials only where the browser can use them', async () => {
    const page = await openPage();
    expect(page.supportsAuth.value).toBe(true);
    page.profile.scheme = 'socks5';
    // The unit tests run as a Chromium build.
    expect(page.supportsAuth.value).toBe(false);
  });
});
