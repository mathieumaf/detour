import { activeProfile, buildPacScript, expandBypassForChromium } from '@/core';
import type { ProxyProfile, ProxyState } from '@/core';
import type { ProxyBackend } from './backend';

// Chromium has one process-wide setting, chrome.proxy.settings, and it
// survives a service worker restart. There is nothing to hold at startup: the
// browser keeps applying the last value while the worker is asleep.
export function createChromiumBackend(): ProxyBackend {
  async function routeByProfile(profile: ProxyProfile): Promise<void> {
    await chrome.proxy.settings.set({
      scope: 'regular',
      value: {
        mode: 'fixed_servers',
        rules: {
          singleProxy: { scheme: profile.scheme, host: profile.host.trim(), port: profile.port },
          bypassList: expandBypassForChromium(profile.bypassList),
        },
      },
    });
  }

  return {
    start() {},

    async routeByState(state: ProxyState) {
      // Rules need a decision per URL, which one fixed server cannot express,
      // so the rule list and the active profile are compiled into a PAC
      // script. With no rules, the simpler fixed_servers mode is enough and
      // Chromium applies the bypass list natively.
      if (state.rules.length === 0) {
        await routeByProfile(activeProfile(state));
        return;
      }
      await chrome.proxy.settings.set({
        scope: 'regular',
        value: {
          mode: 'pac_script',
          pacScript: { data: buildPacScript(state), mandatory: true },
        },
      });
    },

    routeByProfile,

    async release() {
      await chrome.proxy.settings.clear({ scope: 'regular' });
    },

    abortStartup() {},
  };
}
