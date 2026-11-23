(function (root) {
  'use strict';

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  /**
   * Computes a 100% REAL performance score (0-100) from actual browser & page telemetry.
   * Never uses static option weights or fabricated numbers.
   *
   * @param {object} metrics
   * @returns {object} { score, grade, statusTone, breakdown, hasPageData }
   */
  function computeRealPerfScore(metrics = {}) {
    const {
      isRestricted = false,
      fps = null,
      longTaskCount = null,
      longTaskTotalMs = null,
      domNodes = null,
      resourceCount = null,
      transferBytes = null,
      jsHeapUsedMB = null,
      ramFreePercent = null,
      openTabsCount = null,
      loadedTabsCount = null
    } = metrics;

    if (isRestricted) {
      return {
        score: null,
        grade: 'Page système',
        statusTone: 'restricted',
        breakdown: {},
        hasPageData: false
      };
    }

    const weightedParts = [];
    const breakdown = {};

    // 1. Real FPS fluidity (weight 35)
    if (typeof fps === 'number' && fps > 0) {
      // 60+ fps -> 100, 45 fps -> 75, 30 fps -> 45, 15 fps -> 15
      const fpsScore = clamp(Math.round(((fps - 10) / 50) * 100), 5, 100);
      breakdown.fpsScore = fpsScore;
      weightedParts.push({ weight: 35, value: fpsScore });
    }

    // 2. Real Main-Thread responsiveness via Long Tasks >50ms (weight 25)
    if (typeof longTaskCount === 'number' || typeof longTaskTotalMs === 'number') {
      const totalMs = typeof longTaskTotalMs === 'number' ? longTaskTotalMs : 0;
      const count = typeof longTaskCount === 'number' ? longTaskCount : 0;
      // 0ms -> 100, 200ms -> ~80, 1000ms -> ~35, 2500ms+ -> 10
      const penalty = (totalMs / 25) + (count * 3);
      const mainThreadScore = clamp(Math.round(100 - penalty), 10, 100);
      breakdown.mainThreadScore = mainThreadScore;
      weightedParts.push({ weight: 25, value: mainThreadScore });
    }

    // 3. Real DOM complexity & resource load (weight 20)
    if (typeof domNodes === 'number' && domNodes >= 0) {
      // <= 800 nodes -> 100, 2000 -> 78, 5000 -> 45, 10000+ -> 15
      let domScore = 100;
      if (domNodes > 800) {
        domScore = clamp(Math.round(100 - ((domNodes - 800) / 95)), 15, 100);
      }
      if (typeof resourceCount === 'number' && resourceCount > 120) {
        domScore = clamp(domScore - Math.min(18, Math.round((resourceCount - 120) / 15)), 10, 100);
      }
      if (typeof transferBytes === 'number' && transferBytes > 5 * 1024 * 1024) {
        const extraMB = (transferBytes / (1024 * 1024)) - 5;
        domScore = clamp(domScore - Math.min(15, Math.round(extraMB * 1.5)), 10, 100);
      }
      breakdown.domScore = domScore;
      weightedParts.push({ weight: 20, value: domScore });
    }

    // 4. Real Memory / Tab pressure (weight 20)
    const memComponents = [];
    if (typeof ramFreePercent === 'number') {
      // 45%+ free -> 100, 25% -> 65, 10% -> 25
      memComponents.push(clamp(Math.round((ramFreePercent / 45) * 100), 10, 100));
    }
    if (typeof jsHeapUsedMB === 'number' && jsHeapUsedMB > 0) {
      // <= 40MB -> 100, 150MB -> 65, 400MB+ -> 15
      const heapScore = jsHeapUsedMB <= 40
        ? 100
        : clamp(Math.round(100 - ((jsHeapUsedMB - 40) / 4.2)), 15, 100);
      memComponents.push(heapScore);
    }
    if (typeof loadedTabsCount === 'number' && loadedTabsCount >= 0) {
      // <= 8 loaded tabs -> 100, 20 -> 70, 45+ -> 20
      const tabScore = loadedTabsCount <= 8
        ? 100
        : clamp(Math.round(100 - ((loadedTabsCount - 8) * 2.2)), 20, 100);
      memComponents.push(tabScore);
    } else if (typeof openTabsCount === 'number' && openTabsCount >= 0) {
      const tabScore = openTabsCount <= 10
        ? 100
        : clamp(Math.round(100 - ((openTabsCount - 10) * 1.8)), 25, 100);
      memComponents.push(tabScore);
    }

    if (memComponents.length > 0) {
      const memoryScore = Math.round(memComponents.reduce((a, b) => a + b, 0) / memComponents.length);
      breakdown.memoryScore = memoryScore;
      weightedParts.push({ weight: 20, value: memoryScore });
    }

    if (weightedParts.length === 0) {
      return {
        score: null,
        grade: 'Mesure…',
        statusTone: 'neutral',
        breakdown,
        hasPageData: false
      };
    }

    const totalWeight = weightedParts.reduce((acc, p) => acc + p.weight, 0);
    const weightedSum = weightedParts.reduce((acc, p) => acc + (p.value * p.weight), 0);
    const score = clamp(Math.round(weightedSum / totalWeight), 0, 100);

    let grade;
    let statusTone;
    if (score >= 85) {
      grade = 'Optimal';
      statusTone = 'optimal';
    } else if (score >= 70) {
      grade = 'Fluide';
      statusTone = 'good';
    } else if (score >= 50) {
      grade = 'Modéré';
      statusTone = 'moderate';
    } else if (score >= 30) {
      grade = 'Chargé';
      statusTone = 'heavy';
    } else {
      grade = 'Critique';
      statusTone = 'critical';
    }

    return {
      score,
      grade,
      statusTone,
      breakdown,
      hasPageData: true
    };
  }

  const exported = {
    computeRealPerfScore
  };

  root.PotatoMode = root.PotatoMode || {};
  root.PotatoMode.perfScore = exported;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
