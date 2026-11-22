import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-vue'],
  zip: {
    // Firefox Add-ons reviewers rebuild the extension from the sources zip.
    // Ship what that takes and leave out what it does not: the store artwork,
    // the test suites and their data, docs, and release tooling.
    // scripts/verify-sources.ts rebuilds from the zip to prove it is enough.
    excludeSources: [
      'store/**',
      'e2e/**',
      'docs/**',
      'scripts/**',
      'src/core/fixtures/**',
      '**/fake-*.ts',
      'CHANGELOG.md',
      'release-please-config.json',
    ],
  },
  // Keep both targets on MV3 so the popup/background share one manifest shape
  // and the `action` API exists on Firefox too.
  manifestVersion: 3,
  manifest: ({ browser }) => {
    const firefox = browser === 'firefox';
    return {
      name: 'Detour',
      description:
        'Switch HTTP, HTTPS, or SOCKS proxy profiles from your toolbar, with auto-switch rules, health checks, failover, auth, and bypass.',
      permissions: [
        'proxy',
        'storage',
        'alarms',
        'webRequest',
        // Chromium supplies proxy auth via webRequestAuthProvider; Firefox keeps
        // the classic blocking webRequest for onAuthRequired.
        firefox ? 'webRequestBlocking' : 'webRequestAuthProvider',
      ],
      host_permissions: ['<all_urls>'],
      action: { default_title: 'Detour' },
      // No suggested_key: common chords collide across browsers. Users assign
      // both commands on chrome://extensions/shortcuts (Firefox: about:addons).
      commands: {
        'toggle-detour': {
          description: 'Toggle Detour on or off',
        },
        'next-profile': {
          description: 'Switch to the next named profile',
        },
      },
      ...(firefox && {
        browser_specific_settings: {
          gecko: {
            // data_collection_permissions lands in Firefox 140, so require it.
            id: 'detour@mafille.me',
            strict_min_version: '140.0',
            // Required by AMO for new add-ons. Detour collects no data:
            // credentials stay in local storage and nothing is sent to us.
            data_collection_permissions: { required: ['none'] },
          },
        },
      }),
    };
  },
});
