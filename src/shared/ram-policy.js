(function (root) {
  'use strict';

  const defaultsMod = (root.PotatoMode && root.PotatoMode.defaults) ||
    (typeof require === 'function' ? require('./defaults.js') : null);

  /**
   * Determines whether an individual tab is eligible for safe RAM suspension (tabs.discard).
   */
  function isTabDiscardable(tab, settings, dirtyFormTabIds) {
    if (!tab || typeof tab.id !== 'number') return false;
    if (tab.active) return false;
    if (tab.discarded) return false;
    if (tab.pinned) return false;
    if (tab.audible) return false;
    if (tab.autoDiscardable === false) return false;
    if (!tab.url || defaultsMod.isRestrictedUrl(tab.url)) return false;
    if (defaultsMod.isDomainWhitelisted(tab.url, settings)) return false;
    if (settings.ramProtectForms && dirtyFormTabIds && dirtyFormTabIds.has(tab.id)) return false;
    return true;
  }

  /**
   * Pure policy engine: returns the exact list of tabs to discard based on idle timeout
   * and max concurrent loaded tabs cap.
   *
   * @param {Array} tabs - Result of tabs.query({})
   * @param {Object} lastActiveMap - { [tabId]: timestampMs }
   * @param {Object} settings - Extension settings
   * @param {number} nowMs - Current timestamp
   * @param {Set<number>} dirtyFormTabIds - Tabs with unsaved user form edits
   * @param {boolean} forceNow - If true, suspends all eligible inactive tabs immediately
   * @returns {Array<{tab: object, reason: 'idle'|'cap'|'manual'}>}
   */
  function selectTabsToDiscard(tabs, lastActiveMap, settings, nowMs, dirtyFormTabIds, forceNow = false) {
    if (!Array.isArray(tabs) || tabs.length === 0) return [];
    if (!forceNow && (!settings.enabled || !settings.ramLimiterEnabled)) return [];

    const idleMs = Math.max(1, Number(settings.ramIdleMinutes) || 20) * 60 * 1000;
    const maxLoaded = Math.max(0, Number(settings.ramMaxActiveTabs) || 0);

    const eligible = [];
    let totalLoadedCount = 0;

    for (const tab of tabs) {
      if (!tab.discarded) {
        totalLoadedCount++;
      }
      if (isTabDiscardable(tab, settings, dirtyFormTabIds)) {
        const lastActive = Number(lastActiveMap && lastActiveMap[tab.id]) ||
          Number(tab.lastAccessed) ||
          nowMs;
        eligible.push({ tab, lastActive });
      }
    }

    // Sort oldest inactive first
    eligible.sort((a, b) => a.lastActive - b.lastActive);

    if (forceNow) {
      return eligible.map((entry) => ({ tab: entry.tab, reason: 'manual' }));
    }

    const chosenIds = new Set();
    const result = [];

    // Pass 1: idle timeout
    for (const entry of eligible) {
      if (nowMs - entry.lastActive >= idleMs) {
        chosenIds.add(entry.tab.id);
        result.push({ tab: entry.tab, reason: 'idle' });
      }
    }

    // Pass 2: max concurrent loaded tabs cap
    if (maxLoaded > 0) {
      let remainingLoaded = totalLoadedCount - result.length;
      if (remainingLoaded > maxLoaded) {
        for (const entry of eligible) {
          if (remainingLoaded <= maxLoaded) break;
          if (chosenIds.has(entry.tab.id)) continue;
          chosenIds.add(entry.tab.id);
          result.push({ tab: entry.tab, reason: 'cap' });
          remainingLoaded--;
        }
      }
    }

    return result;
  }

  const exported = {
    isTabDiscardable,
    selectTabsToDiscard
  };

  root.PotatoMode = root.PotatoMode || {};
  root.PotatoMode.ramPolicy = exported;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
