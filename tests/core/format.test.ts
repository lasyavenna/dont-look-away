import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { TRUNCATION_INDICATOR, deepEqual, serializeValue, truncateForDisplay } from '../../src/core/format';

describe('Property 15: Display truncation', () => {
  // **Validates: Requirements 5.8, 6.2**
  it('returns text unchanged when <= 500, else first 500 chars + indicator', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 1200 }), (s) => {
        const out = truncateForDisplay(s, 500);
        if (s.length <= 500) expect(out).toBe(s);
        else expect(out).toBe(s.slice(0, 500) + TRUNCATION_INDICATOR);
      }),
    );
  });

  it('serializeValue returns a string for any value', () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        expect(typeof serializeValue(v)).toBe('string');
      }),
    );
  });
});

describe('truncateForDisplay', () => {
  it('handles 499, 500, 501 characters', () => {
    expect(truncateForDisplay('a'.repeat(499), 500)).toBe('a'.repeat(499));
    expect(truncateForDisplay('a'.repeat(500), 500)).toBe('a'.repeat(500));
    expect(truncateForDisplay('a'.repeat(501), 500)).toBe('a'.repeat(500) + TRUNCATION_INDICATOR);
  });
});

describe('serializeValue', () => {
  it('handles special values', () => {
    expect(serializeValue(undefined)).toContain('undefined');
    expect(serializeValue(NaN)).toContain('NaN');
    expect(serializeValue(Infinity)).toContain('Infinity');
    expect(serializeValue(-Infinity)).toContain('-Infinity');
    expect(serializeValue(10n)).toContain('10n');
    expect(serializeValue(() => 1)).toContain('function');
    expect(serializeValue([1, 'a', null])).toBe('[1,"a",null]');
  });

  it('handles cycles without throwing and does not flag shared references', () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    expect(serializeValue(a)).toContain('[Circular]');
    const shared = { n: 1 };
    expect(serializeValue([shared, shared])).toBe('[{"n":1},{"n":1}]');
  });
});

describe('deepEqual', () => {
  it('compares primitives, NaN, arrays and objects', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual(NaN, NaN)).toBe(true);
    expect(deepEqual([1, [2]], [1, [2]])).toBe(true);
    expect(deepEqual([1, 2], [1, 3])).toBe(false);
    expect(deepEqual([1], [1, 2])).toBe(false);
    expect(deepEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });

  it('handles cycles', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    const b: Record<string, unknown> = {};
    b.self = b;
    expect(deepEqual(a, b)).toBe(true);
  });
});
