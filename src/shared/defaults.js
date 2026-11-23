(function (root) {
  'use strict';

  const VERSION = '3.1.0';

  const DEFAULTS = {
    enabled: true,
    autoAdaptiveMode: true,
    activeProfile: 'balanced',
    lastAutoSwitch: null,

    // Performance
    disableAnimations: true,
    killGpuEffects: true,
    removeUIEffects: false,
    noWillChange: true,
    contentVisibility: false,
    lazyLoadAll: true,

    // Media & Network (DNR + DOM)
    pauseVideos: true,
    blockGifs: true,
    blockWebFonts: false,
    blockImages: false,
    blockHeavyMedia: false,
    blockIframes: false,
    grayscaleMedia: false,

    // Interface
    darkMode: false,
    systemFonts: false,
    noSticky: false,
    noPopups: true,
    readerMode: false,

    // RAM Limiter (tabs.discard)
    ramLimiterEnabled: true,
    ramIdleMinutes: 20,
    ramMaxActiveTabs: 12,
    ramProtectForms: true,

    // Advanced
    customCSS: false,
    customCSSCode: '',
    whitelist: true,
    whitelistDomains: '',

    // Persisted real diagnostics & counters
    lastScanReport: null,
    statsTabsSuspended: 0
  };

  const SETTINGS_KEYS = Object.keys(DEFAULTS);

  const PROFILES = {
    light: {
      id: 'light',
      label: 'Léger',
      tagline: 'PC puissant · Fluide sans altérer le design',
      settings: {
        activeProfile: 'light',
        disableAnimations: true,
        killGpuEffects: false,
        removeUIEffects: false,
        noWillChange: true,
        contentVisibility: false,
        lazyLoadAll: true,
        pauseVideos: true,
        blockGifs: false,
        blockWebFonts: false,
        blockImages: false,
        blockHeavyMedia: false,
        blockIframes: false,
        grayscaleMedia: false,
        systemFonts: false,
        noSticky: false,
        noPopups: true,
        ramLimiterEnabled: true,
        ramIdleMinutes: 45,
        ramMaxActiveTabs: 20
      }
    },
    balanced: {
      id: 'balanced',
      label: 'Équilibré',
      tagline: 'Recommandé · Gain net CPU/GPU & RAM',
      settings: {
        activeProfile: 'balanced',
        disableAnimations: true,
        killGpuEffects: true,
        removeUIEffects: false,
        noWillChange: true,
        contentVisibility: true,
        lazyLoadAll: true,
        pauseVideos: true,
        blockGifs: true,
        blockWebFonts: false,
        blockImages: false,
        blockHeavyMedia: false,
        blockIframes: false,
        grayscaleMedia: false,
        systemFonts: false,
        noSticky: false,
        noPopups: true,
        ramLimiterEnabled: true,
        ramIdleMinutes: 20,
        ramMaxActiveTabs: 12
      }
    },
    eco: {
      id: 'eco',
      label: 'Éco',
      tagline: 'PC modeste ou batterie · Économie réseau & RAM',
      settings: {
        activeProfile: 'eco',
        disableAnimations: true,
        killGpuEffects: true,
        removeUIEffects: true,
        noWillChange: true,
        contentVisibility: true,
        lazyLoadAll: true,
        pauseVideos: true,
        blockGifs: true,
        blockWebFonts: true,
        blockImages: false,
        blockHeavyMedia: false,
        blockIframes: true,
        grayscaleMedia: false,
        systemFonts: true,
        noSticky: true,
        noPopups: true,
        ramLimiterEnabled: true,
        ramIdleMinutes: 10,
        ramMaxActiveTabs: 8
      }
    },
    extreme: {
      id: 'extreme',
      label: 'Patate Max',
      tagline: 'Vieux PC / RAM saturée · Blocage réseau maximal',
      settings: {
        activeProfile: 'extreme',
        disableAnimations: true,
        killGpuEffects: true,
        removeUIEffects: true,
        noWillChange: true,
        contentVisibility: true,
        lazyLoadAll: true,
        pauseVideos: true,
        blockGifs: true,
        blockWebFonts: true,
        blockImages: true,
        blockHeavyMedia: true,
        blockIframes: true,
        grayscaleMedia: false,
        systemFonts: true,
        noSticky: true,
        noPopups: true,
        ramLimiterEnabled: true,
        ramIdleMinutes: 3,
        ramMaxActiveTabs: 4
      }
    }
  };

  const DNR_RULE_IDS = {
    BLOCK_WEBFONTS: 1001,
    BLOCK_GIFS: 1002,
    BLOCK_IMAGES: 1003,
    BLOCK_HEAVY_MEDIA: 1004
  };

  const RESTRICTED_PREFIXES = [
    'chrome://',
    'chrome-extension://',
    'chrome-search://',
    'devtools://',
    'edge://',
    'brave://',
    'opera://',
    'vivaldi://',
    'about:',
    'moz-extension://',
    'view-source:',
    'file://',
    'data:',
    'javascript:'
  ];

  const RESTRICTED_HOSTS = [
    'chrome.google.com',
    'chromewebstore.google.com',
    'addons.mozilla.org',
    'accounts-static.cdn.mozilla.net'
  ];

  function normalizeDomain(input) {
    if (!input || typeof input !== 'string') return '';
    let cleaned = input.trim().toLowerCase();
    if (!cleaned) return '';
    cleaned = cleaned.replace(/^[a-z]+:\/\//, '');
    cleaned = cleaned.split('/')[0].split(':')[0];
    cleaned = cleaned.replace(/^www\./, '').replace(/^\.+|\.+$/g, '');
    return cleaned;
  }

  function extractHostname(url) {
    if (!url || typeof url !== 'string') return '';
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      return normalizeDomain(parsed.hostname);
    } catch (_) {
      return '';
    }
  }

  function isRestrictedUrl(url) {
    if (!url || typeof url !== 'string') return true;
    const lower = url.toLowerCase();
    for (const prefix of RESTRICTED_PREFIXES) {
      if (lower.startsWith(prefix)) return true;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
      const host = parsed.hostname.toLowerCase();
      if (host === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')) return true;
      if (RESTRICTED_HOSTS.includes(host) && host !== 'chrome.google.com') return true;
      return false;
    } catch (_) {
      return true;
    }
  }

  function parseWhitelist(raw) {
    if (!raw || typeof raw !== 'string') return [];
    const seen = new Set();
    const out = [];
    for (const token of raw.split(/[\n,;]+/)) {
      const domain = normalizeDomain(token);
      if (domain && !seen.has(domain)) {
        seen.add(domain);
        out.push(domain);
      }
    }
    return out;
  }

  function isDomainWhitelisted(hostnameOrUrl, settings) {
    if (!settings || !settings.whitelist || !settings.whitelistDomains) return false;
    const host = hostnameOrUrl && hostnameOrUrl.includes('://')
      ? extractHostname(hostnameOrUrl)
      : normalizeDomain(hostnameOrUrl);
    if (!host) return false;
    const domains = parseWhitelist(settings.whitelistDomains);
    return domains.some((d) => host === d || host.endsWith('.' + d));
  }

  function toggleDomainInWhitelist(hostnameOrUrl, rawDomains) {
    const host = hostnameOrUrl && hostnameOrUrl.includes('://')
      ? extractHostname(hostnameOrUrl)
      : normalizeDomain(hostnameOrUrl);
    if (!host) return { nextDomains: rawDomains || '', added: false, domain: '' };

    const domains = parseWhitelist(rawDomains);
    const exists = domains.some((d) => host === d || host.endsWith('.' + d));
    let nextList;
    if (exists) {
      nextList = domains.filter((d) => !(host === d || host.endsWith('.' + d)));
    } else {
      nextList = [...domains, host];
    }
    return {
      nextDomains: nextList.join('\n'),
      added: !exists,
      domain: host
    };
  }

  function isExtremeMode(settings) {
    if (!settings || !settings.enabled) return false;
    return settings.activeProfile === 'extreme' || (
      !!settings.blockImages && !!settings.blockWebFonts && !!settings.disableAnimations
    );
  }

  const exported = {
    VERSION,
    DEFAULTS,
    SETTINGS_KEYS,
    PROFILES,
    DNR_RULE_IDS,
    normalizeDomain,
    extractHostname,
    isRestrictedUrl,
    parseWhitelist,
    isDomainWhitelisted,
    toggleDomainInWhitelist,
    isExtremeMode
  };

  root.PotatoMode = root.PotatoMode || {};
  root.PotatoMode.defaults = exported;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
