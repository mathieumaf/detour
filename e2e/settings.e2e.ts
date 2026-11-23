// The popup and the settings page, driven like a user would. Each test starts
// from a state it writes itself, clicks and types through the real pages, and
// then checks what was stored and, where it matters, where traffic went.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'puppeteer';
import { buildExport } from '../src/core/import-export';
import { BROWSER, launchDetour, waitFor, type Detour } from './detour';
import { HOSTS } from './hosts';
import { startServers, type Servers } from './servers';
import { DIRECT_ACTION, profile, state, type ProxyState } from './state';
import { expectTraffic } from './traffic';
import {
  choose,
  chooseFile,
  clickButton,
  field,
  fieldValue,
  fill,
  pageText,
  waitForText,
} from './ui';

let servers: Servers;
let detour: Detour;

beforeAll(async () => {
  servers = await startServers();
  detour = await launchDetour();
});

afterAll(async () => {
  await detour?.close();
  await servers?.close();
});

// One HTTP profile pointing at the test proxy, Detour off.
function configured(extra: Partial<ProxyState> = {}): ProxyState {
  return state({
    profiles: [profile({ name: 'Office', host: '127.0.0.1', port: servers.httpProxy.port })],
    ...extra,
  });
}

// The pages load their state after they mount. Wait for a field to show it
// before typing, or the load would overwrite what the test typed.
async function openSettings(profileName: string): Promise<Page> {
  const page = await detour.openPage('options.html');
  await waitFor(
    `settings to show the "${profileName}" profile`,
    async () => (await fieldValue(page, 'Profile name')) === profileName,
  );
  return page;
}

async function stored(): Promise<ProxyState> {
  const current = await detour.readState();
  if (!current) throw new Error('Nothing is stored yet.');
  return current;
}

async function waitForStored(what: string, check: (current: ProxyState) => boolean): Promise<void> {
  await waitFor(what, async () => check(await stored()));
}

