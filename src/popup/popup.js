// Potato Mode v3.1 — Minimalist Apple Glassmorphism Popup Controller
// 100% real telemetry, real-time adaptive auto-switching, zero inline handlers.
(function () {
  'use strict';

  const { api, defaults, perfScore } = globalThis.PotatoMode;

  const CIRCUMFERENCE = 2 * Math.PI * 49; // r = 49 -> 307.88

  const TOGGLE_KEYS = [
    'enabled',
    'autoAdaptiveMode',
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

  function formatCompact(n) {
    if (typeof n !== 'number') return '—';
    if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  // ---------------- Real Hardware Signals & Micro-Benchmark ----------------

  function runRealMicroBenchmark() {
    return new Promise((resolve) => {
      const start = performance.now();
      let acc = 0;
      for (let i = 1; i <= 180000; i++) {
        acc += Math.sqrt(i) * Math.sin(i * 0.001);
      }
      const computeMs = performance.now() - start;

      const stamps = [];
      let done = false;
      const guard = setTimeout(() => {
        if (!done) {
          done = true;
          resolve({ benchmarkMs: Number(computeMs.toFixed(1)), frameJitterMs: null, _c: acc });
        }
      }, 260);

      function frame(ts) {
        if (done) return;
        stamps.push(ts);
        if (stamps.length >= 6) {
          done = true;
          clearTimeout(guard);
          const deltas = [];
          for (let i = 1; i < stamps.length; i++) deltas.push(stamps[i] - stamps[i - 1]);
          const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
          const variance = deltas.reduce((s, d) => s + Math.pow(d - avg, 2), 0) / deltas.length;
          resolve({
            benchmarkMs: Number(computeMs.toFixed(1)),
            frameJitterMs: Number(Math.sqrt(variance).toFixed(2)),
            _c: acc
          });
          return;
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  async function collectClientEnv(withBenchmark = false) {
    const bench = withBenchmark ? await runRealMicroBenchmark() : { benchmarkMs: null, frameJitterMs: null };

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

  function resolvePopupVisualState() {
    const tab = liveTelemetry && liveTelemetry.activeTab;
    if (tab && tab.isRestricted) return 'error';
    if (!state.enabled) return 'inactive';
    if (tab && tab.hostname && defaults.isDomainWhitelisted(tab.hostname, state)) return 'paused';
    if (defaults.isExtremeMode(state)) return 'extreme';
    return 'active';
  }

  function renderHeaderAndSite() {
    const visualState = resolvePopupVisualState();
    document.body.setAttribute('data-state', visualState);
    $('brandIcon').src = `../icons/${visualState}-48.png`;

    const badge = $('headerBadge');
    const prof = defaults.PROFILES[state.activeProfile];
    const profName = prof ? prof.label : 'Perso';
    const isAuto = !!state.autoAdaptiveMode && state.controlMode === 'auto';
    const isScanned = !isAuto && state.controlMode === 'scanned';

    if (visualState === 'inactive') badge.textContent = 'OFF';
    else if (visualState === 'paused') badge.textContent = 'Pause';
    else if (visualState === 'error') badge.textContent = 'Système';
    else if (isAuto) badge.textContent = `Auto · ${profName}`;
    else if (isScanned) badge.textContent = `Scanné · ${profName}`;
    else badge.textContent = profName;

    // Adaptive status caption — 100% mutually exclusive between Auto, Scanned, and Manual
    const adaptiveSub = $('adaptiveStatus');
    const autoNote = $('autoLiveNote');
    const scanZone = $('scanZone');

    if (!state.enabled) {
      adaptiveSub.textContent = 'Potato Mode désactivé';
      autoNote.hidden = true;
      scanZone.hidden = true;
    } else if (isAuto) {
      const sw = state.lastAutoSwitch;
      if (sw && sw.reason) {
        adaptiveSub.textContent = `${profName} · ${sw.reason}`;
      } else {
        adaptiveSub.textContent = `Estimation continue (${profName})`;
      }
      autoNote.hidden = false;
      autoNote.textContent = 'Réévaluation automatique toutes les 60 s';
      scanZone.hidden = true;
    } else if (isScanned) {
      adaptiveSub.textContent = `Calibré par scan (${profName}) · fixe`;
      autoNote.hidden = true;
      scanZone.hidden = false;
    } else {
      adaptiveSub.textContent = `Profil manuel (${profName})`;
      autoNote.hidden = true;
      scanZone.hidden = false;
    }

    // Current site row
    const tab = liveTelemetry && liveTelemetry.activeTab;
    const led = $('siteLed');
    const hostEl = $('siteHost');
    const btn = $('toggleSiteBtn');

    if (!tab || tab.isRestricted) {
      led.className = 'site-dot error';
      hostEl.textContent = 'Page système';
      btn.textContent = 'Protégée';
      btn.disabled = true;
      btn.classList.remove('is-paused');
    } else {
      const excluded = defaults.isDomainWhitelisted(tab.hostname, state);
      hostEl.textContent = tab.hostname || 'Site actuel';
      btn.disabled = false;
      if (!state.enabled) {
        led.className = 'site-dot off';
        btn.textContent = excluded ? 'Exclu' : 'Exclure';
        btn.classList.toggle('is-paused', excluded);
      } else if (excluded) {
        led.className = 'site-dot paused';
        btn.textContent = 'Réactiver';
        btn.classList.add('is-paused');
      } else {
        led.className = 'site-dot';
        btn.textContent = 'Exclure';
        btn.classList.remove('is-paused');
      }
    }
  }

  function renderScoreHero() {
    const arc = $('scoreArc');
    const numEl = $('scoreNum');
    const gradeEl = $('scoreGrade');

    if (!liveTelemetry) {
      numEl.textContent = '—';
      gradeEl.textContent = 'Mesure…';
      return;
    }

    const { activeTab: tab, page, memory: mem, tabs: tabsInfo } = liveTelemetry;

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
      arc.style.stroke = 'var(--text-3)';
    } else {
      numEl.textContent = String(scoreRes.score);
      gradeEl.textContent = scoreRes.grade;
      arc.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - scoreRes.score / 100));
      if (scoreRes.score >= 80) arc.style.stroke = 'var(--green)';
      else if (scoreRes.score >= 55) arc.style.stroke = 'var(--accent)';
      else arc.style.stroke = 'var(--red)';
    }

    // Whisper-quiet real inline telemetry strip
    $('metricFps').textContent = page && typeof page.fps === 'number' ? `${page.fps} FPS` : '— FPS';

    if (mem && typeof mem.ramFreePercent === 'number') {
      $('metricMem').textContent = `${Math.round(mem.ramFreePercent)}% RAM libre`;
    } else if (tabsInfo) {
      $('metricMem').textContent = `${tabsInfo.loadedTabsCount}/${tabsInfo.openTabsCount} onglets`;
    } else {
      $('metricMem').textContent = '—';
    }

    $('metricDom').textContent = page && typeof page.domNodes === 'number'
      ? `${formatCompact(page.domNodes)} DOM`
      : '— DOM';
  }

  function renderScanDisclosure(report) {
    const disc = $('scanDisclosure');
    // Only show manual scan diagnostic in Scanned mode (never in Auto mode)
    if (!report || !report.detectedSpecs || state.controlMode !== 'scanned' || state.autoAdaptiveMode) {
      disc.hidden = true;
      return;
    }

    const s = report.detectedSpecs;
    const summaryParts = [];
    if (typeof s.cpuCores === 'number') summaryParts.push(`${s.cpuCores} cœurs`);
    if (typeof s.ramTotalGB === 'number') summaryParts.push(`${s.ramTotalGB} Go RAM`);
    else if (typeof s.benchmarkMs === 'number') summaryParts.push(`Bench ${s.benchmarkMs} ms`);
    summaryParts.push(`Profil ${report.profileLabel}`);

    $('scanSummaryLine').textContent = summaryParts.join(' · ');

    const fullSpecs = [];
    if (typeof s.cpuCores === 'number') fullSpecs.push(`${s.cpuCores} cœurs`);
    if (typeof s.cpuLoadPercent === 'number') fullSpecs.push(`CPU ${s.cpuLoadPercent}%`);
    if (typeof s.ramTotalGB === 'number') {
      fullSpecs.push(
        typeof s.ramFreePercent === 'number'
          ? `${s.ramTotalGB} Go RAM (${s.ramFreePercent}% libre)`
          : `~${s.ramTotalGB} Go RAM`
      );
    }
    if (typeof s.benchmarkMs === 'number') fullSpecs.push(`Bench ${s.benchmarkMs} ms`);
    if (typeof s.loadedTabsCount === 'number') fullSpecs.push(`${s.loadedTabsCount} onglets RAM`);
    if (s.onBattery === true && typeof s.batteryLevel === 'number') fullSpecs.push(`Batterie ${s.batteryLevel}%`);
    $('scanSpecs').textContent = fullSpecs.join(' · ');

    const reasonsEl = $('scanReasons');
    reasonsEl.textContent = '';
    for (const r of report.reasons || []) {
      const li = document.createElement('li');
      li.textContent = r;
      reasonsEl.appendChild(li);
    }

    disc.hidden = false;
  }

  function renderRamView() {
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

    const sorted = [...tabsInfo.list].sort((a, b) => Number(a.discarded) - Number(b.discarded)).slice(0, 10);
    for (const t of sorted) {
      const row = document.createElement('div');
      row.className = 'bg-tab-row';

      const copy = document.createElement('div');
      copy.className = 'bg-tab-copy';

      const title = document.createElement('span');
      title.className = 'bg-tab-title';
      title.textContent = t.title;

      const host = document.createElement('span');
      host.className = 'bg-tab-host';
      host.textContent = t.hostname;

      copy.append(title, host);
      row.appendChild(copy);

      if (t.discarded) {
        const tag = document.createElement('span');
        tag.className = 'tab-tag';
        tag.textContent = 'En veille';
        row.appendChild(tag);
      } else if (t.pinned || t.audible) {
        const tag = document.createElement('span');
        tag.className = 'tab-tag';
        tag.textContent = t.audible ? 'Audio' : 'Épinglé';
        row.appendChild(tag);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ghost-pill';
        btn.textContent = 'Veille';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const res = await api.runtimeSendMessage({ action: 'discardSingleTab', tabId: t.id });
          if (res && res.ok) await refreshTelemetry();
          else btn.disabled = false;
        });
        row.appendChild(btn);
      }

      listEl.appendChild(row);
    }
  }

  function renderControls() {
    for (const key of TOGGLE_KEYS) {
      const el = $(key);
      if (el && el.type === 'checkbox') el.checked = !!state[key];
      if (key !== 'enabled' && key !== 'autoAdaptiveMode') {
        const row = $('item-' + key);
        if (row) row.classList.toggle('disabled-item', !state.enabled);
      }
    }

    document.querySelectorAll('.prof-btn').forEach((btn) => {
      btn.classList.toggle('active', state.enabled && btn.dataset.profile === state.activeProfile);
    });

    const wl = $('whitelistDomains');
    if (wl && document.activeElement !== wl) wl.value = state.whitelistDomains || '';

    const cssEl = $('customCSSCode');
    if (cssEl && document.activeElement !== cssEl) cssEl.value = state.customCSSCode || '';
  }

  function renderAll() {
    renderHeaderAndSite();
    renderControls();
    renderScoreHero();
    renderRamView();
    renderScanDisclosure(state.lastScanReport);
  }

  async function refreshTelemetry() {
    const res = await api.runtimeSendMessage({ action: 'getLiveTelemetry' });
    if (res && res.ok && res.data) liveTelemetry = res.data;
    const fresh = await api.storageGet(defaults.SETTINGS_KEYS);
    state = { ...defaults.DEFAULTS, ...fresh };
    renderAll();
  }

  async function savePartial(patch) {
    Object.assign(state, patch);
    await api.storageSet(patch);
    renderAll();
    setTimeout(refreshTelemetry, 180);
  }

  // ---------------- Event Wiring ----------------

  function wireEvents() {
    // Top 3-view navigation
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        document.querySelectorAll('.nav-btn').forEach((b) => {
          const isAct = b === btn;
          b.classList.toggle('active', isAct);
          b.setAttribute('aria-selected', String(isAct));
        });
        document.querySelectorAll('.view').forEach((v) => {
          const match = v.id === `view-${target}`;
          v.hidden = !match;
          v.classList.toggle('active', match);
        });
      });
    });

    // Switches
    for (const key of TOGGLE_KEYS) {
      const el = $(key);
      if (!el) continue;
      el.addEventListener('change', async (e) => {
        const checked = e.target.checked;
        if (key === 'autoAdaptiveMode') {
          if (checked) {
            await savePartial({
              autoAdaptiveMode: true,
              controlMode: 'auto',
              lastAutoSwitch: null
            });
            if (state.enabled) {
              const env = await collectClientEnv(false);
              await api.runtimeSendMessage({ action: 'updateClientEnv', env });
              await api.runtimeSendMessage({ action: 'triggerAutoAdaptive' });
              await refreshTelemetry();
            }
          } else {
            await savePartial({
              autoAdaptiveMode: false,
              controlMode: 'manual'
            });
          }
          return;
        }

        const patch = { [key]: checked };
        if (key === 'blockWebFonts' && checked) patch.systemFonts = true;
        if (key !== 'enabled' && key !== 'whitelist' && key !== 'customCSS' && key !== 'ramProtectForms') {
          patch.activeProfile = 'custom';
          patch.autoAdaptiveMode = false;
          patch.controlMode = 'manual';
        }
        savePartial(patch);
      });
    }

    // Manual profile selection pauses Auto Adaptive cleanly
    document.querySelectorAll('.prof-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const profile = defaults.PROFILES[btn.dataset.profile];
        if (!profile) return;
        savePartial({
          ...profile.settings,
          enabled: true,
          autoAdaptiveMode: false,
          controlMode: 'manual'
        });
      });
    });

    // Per-site 1-click toggle
    $('toggleSiteBtn').addEventListener('click', async () => {
      const tab = liveTelemetry && liveTelemetry.activeTab;
      if (!tab || tab.isRestricted || !tab.hostname) return;
      const res = await api.runtimeSendMessage({ action: 'toggleCurrentSite', hostname: tab.hostname });
      if (res && res.ok) {
        state.whitelist = true;
        state.whitelistDomains = res.whitelistDomains;
        renderAll();
        setTimeout(refreshTelemetry, 180);
      }
    });

    // Manual one-shot PC Scan button (mutually exclusive with Auto Adaptive)
    $('scanBtn').addEventListener('click', async () => {
      const btn = $('scanBtn');
      const txt = $('scanBtnText');
      btn.disabled = true;
      btn.classList.add('scanning');
      txt.textContent = 'Analyse du PC…';

      try {
        const clientMetrics = await collectClientEnv(true);
        const res = await api.runtimeSendMessage({ action: 'runAdaptiveScan', clientMetrics });
        if (res && res.ok && res.report) {
          Object.assign(state, res.report.recommendedSettings, {
            lastScanReport: res.report,
            controlMode: 'scanned',
            autoAdaptiveMode: false,
            lastAutoSwitch: null
          });
          txt.textContent = `Profil ${res.report.profileLabel} appliqué`;
          await refreshTelemetry();
        } else {
          txt.textContent = 'Scanner mon PC';
        }
      } finally {
        btn.disabled = false;
        btn.classList.remove('scanning');
        setTimeout(() => { txt.textContent = 'Scanner mon PC'; }, 2400);
      }
    });

    // RAM controls
    $('ramIdleMinutes').addEventListener('change', (e) => {
      savePartial({
        ramIdleMinutes: Number(e.target.value),
        activeProfile: 'custom',
        autoAdaptiveMode: false,
        controlMode: 'manual'
      });
    });

    $('ramMaxActiveTabs').addEventListener('change', (e) => {
      savePartial({
        ramMaxActiveTabs: Number(e.target.value),
        activeProfile: 'custom',
        autoAdaptiveMode: false,
        controlMode: 'manual'
      });
    });

    $('discardNowBtn').addEventListener('click', async () => {
      const btn = $('discardNowBtn');
      const fb = $('ramFeedback');
      btn.disabled = true;
      btn.textContent = 'Mise en veille…';

      const res = await api.runtimeSendMessage({ action: 'discardNow' });
      btn.disabled = false;
      btn.textContent = 'Libérer la RAM maintenant';

      if (res && res.ok && res.result) {
        const { discardedCount, freedMB } = res.result;
        fb.hidden = false;
        if (discardedCount === 0) {
          fb.textContent = 'Tous les onglets éligibles sont déjà en veille.';
        } else if (typeof freedMB === 'number' && freedMB > 0) {
          fb.textContent = `${discardedCount} onglet(s) en veille · ~${freedMB} Mo libérés`;
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
      wlTimer = setTimeout(() => savePartial({ whitelistDomains: e.target.value }), 350);
    });

    let cssTimer;
    $('customCSSCode').addEventListener('input', (e) => {
      clearTimeout(cssTimer);
      cssTimer = setTimeout(() => savePartial({ customCSSCode: e.target.value }), 350);
    });

    // Export / Import / Reset
    $('exportBtn').addEventListener('click', () => {
      const payload = {};
      for (const k of defaults.SETTINGS_KEYS) {
        if (k !== 'lastScanReport' && k !== 'lastAutoSwitch') payload[k] = state[k];
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'potato-mode-settings.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    $('importBtn').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          const safe = {};
          for (const k of defaults.SETTINGS_KEYS) {
            if (parsed[k] !== undefined && k !== 'lastScanReport' && k !== 'lastAutoSwitch') {
              safe[k] = parsed[k];
            }
          }
          savePartial(safe);
        } catch (_) {}
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    $('resetBtn').addEventListener('click', () => savePartial({ ...defaults.DEFAULTS }));
  }

  document.addEventListener('DOMContentLoaded', async () => {
    wireEvents();
    const stored = await api.storageGet(defaults.SETTINGS_KEYS);
    state = { ...defaults.DEFAULTS, ...stored };
    renderAll();

    // Silently share latest battery/network hints with background for auto-adaptive mode
    collectClientEnv(false).then((env) => {
      api.runtimeSendMessage({ action: 'updateClientEnv', env });
    });

    await refreshTelemetry();
  });
})();
