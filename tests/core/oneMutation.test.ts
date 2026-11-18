import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { normalizeConfig } from '../../src/core/config';
import type { GameConfig } from '../../src/core/config';
import { CANDIDATES } from '../../src/core/mutations';
import { initialState, step } from '../../src/core/reducer';
import type { CoreDeps, GameEvent, GameState, TestResult } from '../../src/core/types';

// **Validates: Requirements 12.2, 12.3, 12.4, 12.5, 12.6, 12.12, 12.15, 12.17, 22.12, 22.17, 7.2, 12.14**

const cfg = normalizeConfig({});
const ORDERS: string[][] = [
  ['off-by-one', 'flipped-comparison', 'lost-name'],
  ['lost-name', 'flipped-comparison', 'off-by-one'],
  ['flipped-comparison', 'lost-name', 'off-by-one'],
];

const TARGETS = CANDIDATES.map((c) => c.target);
/** Code containing exactly the targets selected by the mask (bit i => CANDIDATES[i]). */
const codeFor = (mask: number): string =>
  `// code\n` + TARGETS.filter((_, i) => mask & (1 << i)).join('\n') + '\n';

const started = (c: GameConfig = cfg): GameState => step(initialState(c), { type: 'START' }, c).state;

function absence(s: GameState, c: GameConfig, deps?: CoreDeps): GameState {
  const id = s.activeRoundId!;
  const h = step(s, { type: 'VISIBILITY_HIDDEN', roundId: id }, c, deps).state;
  return step(h, { type: 'VISIBILITY_VISIBLE', roundId: id }, c, deps).state;
}
const edit = (s: GameState, c: GameConfig, code: string): GameState =>
  step(s, { type: 'CODE_CHANGED', roundId: s.activeRoundId!, code }, c).state;

const res = (index: number): TestResult => ({ index, status: 'pass', message: '', expectedText: 'x', actualText: 'x' });

type Op = { kind: 'edit'; mask: number } | { kind: 'absence' };
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('edit' as const), mask: fc.integer({ min: 0, max: 7 }) }),
  fc.constant({ kind: 'absence' as const }),
);

