(function (root) {
  'use strict';

  const defaultsMod = (root.PotatoMode && root.PotatoMode.defaults) ||
    (typeof require === 'function' ? require('./defaults.js') : null);

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  /**
   * Evaluates REAL hardware & session telemetry to choose an adapted Potato Mode profile.
   * Never fabricates missing hardware values; degrades cleanly across Chrome and Firefox.
   *
   * @param {object} telemetry
   * @returns {object} Scan report with recommendedSettings and factual reasons
   */
  function evaluateScan(telemetry = {}) {
    const {
      cpuCores = null,
      cpuModel = null,
      cpuLoadPercent = null,
      ramTotalGB = null,
      ramAvailableGB = null,
      ramFreePercent = null,
      ramSource = null, // 'system.memory' | 'deviceMemory' | null
      benchmarkMs = null,
      frameJitterMs = null,
      openTabsCount = 0,
      loadedTabsCount = 0,
      discardedTabsCount = 0,
      onBattery = null,
      batteryLevel = null, // 0..1
      saveData = null,
      effectiveConnection = null,
      pageDomNodes = null
    } = telemetry;

    const reasons = [];
    const capacityPoints = [];
    let pressureBonus = 0;

    // 1. RAM capacity (real)
    if (typeof ramTotalGB === 'number' && ramTotalGB > 0) {
      if (ramTotalGB <= 4) {
        capacityPoints.push(18);
        reasons.push(`RAM détectée faible (${ramTotalGB.toFixed(1)} Go) : blocage réseau & limiteur RAM strict activés.`);
      } else if (ramTotalGB <= 8) {
        capacityPoints.push(45);
        reasons.push(`RAM modérée (${ramTotalGB.toFixed(1)} Go) : profil économe avec suspension des onglets inactifs.`);
      } else if (ramTotalGB <= 16) {
        capacityPoints.push(74);
        reasons.push(`RAM confortable (${ramTotalGB.toFixed(1)} Go) : optimisations équilibrées sans altérer les visuels.`);
      } else {
        capacityPoints.push(95);
        reasons.push(`Grande capacité RAM (${ramTotalGB.toFixed(1)} Go) : mode léger privilégié.`);
      }
    }

    // 2. Real free RAM pressure (Chrome system.memory)
    let criticalPressure = false;
    if (typeof ramFreePercent === 'number') {
      if (ramFreePercent < 15) {
        pressureBonus += 24;
        criticalPressure = true;
        reasons.push(`Mémoire libre critique (${Math.round(ramFreePercent)} %) : bridage RAM renforcé.`);
      } else if (ramFreePercent < 25) {
        pressureBonus += 10;
        reasons.push(`Mémoire libre tendue (${Math.round(ramFreePercent)} %) : suspension d'onglets accélérée.`);
      }
    }

    // 3. CPU logical cores (real)
    if (typeof cpuCores === 'number' && cpuCores > 0) {
      if (cpuCores <= 2) {
        capacityPoints.push(20);
        reasons.push(`CPU ${cpuCores} cœurs : suppression des effets GPU et animations.`);
      } else if (cpuCores <= 4) {
        capacityPoints.push(48);
        reasons.push(`CPU ${cpuCores} cœurs : allègement du rendu GPU.`);
      } else if (cpuCores <= 8) {
        capacityPoints.push(76);
      } else {
        capacityPoints.push(94);
      }
    }

    // 4. Real CPU load % (Chrome system.cpu)
    if (typeof cpuLoadPercent === 'number') {
      if (cpuLoadPercent >= 80) {
        pressureBonus += 22;
        reasons.push(`Charge CPU actuelle élevée (${Math.round(cpuLoadPercent)} %) : réduction des effets composites.`);
      } else if (cpuLoadPercent >= 55) {
        pressureBonus += 10;
      }
    }

    // 5. Real micro-benchmark (Chrome & Firefox)
    // Lower ms = faster CPU. Reference: < 14ms fast, 14-30ms mid, 30-55ms modest, > 55ms slow
    if (typeof benchmarkMs === 'number' && benchmarkMs > 0) {
      if (benchmarkMs >= 55) {
        capacityPoints.push(22);
        reasons.push(`Test de réactivité CPU lent (${Math.round(benchmarkMs)} ms) : optimisations renforcées.`);
      } else if (benchmarkMs >= 30) {
        capacityPoints.push(50);
      } else if (benchmarkMs >= 15) {
        capacityPoints.push(75);
      } else {
        capacityPoints.push(94);
      }
    }

    if (typeof frameJitterMs === 'number' && frameJitterMs > 12) {
      pressureBonus += 10;
      reasons.push(`Instabilité d'affichage mesurée (jitter ${frameJitterMs.toFixed(1)} ms).`);
    }

    // 6. Open / loaded tabs pressure (real)
    const activeLoaded = loadedTabsCount > 0 ? loadedTabsCount : openTabsCount;
    if (activeLoaded >= 30) {
      pressureBonus += 16;
      reasons.push(`${activeLoaded} onglets chargés en RAM : plafond d'onglets actifs appliqué.`);
    } else if (activeLoaded >= 18) {
      pressureBonus += 8;
      reasons.push(`${activeLoaded} onglets chargés : mise en veille automatique calibrée.`);
    } else if (activeLoaded >= 10) {
      pressureBonus += 4;
    }

    // 7. Battery state (real when supported)
    if (onBattery === true) {
      if (typeof batteryLevel === 'number' && batteryLevel <= 0.25) {
        pressureBonus += 12;
        reasons.push(`Batterie faible (${Math.round(batteryLevel * 100)} %) : mode économie d'énergie activé.`);
      } else {
        pressureBonus += 6;
        reasons.push('Sur batterie : allègement GPU & vidéos pour préserver l\'autonomie.');
      }
    }

    // 8. Network constraints (real when supported)
    const slowNet = saveData === true || effectiveConnection === 'slow-2g' || effectiveConnection === '2g' || effectiveConnection === '3g';
    if (slowNet) {
      pressureBonus += 12;
      reasons.push(saveData
        ? 'Économiseur de données actif : blocage réseau des polices et GIFs.'
        : `Connexion limitée (${effectiveConnection}) : réduction des téléchargements réseau.`);
    }

    // Cap non-critical transient pressure so a healthy mid-range laptop lands in Eco rather than blocking all images
    const cappedPressure = criticalPressure ? Math.min(pressureBonus, 45) : Math.min(pressureBonus, 24);

    // Compute final capacity index (0 = very weak/under heavy load, 100 = very fast/idle)
    const baseCapacity = capacityPoints.length > 0
      ? capacityPoints.reduce((a, b) => a + b, 0) / capacityPoints.length
      : 65;

    const effectiveCapacity = clamp(Math.round(baseCapacity - cappedPressure), 0, 100);

    let profileId;
    if (effectiveCapacity < 25) {
      profileId = 'extreme';
    } else if (effectiveCapacity < 52) {
      profileId = 'eco';
    } else if (effectiveCapacity < 76) {
      profileId = 'balanced';
    } else {
      profileId = 'light';
    }

    const baseProfile = defaultsMod.PROFILES[profileId];
    const recommendedSettings = { ...baseProfile.settings, enabled: true };

    // Fine-tune RAM limiter thresholds based on actual RAM & tab load
    if (typeof ramTotalGB === 'number' && ramTotalGB > 0) {
      if (ramTotalGB <= 4 || (typeof ramFreePercent === 'number' && ramFreePercent < 15)) {
        recommendedSettings.ramIdleMinutes = 3;
        recommendedSettings.ramMaxActiveTabs = 4;
      } else if (ramTotalGB <= 8 || (typeof ramFreePercent === 'number' && ramFreePercent < 25)) {
        recommendedSettings.ramIdleMinutes = 10;
        recommendedSettings.ramMaxActiveTabs = 8;
      } else if (ramTotalGB <= 16) {
        recommendedSettings.ramIdleMinutes = activeLoaded >= 25 ? 10 : 20;
        recommendedSettings.ramMaxActiveTabs = 12;
      } else {
        recommendedSettings.ramIdleMinutes = activeLoaded >= 35 ? 20 : 45;
        recommendedSettings.ramMaxActiveTabs = 20;
      }
    }

    // Fine-tune network blocking when on slow connection / saveData
    if (slowNet) {
      recommendedSettings.blockGifs = true;
      recommendedSettings.blockWebFonts = true;
      recommendedSettings.systemFonts = true;
      if (effectiveConnection === 'slow-2g' || effectiveConnection === '2g') {
        recommendedSettings.blockImages = true;
      }
    }

    // Fine-tune for very heavy DOM page
    if (typeof pageDomNodes === 'number' && pageDomNodes >= 3500) {
      recommendedSettings.contentVisibility = true;
      recommendedSettings.noWillChange = true;
      reasons.push(`Page actuelle très dense (${pageDomNodes} éléments DOM) : content-visibility activé.`);
    }

    if (reasons.length === 0) {
      reasons.push(`Machine équilibrée détectée : profil ${baseProfile.label} appliqué.`);
    }

    return {
      profileId,
      profileLabel: baseProfile.label,
      tagline: baseProfile.tagline,
      effectiveCapacity,
      recommendedSettings,
      reasons: reasons.slice(0, 4),
      detectedSpecs: {
        cpuCores: typeof cpuCores === 'number' ? cpuCores : null,
        cpuModel: cpuModel || null,
        cpuLoadPercent: typeof cpuLoadPercent === 'number' ? Math.round(cpuLoadPercent) : null,
        ramTotalGB: typeof ramTotalGB === 'number' ? Number(ramTotalGB.toFixed(1)) : null,
        ramAvailableGB: typeof ramAvailableGB === 'number' ? Number(ramAvailableGB.toFixed(1)) : null,
        ramFreePercent: typeof ramFreePercent === 'number' ? Math.round(ramFreePercent) : null,
        ramSource: ramSource || null,
        benchmarkMs: typeof benchmarkMs === 'number' ? Math.round(benchmarkMs) : null,
        openTabsCount,
        loadedTabsCount: activeLoaded,
        discardedTabsCount,
        onBattery,
        batteryLevel: typeof batteryLevel === 'number' ? Math.round(batteryLevel * 100) : null,
        effectiveConnection: effectiveConnection || null
      },
      timestamp: Date.now()
    };
  }

  const PROFILE_ORDER = ['light', 'balanced', 'eco', 'extreme'];
  const AUTO_SWITCH_COOLDOWN_MS = 2 * 60 * 1000; // 2 min anti-flapping cooldown

  /**
   * Decides whether the automatic adaptive mode should switch profiles based on
   * live telemetry, applying hysteresis/cooldown to prevent rapid oscillation.
   */
  function decideAdaptiveTransition(currentProfileId, scanReport, lastSwitchAt = 0, nowMs = Date.now()) {
    if (!scanReport || !scanReport.profileId) {
      return { shouldSwitch: false, reason: 'no-report' };
    }

    const targetId = scanReport.profileId;
    if (targetId === currentProfileId) {
      return { shouldSwitch: false, reason: 'already-optimal' };
    }

    const specs = scanReport.detectedSpecs || {};
    const isCriticalEmergency =
      (typeof specs.ramFreePercent === 'number' && specs.ramFreePercent < 12) ||
      (typeof specs.cpuLoadPercent === 'number' && specs.cpuLoadPercent >= 90);

    const elapsed = nowMs - (Number(lastSwitchAt) || 0);
    if (!isCriticalEmergency && lastSwitchAt > 0 && elapsed < AUTO_SWITCH_COOLDOWN_MS) {
      return { shouldSwitch: false, reason: 'cooldown' };
    }

    const currIdx = PROFILE_ORDER.indexOf(currentProfileId);
    const nextIdx = PROFILE_ORDER.indexOf(targetId);

    // Build a concise factual reason for the UI
    let summaryReason = scanReport.reasons && scanReport.reasons[0]
      ? scanReport.reasons[0]
      : `Adaptation vers ${scanReport.profileLabel}`;

    if (typeof specs.ramFreePercent === 'number' && specs.ramFreePercent < 15) {
      summaryReason = `RAM libre ${specs.ramFreePercent}%`;
    } else if (typeof specs.cpuLoadPercent === 'number' && specs.cpuLoadPercent >= 80) {
      summaryReason = `CPU à ${specs.cpuLoadPercent}%`;
    } else if (typeof specs.loadedTabsCount === 'number' && specs.loadedTabsCount >= 18) {
      summaryReason = `${specs.loadedTabsCount} onglets en RAM`;
    } else if (specs.onBattery === true && typeof specs.batteryLevel === 'number' && specs.batteryLevel <= 25) {
      summaryReason = `Batterie ${specs.batteryLevel}%`;
    } else if (currIdx >= 0 && nextIdx >= 0 && nextIdx < currIdx) {
      summaryReason = 'Charge redevenue faible';
    }

    return {
      shouldSwitch: true,
      fromProfileId: currentProfileId,
      nextProfileId: targetId,
      nextProfileLabel: scanReport.profileLabel,
      reason: summaryReason,
      recommendedSettings: scanReport.recommendedSettings,
      timestamp: nowMs
    };
  }

  const exported = {
    evaluateScan,
    decideAdaptiveTransition,
    AUTO_SWITCH_COOLDOWN_MS
  };

  root.PotatoMode = root.PotatoMode || {};
  root.PotatoMode.scanner = exported;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
