import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  parseConfigOverrides,
  type GameConfig,
} from '../../src/core/config';

const IDS = DEFAULT_CONFIG.candidateOrder;

function assertValid(c: GameConfig): void {
  const num = (v: number, min: number, max: number) => {
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(min);
    expect(v).toBeLessThanOrEqual(max);
  };
  num(c.drainIntervalMs, 100, 60_000);
  num(c.drainAmount, 0, 100);
  num(c.absenceCost, 0, 100);
  num(c.runTimeoutMs, 200, 30_000);
  num(c.editorMaxLength, 1000, 1_000_000);
  num(c.noticedDurationMs, 200, 30_000);
  num(c.volumeCap, 0, 0.5);
  expect(c.volumeCap).toBeLessThanOrEqual(0.5);
  expect(c.testCountMin).toBeGreaterThanOrEqual(1);
  expect(c.testCountMin).toBeLessThanOrEqual(c.testCountMax);
  const t = c.thresholds;
  expect(t.distressedMin).toBeGreaterThan(0);
  expect(t.distressedMin).toBeLessThan(t.uneasyMin);
  expect(t.uneasyMin).toBeLessThan(t.calmMin);
  expect(t.calmMin).toBeLessThanOrEqual(100);
  expect([...c.candidateOrder].sort()).toEqual([...IDS].sort());
}

const anyNum = fc.oneof(
  fc.double({ noNaN: false }),
  fc.integer(),
  fc.constantFrom(NaN, Infinity, -Infinity, 0, -0, 1e300),
  fc.string(),
  fc.constant(null),
  fc.constant(undefined),
);

const partialArb = fc.record(
  {
    drainIntervalMs: anyNum,
    drainAmount: anyNum,
    absenceCost: anyNum,
    thresholds: fc.oneof(
      fc.record({ calmMin: anyNum, uneasyMin: anyNum, distressedMin: anyNum }, { requiredKeys: [] }),
      fc.constant(null),
      fc.string(),
    ),
    runTimeoutMs: anyNum,
    editorMaxLength: anyNum,
    noticedDurationMs: anyNum,
    volumeCap: anyNum,
    testCountMin: anyNum,
    testCountMax: anyNum,
    candidateOrder: fc.oneof(
      fc.shuffledSubarray([...IDS, 'x'] as string[]),
      fc.array(fc.string()),
      fc.constant(null),
    ),
  },
  { requiredKeys: [] },
) as unknown as fc.Arbitrary<Partial<GameConfig>>;

