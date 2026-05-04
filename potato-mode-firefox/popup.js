document.addEventListener('DOMContentLoaded', () => {
    const controls = [
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
    const state = {};

    // Load state
    chrome.storage.local.get(controls, (result) => {
        const defaults = {
            enabled: true,
            disableAnimations: true,
            removeUIEffects: true,
            grayscaleMedia: true,
            blockGifs: true,
            pauseVideos: true,
            blockImages: false,
            darkMode: false,
            systemFonts: false
        };

        const updateSubOptionsUI = (isEnabled) => {
            controls.forEach(id => {
                if (id === 'enabled') return;
                const el = document.getElementById(id);
                const container = el.closest('.control-item');
                if (isEnabled) {
                    container.classList.remove('disabled');
                } else {
                    container.classList.add('disabled');
                }
            });
        };

        controls.forEach(id => {
            const el = document.getElementById(id);
            state[id] = result[id] ?? defaults[id];
            el.checked = state[id];
            
            el.addEventListener('change', (e) => {
                const newState = {};
                newState[id] = e.target.checked;
                chrome.storage.local.set(newState);
                if (id === 'enabled') {
                    updateSubOptionsUI(e.target.checked);
                }
            });
        });

        updateSubOptionsUI(state['enabled']);
    });
});
