import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  // Keep both targets on MV3 so the popup/background share one manifest shape
  // and the `action` API exists on Firefox too.
  manifestVersion: 3,
  manifest: ({ browser }) => {
    const firefox = browser === 'firefox';
    return {
      name: 'Detour',
      description:
        'Simple proxy switcher — HTTP, HTTPS, SOCKS4/5 with authentication.',
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
