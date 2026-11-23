// Potato Mode v3.0 — Unified Cross-Browser Background Engine (Chrome MV3 SW + Firefox MV3 Event Page)
'use strict';

if (typeof importScripts === 'function' && (!globalThis.PotatoMode || !globalThis.PotatoMode.defaults)) {
  importScripts(
    '../shared/browser-api.js',
    '../shared/defaults.js',
    '../shared/scanner-engine.js',
    '../shared/ram-policy.js'
  );
}

(function () {
  const { api, defaults, scanner, ramPolicy } = globalThis.PotatoMode;
  const rawApi = api.raw;
  const ALARM_RAM_SWEEP = 'pm-ram-sweep';
  const STORAGE_TAB_ACTIVITY = 'pm_tab_activity';

  // Ephemeral set of tabs reporting dirty/unsaved forms (refreshed by content script)
  const dirtyFormTabIds = new Set();

  function iconPathForState(state) {
    return {
      16: `icons/${state}-16.png`,
      32: `icons/${state}-32.png`,
      48: `icons/${state}-48.png`,
      128: `icons/${state}-128.png`
    };
  }

  async function loadSettings() {
    const stored = await api.storageGet(defaults.SETTINGS_KEYS);
    return { ...defaults.DEFAULTS, ...stored };
  }

  // ---------------- Dynamic Per-Tab Icon & Title ----------------

  function resolveTabVisualState(tab, settings) {
    const url = tab && tab.url ? tab.url : '';
    if (!url || defaults.isRestrictedUrl(url)) {
      return {
        state: 'error',
        title: 'Potato Mode — Page système non modifiable'
      };
    }

    const host = defaults.extractHostname(url);

    if (!settings.enabled) {
      return {
        state: 'inactive',
        title: 'Potato Mode — Désactivé (Alt+Shift+P pour activer)'
      };
    }

    if (defaults.isDomainWhitelisted(url, settings)) {
      return {
        state: 'paused',
        title: `Potato Mode — En pause sur ${host || 'ce site'}`
      };
    }

    if (defaults.isExtremeMode(settings)) {
      return {
        state: 'extreme',
        title: `Potato Mode — Patate Max actif sur ${host || 'ce site'}`
      };
    }

    return {
      state: 'active',
      title: `Potato Mode — Actif sur ${host || 'ce site'}`
    };
  }

  async function updateTabIcon(tab, settings) {
    if (!tab || typeof tab.id !== 'number') return;
    const cfg = settings || (await loadSettings());
    const { state, title } = resolveTabVisualState(tab, cfg);

    await Promise.all([
      api.actionSetIcon({ tabId: tab.id, path: iconPathForState(state) }),
      api.actionSetTitle({ tabId: tab.id, title }),
      api.actionSetBadgeText({ tabId: tab.id, text: '' })
    ]);
  }

  async function updateGlobalIconAndAllTabs(settings) {
    const cfg = settings || (await loadSettings());
    const globalState = !cfg.enabled
      ? 'inactive'
      : defaults.isExtremeMode(cfg)
        ? 'extreme'
        : 'active';

    await Promise.all([
      api.actionSetIcon({ path: iconPathForState(globalState) }),
      api.actionSetBadgeText({ text: '' })
    ]);

    const tabs = await api.tabsQuery({});
    await Promise.all(tabs.map((tab) => updateTabIcon(tab, cfg)));
  }

  // ---------------- DeclarativeNetRequest (Real Network Blocking) ----------------

  async function syncDnrRules(settings) {
    if (!api.capabilities.hasDNR) return 0;

    const cfg = settings || (await loadSettings());
    const existing = await api.dnrGetDynamicRules();
    const removeRuleIds = existing.map((r) => r.id);
    const addRules = [];

    if (cfg.enabled) {
      const excludedDomains = cfg.whitelist ? defaults.parseWhitelist(cfg.whitelistDomains) : [];
      const baseCondition = excludedDomains.length > 0
        ? { excludedInitiatorDomains: excludedDomains }
        : {};

      if (cfg.blockWebFonts) {
        addRules.push({
          id: defaults.DNR_RULE_IDS.BLOCK_WEBFONTS,
          priority: 1,
          action: { type: 'block' },
          condition: {
            ...baseCondition,
            resourceTypes: ['font']
          }
        });
      }

      if (cfg.blockGifs && !cfg.blockImages) {
        addRules.push({
          id: defaults.DNR_RULE_IDS.BLOCK_GIFS,
          priority: 1,
          action: { type: 'block' },
          condition: {
            ...baseCondition,
            urlFilter: '.gif',
            resourceTypes: ['image']
          }
        });
      }

      if (cfg.blockImages) {
        addRules.push({
          id: defaults.DNR_RULE_IDS.BLOCK_IMAGES,
          priority: 2,
          action: { type: 'block' },
          condition: {
            ...baseCondition,
            resourceTypes: ['image', 'imageset']
          }
        });
      }

      if (cfg.blockHeavyMedia) {
        addRules.push({
          id: defaults.DNR_RULE_IDS.BLOCK_HEAVY_MEDIA,
          priority: 1,
          action: { type: 'block' },
          condition: {
            ...baseCondition,
            resourceTypes: ['media']
          }
        });
      }
    }

    await api.dnrUpdateDynamicRules({ removeRuleIds, addRules });
    return addRules.length;
  }

  // ---------------- Real RAM Limiter (tabs.discard) ----------------

  async function getTabActivityMap() {
    const res = await api.storageGet(STORAGE_TAB_ACTIVITY);
    return (res && res[STORAGE_TAB_ACTIVITY]) || {};
  }

  async function touchTabActivity(tabId) {
    if (typeof tabId !== 'number') return;
    const map = await getTabActivityMap();
    map[tabId] = Date.now();
    await api.storageSet({ [STORAGE_TAB_ACTIVITY]: map });
  }

  async function pruneTabActivity(openTabs) {
    const validIds = new Set(openTabs.map((t) => String(t.id)));
    const map = await getTabActivityMap();
    let changed = false;
    for (const key of Object.keys(map)) {
      if (!validIds.has(key)) {
        delete map[key];
        changed = true;
      }
    }
    if (changed) {
      await api.storageSet({ [STORAGE_TAB_ACTIVITY]: map });
    }
    return map;
  }

  async function runRamSweep(forceNow = false) {
    const cfg = await loadSettings();
    if (!forceNow && (!cfg.enabled || !cfg.ramLimiterEnabled)) {
      return { discardedCount: 0, freedMB: null };
    }

    const tabs = await api.tabsQuery({});
    const activityMap = await pruneTabActivity(tabs);
    const now = Date.now();

    // Ensure currently active tabs always have fresh timestamps
    for (const tab of tabs) {
      if (tab.active && typeof tab.id === 'number') {
        activityMap[tab.id] = now;
      }
    }

    const candidates = ramPolicy.selectTabsToDiscard(
      tabs,
      activityMap,
      cfg,
      now,
      dirtyFormTabIds,
      forceNow
    );

    if (candidates.length === 0) {
      return { discardedCount: 0, freedMB: null };
    }

    const memBefore = await api.getSystemMemory();
    let discardedCount = 0;

    for (const { tab } of candidates) {
      const res = await api.tabsDiscard(tab.id);
      if (res !== null) {
        discardedCount++;
        dirtyFormTabIds.delete(tab.id);
      }
    }

    let freedMB = null;
    if (memBefore && discardedCount > 0) {
      // Brief pause so OS/browser reclaims discarded renderer memory before reading delta
      await new Promise((r) => setTimeout(r, 250));
      const memAfter = await api.getSystemMemory();
      if (memAfter && typeof memAfter.availableCapacity === 'number') {
        const delta = memAfter.availableCapacity - memBefore.availableCapacity;
        if (delta > 0) {
          freedMB = Math.round(delta / (1024 * 1024));
        }
      }
    }

    if (discardedCount > 0) {
      const nextTotal = (Number(cfg.statsTabsSuspended) || 0) + discardedCount;
      await api.storageSet({ statsTabsSuspended: nextTotal });
    }

    return { discardedCount, freedMB };
  }

  // ---------------- Real Hardware Telemetry & Adaptive Scan ----------------

  async function sampleRealCpuLoadPercent() {
    const snap1 = await api.getSystemCpu();
    if (!snap1 || !Array.isArray(snap1.processors) || snap1.processors.length === 0) {
      return { cpuModel: null, cpuCores: null, cpuLoadPercent: null };
    }

    await new Promise((r) => setTimeout(r, 140));
    const snap2 = await api.getSystemCpu();

    let cpuLoadPercent = null;
    if (snap2 && Array.isArray(snap2.processors) && snap2.processors.length === snap1.processors.length) {
      let totalDelta = 0;
      let busyDelta = 0;
      for (let i = 0; i < snap1.processors.length; i++) {
        const u1 = snap1.processors[i].usage;
        const u2 = snap2.processors[i].usage;
        const dt = u2.total - u1.total;
        const db = (u2.user - u1.user) + (u2.kernel - u1.kernel);
        if (dt > 0) {
          totalDelta += dt;
          busyDelta += db;
        }
      }
      if (totalDelta > 0) {
        cpuLoadPercent = Math.max(0, Math.min(100, (busyDelta / totalDelta) * 100));
      }
    }

    return {
      cpuModel: snap1.modelName || null,
      cpuCores: snap1.numOfProcessors || snap1.processors.length || null,
      cpuLoadPercent
    };
  }

  async function collectBrowserTelemetry(activeTabId) {
    const [tabs, memInfo, dnrRules] = await Promise.all([
      api.tabsQuery({}),
      api.getSystemMemory(),
      api.dnrGetDynamicRules()
    ]);

    const openTabsCount = tabs.length;
    const discardedTabsCount = tabs.filter((t) => t.discarded).length;
    const loadedTabsCount = openTabsCount - discardedTabsCount;

    let ramTotalGB = null;
    let ramAvailableGB = null;
    let ramFreePercent = null;
    let ramSource = null;

    if (memInfo && typeof memInfo.capacity === 'number' && memInfo.capacity > 0) {
      ramTotalGB = memInfo.capacity / (1024 ** 3);
      ramAvailableGB = memInfo.availableCapacity / (1024 ** 3);
      ramFreePercent = (memInfo.availableCapacity / memInfo.capacity) * 100;
      ramSource = 'system.memory';
    }

    let pageTelemetry = null;
    let activeTab = null;
    if (typeof activeTabId === 'number') {
      activeTab = await api.tabsGet(activeTabId);
    } else {
      const [current] = await api.tabsQuery({ active: true, currentWindow: true });
      activeTab = current || null;
    }

    const isRestricted = !activeTab || !activeTab.url || defaults.isRestrictedUrl(activeTab.url);
    if (activeTab && !isRestricted) {
      pageTelemetry = await api.tabsSendMessage(activeTab.id, { action: 'getPageTelemetry' });
    }

    return {
      activeTab: activeTab
        ? {
            id: activeTab.id,
            url: activeTab.url || '',
            hostname: defaults.extractHostname(activeTab.url || ''),
            isRestricted
          }
        : { id: null, url: '', hostname: '', isRestricted: true },
      tabs: {
        openTabsCount,
        loadedTabsCount,
        discardedTabsCount,
        list: tabs
          .filter((t) => !t.active && t.url && !defaults.isRestrictedUrl(t.url))
          .map((t) => ({
            id: t.id,
            title: t.title || defaults.extractHostname(t.url) || 'Onglet',
            hostname: defaults.extractHostname(t.url),
            discarded: !!t.discarded,
            pinned: !!t.pinned,
            audible: !!t.audible
          }))
      },
      memory: {
        ramTotalGB,
        ramAvailableGB,
        ramFreePercent,
        ramSource
      },
      dnrRulesActive: Array.isArray(dnrRules) ? dnrRules.length : 0,
      page: pageTelemetry,
      capabilities: api.capabilities
    };
  }

  async function handleAdaptiveScan(clientMetrics = {}) {
    const [cpuStats, browserStats] = await Promise.all([
      sampleRealCpuLoadPercent(),
      collectBrowserTelemetry(clientMetrics.activeTabId)
    ]);

    const ramTotalGB = browserStats.memory.ramTotalGB ??
      (typeof clientMetrics.deviceMemoryGB === 'number' ? clientMetrics.deviceMemoryGB : null);
    const ramSource = browserStats.memory.ramSource ??
      (typeof clientMetrics.deviceMemoryGB === 'number' ? 'deviceMemory' : null);

    const scanInput = {
      cpuCores: cpuStats.cpuCores ?? clientMetrics.hardwareConcurrency ?? null,
      cpuModel: cpuStats.cpuModel,
      cpuLoadPercent: cpuStats.cpuLoadPercent,
      ramTotalGB,
      ramAvailableGB: browserStats.memory.ramAvailableGB,
      ramFreePercent: browserStats.memory.ramFreePercent,
      ramSource,
      benchmarkMs: clientMetrics.benchmarkMs ?? null,
      frameJitterMs: clientMetrics.frameJitterMs ?? null,
      openTabsCount: browserStats.tabs.openTabsCount,
      loadedTabsCount: browserStats.tabs.loadedTabsCount,
      discardedTabsCount: browserStats.tabs.discardedTabsCount,
      onBattery: clientMetrics.onBattery ?? null,
      batteryLevel: clientMetrics.batteryLevel ?? null,
      saveData: clientMetrics.saveData ?? null,
      effectiveConnection: clientMetrics.effectiveConnection ?? null,
      pageDomNodes: browserStats.page ? browserStats.page.domNodes : null
    };

    const report = scanner.evaluateScan(scanInput);

    // Apply recommended settings immediately
    const toSave = {
      ...report.recommendedSettings,
      lastScanReport: report
    };
    await api.storageSet(toSave);

    const fullSettings = await loadSettings();
    await Promise.all([
      syncDnrRules(fullSettings),
      updateGlobalIconAndAllTabs(fullSettings)
    ]);

    return report;
  }

  // ---------------- Lifecycle & Event Listeners ----------------

  async function initialize() {
    const stored = await api.storageGet(defaults.SETTINGS_KEYS);
    const missing = {};
    for (const key of defaults.SETTINGS_KEYS) {
      if (stored[key] === undefined) {
        missing[key] = defaults.DEFAULTS[key];
      }
    }
    if (Object.keys(missing).length > 0) {
      await api.storageSet(missing);
    }

    const cfg = { ...defaults.DEFAULTS, ...stored };
    api.alarmsCreate(ALARM_RAM_SWEEP, { periodInMinutes: 1 });
    await Promise.all([
      syncDnrRules(cfg),
      updateGlobalIconAndAllTabs(cfg)
    ]);
  }

  if (rawApi && rawApi.runtime) {
    rawApi.runtime.onInstalled.addListener(() => {
      initialize();
    });

    if (rawApi.runtime.onStartup) {
      rawApi.runtime.onStartup.addListener(() => {
        initialize();
      });
    }

    rawApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.action) return false;

      if (msg.action === 'formDirty') {
        if (sender && sender.tab && typeof sender.tab.id === 'number') {
          if (msg.dirty) dirtyFormTabIds.add(sender.tab.id);
          else dirtyFormTabIds.delete(sender.tab.id);
        }
        sendResponse({ ok: true });
        return false;
      }

      if (msg.action === 'getLiveTelemetry') {
        collectBrowserTelemetry(msg.tabId)
          .then((data) => sendResponse({ ok: true, data }))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }

      if (msg.action === 'runAdaptiveScan') {
        handleAdaptiveScan(msg.clientMetrics || {})
          .then((report) => sendResponse({ ok: true, report }))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }

      if (msg.action === 'discardNow') {
        runRamSweep(true)
          .then((result) => sendResponse({ ok: true, result }))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }

      if (msg.action === 'discardSingleTab' && typeof msg.tabId === 'number') {
        api.tabsDiscard(msg.tabId)
          .then(async (res) => {
            if (res !== null) {
              const cfg = await loadSettings();
              await api.storageSet({ statsTabsSuspended: (Number(cfg.statsTabsSuspended) || 0) + 1 });
            }
            sendResponse({ ok: res !== null });
          })
          .catch(() => sendResponse({ ok: false }));
        return true;
      }

      if (msg.action === 'toggleCurrentSite' && msg.hostname) {
        (async () => {
          const cfg = await loadSettings();
          const { nextDomains, added, domain } = defaults.toggleDomainInWhitelist(
            msg.hostname,
            cfg.whitelistDomains
          );
          await api.storageSet({
            whitelist: true,
            whitelistDomains: nextDomains
          });
          sendResponse({ ok: true, added, domain, whitelistDomains: nextDomains });
        })().catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }

      return false;
    });
  }

  if (rawApi && rawApi.storage && rawApi.storage.onChanged) {
    rawApi.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName && areaName !== 'local') return;
      const relevant = Object.keys(changes).some((k) => defaults.SETTINGS_KEYS.includes(k));
      if (!relevant) return;

      const cfg = await loadSettings();
      const dnrKeys = ['enabled', 'blockWebFonts', 'blockGifs', 'blockImages', 'blockHeavyMedia', 'whitelist', 'whitelistDomains'];
      const needDnr = dnrKeys.some((k) => changes[k] !== undefined);
      const iconKeys = ['enabled', 'activeProfile', 'blockImages', 'blockWebFonts', 'disableAnimations', 'whitelist', 'whitelistDomains'];
      const needIcon = iconKeys.some((k) => changes[k] !== undefined);

      const tasks = [];
      if (needDnr) tasks.push(syncDnrRules(cfg));
      if (needIcon) tasks.push(updateGlobalIconAndAllTabs(cfg));
      await Promise.all(tasks);
    });
  }

  if (rawApi && rawApi.tabs) {
    rawApi.tabs.onActivated.addListener(async ({ tabId }) => {
      touchTabActivity(tabId);
      const tab = await api.tabsGet(tabId);
      if (tab) await updateTabIcon(tab);
    });

    rawApi.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.url || changeInfo.status === 'loading' || changeInfo.status === 'complete') {
        if (changeInfo.url) dirtyFormTabIds.delete(tabId);
        await updateTabIcon(tab);
      }
    });

    rawApi.tabs.onRemoved.addListener((tabId) => {
      dirtyFormTabIds.delete(tabId);
    });
  }

  if (rawApi && rawApi.alarms && rawApi.alarms.onAlarm) {
    rawApi.alarms.onAlarm.addListener((alarm) => {
      if (alarm && alarm.name === ALARM_RAM_SWEEP) {
        runRamSweep(false);
      }
    });
  }

  if (rawApi && rawApi.commands && rawApi.commands.onCommand) {
    rawApi.commands.onCommand.addListener(async (command) => {
      const cfg = await loadSettings();
      if (command === 'toggle-global') {
        await api.storageSet({ enabled: !cfg.enabled });
      } else if (command === 'toggle-site') {
        const [activeTab] = await api.tabsQuery({ active: true, currentWindow: true });
        if (activeTab && activeTab.url && !defaults.isRestrictedUrl(activeTab.url)) {
          const { nextDomains } = defaults.toggleDomainInWhitelist(activeTab.url, cfg.whitelistDomains);
          await api.storageSet({ whitelist: true, whitelistDomains: nextDomains });
        }
      }
    });
  }

  // Ensure initial state is synced when SW wakes cleanly
  loadSettings().then((cfg) => {
    api.alarmsCreate(ALARM_RAM_SWEEP, { periodInMinutes: 1 });
    updateGlobalIconAndAllTabs(cfg);
  });
})();
