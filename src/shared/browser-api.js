(function (root) {
  'use strict';

  const hasBrowser = typeof globalThis.browser !== 'undefined' && !!globalThis.browser.runtime;
  const api = hasBrowser ? globalThis.browser : (typeof globalThis.chrome !== 'undefined' ? globalThis.chrome : null);

  function callApi(fn, ctx, ...args) {
    if (typeof fn !== 'function') {
      return Promise.resolve(null);
    }
    try {
      if (hasBrowser) {
        return Promise.resolve(fn.apply(ctx, args));
      }
      return new Promise((resolve, reject) => {
        const maybePromise = fn.apply(ctx, [
          ...args,
          (result) => {
            const err = api && api.runtime && api.runtime.lastError;
            if (err) {
              reject(new Error(err.message));
            } else {
              resolve(result);
            }
          }
        ]);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(resolve, reject);
        }
      });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  const capabilities = {
    isFirefox: hasBrowser && typeof globalThis.InstallTrigger !== 'undefined' || (hasBrowser && !(api && api.system)),
    hasDNR: !!(api && api.declarativeNetRequest && typeof api.declarativeNetRequest.updateDynamicRules === 'function'),
    hasSystemMemory: !!(api && api.system && api.system.memory && typeof api.system.memory.getInfo === 'function'),
    hasSystemCpu: !!(api && api.system && api.system.cpu && typeof api.system.cpu.getInfo === 'function'),
    hasAlarms: !!(api && api.alarms && typeof api.alarms.create === 'function'),
    hasCommands: !!(api && api.commands && api.commands.onCommand)
  };

  const browserApi = {
    raw: api,
    capabilities,

    storageGet(keys) {
      if (!api || !api.storage || !api.storage.local) return Promise.resolve({});
      return callApi(api.storage.local.get, api.storage.local, keys).catch(() => ({}));
    },

    storageSet(items) {
      if (!api || !api.storage || !api.storage.local) return Promise.resolve();
      return callApi(api.storage.local.set, api.storage.local, items).catch(() => {});
    },

    tabsQuery(queryInfo) {
      if (!api || !api.tabs) return Promise.resolve([]);
      return callApi(api.tabs.query, api.tabs, queryInfo).catch(() => []);
    },

    tabsGet(tabId) {
      if (!api || !api.tabs) return Promise.resolve(null);
      return callApi(api.tabs.get, api.tabs, tabId).catch(() => null);
    },

    tabsDiscard(tabId) {
      if (!api || !api.tabs || typeof api.tabs.discard !== 'function') return Promise.resolve(null);
      return callApi(api.tabs.discard, api.tabs, tabId).catch(() => null);
    },

    tabsSendMessage(tabId, message) {
      if (!api || !api.tabs) return Promise.resolve(null);
      return callApi(api.tabs.sendMessage, api.tabs, tabId, message).catch(() => null);
    },

    runtimeSendMessage(message) {
      if (!api || !api.runtime) return Promise.resolve(null);
      return callApi(api.runtime.sendMessage, api.runtime, message).catch(() => null);
    },

    actionSetIcon(details) {
      const action = api && (api.action || api.browserAction);
      if (!action || typeof action.setIcon !== 'function') return Promise.resolve();
      return callApi(action.setIcon, action, details).catch(() => {});
    },

    actionSetTitle(details) {
      const action = api && (api.action || api.browserAction);
      if (!action || typeof action.setTitle !== 'function') return Promise.resolve();
      return callApi(action.setTitle, action, details).catch(() => {});
    },

    actionSetBadgeText(details) {
      const action = api && (api.action || api.browserAction);
      if (!action || typeof action.setBadgeText !== 'function') return Promise.resolve();
      return callApi(action.setBadgeText, action, details).catch(() => {});
    },

    actionSetBadgeBackgroundColor(details) {
      const action = api && (api.action || api.browserAction);
      if (!action || typeof action.setBadgeBackgroundColor !== 'function') return Promise.resolve();
      return callApi(action.setBadgeBackgroundColor, action, details).catch(() => {});
    },

    dnrGetDynamicRules() {
      if (!capabilities.hasDNR) return Promise.resolve([]);
      return callApi(api.declarativeNetRequest.getDynamicRules, api.declarativeNetRequest).catch(() => []);
    },

    dnrUpdateDynamicRules(options) {
      if (!capabilities.hasDNR) return Promise.resolve();
      return callApi(api.declarativeNetRequest.updateDynamicRules, api.declarativeNetRequest, options).catch(() => {});
    },

    getSystemMemory() {
      if (!capabilities.hasSystemMemory) return Promise.resolve(null);
      return callApi(api.system.memory.getInfo, api.system.memory).catch(() => null);
    },

    getSystemCpu() {
      if (!capabilities.hasSystemCpu) return Promise.resolve(null);
      return callApi(api.system.cpu.getInfo, api.system.cpu).catch(() => null);
    },

    alarmsCreate(name, alarmInfo) {
      if (!capabilities.hasAlarms) return;
      try {
        api.alarms.create(name, alarmInfo);
      } catch (_) {}
    }
  };

  root.PotatoMode = root.PotatoMode || {};
  root.PotatoMode.api = browserApi;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = browserApi;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
