// Potato Mode - Background Service Worker (Chrome MV3)
'use strict';

// On install: set defaults
chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') {
        chrome.storage.local.set({
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
        });
    }
});

// Update badge to show enabled/disabled state
function updateBadge(enabled) {
    if (enabled) {
        chrome.action.setBadgeText({ text: '' });
    } else {
        chrome.action.setBadgeText({ text: 'OFF' });
        chrome.action.setBadgeBackgroundColor({ color: '#555' });
    }
}

chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled !== undefined) {
        updateBadge(changes.enabled.newValue);
    }
});

// Initialize badge on startup
chrome.storage.local.get('enabled', ({ enabled }) => {
    updateBadge(enabled ?? true);
});
