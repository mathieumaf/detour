import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Detour',
    description: 'Simple proxy switcher — HTTP, HTTPS, SOCKS4/5 with authentication.',
    permissions: [
      'proxy',
      'storage',
      'webRequest',
      'webRequestAuthProvider',
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Detour',
    },
  },
});
