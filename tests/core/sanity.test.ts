import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { DEFAULT_CONFIG, normalizeConfig } from '../../src/core/config';
import { applyAbsenceCost, applyDrain, severity, warningLevelFor } from '../../src/core/sanity';

const cfg = DEFAULT_CONFIG;

describe('warningLevelFor boundaries (defaults)', () => {
  it.each([
    [0, 'critical'],
    [20, 'critical'],
    [21, 'distressed'],
    [40, 'distressed'],
    [41, 'uneasy'],
    [70, 'uneasy'],
    [71, 'calm'],
    [100, 'calm'],
  ])('%i -> %s', (v, level) => {
    expect(warningLevelFor(v, cfg)).toBe(level);
  });

  it.each([NaN, -1, 101, 50.5, Infinity, -Infinity])('invalid %s -> null', (v) => {
    expect(warningLevelFor(v, cfg)).toBeNull();
  });
});

describe('Property 1: Warning level is total and monotonic', () => {
  // **Validates: Requirements 9.1, 9.9, 22.2, 22.3**
  const arbCfg = fc
    .record({
      calmMin: fc.integer({ min: 0, max: 100 }),
      uneasyMin: fc.integer({ min: 0, max: 100 }),
      distressedMin: fc.integer({ min: 0, max: 100 }),
    })
    .map((t) => normalizeConfig({ thresholds: t }));

  it('is total, critical below distressedMin, monotonic, and null for invalid input', () => {
    fc.assert(
      fc.property(
        arbCfg,
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (c, a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const la = warningLevelFor(lo, c);
          const lb = warningLevelFor(hi, c);
          expect(la).not.toBeNull();
          expect(lb).not.toBeNull();
          expect(severity[la!]).toBeGreaterThanOrEqual(severity[lb!]);
          if (lo < c.thresholds.distressedMin) expect(la).toBe('critical');
          expect(warningLevelFor(0, c)).toBe('critical');
        },
      ),
    );
    fc.assert(
      fc.property(
        arbCfg,
        fc.oneof(
          fc.integer({ min: -1000, max: -1 }),
          fc.integer({ min: 101, max: 1000 }),
          fc.double({ noInteger: true }),
        ),
        (c, v) => {
          expect(warningLevelFor(v, c)).toBeNull();
        },
      ),
    );
  });
});

describe('floor at 0', () => {
  it('applyDrain and applyAbsenceCost never go below 0', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (v) => {
        expect(applyDrain(v, cfg)).toBeGreaterThanOrEqual(0);
        expect(applyAbsenceCost(v, cfg)).toBeGreaterThanOrEqual(0);
      }),
    );
    expect(applyDrain(0, cfg)).toBe(0);
    expect(applyAbsenceCost(0, cfg)).toBe(0);
    expect(applyDrain(1, { ...cfg, drainAmount: 50 })).toBe(0);
    expect(applyAbsenceCost(5, { ...cfg, absenceCost: 50 })).toBe(0);
  });
});

describe('integer 0..100 output for odd configs and values', () => {
  const isOk = (n: number) => Number.isInteger(n) && n >= 0 && n <= 100;

  it('handles fractional and non-finite configs/values', () => {
    for (const amt of [1.5, NaN, Infinity, -Infinity, -3, 0.2, 1e300]) {
      for (const v of [100, 50.7, 0, NaN, Infinity, -Infinity, -5, 1e300]) {
        expect(isOk(applyDrain(v, { ...cfg, drainAmount: amt }))).toBe(true);
        expect(isOk(applyAbsenceCost(v, { ...cfg, absenceCost: amt }))).toBe(true);
      }
    }
    expect(applyDrain(10.9, { ...cfg, drainAmount: 1.5 })).toBe(9);
  });

  it('property: arbitrary doubles always yield integers in 0..100', () => {
    fc.assert(
      fc.property(fc.double({ noDefaultInfinity: false }), fc.double({ noDefaultInfinity: false }), (v, amt) => {
        expect(isOk(applyDrain(v, { ...cfg, drainAmount: amt }))).toBe(true);
        expect(isOk(applyAbsenceCost(v, { ...cfg, absenceCost: amt }))).toBe(true);
      }),
    );
  });
});
