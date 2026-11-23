// Potato Mode v3.0 — Popup Controller (Apple Glassmorphism UI)
// 100% real telemetry, zero fabricated scores, zero inline event handlers.
(function () {
  'use strict';

  const { api, defaults, perfScore } = globalThis.PotatoMode;

  const CIRCUMFERENCE = 2 * Math.PI * 36; // r = 36 -> 226.19

  const TOGGLE_KEYS = [
    'enabled',
    'disableAnimations',
    'killGpuEffects',
    'noWillChange',
    'contentVisibility',
    'lazyLoadAll',
    'removeUIEffects',
    'pauseVideos',
    'blockGifs',
    'blockWebFonts',
    'blockImages',
    'blockHeavyMedia',
    'blockIframes',
    'grayscaleMedia',
    'noPopups',
    'darkMode',
    'systemFonts',
    'noSticky',
    'readerMode',
    'ramLimiterEnabled',
    'ramProtectForms',
    'whitelist',
    'customCSS'
  ];

  let state = { ...defaults.DEFAULTS };
  let liveTelemetry = null;

  function $(id) {
    return document.getElementById(id);
  }

  function formatCompactNumber(n) {
    if (typeof n !== 'number') return '—';
    if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  // ---------------- Real Client Hardware Signals + Micro-Benchmark ----------------

  function runRealMicroBenchmark() {
    return new Promise((resolve) => {
      const start = performance.now();
      // Deterministic lightweight integer/float compute workload (~5–60ms depending on real CPU)
      let acc = 0;
      for (let i = 1; i <= 180000; i++) {
        acc += Math.sqrt(i) * Math.sin(i * 0.001);
      }
      const computeMs = performance.now() - start;

      // Measure real 6-frame rAF jitter
      const stamps = [];
      let done = false;
      const guard = setTimeout(() => {
        if (!done) {
          done = true;
          resolve({ benchmarkMs: computeMs, frameJitterMs: null, _checksum: acc });
        }
      }, 260);

      function frame(ts) {
        if (done) return;
        stamps.push(ts);
        if (stamps.length >= 6) {
          done = true;
          clearTimeout(guard);
          const deltas = [];
          for (let i = 1; i < stamps.length; i++) {
            deltas.push(stamps[i] - stamps[i - 1]);
          }
          const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
          const variance = deltas.reduce((s, d) => s + Math.pow(d - avg, 2), 0) / deltas.length;
          resolve({
            benchmarkMs: Number(computeMs.toFixed(1)),
            frameJitterMs: Number(Math.sqrt(variance).toFixed(2)),
            _checksum: acc
          });
          return;
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  async function collectClientHardwareSignals() {
    const bench = await runRealMicroBenchmark();

    let onBattery = null;
    let batteryLevel = null;
    if (typeof navigator.getBattery === 'function') {
      try {
        const bat = await navigator.getBattery();
        onBattery = !bat.charging;
        batteryLevel = typeof bat.level === 'number' ? bat.level : null;
      } catch (_) {}
    }

    let saveData = null;
    let effectiveConnection = null;
    if (navigator.connection) {
      saveData = typeof navigator.connection.saveData === 'boolean' ? navigator.connection.saveData : null;
      effectiveConnection = navigator.connection.effectiveType || null;
    }

    return {
      activeTabId: liveTelemetry && liveTelemetry.activeTab ? liveTelemetry.activeTab.id : undefined,
      hardwareConcurrency: typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null,
      deviceMemoryGB: typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null,
      benchmarkMs: bench.benchmarkMs,
      frameJitterMs: bench.frameJitterMs,
      onBattery,
      batteryLevel,
      saveData,
      effectiveConnection
    };
  }

  // ---------------- Visual State & Rendering ----------------

  function resolveCurrentPopupState() {
    const tab = liveTelemetry && liveTelemetry.activeTab;
    if (tab && tab.isRestricted) return 'error';
    if (!state.enabled) return 'inactive';
    if (tab && tab.hostname && defaults.isDomainWhitelisted(tab.hostname, state)) return 'paused';
    if (defaults.isExtremeMode(state)) return 'extreme';
    return 'active';
  }

  function renderHeaderAndSite() {
    const visualState = resolveCurrentPopupState();
    document.body.setAttribute('data-state', visualState);

    const iconEl = $('brandIcon');
    if (iconEl) iconEl.src = `../icons/${visualState}-48.png`;

    const profileObj = defaults.PROFILES[state.activeProfile];
    const profileName = profileObj ? profileObj.label : 'Personnalisé';

    const sub = $('statusSubtitle');
    if (visualState === 'inactive') {
      sub.textContent = 'Désactivé';
    } else if (visualState === 'paused') {
      sub.textContent = 'En pause sur ce site';
    } else if (visualState === 'error') {
      sub.textContent = 'Page système protégée';
    } else if (visualState === 'extreme') {
      sub.textContent = 'Actif · Patate Max';
    } else {
      sub.textContent = `Actif · ${profileName}`;
    }

    const tab = liveTelemetry && liveTelemetry.activeTab;
    const led = $('siteLed');
    const hostEl = $('siteHost');
    const siteBtn = $('toggleSiteBtn');

    if (!tab || tab.isRestricted) {
      led.className = 'status-led error';
      hostEl.textContent = 'Page système du navigateur';
      siteBtn.textContent = 'Protégée';
      siteBtn.disabled = true;
      siteBtn.classList.remove('is-paused');
    } else {
      const excluded = defaults.isDomainWhitelisted(tab.hostname, state);
      hostEl.textContent = tab.hostname || 'Site actuel';
      siteBtn.disabled = false;
      if (!state.enabled) {
        led.className = 'status-led off';
        siteBtn.textContent = excluded ? 'Exclu' : 'Exclure';
        siteBtn.classList.toggle('is-paused', excluded);
      } else if (excluded) {
        led.className = 'status-led paused';
        siteBtn.textContent = 'Réactiver';
        siteBtn.classList.add('is-paused');
      } else {
        led.className = 'status-led';
        siteBtn.textContent = 'Exclure';
        siteBtn.classList.remove('is-paused');
      }
    }
  }

  function renderRealScoreAndMetrics() {
    const arc = $('scoreArc');
    const numEl = $('scoreNum');
    const gradeEl = $('scoreGrade');

    if (!liveTelemetry) {
      numEl.textContent = '—';
      gradeEl.textContent = 'Mesure…';
      return;
    }

    const tab = liveTelemetry.activeTab;
    const page = liveTelemetry.page;
    const mem = liveTelemetry.memory;
    const tabsInfo = liveTelemetry.tabs;

    const scoreRes = perfScore.computeRealPerfScore({
      isRestricted: tab && tab.isRestricted,
      fps: page ? page.fps : null,
      longTaskCount: page ? page.longTaskCount : null,
      longTaskTotalMs: page ? page.longTaskTotalMs : null,
      domNodes: page ? page.domNodes : null,
      resourceCount: page ? page.resourceCount : null,
      transferBytes: page ? page.transferBytes : null,
      jsHeapUsedMB: page ? page.jsHeapUsedMB : null,
      ramFreePercent: mem ? mem.ramFreePercent : null,
      openTabsCount: tabsInfo ? tabsInfo.openTabsCount : null,
      loadedTabsCount: tabsInfo ? tabsInfo.loadedTabsCount : null
    });

    if (scoreRes.score === null) {
      numEl.textContent = '—';
      gradeEl.textContent = scoreRes.grade;
      arc.style.strokeDashoffset = String(CIRCUMFERENCE);
      arc.style.stroke = 'var(--text-tertiary)';
    } else {
      numEl.textContent = String(scoreRes.score);
      gradeEl.textContent = scoreRes.grade;
      const offset = CIRCUMFERENCE * (1 - scoreRes.score / 100);
      arc.style.strokeDashoffset = String(offset);

      if (scoreRes.score >= 80) arc.style.stroke = 'var(--green)';
      else if (scoreRes.score >= 55) arc.style.stroke = 'var(--accent)';
      else arc.style.stroke = 'var(--red)';
    }

    // Tile 1: Real FPS
    $('metricFps').textContent = page && typeof page.fps === 'number' ? `${page.fps} FPS` : '—';

    // Tile 2: Real System RAM (Chrome) OR Real Loaded Tabs (Firefox) — never fabricated!
    if (mem && typeof mem.ramFreePercent === 'number') {
      $('metricMemLabel').textContent = 'RAM libre';
      $('metricMem').textContent = `${Math.round(mem.ramFreePercent)}% (${mem.ramAvailableGB.toFixed(1)} Go)`;
    } else if (tabsInfo) {
      $('metricMemLabel').textContent = 'Onglets RAM';
      $('metricMem').textContent = `${tabsInfo.loadedTabsCount}/${tabsInfo.openTabsCount}`;
    } else {
      $('metricMem').textContent = '—';
    }

    // Tile 3: Real DOM node count
    $('metricDom').textContent = page && typeof page.domNodes === 'number'
      ? `${formatCompactNumber(page.domNodes)} nœuds`
      : '—';

    // Tile 4: Real active protection counters (DNR rules + real actions)
    const dnr = liveTelemetry.dnrRulesActive || 0;
    const pausedVids = page && page.actions ? page.actions.videosPaused : 0;
    const sleeping = tabsInfo ? tabsInfo.discardedTabsCount : 0;
    const parts = [];
    if (dnr > 0) parts.push(`${dnr} DNR`);
    if (sleeping > 0) parts.push(`${sleeping} veille`);
    else if (pausedVids > 0) parts.push(`${pausedVids} vid.`);
    $('metricActions').textContent = parts.length > 0 ? parts.join(' · ') : (state.enabled ? 'Actif' : 'OFF');
  }

  function renderScanReport(report) {
    const box = $('scanReport');
    if (!report || !report.detectedSpecs) {
      box.hidden = true;
      return;
    }

    const specsEl = $('scanSpecs');
    const reasonsEl = $('scanReasons');
    const s = report.detectedSpecs;

    specsEl.textContent = '';
    const chips = [];
    if (typeof s.cpuCores === 'number') chips.push(`${s.cpuCores} cœurs`);
    if (typeof s.cpuLoadPercent === 'number') chips.push(`CPU ${s.cpuLoadPercent}%`);
    if (typeof s.ramTotalGB === 'number') {
      chips.push(
        typeof s.ramFreePercent === 'number'
          ? `${s.ramTotalGB} Go RAM (${s.ramFreePercent}% libre)`
          : `~${s.ramTotalGB} Go RAM`
      );
    }
    if (typeof s.benchmarkMs === 'number') chips.push(`Bench ${s.benchmarkMs} ms`);
    if (typeof s.loadedTabsCount === 'number') chips.push(`${s.loadedTabsCount} onglets RAM`);
    if (s.onBattery === true && typeof s.batteryLevel === 'number') chips.push(`Batterie ${s.batteryLevel}%`);
    if (s.effectiveConnection) chips.push(`Réseau ${s.effectiveConnection}`);
    chips.push(`Profil ${report.profileLabel}`);

    for (const label of chips) {
      const span = document.createElement('span');
      span.className = 'spec-chip';
      span.textContent = label;
      specsEl.appendChild(span);
    }

    reasonsEl.textContent = '';
    for (const reason of report.reasons || []) {
      const li = document.createElement('li');
      li.textContent = reason;
      reasonsEl.appendChild(li);
    }

    box.hidden = false;
  }

  function renderRamPanel() {
    const tabsInfo = liveTelemetry && liveTelemetry.tabs;
    $('ramLoadedCount').textContent = tabsInfo ? String(tabsInfo.loadedTabsCount) : '—';
    $('ramSleepingCount').textContent = tabsInfo ? String(tabsInfo.discardedTabsCount) : '—';
    $('ramTotalSaved').textContent = String(Number(state.statsTabsSuspended) || 0);

    $('ramIdleMinutes').value = String(state.ramIdleMinutes);
    $('ramMaxActiveTabs').value = String(state.ramMaxActiveTabs);

    const listEl = $('backgroundTabsList');
    listEl.textContent = '';

    if (!tabsInfo || !Array.isArray(tabsInfo.list) || tabsInfo.list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-hint';
      empty.textContent = 'Aucun autre onglet web ouvert';
      listEl.appendChild(empty);
      return;
    }

    // Show loaded background tabs first, up to 8 items for a clean compact UI
    const sorted = [...tabsInfo.list].sort((a, b) => Number(a.discarded) - Number(b.discarded)).slice(0, 8);

    for (const t of sorted) {
      const row = document.createElement('div');
      row.className = 'bg-tab-row';

      const info = document.createElement('div');
      info.className = 'bg-tab-info';

      const title = document.createElement('span');
      title.className = 'bg-tab-title';
      title.textContent = t.title;

      const host = document.createElement('span');
      host.className = 'bg-tab-host';
      host.textContent = t.hostname;

      info.append(title, host);
      row.appendChild(info);

      if (t.discarded) {
        const badge = document.createElement('span');
        badge.className = 'tab-badge';
        badge.textContent = 'En veille';
        row.appendChild(badge);
      } else if (t.pinned || t.audible) {
        const badge = document.createElement('span');
        badge.className = 'tab-badge';
        badge.textContent = t.audible ? 'Audio' : 'Épinglé';
        row.appendChild(badge);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pill-btn';
        btn.textContent = 'Veille';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const res = await api.runtimeSendMessage({ action: 'discardSingleTab', tabId: t.id });
          if (res && res.ok) {
            await refreshTelemetry();
          } else {
            btn.disabled = false;
          }
        });
        row.appendChild(btn);
      }

      listEl.appendChild(row);
    }
  }

  function renderControls() {
    for (const key of TOGGLE_KEYS) {
      const el = $(key);
      if (el && el.type === 'checkbox') {
        el.checked = !!state[key];
      }
      if (key !== 'enabled') {
        const row = $('item-' + key);
        if (row) {
          row.classList.toggle('disabled-item', !state.enabled);
        }
      }
    }

    document.querySelectorAll('.profile-chip').forEach((btn) => {
      btn.classList.toggle('active', state.enabled && btn.dataset.profile === state.activeProfile);
    });

    const wl = $('whitelistDomains');
    if (wl && document.activeElement !== wl) {
      wl.value = state.whitelistDomains || '';
    }

    const cssEl = $('customCSSCode');
    if (cssEl && document.activeElement !== cssEl) {
      cssEl.value = state.customCSSCode || '';
    }
    const cssBox = $('customCSSBox');
    if (cssBox) cssBox.hidden = !state.customCSS;
  }

  function renderAll() {
    renderHeaderAndSite();
    renderControls();
    renderRealScoreAndMetrics();
    renderRamPanel();
    renderScanReport(state.lastScanReport);
  }

  async function refreshTelemetry() {
    const res = await api.runtimeSendMessage({ action: 'getLiveTelemetry' });
    if (res && res.ok && res.data) {
      liveTelemetry = res.data;
    }
    const fresh = await api.storageGet(defaults.SETTINGS_KEYS);
    state = { ...defaults.DEFAULTS, ...fresh };
    renderAll();
  }

  async function savePartial(patch) {
    Object.assign(state, patch);
    await api.storageSet(patch);
    renderAll();
    // Refresh live telemetry briefly after settings change so DNR/score reflects reality
    setTimeout(refreshTelemetry, 180);
  }

  // ---------------- Event Wiring ----------------

  function wireEvents() {
    // Segmented tabs
    document.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        document.querySelectorAll('.seg-btn').forEach((b) => {
          const isAct = b === btn;
          b.classList.toggle('active', isAct);
          b.setAttribute('aria-selected', String(isAct));
        });
        document.querySelectorAll('.tab-panel').forEach((panel) => {
          const match = panel.id === `panel-${target}`;
          panel.hidden = !match;
          panel.classList.toggle('active', match);
        });
      });
    });

    // Toggles
    for (const key of TOGGLE_KEYS) {
      const el = $(key);
      if (!el) continue;
      el.addEventListener('change', (e) => {
        const patch = { [key]: e.target.checked };
        if (key === 'blockWebFonts' && e.target.checked) {
          patch.systemFonts = true;
        }
        if (key !== 'enabled' && key !== 'whitelist' && key !== 'customCSS' && key !== 'ramProtectForms') {
          patch.activeProfile = 'custom';
        }
        savePartial(patch);
      });
    }

    // Quick profile pills
    document.querySelectorAll('.profile-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const profile = defaults.PROFILES[btn.dataset.profile];
        if (!profile) return;
        savePartial({ ...profile.settings, enabled: true });
      });
    });

    // Per-site 1-click toggle
    $('toggleSiteBtn').addEventListener('click', async () => {
      const tab = liveTelemetry && liveTelemetry.activeTab;
      if (!tab || tab.isRestricted || !tab.hostname) return;
      const res = await api.runtimeSendMessage({
        action: 'toggleCurrentSite',
        hostname: tab.hostname
      });
      if (res && res.ok) {
        state.whitelist = true;
        state.whitelistDomains = res.whitelistDomains;
        renderAll();
        setTimeout(refreshTelemetry, 180);
      }
    });

    // Big Heroic Adaptive Scan Button
    $('scanBtn').addEventListener('click', async () => {
      const btn = $('scanBtn');
      const title = $('scanBtnTitle');
      const sub = $('scanBtnSub');

      btn.disabled = true;
      btn.classList.add('scanning');
      title.textContent = 'Analyse du PC en cours…';
      sub.textContent = 'Mesure réelle CPU, RAM, onglets & réactivité';

      try {
        const clientMetrics = await collectClientHardwareSignals();
        const res = await api.runtimeSendMessage({
          action: 'runAdaptiveScan',
          clientMetrics
        });

        if (res && res.ok && res.report) {
          Object.assign(state, res.report.recommendedSettings, { lastScanReport: res.report });
          title.textContent = `Profil ${res.report.profileLabel} appliqué`;
          sub.textContent = res.report.tagline;
          await refreshTelemetry();
        } else {
          title.textContent = 'Scanner & Adapter mon PC';
          sub.textContent = 'Impossible de terminer le scan';
        }
      } finally {
        btn.disabled = false;
        btn.classList.remove('scanning');
        setTimeout(() => {
          title.textContent = 'Scanner & Adapter mon PC';
          sub.textContent = 'Calibre automatiquement CPU, RAM & réseau';
        }, 2800);
      }
    });

    // RAM controls
    $('ramIdleMinutes').addEventListener('change', (e) => {
      savePartial({ ramIdleMinutes: Number(e.target.value), activeProfile: 'custom' });
    });

    $('ramMaxActiveTabs').addEventListener('change', (e) => {
      savePartial({ ramMaxActiveTabs: Number(e.target.value), activeProfile: 'custom' });
    });

    $('discardNowBtn').addEventListener('click', async () => {
      const btn = $('discardNowBtn');
      const fb = $('ramFeedback');
      btn.disabled = true;
      btn.textContent = 'Mise en veille en cours…';

      const res = await api.runtimeSendMessage({ action: 'discardNow' });
      btn.disabled = false;
      btn.textContent = 'Libérer la RAM maintenant';

      if (res && res.ok && res.result) {
        const { discardedCount, freedMB } = res.result;
        fb.hidden = false;
        if (discardedCount === 0) {
          fb.textContent = 'Tous les onglets éligibles sont déjà en veille.';
        } else if (typeof freedMB === 'number' && freedMB > 0) {
          fb.textContent = `${discardedCount} onglet(s) mis en veille · ~${freedMB} Mo libérés`;
        } else {
          fb.textContent = `${discardedCount} onglet(s) mis en veille`;
        }
        await refreshTelemetry();
      }
    });

    // Debounced textareas
    let wlTimer;
    $('whitelistDomains').addEventListener('input', (e) => {
      clearTimeout(wlTimer);
      wlTimer = setTimeout(() => {
        savePartial({ whitelistDomains: e.target.value });
      }, 350);
    });

    let cssTimer;
    $('customCSSCode').addEventListener('input', (e) => {
      clearTimeout(cssTimer);
      cssTimer = setTimeout(() => {
        savePartial({ customCSSCode: e.target.value });
      }, 350);
    });

    // Export / Import / Reset
    $('exportBtn').addEventListener('click', () => {
      const payload = {};
      for (const k of defaults.SETTINGS_KEYS) {
        if (k !== 'lastScanReport') payload[k] = state[k];
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'potato-mode-settings.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    $('importBtn').addEventListener('click', () => {
      $('importFile').click();
    });

    $('importFile').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          const safe = {};
          for (const k of defaults.SETTINGS_KEYS) {
            if (parsed[k] !== undefined && k !== 'lastScanReport') {
              safe[k] = parsed[k];
            }
          }
          savePartial(safe);
        } catch (_) {}
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    $('resetBtn').addEventListener('click', () => {
      savePartial({ ...defaults.DEFAULTS });
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    wireEvents();
    const stored = await api.storageGet(defaults.SETTINGS_KEYS);
    state = { ...defaults.DEFAULTS, ...stored };
    renderAll();
    await refreshTelemetry();
  });
})();
