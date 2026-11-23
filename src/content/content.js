// Potato Mode v3.0 — Content Script Engine
// Injected at document_start; applies classes to <html> immediately, collects REAL telemetry.
(function () {
  'use strict';

  // Never impact extension popups, browser UI, or non-HTTP(S) pages
  if (
    typeof window === 'undefined' ||
    !window.location ||
    (window.location.protocol !== 'http:' && window.location.protocol !== 'https:')
  ) {
    return;
  }

  const { api, defaults } = globalThis.PotatoMode || {};
  if (!api || !defaults) return;

  let settings = { ...defaults.DEFAULTS };
  let isWhitelisted = false;
  let customStyleEl = null;
  let readerOverlayEl = null;
  let readerFontSize = 19;
  let dirtyFormNotified = false;

  // Real runtime counters for this page (zero fabricated numbers)
  const pageCounters = {
    videosPaused: 0,
    lazyLoaded: 0,
    longTaskCount: 0,
    longTaskTotalMs: 0
  };

  // Track videos we already paused once so manual user playback is respected
  const handledVideos = new WeakSet();
  // Track elements un-stuck so we can cleanly restore them when toggled off
  const unstuckElements = new Set();

  // ---------------- Real Long Tasks Observer ----------------
  try {
    if (typeof PerformanceObserver !== 'undefined') {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          pageCounters.longTaskCount++;
          pageCounters.longTaskTotalMs += entry.duration || 0;
        }
      });
      po.observe({ entryTypes: ['longtask'] });
    }
  } catch (_) {
    // Supported on Chromium; gracefully ignored on browsers without longtask observer
  }

  function shouldApply() {
    return !!settings.enabled && !isWhitelisted;
  }

  function updateWhitelistFlag() {
    isWhitelisted = defaults.isDomainWhitelisted(window.location.hostname, settings);
  }

  // ---------------- Immediate <html> Class Sync (Zero FOUC) ----------------

  function updateRootClasses() {
    const rootEl = document.documentElement;
    if (!rootEl) return;

    const active = shouldApply();
    rootEl.classList.toggle('pm-enabled', active);
    rootEl.classList.toggle('pm-no-animations', active && !!settings.disableAnimations);
    rootEl.classList.toggle('pm-kill-gpu', active && !!settings.killGpuEffects);
    rootEl.classList.toggle('pm-no-ui-effects', active && !!settings.removeUIEffects);
    rootEl.classList.toggle('pm-no-will-change', active && !!settings.noWillChange);
    rootEl.classList.toggle('pm-content-visibility', active && !!settings.contentVisibility);
    rootEl.classList.toggle('pm-grayscale', active && !!settings.grayscaleMedia);
    rootEl.classList.toggle('pm-no-gifs', active && !!settings.blockGifs);
    rootEl.classList.toggle('pm-block-images', active && !!settings.blockImages);
    rootEl.classList.toggle('pm-block-iframes', active && !!settings.blockIframes);
    rootEl.classList.toggle('pm-dark-mode', active && !!settings.darkMode);
    rootEl.classList.toggle('pm-system-fonts', active && (!!settings.systemFonts || !!settings.blockWebFonts));
    rootEl.classList.toggle('pm-no-sticky', active && !!settings.noSticky);
    rootEl.classList.toggle('pm-no-popups', active && !!settings.noPopups);
  }

  // ---------------- Custom CSS Injection ----------------

  function applyCustomCSS() {
    if (!shouldApply() || !settings.customCSS || !settings.customCSSCode) {
      if (customStyleEl) {
        customStyleEl.remove();
        customStyleEl = null;
      }
      return;
    }
    const target = document.head || document.documentElement;
    if (!target) return;

    if (!customStyleEl) {
      customStyleEl = document.createElement('style');
      customStyleEl.id = 'pm-custom-css';
      target.appendChild(customStyleEl);
    }
    customStyleEl.textContent = settings.customCSSCode;
  }

  // ---------------- Smart Media & Lazy-Load Optimizer ----------------

  function optimizeMediaNode(node) {
    if (!shouldApply() || !node || node.nodeType !== Node.ELEMENT_NODE) return;

    if (settings.pauseVideos) {
      const videos = node.tagName === 'VIDEO' ? [node] : node.querySelectorAll('video');
      for (const v of videos) {
        if (handledVideos.has(v)) continue;
        handledVideos.add(v);
        v.removeAttribute('autoplay');
        if (v.getAttribute('preload') !== 'none') {
          v.setAttribute('preload', 'none');
        }
        if (!v.paused) {
          try {
            v.pause();
            pageCounters.videosPaused++;
          } catch (_) {}
        }
      }
    }

    if (settings.lazyLoadAll) {
      const imgs = node.tagName === 'IMG' ? [node] : node.querySelectorAll('img');
      for (const img of imgs) {
        let touched = false;
        if (img.getAttribute('loading') !== 'lazy') {
          img.setAttribute('loading', 'lazy');
          touched = true;
        }
        if (img.getAttribute('decoding') !== 'async') {
          img.setAttribute('decoding', 'async');
          touched = true;
        }
        if (touched) pageCounters.lazyLoaded++;
      }

      const iframes = node.tagName === 'IFRAME' ? [node] : node.querySelectorAll('iframe');
      for (const frame of iframes) {
        if (frame.getAttribute('loading') !== 'lazy') {
          frame.setAttribute('loading', 'lazy');
          pageCounters.lazyLoaded++;
        }
      }
    }
  }

  // Pause videos automatically when tab becomes hidden to save CPU/battery
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !shouldApply() || !settings.pauseVideos) return;
    document.querySelectorAll('video').forEach((v) => {
      if (!v.paused) {
        try {
          v.pause();
          pageCounters.videosPaused++;
        } catch (_) {}
      }
    });
  });

  // ---------------- Lightweight Reversible Sticky Neutralizer ----------------

  function applyStickyFix() {
    if (!shouldApply() || !settings.noSticky) {
      for (const el of unstuckElements) {
        if (el && el.isConnected) {
          el.removeAttribute('data-pm-unstick');
        }
      }
      unstuckElements.clear();
      return;
    }

    // Targeted structural candidates only — NEVER querySelectorAll('*')!
    const candidates = document.querySelectorAll(
      'header, nav, aside, [role="banner"], [class*="sticky" i], [class*="navbar" i], [class*="topbar" i]'
    );
    for (const el of candidates) {
      const pos = window.getComputedStyle(el).position;
      if (pos === 'sticky' || pos === '-webkit-sticky') {
        el.setAttribute('data-pm-unstick', '1');
        unstuckElements.add(el);
      }
    }
  }

  // ---------------- Reversible Apple-Style Reader Mode ----------------

  function removeReaderMode() {
    if (readerOverlayEl) {
      readerOverlayEl.remove();
      readerOverlayEl = null;
    }
    if (document.documentElement) {
      document.documentElement.classList.remove('pm-reader-active');
    }
  }

  function applyReaderMode() {
    if (!shouldApply() || !settings.readerMode) {
      removeReaderMode();
      return;
    }
    if (!document.body || readerOverlayEl) return;

    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.article-content',
      '.post-content',
      '.entry-content',
      '.story-body',
      '#main-content',
      '#content'
    ];

    let sourceEl = null;
    for (const sel of selectors) {
      const candidate = document.querySelector(sel);
      if (candidate && candidate.innerText && candidate.innerText.trim().length > 280) {
        sourceEl = candidate;
        break;
      }
    }
    if (!sourceEl) return;

    const overlay = document.createElement('div');
    overlay.id = 'pm-reader-overlay';

    const toolbar = document.createElement('div');
    toolbar.id = 'pm-reader-toolbar';

    const label = document.createElement('span');
    label.textContent = 'Mode Lecture';

    const btnSmaller = document.createElement('button');
    btnSmaller.type = 'button';
    btnSmaller.textContent = 'A−';

    const btnLarger = document.createElement('button');
    btnLarger.type = 'button';
    btnLarger.textContent = 'A+';

    const btnExit = document.createElement('button');
    btnExit.type = 'button';
    btnExit.textContent = 'Quitter';

    const article = document.createElement('div');
    article.id = 'pm-reader-article';
    article.style.setProperty('--pm-reader-size', `${readerFontSize}px`);

    // Clone safely and strip scripts/iframes inside reader view
    const cloned = sourceEl.cloneNode(true);
    cloned.querySelectorAll('script, style, iframe, noscript, form, button').forEach((n) => n.remove());
    article.appendChild(cloned);

    btnSmaller.addEventListener('click', () => {
      readerFontSize = Math.max(14, readerFontSize - 2);
      article.style.setProperty('--pm-reader-size', `${readerFontSize}px`);
    });
    btnLarger.addEventListener('click', () => {
      readerFontSize = Math.min(28, readerFontSize + 2);
      article.style.setProperty('--pm-reader-size', `${readerFontSize}px`);
    });
    btnExit.addEventListener('click', () => {
      removeReaderMode();
      api.storageSet({ readerMode: false });
    });

    toolbar.append(label, btnSmaller, btnLarger, btnExit);
    overlay.append(toolbar, article);

    document.body.appendChild(overlay);
    document.documentElement.classList.add('pm-reader-active');
    readerOverlayEl = overlay;
  }

  // ---------------- Batched Low-CPU MutationObserver ----------------

  let pendingNodes = [];
  let flushScheduled = false;

  function flushPendingNodes() {
    flushScheduled = false;
    const batch = pendingNodes;
    pendingNodes = [];
    for (const node of batch) {
      if (node.isConnected) {
        optimizeMediaNode(node);
      }
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (!shouldApply()) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          pendingNodes.push(node);
        }
      }
    }
    if (pendingNodes.length > 0 && !flushScheduled) {
      flushScheduled = true;
      requestAnimationFrame(flushPendingNodes);
    }
  });

  function syncObserver() {
    if (shouldApply() && (settings.pauseVideos || settings.lazyLoadAll)) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } else {
      observer.disconnect();
    }
  }

  // ---------------- Dirty Form Protection for RAM Limiter ----------------

  function markFormDirty() {
    if (dirtyFormNotified) return;
    dirtyFormNotified = true;
    api.runtimeSendMessage({ action: 'formDirty', dirty: true });
  }

  document.addEventListener(
    'input',
    (ev) => {
      const el = ev.target;
      if (!el) return;
      if (
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable ||
        (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'submit'].includes(el.type))
      ) {
        markFormDirty();
      }
    },
    { passive: true, capture: true }
  );

  // ---------------- Real Live Telemetry & Micro-Benchmark ----------------

  function measureShortFpsAndJitter(frameCount = 7) {
    return new Promise((resolve) => {
      if (document.hidden || typeof requestAnimationFrame !== 'function') {
        resolve({ fps: null, frameJitterMs: null });
        return;
      }
      const timestamps = [];
      let done = false;
      const safety = setTimeout(() => {
        if (!done) {
          done = true;
          resolve({ fps: null, frameJitterMs: null });
        }
      }, 450);

      function step(ts) {
        if (done) return;
        timestamps.push(ts);
        if (timestamps.length >= frameCount) {
          done = true;
          clearTimeout(safety);
          const deltas = [];
          for (let i = 1; i < timestamps.length; i++) {
            const d = timestamps[i] - timestamps[i - 1];
            if (d > 0 && d < 500) deltas.push(d);
          }
          if (deltas.length === 0) {
            resolve({ fps: null, frameJitterMs: null });
            return;
          }
          const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
          const variance = deltas.reduce((acc, d) => acc + Math.pow(d - avg, 2), 0) / deltas.length;
          resolve({
            fps: Math.min(240, Math.round(1000 / avg)),
            frameJitterMs: Number(Math.sqrt(variance).toFixed(2))
          });
          return;
        }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  async function collectPageTelemetry() {
    const domNodes = document.getElementsByTagName('*').length;
    const iframesCount = document.getElementsByTagName('iframe').length;

    let resourceCount = null;
    let transferBytes = null;
    try {
      const resources = performance.getEntriesByType('resource');
      resourceCount = resources.length;
      let bytes = 0;
      for (const r of resources) {
        if (typeof r.transferSize === 'number' && r.transferSize > 0) {
          bytes += r.transferSize;
        }
      }
      transferBytes = bytes;
    } catch (_) {}

    let jsHeapUsedMB = null;
    if (performance && performance.memory && typeof performance.memory.usedJSHeapSize === 'number') {
      jsHeapUsedMB = Number((performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1));
    }

    const { fps, frameJitterMs } = await measureShortFpsAndJitter(7);

    return {
      fps,
      frameJitterMs,
      domNodes,
      resourceCount,
      transferBytes,
      jsHeapUsedMB,
      longTaskCount: pageCounters.longTaskCount,
      longTaskTotalMs: Math.round(pageCounters.longTaskTotalMs),
      actions: {
        videosPaused: pageCounters.videosPaused,
        lazyLoaded: pageCounters.lazyLoaded,
        iframesHidden: shouldApply() && settings.blockIframes ? iframesCount : 0
      }
    };
  }

  // ---------------- Apply All ----------------

  function applyAll() {
    updateWhitelistFlag();
    updateRootClasses();
    applyCustomCSS();

    if (document.body) {
      optimizeMediaNode(document.body);
      applyReaderMode();
      if (settings.noSticky || unstuckElements.size > 0) {
        requestAnimationFrame(applyStickyFix);
      }
    }
    syncObserver();
  }

  // Initialize as early as possible (document_start)
  api.storageGet(defaults.SETTINGS_KEYS).then((stored) => {
    settings = { ...defaults.DEFAULTS, ...stored };
    updateWhitelistFlag();
    updateRootClasses();
    applyCustomCSS();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyAll, { once: true });
    } else {
      applyAll();
    }
  });

  // React instantly to setting changes
  if (api.raw && api.raw.storage && api.raw.storage.onChanged) {
    api.raw.storage.onChanged.addListener((changes, area) => {
      if (area && area !== 'local') return;
      let touched = false;
      for (const [key, change] of Object.entries(changes)) {
        if (defaults.SETTINGS_KEYS.includes(key)) {
          settings[key] = change.newValue;
          touched = true;
        }
      }
      if (touched) applyAll();
    });
  }

  // Respond to popup/background live telemetry requests
  if (api.raw && api.raw.runtime && api.raw.runtime.onMessage) {
    api.raw.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || !msg.action) return false;
      if (msg.action === 'getPageTelemetry') {
        collectPageTelemetry().then((data) => sendResponse(data));
        return true;
      }
      if (msg.action === 'reapply') {
        applyAll();
        sendResponse({ ok: true });
        return false;
      }
      return false;
    });
  }
})();
