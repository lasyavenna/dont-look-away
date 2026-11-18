import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { diffLines, newFromDiff, oldFromDiff } from '../../src/core/diff';

const roundTrips = (a: string, b: string) => {
  const d = diffLines(a, b);
  return newFromDiff(d) === b && oldFromDiff(d) === a;
};

// Small line alphabet makes shared lines (and thus real LCS work) likely.
const multiline = fc
  .array(fc.constantFrom('a', 'b', 'c', '', 'foo', 'bar baz'), { maxLength: 40 })
  .map((ls) => ls.join('\n'));
const anyText = fc.string({ maxLength: 10000 });

describe('diff', () => {
  // Feature: dont-look-away, Property 12: Diff round trip
  // **Validates: Requirements 13.5, 13.6, 22.7**
  it('Property 12: round-trips for arbitrary strings', () => {
    fc.assert(fc.property(anyText, anyText, (a, b) => roundTrips(a, b)), { numRuns: 50 });
  });

  it('Property 12: round-trips for multi-line strings', () => {
    fc.assert(fc.property(multiline, multiline, (a, b) => roundTrips(a, b)), { numRuns: 200 });
  });

  it('handles empty strings', () => {
    expect(diffLines('', '')).toEqual([{ kind: 'same', text: '' }]);
    expect(roundTrips('', 'abc\ndef')).toBe(true);
    expect(roundTrips('abc\ndef', '')).toBe(true);
  });

  it('handles trailing newlines', () => {
    expect(roundTrips('a\nb\n', 'a\nb')).toBe(true);
    expect(roundTrips('a\nb', 'a\nb\n')).toBe(true);
    expect(roundTrips('\n\n', '\n')).toBe(true);
  });

  it('yields only same lines for identical inputs', () => {
    const d = diffLines('x\ny\nz\n', 'x\ny\nz\n');
    expect(d.every((l) => l.kind === 'same')).toBe(true);
    expect(d).toHaveLength(4);
  });

  it('marks changed lines as remove/add', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'remove', text: 'b' },
      { kind: 'add', text: 'x' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('round-trips via the large-input fallback (n*m > 4,000,000)', () => {
    const a = Array.from({ length: 2100 }, (_, i) => `old${i}`);
    const b = Array.from({ length: 2100 }, (_, i) => `new${i}`);
    const oldText = ['head', ...a, 'tail'].join('\n');
    const newText = ['head', ...b, 'tail'].join('\n');
    const d = diffLines(oldText, newText);
    expect(d.filter((l) => l.kind === 'remove')).toHaveLength(2100);
    expect(d.filter((l) => l.kind === 'add')).toHaveLength(2100);
    expect(newFromDiff(d)).toBe(newText);
    expect(oldFromDiff(d)).toBe(oldText);
  });
});
