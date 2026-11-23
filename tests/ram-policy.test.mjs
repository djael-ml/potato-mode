import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ramPolicy = require('../src/shared/ram-policy.js');
const { DEFAULTS } = require('../src/shared/defaults.js');

describe('RAM Limiter Tab-Discard Policy', () => {
  const now = 1_700_000_000_000;
  const min = 60 * 1000;

  const baseTabs = [
    { id: 1, active: true, discarded: false, pinned: false, audible: false, url: 'https://perplexity.ai' },
    { id: 2, active: false, discarded: false, pinned: true, audible: false, url: 'https://mail.google.com' },
    { id: 3, active: false, discarded: false, pinned: false, audible: true, url: 'https://music.youtube.com' },
    { id: 4, active: false, discarded: false, pinned: false, audible: false, url: 'chrome://settings' },
    { id: 5, active: false, discarded: false, pinned: false, audible: false, url: 'https://figma.com/file/1' },
    { id: 6, active: false, discarded: false, pinned: false, audible: false, url: 'https://news.ycombinator.com' },
    { id: 7, active: false, discarded: false, pinned: false, audible: false, url: 'https://docs.python.org' },
    { id: 8, active: false, discarded: false, pinned: false, audible: false, url: 'https://example.org/form' },
    { id: 9, active: false, discarded: true, pinned: false, audible: false, url: 'https://already-sleeping.com' }
  ];

  const activity = {
    1: now,
    2: now - 60 * min,
    3: now - 60 * min,
    4: now - 60 * min,
    5: now - 60 * min,
    6: now - 35 * min, // idle > 20m
    7: now - 5 * min,  // recent
    8: now - 40 * min  // dirty form!
  };

  it('protects active, pinned, audible, restricted, whitelisted, and dirty-form tabs', () => {
    const settings = {
      ...DEFAULTS,
      enabled: true,
      ramLimiterEnabled: true,
      ramIdleMinutes: 20,
      ramMaxActiveTabs: 20,
      ramProtectForms: true,
      whitelist: true,
      whitelistDomains: 'figma.com'
    };

    const dirty = new Set([8]);
    const chosen = ramPolicy.selectTabsToDiscard(baseTabs, activity, settings, now, dirty, false);

    assert.deepEqual(chosen.map((c) => c.tab.id), [6]);
    assert.equal(chosen[0].reason, 'idle');
  });

  it('enforces max active loaded tabs cap by discarding oldest eligible tabs', () => {
    const settings = {
      ...DEFAULTS,
      enabled: true,
      ramLimiterEnabled: true,
      ramIdleMinutes: 999,
      ramMaxActiveTabs: 6,
      ramProtectForms: false,
      whitelist: true,
      whitelistDomains: 'figma.com'
    };

    // Total loaded = 8 (tabs 1..8). Cap = 6 -> must discard 2 oldest eligible (8 at -40m, 6 at -35m)
    const chosen = ramPolicy.selectTabsToDiscard(baseTabs, activity, settings, now, new Set(), false);
    assert.deepEqual(chosen.map((c) => c.tab.id), [8, 6]);
    assert.ok(chosen.every((c) => c.reason === 'cap'));
  });

  it('supports manual forceNow while still honoring all safety guards', () => {
    const settings = {
      ...DEFAULTS,
      ramProtectForms: true,
      whitelist: true,
      whitelistDomains: 'figma.com'
    };

    const chosen = ramPolicy.selectTabsToDiscard(baseTabs, activity, settings, now, new Set([8]), true);
    assert.deepEqual(chosen.map((c) => c.tab.id), [6, 7]);
    assert.ok(chosen.every((c) => c.reason === 'manual'));
  });
});
