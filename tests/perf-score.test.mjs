import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const perfScore = require('../src/shared/perf-score.js');

describe('Real Dynamic Performance Score (Zero Fake Data)', () => {
  it('returns null score on restricted browser system pages', () => {
    const res = perfScore.computeRealPerfScore({ isRestricted: true });
    assert.equal(res.score, null);
    assert.equal(res.grade, 'Page système');
    assert.equal(res.hasPageData, false);
  });

  it('returns null score when no telemetry has been measured yet', () => {
    const res = perfScore.computeRealPerfScore({});
    assert.equal(res.score, null);
    assert.equal(res.hasPageData, false);
  });

  it('scores a fast, lightweight, low-pressure page as Optimal', () => {
    const res = perfScore.computeRealPerfScore({
      fps: 60,
      longTaskCount: 0,
      longTaskTotalMs: 0,
      domNodes: 520,
      resourceCount: 32,
      transferBytes: 850 * 1024,
      jsHeapUsedMB: 24,
      ramFreePercent: 55,
      loadedTabsCount: 5
    });

    assert.ok(res.score >= 90, `Expected >= 90, got ${res.score}`);
    assert.equal(res.grade, 'Optimal');
    assert.equal(res.hasPageData, true);
  });

  it('scores a laggy, memory-starved heavy page as Critique', () => {
    const res = perfScore.computeRealPerfScore({
      fps: 18,
      longTaskCount: 16,
      longTaskTotalMs: 1900,
      domNodes: 9500,
      resourceCount: 280,
      transferBytes: 18 * 1024 * 1024,
      jsHeapUsedMB: 420,
      ramFreePercent: 7,
      loadedTabsCount: 44
    });

    assert.ok(res.score <= 30, `Expected <= 30, got ${res.score}`);
    assert.equal(res.grade, 'Critique');
  });

  it('computes honest score from partial Firefox telemetry (no JS heap / no system RAM)', () => {
    const res = perfScore.computeRealPerfScore({
      fps: 58,
      domNodes: 1400,
      loadedTabsCount: 10
    });

    assert.equal(typeof res.score, 'number');
    assert.ok(res.score >= 70 && res.score <= 100);
    assert.equal(res.breakdown.mainThreadScore, undefined);
  });
});
