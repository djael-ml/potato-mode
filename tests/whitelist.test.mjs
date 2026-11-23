import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const defaults = require('../src/shared/defaults.js');

describe('Whitelist & URL Utilities', () => {
  it('normalizes domains cleanly', () => {
    assert.equal(defaults.normalizeDomain('https://www.Perplexity.ai/onboarding'), 'perplexity.ai');
    assert.equal(defaults.normalizeDomain('  WWW.GitHub.COM:443/djael-ml  '), 'github.com');
    assert.equal(defaults.normalizeDomain(''), '');
  });

  it('matches exact domains and subdomains in whitelist', () => {
    const settings = {
      whitelist: true,
      whitelistDomains: 'perplexity.ai\nfigma.com, www.youtube.com'
    };
    assert.equal(defaults.isDomainWhitelisted('perplexity.ai', settings), true);
    assert.equal(defaults.isDomainWhitelisted('https://docs.perplexity.ai/guide', settings), true);
    assert.equal(defaults.isDomainWhitelisted('m.youtube.com', settings), true);
    assert.equal(defaults.isDomainWhitelisted('notperplexity.ai', settings), false);
    assert.equal(defaults.isDomainWhitelisted('perplexity.ai', { ...settings, whitelist: false }), false);
  });

  it('toggles a domain on and off cleanly', () => {
    const first = defaults.toggleDomainInWhitelist('www.perplexity.ai', 'figma.com');
    assert.equal(first.added, true);
    assert.equal(first.nextDomains, 'figma.com\nperplexity.ai');

    const second = defaults.toggleDomainInWhitelist('sub.perplexity.ai', first.nextDomains);
    assert.equal(second.added, false);
    assert.equal(second.nextDomains, 'figma.com');
  });

  it('identifies restricted browser and store URLs accurately', () => {
    assert.equal(defaults.isRestrictedUrl('chrome://extensions'), true);
    assert.equal(defaults.isRestrictedUrl('about:debugging#/runtime/this-firefox'), true);
    assert.equal(defaults.isRestrictedUrl('moz-extension://abc/popup.html'), true);
    assert.equal(defaults.isRestrictedUrl('https://addons.mozilla.org/en-US/firefox/'), true);
    assert.equal(defaults.isRestrictedUrl('https://chromewebstore.google.com/detail/xyz'), true);
    assert.equal(defaults.isRestrictedUrl('https://www.perplexity.ai/onboarding'), false);
    assert.equal(defaults.isRestrictedUrl('http://localhost:3000'), false);
  });
});
