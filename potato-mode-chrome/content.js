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

    let settings = { ...DEFAULTS };
    let customStyleEl = null;
    let isWhitelisted = false;

    // Check whitelist
    function checkWhitelist() {
        if (!settings.whitelist || !settings.whitelistDomains) {
            isWhitelisted = false;
            return;
        }
        const currentDomain = window.location.hostname.replace(/^www\./, '');
        const domains = settings.whitelistDomains
            .split(/[\n,]+/)
            .map(d => d.trim().replace(/^www\./, '').toLowerCase())
            .filter(Boolean);
        isWhitelisted = domains.some(d => currentDomain === d || currentDomain.endsWith('.' + d));
    }

    function shouldApply() {
        return settings.enabled && !isWhitelisted;
    }

    function updateDOMClasses() {
        const body = document.body;
        if (!body) return;

        const active = shouldApply();
        body.classList.toggle('pm-enabled', active);
        body.classList.toggle('pm-block-images', active && settings.blockImages);
        body.classList.toggle('pm-dark-mode', active && settings.darkMode);
        body.classList.toggle('pm-system-fonts', active && settings.systemFonts);
        body.classList.toggle('pm-no-animations', active && settings.disableAnimations);
        body.classList.toggle('pm-no-ui-effects', active && settings.removeUIEffects);
        body.classList.toggle('pm-grayscale', active && settings.grayscaleMedia);
        body.classList.toggle('pm-no-gifs', active && settings.blockGifs);
        body.classList.toggle('pm-pause-videos', active && settings.pauseVideos);
        body.classList.toggle('pm-block-iframes', active && settings.blockIframes);
        body.classList.toggle('pm-no-sticky', active && settings.noSticky);
        body.classList.toggle('pm-no-popups', active && settings.noPopups);
        body.classList.toggle('pm-content-visibility', active && settings.contentVisibility);
        body.classList.toggle('pm-no-will-change', active && settings.noWillChange);
        body.classList.toggle('pm-reader-mode', active && settings.readerMode);
    }

    function applyCustomCSS() {
        if (!shouldApply() || !settings.customCSS || !settings.customCSSCode) {
            if (customStyleEl) {
                customStyleEl.remove();
                customStyleEl = null;
            }
            return;
        }
        if (!customStyleEl) {
            customStyleEl = document.createElement('style');
            customStyleEl.id = 'pm-custom-css';
            document.head?.appendChild(customStyleEl);
        }
        customStyleEl.textContent = settings.customCSSCode;
    }

    function optimizeMedia(node) {
        if (!shouldApply() || !node || node.nodeType !== Node.ELEMENT_NODE) return;

        // Pause videos
        if (settings.pauseVideos) {
            const videos = node.tagName === 'VIDEO' ? [node] : node.querySelectorAll('video');
            videos.forEach(v => {
                v.pause();
                v.removeAttribute('autoplay');
                v.setAttribute('preload', 'none');
            });
        }

        // Force lazy loading on images and iframes
        if (settings.lazyLoadAll) {
            const imgs = node.tagName === 'IMG' ? [node] : node.querySelectorAll('img');
            imgs.forEach(img => {
                if (img.getAttribute('loading') !== 'lazy') {
                    img.setAttribute('loading', 'lazy');
                }
                if (img.getAttribute('decoding') !== 'async') {
                    img.setAttribute('decoding', 'async');
                }
            });

            const iframes = node.tagName === 'IFRAME' ? [node] : node.querySelectorAll('iframe');
            iframes.forEach(iframe => {
                if (iframe.getAttribute('loading') !== 'lazy') {
                    iframe.setAttribute('loading', 'lazy');
                }
            });
        }
    }

    function applyStickyFix() {
        if (!shouldApply() || !settings.noSticky) return;
        document.querySelectorAll('*').forEach(el => {
            const style = window.getComputedStyle(el);
            if (style.position === 'sticky' || style.position === '-webkit-sticky') {
                el.style.setProperty('position', 'relative', 'important');
            }
        });
    }

    function applyReaderMode() {
        if (!shouldApply() || !settings.readerMode) return;
        if (document.getElementById('pm-reader-container')) return;

        // Try to extract main content
        const selectors = [
            'main', 'article', '[role="main"]', '.article', '.post',
            '.content', '#content', '.entry-content', '.post-content',
            '.article-content', '.story-body', '#main-content'
        ];

        let content = null;
        for (const sel of selectors) {
            content = document.querySelector(sel);
            if (content && content.innerText.length > 300) break;
        }

        if (!content) return;

        const container = document.createElement('div');
        container.id = 'pm-reader-container';
        container.innerHTML = content.innerHTML;
        document.body.appendChild(container);
        document.body.classList.add('pm-reader-mode');
    }

    // MutationObserver
    const observer = new MutationObserver((mutations) => {
        if (!shouldApply()) return;
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    optimizeMedia(node);
                }
            }
        }
    });

    function startObserver() {
        if (shouldApply() && (settings.pauseVideos || settings.lazyLoadAll)) {
            observer.observe(document.documentElement, { childList: true, subtree: true });
        } else {
            observer.disconnect();
        }
    }

    function applyAll() {
        checkWhitelist();
        updateDOMClasses();
        applyCustomCSS();
        optimizeMedia(document.body);
        applyReaderMode();
        startObserver();
        // Sticky fix needs layout to be ready
        if (settings.noSticky) {
            requestAnimationFrame(applyStickyFix);
        }
    }

    // Initialize
    chrome.storage.local.get(SETTINGS_KEYS, (result) => {
        Object.assign(settings, DEFAULTS, result);
        
        if (document.body) {
            applyAll();
        } else {
            document.addEventListener('DOMContentLoaded', applyAll, { once: true });
        }
    });

    // Listen for changes from popup
    chrome.storage.onChanged.addListener((changes) => {
        for (const [key, { newValue }] of Object.entries(changes)) {
            if (SETTINGS_KEYS.includes(key)) {
                settings[key] = newValue;
            }
        }
        applyAll();
    });

    // Listen for messages from background (tab-specific commands)
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'reapply') {
            applyAll();
        }
    });

})();
