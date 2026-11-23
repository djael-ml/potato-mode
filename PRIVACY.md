# Privacy Policy — Potato Mode

**Potato Mode** is built to be strictly **private by design**.

## Data Collection
- **Zero Personal Data Collection**: Potato Mode never collects, logs, or transmits any browsing history, page content, hardware specifications, or personally identifiable information.
- **100% Local Storage**: All settings, whitelists, custom CSS, and local scan summaries remain strictly on your device in `storage.local`.
- **Zero External Network Calls**: The extension loads zero third-party fonts, scripts, trackers, or analytics endpoints.

## Permissions Explained
- **`storage`**: Saves your local preferences and whitelist domains.
- **`tabs`**: Displays the current domain in the popup, updates the toolbar icon per tab, and powers the optional RAM Limiter (`tabs.discard`) to suspend idle background tabs.
- **`alarms`**: Schedules lightweight periodic RAM sweeps without keeping a persistent background process running.
- **`declarativeNetRequest`**: Blocks selected heavy assets (WebFonts, GIFs, images, or media streams) natively inside the browser engine before they are downloaded.
- **`system.memory` & `system.cpu` (Chrome / Chromium only)**: Reads local available RAM and CPU capacity solely on your device to calibrate the Adaptive PC Scan and live score. Nothing ever leaves your machine.
- **`<all_urls>`**: Applies your chosen CSS/JS optimizations to web pages you visit (never runs on restricted browser system pages).

## Contact
Questions or issues: [djael-ml/potato-mode](https://github.com/djael-ml/potato-mode)
