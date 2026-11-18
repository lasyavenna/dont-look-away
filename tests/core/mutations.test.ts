import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { attemptMutation, CANDIDATES, replaceFirst, type CandidateMutation } from '../../src/core/mutations';

const mk = (id: string, target: string, transform: (c: string) => string): CandidateMutation => ({
  id,
  description: id,
  target,
  transform,
});

describe('Property 9: Mutation determinism and purity', () => {
  it('transforms and attemptMutation are deterministic', () => {
    // **Validates: Requirements 12.7, 12.8, 12.11, 22.6**
    fc.assert(
      fc.property(fc.string({ maxLength: 10000 }), fc.boolean(), (code, ok) => {
        for (const c of CANDIDATES) {
          expect(c.transform(code)).toBe(c.transform(code));
        }
        const save = () => ok;
        const a = attemptMutation(code, CANDIDATES, save, 20000);
        const b = attemptMutation(code, CANDIDATES, save, 20000);
        expect(a).toEqual(b);
      }),
      { numRuns: 50 },
    );
  });

  it('applies a real candidate deterministically on matching code', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (pad) => {
        const code = `${pad}\nlet best = -1;\n`;
        const r = attemptMutation(code, CANDIDATES, () => true, 20000);
        expect(r.kind).toBe('applied');
        if (r.kind === 'applied') {
          expect(r.record.snapshot).toBe(code);
          expect(r.record.resultingCode).not.toBe(code);
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe('Property 11: Snapshot failure cancels the attempt', () => {
  it('save false or throw cancels and tries no later candidate', () => {
    // **Validates: Requirements 12.16, 13.1, 13.2**
    fc.assert(
      fc.property(fc.string({ maxLength: 100 }), fc.boolean(), (pad, throws) => {
        const code = `${pad}A B`;
        const later = vi.fn((c: string) => c + 'x');
        const cands = [mk('a', 'A', replaceFirst('A', 'Z')), mk('b', 'B', later)];
        const save = () => {
          if (throws) throw new Error('boom');
          return false;
        };
        const r = attemptMutation(code, cands, save, 10000);
        expect(r.kind).toBe('cancelled');
        expect(later).not.toHaveBeenCalled();
        // a later attempt may succeed
        expect(attemptMutation(code, cands, () => true, 10000).kind).toBe('applied');
      }),
      { numRuns: 50 },
    );
  });
});

describe('attemptMutation skip reasons', () => {
  it('target-missing', () => {
    const r = attemptMutation('abc', [mk('x', 'zzz', (c) => c + '!')], () => true, 100);
    expect(r).toEqual({ kind: 'none', skipped: [{ id: 'x', reason: 'target-missing' }] });
  });

  it('transform-failed on throw and on non-string', () => {
    const r = attemptMutation(
      'abc',
      [
        mk('t', 'a', () => {
          throw new Error('x');
        }),
        mk('n', 'a', (() => 5) as unknown as (c: string) => string),
      ],
      () => true,
      100,
    );
    expect(r.skipped).toEqual([
      { id: 't', reason: 'transform-failed' },
      { id: 'n', reason: 'transform-failed' },
    ]);
    expect(r.kind).toBe('none');
  });

  it('no-change', () => {
    const r = attemptMutation('abc', [mk('x', 'a', (c) => c)], () => true, 100);
    expect(r.skipped).toEqual([{ id: 'x', reason: 'no-change' }]);
  });

  it('size-limit is distinct from no-change and stores no snapshot', () => {
    const save = vi.fn(() => true);
    const r = attemptMutation('abc', [mk('x', 'a', (c) => c + 'defgh')], save, 5);
    expect(r).toEqual({ kind: 'none', skipped: [{ id: 'x', reason: 'size-limit' }] });
    expect(save).not.toHaveBeenCalled();
  });

  it('output exactly at maxLength is allowed', () => {
    const r = attemptMutation('abc', [mk('x', 'a', (c) => c + 'de')], () => true, 5);
    expect(r.kind).toBe('applied');
  });
});

describe('attemptMutation flow', () => {
  it('first success stops the attempt, keeping earlier skips', () => {
    const second = vi.fn((c: string) => c + '2');
    const save = vi.fn(() => true);
    const r = attemptMutation(
      'abc',
      [mk('miss', 'zzz', (c) => c), mk('one', 'a', (c) => c + '1'), mk('two', 'b', second)],
      save,
      100,
    );
    expect(r.kind).toBe('applied');
    if (r.kind === 'applied') {
      expect(r.record.id).toBe('one');
      expect(r.record.snapshot).toBe('abc');
      expect(r.record.resultingCode).toBe('abc1');
      expect(r.skipped).toEqual([{ id: 'miss', reason: 'target-missing' }]);
    }
    expect(second).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('abc');
  });

  it('save returning false cancels, no later candidate tried', () => {
    const later = vi.fn((c: string) => c + '2');
    const r = attemptMutation('abc', [mk('one', 'a', (c) => c + '1'), mk('two', 'b', later)], () => false, 100);
    expect(r).toEqual({ kind: 'cancelled', skipped: [] });
    expect(later).not.toHaveBeenCalled();
  });

  it('save throwing cancels, no later candidate tried', () => {
    const later = vi.fn((c: string) => c + '2');
    const r = attemptMutation(
      'abc',
      [mk('one', 'a', (c) => c + '1'), mk('two', 'b', later)],
      () => {
        throw new Error('quota');
      },
      100,
    );
    expect(r.kind).toBe('cancelled');
    expect(later).not.toHaveBeenCalled();
  });

  it('all skipped returns none; empty candidates returns none', () => {
    expect(attemptMutation('abc', CANDIDATES, () => true, 100).kind).toBe('none');
    expect(attemptMutation('abc', [], () => true, 100)).toEqual({ kind: 'none', skipped: [] });
  });
});