describe('Property 10: At most one Mutation per round and ordered retry', () => {
  it('applies at most one mutation, the first present candidate in order, then stops', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ORDERS),
        fc.array(opArb, { maxLength: 8 }),
        (order, ops) => {
          const c: GameConfig = { ...cfg, candidateOrder: order };
          let s = started(c);
          let appliedRec = null as GameState['round'] extends infer R ? (R extends { applied: infer A } ? A : never) : never;
          let absences = 0;
          for (const op of ops) {
            if (op.kind === 'edit') {
              s = edit(s, c, codeFor(op.mask));
              continue;
            }
            const before = s;
            s = absence(s, c);
            absences++;
            expect(s.sanity.value).toBe(100 - 10 * absences);
            if (appliedRec) {
              // later absences: no further mutation, record never replaced, code untouched
              expect(s.round!.applied).toBe(appliedRec);
              expect(s.code).toBe(before.code);
              continue;
            }
            const expected = order
              .map((id) => CANDIDATES.find((x) => x.id === id)!)
              .find((x) => before.code.includes(x.target));
            if (!expected) {
              expect(s.round!.applied).toBeNull();
              expect(s.code).toBe(before.code);
            } else {
              appliedRec = s.round!.applied as typeof appliedRec;
              expect(appliedRec!.id).toBe(expected.id);
              expect(appliedRec!.snapshot).toBe(before.code);
              expect(s.code).toBe(expected.transform(before.code));
              expect(s.code).not.toBe(before.code);
              expect(s.notice).toBe('watcherChanged');
            }
          }
          // determinism
          let t = started(c);
          for (const op of ops) t = op.kind === 'edit' ? edit(t, c, codeFor(op.mask)) : absence(t, c);
          expect(t).toEqual(s);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('failing saveSnapshot cancels the attempt and a later absence retries', () => {
    const c = cfg;
    let s = edit(started(c), c, codeFor(7));
    const failing: CoreDeps = { saveSnapshot: () => false };
    const before = s.code;
    s = absence(s, c, failing);
    expect(s.code).toBe(before);
    expect(s.round!.applied).toBeNull();
    expect(s.sanity.value).toBe(90);
    s = absence(s, c, failing);
    expect(s.round!.applied).toBeNull();
    expect(s.sanity.value).toBe(80);
    s = absence(s, c);
    expect(s.round!.applied?.id).toBe('off-by-one');
    expect(s.sanity.value).toBe(70);
  });

  it('size-limit skip falls through to the next candidate', () => {
    const base = codeFor(7);
    const off = CANDIDATES[0]!;
    const small: GameConfig = { ...cfg, editorMaxLength: base.length };
    // off-by-one grows the code beyond the limit; flipped-comparison keeps the length.
    expect(off.transform(base).length).toBeGreaterThan(base.length);
    let s = started(small);
    s = edit(s, small, base);
    s = absence(s, small);
    expect(s.round!.lastAttemptSkipped).toEqual([{ id: 'off-by-one', reason: 'size-limit' }]);
    expect(s.round!.applied?.id).toBe('flipped-comparison');
  });

  it('first absence applies one mutation and costs 10 sanity', () => {
    let s = edit(started(), cfg, codeFor(7));
    s = absence(s, cfg);
    expect(s.sanity.value).toBe(90);
    expect(s.round!.applied?.id).toBe('off-by-one');
    expect(s.code).toContain('i < candles.length - 1');
    expect(s.notice).toBe('watcherChanged');
  });

  it('later absences cost sanity but apply no further mutation', () => {
    let s = edit(started(), cfg, codeFor(7));
    s = absence(s, cfg);
    const rec = s.round!.applied;
    const code = s.code;
    s = absence(s, cfg);
    s = absence(s, cfg);
    expect(s.sanity.value).toBe(70);
    expect(s.round!.applied).toBe(rec);
    expect(s.code).toBe(code);
  });

  it('missing targets are retried on later absences until success', () => {
    let s = edit(started(), cfg, 'nothing to see here');
    s = absence(s, cfg);
    s = absence(s, cfg);
    expect(s.round!.applied).toBeNull();
    expect(s.code).toBe('nothing to see here');
    expect(s.round!.lastAttemptSkipped.map((k) => k.reason)).toEqual(['target-missing', 'target-missing', 'target-missing']);
    s = edit(s, cfg, codeFor(2));
    s = absence(s, cfg);
    expect(s.round!.applied?.id).toBe('flipped-comparison');
    const code = s.code;
    s = edit(s, cfg, codeFor(7));
    const after = absence(s, cfg);
    expect(after.code).toBe(codeFor(7));
    expect(after.round!.applied?.id).toBe('flipped-comparison');
    expect(code).not.toBe(codeFor(2));
  });
});

describe('Property 7 (mutation case): a mutation stales a running run', () => {
  const runningState = (): GameState => {
    let s = edit(started(), cfg, codeFor(7));
    s = step(s, { type: 'RUN_REQUESTED', roundId: s.activeRoundId! }, cfg).state;
    return s;
  };

  it('a mutation makes an in-progress test run stale', () => {
    const s0 = runningState();
    const roundId = s0.activeRoundId!;
    const runId = s0.run!.runId;
    const s1 = step(s0, { type: 'RUN_RESULT', roundId, runId, result: res(0) }, cfg).state;
    expect(s1.displayRun).not.toBeNull();
    const s2 = absence(s1, cfg);
    expect(s2.round!.applied).not.toBeNull();
    expect(s2.run!.status).toBe('stale');
    expect(s2.displayRun!.status).toBe('stale');
    expect(s2.resultsOutdated).toBe(true);

    // later results and done for that run are discarded
    const r = step(s2, { type: 'RUN_RESULT', roundId, runId, result: res(1) }, cfg);
    expect(r.outcome).toBe('discarded');
    expect(r.state).toBe(s2);
    const d = step(s2, { type: 'RUN_DONE', roundId, runId, count: s2.run!.testCount } as GameEvent, cfg);
    expect(d.outcome).toBe('discarded');
    expect(d.state.phase).toBe('playing');
  });

  it('a skipped attempt leaves a running run running', () => {
    let s = runningState();
    s = edit(step(s, { type: 'RUN_ABORT', roundId: s.activeRoundId!, runId: s.run!.runId }, cfg).state, cfg, 'none');
    s = step(s, { type: 'RUN_REQUESTED', roundId: s.activeRoundId! }, cfg).state;
    s = absence(s, cfg);
    expect(s.round!.applied).toBeNull();
    expect(s.run!.status).toBe('running');
  });
});
