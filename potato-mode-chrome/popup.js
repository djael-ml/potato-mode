'use strict';

const SETTINGS_KEYS = [
    'enabled',
    'blockImages',
    'darkMode',
    'systemFonts',
    'disableAnimations',
    'removeUIEffects',
    'grayscaleMedia',
    'blockGifs',
    'pauseVideos',
    'blockIframes',
    'noSticky',
    'noPopups',
    'contentVisibility',
    'noWillChange',
    'readerMode',
    'lazyLoadAll',
    'customCSS',
    'customCSSCode',
    'whitelist',
    'whitelistDomains'
];

const DEFAULTS = {
    enabled: true,
    blockImages: false,
    darkMode: false,
    systemFonts: false,
    disableAnimations: true,
    removeUIEffects: true,
    grayscaleMedia: true,
    blockGifs: true,
    pauseVideos: true,
    blockIframes: false,
    noSticky: false,
    noPopups: true,
    contentVisibility: false,
    noWillChange: true,
    readerMode: false,
    lazyLoadAll: false,
    customCSS: false,
    customCSSCode: '',
    whitelist: false,
    whitelistDomains: ''
};

// Points de perf pour chaque option (impact estimé)
const PERF_WEIGHTS = {
    disableAnimations: 18,
    noWillChange: 12,
    pauseVideos: 14,
    blockGifs: 8,
    lazyLoadAll: 10,
    blockImages: 15,
    blockIframes: 10,
    contentVisibility: 8,
    grayscaleMedia: 3,
    removeUIEffects: 5,
    noPopups: 5,
    noSticky: 3,
    darkMode: 2,
    systemFonts: 4,
    readerMode: 3,
    customCSS: 0,
    whitelist: 0
};
const MAX_PERF = Object.values(PERF_WEIGHTS).reduce((a, b) => a + b, 0);

const state = {};

function calcPerf() {
    if (!state.enabled) return 0;
    let score = 0;
    for (const [key, weight] of Object.entries(PERF_WEIGHTS)) {
        if (state[key]) score += weight;
    }
    return Math.round((score / MAX_PERF) * 100);
}

function updatePerfMeter() {
    const pct = calcPerf();
    document.getElementById('perfValue').textContent = pct + '%';
    document.getElementById('perfFill').style.width = pct + '%';

    const el = document.getElementById('perfValue');
    if (pct >= 75) el.style.color = '#4caf7d';
    else if (pct >= 40) el.style.color = '#e67e22';
    else el.style.color = '#888';
}

function updateStatusBar() {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    const masterLabel = document.getElementById('masterLabel');

    if (!state.enabled) {
        dot.className = 'status-dot off';
        text.textContent = 'DÉSACTIVÉ';
        masterLabel.textContent = 'OFF';
    } else {
        dot.className = 'status-dot';
        text.textContent = 'ACTIF';
        masterLabel.textContent = 'ON';
    }
}

function updateSubOptionsUI() {
    const isEnabled = state.enabled;
    SETTINGS_KEYS.forEach(id => {
        if (id === 'enabled') return;
        const item = document.getElementById('item-' + id);
        if (item) {
            item.classList.toggle('disabled-item', !isEnabled);
        }
    });
}

function updateControlActiveStates() {
    SETTINGS_KEYS.forEach(id => {
        if (id === 'enabled' || id === 'customCSSCode' || id === 'whitelistDomains') return;
        const item = document.getElementById('item-' + id);
        if (item) {
            item.classList.toggle('active', !!state[id]);
        }
    });
}

function updateTextareaVisibility() {
    const cssArea = document.getElementById('customCSSArea');
    const wlArea = document.getElementById('whitelistArea');
    if (cssArea) cssArea.style.display = state.customCSS ? 'block' : 'none';
    if (wlArea) wlArea.style.display = state.whitelist ? 'block' : 'none';
}

function saveKey(key, value) {
    const obj = {};
    obj[key] = value;
    chrome.storage.local.set(obj);
}

function toggleSection(name) {
    const section = document.querySelector(`.section[data-section="${name}"]`);
    if (section) section.classList.toggle('collapsed');
}
window.toggleSection = toggleSection;

function renderAll() {
    updateSubOptionsUI();
    updateControlActiveStates();
    updatePerfMeter();
    updateStatusBar();
    updateTextareaVisibility();
}

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(SETTINGS_KEYS, (result) => {
        Object.assign(state, DEFAULTS, result);

        // Wire up checkboxes
        SETTINGS_KEYS.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;

            if (el.type === 'checkbox') {
                el.checked = !!state[id];
                el.addEventListener('change', (e) => {
                    state[id] = e.target.checked;
                    saveKey(id, state[id]);
                    renderAll();
                });
            } else if (el.tagName === 'TEXTAREA') {
                el.value = state[id] || '';
                // Debounced save for textarea
                let debounceTimer;
                el.addEventListener('input', (e) => {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        state[id] = e.target.value;
                        saveKey(id, state[id]);
                    }, 400);
                });
            }
        });

        renderAll();
    });
});