describe('Property 17: Config normalization always yields a valid config', () => {
  /** **Validates: Requirements 21.11, 19.14** */
  it('normalizeConfig returns a valid config for any partial input', () => {
    fc.assert(
      fc.property(partialArb, (p) => {
        assertValid(normalizeConfig(p));
      }),
      { numRuns: 200 },
    );
  });

  /** **Validates: Requirements 21.11, 19.14** */
  it('parseConfigOverrides returns a valid config for any query string', () => {
    const keys = ['drainMs', 'drainAmount', 'absenceCost', 'runTimeoutMs', 'noticedMs', 'editorMax', 'volume', 'order', 'junk'];
    const queryArb = fc
      .array(fc.tuple(fc.oneof(fc.constantFrom(...keys), fc.string()), fc.oneof(fc.string(), fc.double().map(String))), { maxLength: 10 })
      .map((kv) => '?' + kv.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'));
    fc.assert(
      fc.property(fc.oneof(queryArb, fc.string()), (q) => {
        assertValid(parseConfigOverrides(q, DEFAULT_CONFIG));
      }),
      { numRuns: 200 },
    );
  });
});

describe('normalizeConfig', () => {
  it('returns the documented defaults for empty input', () => {
    expect(normalizeConfig()).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig({})).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG).toMatchObject({
      drainIntervalMs: 2000,
      drainAmount: 1,
      absenceCost: 10,
      thresholds: { calmMin: 71, uneasyMin: 41, distressedMin: 21 },
      runTimeoutMs: 3000,
      editorMaxLength: 100_000,
      noticedDurationMs: 3000,
      volumeCap: 0.5,
      testCountMin: 4,
      testCountMax: 8,
      candidateOrder: ['off-by-one', 'flipped-comparison', 'lost-name'],
    });
  });

  it('clamps out-of-range numbers and caps volume at 0.5', () => {
    const c = normalizeConfig({ drainIntervalMs: 1, volumeCap: 1, runTimeoutMs: 1e9 });
    expect(c.drainIntervalMs).toBe(100);
    expect(c.volumeCap).toBe(0.5);
    expect(c.runTimeoutMs).toBe(30_000);
    expect(normalizeConfig({ volumeCap: -1 }).volumeCap).toBe(0);
  });

  it('falls back on NaN/Infinity', () => {
    expect(normalizeConfig({ drainAmount: NaN }).drainAmount).toBe(1);
    expect(normalizeConfig({ absenceCost: Infinity }).absenceCost).toBe(10);
  });

  it('drainAmount/absenceCost accept only finite integers in 0..100, else default', () => {
    for (const bad of [1.5, NaN, Infinity, -Infinity, -1, 101, 1000, '5', null, undefined, {}]) {
      const c = normalizeConfig({ drainAmount: bad as never, absenceCost: bad as never });
      expect(c.drainAmount).toBe(1);
      expect(c.absenceCost).toBe(10);
    }
    for (const ok of [0, 1, 50, 100]) {
      const c = normalizeConfig({ drainAmount: ok, absenceCost: ok });
      expect(c.drainAmount).toBe(ok);
      expect(c.absenceCost).toBe(ok);
    }
  });

  it('resets invalid thresholds, keeps valid ones', () => {
    expect(normalizeConfig({ thresholds: { calmMin: 10, uneasyMin: 50, distressedMin: 20 } }).thresholds).toEqual(
      DEFAULT_CONFIG.thresholds,
    );
    expect(normalizeConfig({ thresholds: { calmMin: 80, uneasyMin: 50, distressedMin: 20 } }).thresholds).toEqual({
      calmMin: 80,
      uneasyMin: 50,
      distressedMin: 20,
    });
  });

  it('resets inverted test counts and non-permutation candidate order', () => {
    const c = normalizeConfig({ testCountMin: 10, testCountMax: 5, candidateOrder: ['lost-name', 'lost-name', 'x'] });
    expect(c.testCountMin).toBe(4);
    expect(c.testCountMax).toBe(8);
    expect(c.candidateOrder).toEqual(DEFAULT_CONFIG.candidateOrder);
    expect(normalizeConfig({ candidateOrder: ['lost-name', 'off-by-one', 'flipped-comparison'] }).candidateOrder).toEqual([
      'lost-name',
      'off-by-one',
      'flipped-comparison',
    ]);
  });
});

describe('parseConfigOverrides', () => {
  it('applies known keys', () => {
    const c = parseConfigOverrides('?drainMs=300&absenceCost=40&volume=0.2', DEFAULT_CONFIG);
    expect(c.drainIntervalMs).toBe(300);
    expect(c.absenceCost).toBe(40);
    expect(c.volumeCap).toBe(0.2);
  });

  it('ignores unknown keys and bad values', () => {
    const c = parseConfigOverrides('?foo=1&drainMs=abc&absenceCost=&drainAmount=NaN&noticedMs=Infinity', DEFAULT_CONFIG);
    expect(c).toEqual(DEFAULT_CONFIG);
  });

  it('query drainAmount/absenceCost: non-integers and out-of-range fall back to defaults', () => {
    for (const q of ['drainAmount=1.5', 'drainAmount=Infinity', 'drainAmount=-1', 'drainAmount=101', 'absenceCost=abc', 'absenceCost=2.5', 'absenceCost=1000']) {
      expect(parseConfigOverrides(`?${q}`, DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
    }
    expect(parseConfigOverrides('?drainAmount=3&absenceCost=0', DEFAULT_CONFIG)).toMatchObject({ drainAmount: 3, absenceCost: 0 });
  });

  it('clamps out-of-range values and ignores invalid order', () => {
    expect(parseConfigOverrides('?volume=5&drainMs=1', DEFAULT_CONFIG)).toMatchObject({ volumeCap: 0.5, drainIntervalMs: 100 });
    expect(parseConfigOverrides('?order=a,b', DEFAULT_CONFIG).candidateOrder).toEqual(DEFAULT_CONFIG.candidateOrder);
    expect(parseConfigOverrides('?order=lost-name,off-by-one,flipped-comparison', DEFAULT_CONFIG).candidateOrder[0]).toBe('lost-name');
  });

  it('handles empty search', () => {
    expect(parseConfigOverrides('', DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
  });
});
