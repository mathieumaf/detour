// Take screenshots of the popup and the settings page, for a pull request or
// to look at a change. `bun run screenshots` writes PNGs to .output/screenshots.
//
// The browser is the pinned test build with a throwaway profile, and the
// configuration below is made up. Nothing here touches your own browser.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { BROWSER, launchDetour, waitFor } from './detour';
import { DIRECT_ACTION, profile, state } from './state';
import { fieldValue } from './ui';

const outputDir = path.resolve(import.meta.dirname, '../.output/screenshots');

const demo = state({
  enabled: true,
  activeProfileId: 'office',
  profiles: [
    profile({
      id: 'office',
      name: 'Office',
      scheme: 'https',
      host: 'proxy.example.com',
      port: 8443,
      username: 'demo',
      password: 'not-a-real-password',
      bypassList: ['<local>', '*.internal.example.com'],
    }),
    profile({ id: 'home', name: 'Home', scheme: 'socks5', host: '10.0.0.2', port: 1080 }),
  ],
  rules: [
    { id: 'r1', match: 'github.com', action: 'home' },
    { id: 'r2', match: '<private>', action: DIRECT_ACTION },
  ],
  healthCheck: {
    enabled: true,
    intervalSeconds: 120,
    failureThreshold: 2,
    fallbackProfileId: 'home',
  },
});

const detour = await launchDetour();
try {
  await mkdir(outputDir, { recursive: true });
  await detour.setState(demo);

  const popup = await detour.openPage('popup.html', {
    width: 340,
    height: 320,
    deviceScaleFactor: 2,
  });
  await waitFor('the popup to show the profile', async () =>
    (await popup.evaluate(() => document.body.innerText)).includes('proxy.example.com'),
  );
  const popupFile = path.join(outputDir, `popup-${BROWSER}.png`);
  await popup.screenshot({ path: popupFile });

  const settings = await detour.openPage('options.html', {
    width: 720,
    height: 900,
    deviceScaleFactor: 2,
  });
  await waitFor(
    'the settings page to show the profile',
    async () => (await fieldValue(settings, 'Profile name')) === 'Office',
  );
  const settingsFile = path.join(outputDir, `settings-${BROWSER}.png`);
  await settings.screenshot({ path: settingsFile, fullPage: true });

  console.log(`✔ ${popupFile}\n✔ ${settingsFile}`);
} finally {
  await detour.close();
}
