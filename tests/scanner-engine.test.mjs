import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scanner = require('../src/shared/scanner-engine.js');

describe('Adaptive PC Scanner Engine', () => {
  it('selects Light profile for a powerful idle desktop without over-optimizing', () => {
    const report = scanner.evaluateScan({
      cpuCores: 16,
      cpuLoadPercent: 12,
      ramTotalGB: 32,
      ramAvailableGB: 20,
      ramFreePercent: 62,
      ramSource: 'system.memory',
      benchmarkMs: 8,
      frameJitterMs: 1.2,
      openTabsCount: 6,
      loadedTabsCount: 6,
      onBattery: false
    });

    assert.equal(report.profileId, 'light');
    assert.equal(report.recommendedSettings.blockImages, false);
    assert.equal(report.recommendedSettings.blockWebFonts, false);
    assert.equal(report.recommendedSettings.ramIdleMinutes, 45);
    assert.equal(report.recommendedSettings.ramMaxActiveTabs, 20);
  });

  it('selects Balanced profile for a standard laptop on battery', () => {
    const report = scanner.evaluateScan({
      cpuCores: 8,
      cpuLoadPercent: 35,
      ramTotalGB: 16,
      ramAvailableGB: 7,
      ramFreePercent: 44,
      ramSource: 'system.memory',
      benchmarkMs: 19,
      openTabsCount: 15,
      loadedTabsCount: 14,
      onBattery: true,
      batteryLevel: 0.72
    });

    assert.equal(report.profileId, 'balanced');
    assert.equal(report.recommendedSettings.killGpuEffects, true);
    assert.equal(report.recommendedSettings.blockGifs, true);
    assert.equal(report.recommendedSettings.blockImages, false);
    assert.equal(report.recommendedSettings.ramMaxActiveTabs, 12);
  });

  it('selects Eco profile on modest hardware under low battery and many tabs', () => {
    const report = scanner.evaluateScan({
      cpuCores: 4,
      ramTotalGB: 8,
      ramAvailableGB: 2.1,
      ramFreePercent: 26,
      benchmarkMs: 36,
      openTabsCount: 24,
      loadedTabsCount: 22,
      onBattery: true,
      batteryLevel: 0.18
    });

    assert.equal(report.profileId, 'eco');
    assert.equal(report.recommendedSettings.blockWebFonts, true);
    assert.equal(report.recommendedSettings.ramIdleMinutes, 10);
    assert.equal(report.recommendedSettings.ramMaxActiveTabs, 8);
  });

  it('selects Patate Max (extreme) on low-RAM saturated old PC', () => {
    const report = scanner.evaluateScan({
      cpuCores: 2,
      cpuLoadPercent: 88,
      ramTotalGB: 4,
      ramAvailableGB: 0.4,
      ramFreePercent: 10,
      benchmarkMs: 70,
      openTabsCount: 18,
      loadedTabsCount: 18
    });

    assert.equal(report.profileId, 'extreme');
    assert.equal(report.recommendedSettings.blockImages, true);
    assert.equal(report.recommendedSettings.blockWebFonts, true);
    assert.equal(report.recommendedSettings.blockHeavyMedia, true);
    assert.equal(report.recommendedSettings.ramIdleMinutes, 3);
    assert.equal(report.recommendedSettings.ramMaxActiveTabs, 4);
  });

  it('degrades gracefully on Firefox without system.memory and never fabricates RAM', () => {
    const report = scanner.evaluateScan({
      cpuCores: 4,
      ramTotalGB: null,
      ramFreePercent: null,
      cpuLoadPercent: null,
      benchmarkMs: 38,
      openTabsCount: 14,
      loadedTabsCount: 12
    });

    assert.ok(['light', 'balanced', 'eco', 'extreme'].includes(report.profileId));
    assert.equal(report.detectedSpecs.ramTotalGB, null);
    assert.equal(report.detectedSpecs.ramFreePercent, null);
    assert.equal(report.detectedSpecs.cpuLoadPercent, null);
    assert.equal(report.detectedSpecs.benchmarkMs, 38);
  });
});
