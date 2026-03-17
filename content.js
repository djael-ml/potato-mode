(function() {
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
        'pauseVideos'
    ];
    let settings = {
        enabled: true,
        blockImages: false,
        darkMode: false,
        systemFonts: false,
        disableAnimations: true,
        removeUIEffects: true,
        grayscaleMedia: true,
        blockGifs: true,
        pauseVideos: true
    };

    function updateDOMClasses() {
        const body = document.body;
        if (!body) return;

        const active = settings.enabled;
        body.classList.toggle('pm-enabled', active);
        body.classList.toggle('pm-block-images', active && settings.blockImages);
        body.classList.toggle('pm-dark-mode', active && settings.darkMode);
        body.classList.toggle('pm-system-fonts', active && settings.systemFonts);
        body.classList.toggle('pm-no-animations', active && settings.disableAnimations);
        body.classList.toggle('pm-no-ui-effects', active && settings.removeUIEffects);
        body.classList.toggle('pm-grayscale', active && settings.grayscaleMedia);
        body.classList.toggle('pm-no-gifs', active && settings.blockGifs);
        body.classList.toggle('pm-pause-videos', active && settings.pauseVideos);
    }

    function optimizeMedia(node) {
        if (!settings.enabled || !settings.pauseVideos || !node || node.nodeType !== Node.ELEMENT_NODE) return;

        const videos = node.tagName === 'VIDEO' ? [node] : node.querySelectorAll('video');
        videos.forEach(v => {
            v.pause();
            v.removeAttribute('autoplay');
            v.setAttribute('preload', 'none');
        });
    }

    // Performance optimized observer
    const observer = new MutationObserver((mutations) => {
        if (!settings.enabled || !settings.pauseVideos) return;
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                optimizeMedia(node);
            }
        }
    });

    // Initialize
    chrome.storage.local.get(SETTINGS_KEYS, (result) => {
        Object.assign(settings, result);
        
        // Apply classes when body is available
        const applyAction = () => {
            updateDOMClasses();
            optimizeMedia(document.body);
            if (settings.enabled && settings.pauseVideos) {
                observer.observe(document.documentElement, { childList: true, subtree: true });
            }
        };

        if (document.body) {
            applyAction();
        } else {
            document.addEventListener('DOMContentLoaded', applyAction);
        }
    });

    // Listen for changes
    chrome.storage.onChanged.addListener((changes) => {
        for (const [key, { newValue }] of Object.entries(changes)) {
            if (SETTINGS_KEYS.includes(key)) {
                settings[key] = newValue;
            }
        }
        updateDOMClasses();
        
        if (!settings.enabled || !settings.pauseVideos) {
            observer.disconnect();
        } else {
            observer.observe(document.documentElement, { childList: true, subtree: true });
        }
    });
})();