describe(`settings and popup (${BROWSER})`, () => {
  test('a server saved in settings can be switched on and off from the popup', async () => {
    await detour.setState(state({ profiles: [profile({ host: '', port: 8080 })] }));

    const settings = await openSettings('Default profile');
    await fill(settings, 'Port', String(servers.httpProxy.port));
    await fill(settings, 'Host', '127.0.0.1');
    await waitForStored('the server to be saved', (current) => {
      const saved = current.profiles[0];
      return saved?.host === '127.0.0.1' && saved.port === servers.httpProxy.port;
    });

    const popup = await detour.openPage('popup.html');
    await waitForText(popup, `HTTP · 127.0.0.1:${servers.httpProxy.port}`);
    expect(await pageText(popup)).toContain('Direct connection');

    await popup.click('button.switch');
    await waitForText(popup, 'Proxy active');
    await detour.waitForProxy(true);
    await expectTraffic(detour, servers, HOSTS.ui, 'http-proxy');

    await popup.click('button.switch');
    await waitForText(popup, 'Direct connection');
    await detour.waitForProxy(false);
    await expectTraffic(detour, servers, HOSTS.ui, 'direct');

    await settings.close();
    await popup.close();
  });

  test('the popup cannot switch on a profile that has no server', async () => {
    await detour.setState(state({ profiles: [profile({ host: '', port: 8080 })] }));
    const popup = await detour.openPage('popup.html');
    await waitForText(popup, 'Not configured');
    expect(await popup.$eval('button.switch', (button) => button.disabled)).toBe(true);
    await popup.close();
  });

  test('picking another profile in the popup changes where traffic goes', async () => {
    await detour.setState(
      state({
        enabled: true,
        profiles: [
          profile({ id: 'http', name: 'Office', host: '127.0.0.1', port: servers.httpProxy.port }),
          profile({
            id: 'socks',
            name: 'Tunnel',
            scheme: 'socks5',
            host: '127.0.0.1',
            port: servers.socks.port,
          }),
        ],
      }),
    );
    await expectTraffic(detour, servers, HOSTS.ui, 'http-proxy');

    const popup = await detour.openPage('popup.html');
    await waitForText(popup, `HTTP · 127.0.0.1:${servers.httpProxy.port}`);
    await popup.select('select.profile-picker', 'socks');
    await waitForText(popup, `SOCKS5 · 127.0.0.1:${servers.socks.port}`);
    await waitForStored(
      'the Tunnel profile to be active',
      (current) => current.activeProfileId === 'socks',
    );
    await expectTraffic(detour, servers, HOSTS.ui, 'socks');
    await popup.close();
  });

  test('profiles can be created, renamed, duplicated, and deleted', async () => {
    await detour.setState(configured());
    const settings = await openSettings('Office');

    await clickButton(settings, 'New');
    await waitForStored('a second profile', (current) => current.profiles.length === 2);
    expect(await fieldValue(settings, 'Profile name')).toBe('New profile');

    await fill(settings, 'Profile name', 'Home');
    await fill(settings, 'Host', '10.0.0.2');
    await waitForStored('the new profile to be renamed and saved', (current) =>
      current.profiles.some((item) => item.name === 'Home' && item.host === '10.0.0.2'),
    );

    await clickButton(settings, 'Duplicate');
    await waitForStored('a copy of the profile', (current) =>
      current.profiles.some((item) => item.name === 'Home copy' && item.host === '10.0.0.2'),
    );

    // The copy is selected. Deleting it leaves the two others.
    await clickButton(settings, 'Delete');
    await waitForStored('the copy to be deleted', (current) => current.profiles.length === 2);
    expect((await stored()).profiles.map((item) => item.name)).toEqual(['Office', 'Home']);

    await settings.close();
  });

  test('a rule added in settings routes the host it matches', async () => {
    await detour.setState(configured({ enabled: true }));
    const settings = await openSettings('Office');

    await clickButton(settings, 'Add rule');
    await waitForStored('an empty rule', (current) => current.rules.length === 1);
    await fill(settings, 'Match', HOSTS.other);
    await waitForStored(
      'the rule to be saved',
      (current) => current.rules[0]?.match === HOSTS.other,
    );
    expect((await stored()).rules[0]?.action).toBe(DIRECT_ACTION);

    // A new rule defaults to Direct, so this host now skips the proxy.
    await expectTraffic(detour, servers, HOSTS.other, 'direct');
    await expectTraffic(detour, servers, HOSTS.fallback, 'http-proxy');

    // Point the rule at the profile instead, and the host is proxied again.
    await choose(settings, 'Action', 'Office');
    await waitForStored(
      'the rule to use the profile',
      (current) => current.rules[0]?.action === 'default',
    );
    await expectTraffic(detour, servers, HOSTS.other, 'http-proxy');

    await clickButton(settings, 'Delete', 1);
    await waitForStored('the rule to be deleted', (current) => current.rules.length === 0);
    await settings.close();
  });

  test('rules can be reordered, and the first match wins', async () => {
    await detour.setState(
      configured({
        enabled: true,
        rules: [
          { id: 'direct', match: HOSTS.matched, action: DIRECT_ACTION },
          { id: 'proxy', match: HOSTS.matched, action: 'default' },
        ],
      }),
    );
    await expectTraffic(detour, servers, HOSTS.matched, 'direct');

    const settings = await openSettings('Office');
    await clickButton(settings, 'Down');
    await waitForStored('the rules to swap', (current) => current.rules[0]?.id === 'proxy');
    await expectTraffic(detour, servers, HOSTS.matched, 'http-proxy');
    await settings.close();
  });

  test('a host typed into the bypass list connects directly', async () => {
    await detour.setState(configured({ enabled: true }));
    const settings = await openSettings('Office');

    await fill(settings, 'Bypass list', HOSTS.bypass);
    await waitForStored('the bypass list to be saved', (current) =>
      Boolean(current.profiles[0]?.bypassList.includes(HOSTS.bypass)),
    );
    await expectTraffic(detour, servers, HOSTS.bypass, 'direct');
    await expectTraffic(detour, servers, HOSTS.normal, 'http-proxy');
    await settings.close();
  });

  test('health-check settings are saved', async () => {
    await detour.setState(
      state({
        profiles: [
          profile({ id: 'main', name: 'Office', host: '127.0.0.1', port: servers.httpProxy.port }),
          profile({ id: 'backup', name: 'Backup', host: '127.0.0.1', port: servers.socks.port }),
        ],
      }),
    );
    const settings = await openSettings('Office');

    const toggle = await field(settings, 'Health check while active');
    await toggle.click();
    await waitForStored('health checks to be on', (current) => current.healthCheck.enabled);

    await fill(settings, 'Interval', '120');
    await fill(settings, 'Failures before fallback', '4');
    await choose(settings, 'Fallback', 'Backup');
    await waitForStored(
      'the health settings to be saved',
      (current) => current.healthCheck.fallbackProfileId === 'backup',
    );
    expect((await stored()).healthCheck).toEqual({
      enabled: true,
      intervalSeconds: 120,
      failureThreshold: 4,
      fallbackProfileId: 'backup',
    });
    await settings.close();
  });

  test('SOCKS credentials are editable only where the browser can use them', async () => {
    await detour.setState(configured());
    const settings = await openSettings('Office');
    const disabled = async () =>
      (await field(settings, 'Username')).evaluate((element) => element.disabled);

    expect(await disabled()).toBe(false);
    await choose(settings, 'Type', 'SOCKS5');
    await waitForStored(
      'the scheme to be saved',
      (current) => current.profiles[0]?.scheme === 'socks5',
    );
    // Chromium cannot authenticate a SOCKS proxy; Firefox can.
    expect(await disabled()).toBe(BROWSER === 'chrome');
    await settings.close();
  });

  test('Export downloads the whole configuration as a Detour backup', async () => {
    await detour.setState(
      configured({ rules: [{ id: 'r', match: 'example.com', action: DIRECT_ACTION }] }),
    );
    const settings = await openSettings('Office');

    // Catch the download where the page starts it, and read the file back.
    await settings.evaluate(() => {
      const holder = window as unknown as { exported?: Promise<string> };
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        holder.exported = fetch(this.href).then((response) => response.text());
      };
    });
    await clickButton(settings, 'Export');
    const text = await settings.evaluate(
      () => (window as unknown as { exported?: Promise<string> }).exported,
    );

    const file = JSON.parse(text ?? '{}') as { app: string; state: ProxyState };
    expect(file.app).toBe('detour');
    expect(file.state.profiles.map((item) => item.name)).toEqual(['Office']);
    expect(file.state.rules).toEqual([{ id: 'r', match: 'example.com', action: DIRECT_ACTION }]);
    await settings.close();
  });

  test('Import replaces the configuration with a Detour backup', async () => {
    const backup = state({
      enabled: true,
      profiles: [
        profile({ id: 'a', name: 'Imported', host: '127.0.0.1', port: servers.httpProxy.port }),
        profile({
          id: 'b',
          name: 'Spare',
          scheme: 'socks5',
          host: '127.0.0.1',
          port: servers.socks.port,
        }),
      ],
      rules: [{ id: 'r', match: HOSTS.other, action: 'b' }],
    });

    await detour.setState(configured());
    const settings = await openSettings('Office');
    await chooseFile(settings, 'detour-config.json', buildExport(backup));

    await waitForText(settings, 'Configuration imported.');
    await waitForStored('the backup to be stored', (current) => current.profiles.length === 2);
    expect(await fieldValue(settings, 'Profile name')).toBe('Imported');
    // The backup was enabled, so it takes effect straight away.
    await detour.waitForProxy(true);
    await expectTraffic(detour, servers, HOSTS.fallback, 'http-proxy');
    await expectTraffic(detour, servers, HOSTS.other, 'socks');
    await settings.close();
  });

  test('Import maps a SwitchyOmega backup and lists what it had to skip', async () => {
    await detour.setState(configured());
    const settings = await openSettings('Office');
    const fixture = path.resolve(
      import.meta.dirname,
      '../src/core/fixtures/switchyomega-backup.json',
    );
    await chooseFile(settings, 'OmegaOptions.bak', await readFile(fixture, 'utf8'));

    await waitForText(settings, 'from SwitchyOmega.');
    const text = await pageText(settings);
    expect(text).toMatch(/Imported \d+ profiles and \d+ rules from SwitchyOmega\./);
    expect(text).toMatch(/Skipped \d+ incompatible items?:/);
    const current = await stored();
    expect(current.profiles.length).toBeGreaterThan(0);
    expect(current.profiles.every((item) => item.host !== '')).toBe(true);
    await settings.close();
  });

  test('a file that is not a backup is refused and changes nothing', async () => {
    await detour.setState(configured());
    const settings = await openSettings('Office');
    await chooseFile(settings, 'notes.json', 'this is not json');

    await waitForText(settings, 'Not a valid JSON file.');
    expect((await stored()).profiles.map((item) => item.name)).toEqual(['Office']);

    // Valid JSON with no proxy config in it is refused the same way.
    await chooseFile(settings, 'package.json', JSON.stringify({ hello: 'world' }));
    await waitForText(settings, 'No proxy config found in this file.');
    expect((await stored()).profiles.map((item) => item.name)).toEqual(['Office']);
    await settings.close();
  });
});
