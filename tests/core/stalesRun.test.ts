import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { CHALLENGE } from '../../src/core/challenge';
import { normalizeConfig } from '../../src/core/config';
import { initialState, step } from '../../src/core/reducer';
import type { GameEvent, GameState, TestResult } from '../../src/core/types';

const cfg = normalizeConfig({ drainAmount: 7 });
const N = CHALLENGE.tests.length;

const apply = (s: GameState, e: GameEvent) => step(s, e, cfg).state;
const result = (index: number, status: TestResult['status'] = 'pass'): TestResult => ({
  index,
  status,
  message: '',
  expectedText: '',
  actualText: status === 'pass' ? '' : null,
});

/** Starts a round and a run, then feeds the given result indexes. */
function runningWith(indexes: number[]): GameState {
  let s = apply(initialState(cfg), { type: 'START' });
  const roundId = s.activeRoundId!;
  s = apply(s, { type: 'RUN_REQUESTED', roundId });
  const runId = s.run!.runId;
  for (const index of indexes) s = apply(s, { type: 'RUN_RESULT', roundId, runId, result: result(index) });
  return s;
}

const arbIndexes = fc.uniqueArray(fc.integer({ min: 0, max: N - 1 }), { maxLength: N });
const arbCode = fc.string();

describe('Property 7 (CODE_CHANGED): code change stales a running run', () => {
  // **Validates: Requirements 7.1, 7.2, 7.7, 12.14**
  it('stales in the same step, flags outdated results, and discards later messages', () => {
    fc.assert(
      fc.property(arbIndexes, arbCode, fc.integer({ min: 0, max: N - 1 }), (indexes, code, lateIndex) => {
        const before = runningWith(indexes);
        const roundId = before.activeRoundId!;
        const runId = before.run!.runId;
        const hadDisplay = before.displayRun !== null;

        const changed = step(before, { type: 'CODE_CHANGED', roundId, code }, cfg);
        const s = changed.state;
        expect(changed.outcome).toBe('applied');
        expect(s.run!.status).toBe('stale');
        expect(s.code).toBe(code);
        expect(s.resultsOutdated).toBe(hadDisplay);
        if (hadDisplay) expect(s.displayRun!.status).toBe('stale');

        // Late messages for the stale run change nothing.
        const late: GameEvent[] = [
          { type: 'RUN_RESULT', roundId, runId, result: result(lateIndex) },
          { type: 'RUN_DONE', roundId, runId, count: N },
          { type: 'RUN_TIMEOUT', roundId, runId },
        ];
        for (const e of late) {
          const r = step(s, e, cfg);
          expect(r.outcome).toBe('discarded');
          expect(r.state).toBe(s);
        }
        // Even a complete, all-passing stream cannot win.
        let t = s;
        for (let i = 0; i < N; i++) t = apply(t, { type: 'RUN_RESULT', roundId, runId, result: result(i) });
        t = apply(t, { type: 'RUN_DONE', roundId, runId, count: N });
        expect(t).toEqual(s);
        expect(t.phase).toBe('playing');
      }),
    );
  });

  it('a new run after stale works; its first result replaces displayed results and clears outdated', () => {
    fc.assert(
      fc.property(arbIndexes.filter((a) => a.length > 0), arbCode, fc.integer({ min: 0, max: N - 1 }), (indexes, code, first) => {
        let s = runningWith(indexes);
        const roundId = s.activeRoundId!;
        s = apply(s, { type: 'CODE_CHANGED', roundId, code });
        expect(s.resultsOutdated).toBe(true);
        const oldRunId = s.run!.runId;

        s = apply(s, { type: 'RUN_REQUESTED', roundId });
        expect(s.run!.status).toBe('running');
        expect(s.run!.runId).not.toBe(oldRunId);
        expect(s.resultsOutdated).toBe(true); // still outdated until the first new result
        s = apply(s, { type: 'RUN_RESULT', roundId, runId: s.run!.runId, result: result(first, 'fail') });
        expect(s.resultsOutdated).toBe(false);
        expect(s.displayRun!.runId).toBe(s.run!.runId);
        expect(s.displayRun!.results.map((r) => r.index)).toEqual([first]);
      }),
    );
  });

  it('a new run can still win after an earlier run went stale', () => {
    let s = runningWith([0]);
    const roundId = s.activeRoundId!;
    s = apply(s, { type: 'CODE_CHANGED', roundId, code: 'x' });
    s = apply(s, { type: 'RUN_REQUESTED', roundId });
    const runId = s.run!.runId;
    for (let i = 0; i < N; i++) s = apply(s, { type: 'RUN_RESULT', roundId, runId, result: result(i) });
    s = apply(s, { type: 'RUN_DONE', roundId, runId, count: N });
    expect(s.phase).toBe('won');
  });

  it('CODE_CHANGED with no running run does not create a run', () => {
    fc.assert(
      fc.property(arbCode, (code) => {
        const s0 = apply(initialState(cfg), { type: 'START' });
        const s = apply(s0, { type: 'CODE_CHANGED', roundId: s0.activeRoundId!, code });
        expect(s.run).toBeNull();
        expect(s.displayRun).toBeNull();
        expect(s.resultsOutdated).toBe(false);
        expect(s.nextRunId).toBe(s0.nextRunId);
      }),
    );
  });

  it('code changes and run events do not change sanity', () => {
    fc.assert(
      fc.property(arbIndexes, arbCode, (indexes, code) => {
        const s = runningWith(indexes);
        const roundId = s.activeRoundId!;
        const runId = s.run!.runId;
        let t = apply(s, { type: 'CODE_CHANGED', roundId, code });
        t = apply(t, { type: 'RUN_REQUESTED', roundId });
        t = apply(t, { type: 'RUN_ABORT', roundId, runId: t.run!.runId });
        t = apply(t, { type: 'RUN_DONE', roundId, runId, count: N });
        expect(t.sanity).toEqual(s.sanity);
      }),
    );
  });

  it('regression: stale results after editing', () => {
    let s = runningWith([0, 1]);
    const roundId = s.activeRoundId!;
    const runId = s.run!.runId;
    expect(s.resultsOutdated).toBe(false);
    s = apply(s, { type: 'CODE_CHANGED', roundId, code: 'edited' });
    expect(s.run!.status).toBe('stale');
    expect(s.resultsOutdated).toBe(true);
    const after = apply(s, { type: 'RUN_RESULT', roundId, runId, result: result(2, 'fail') });
    expect(after).toBe(s);
    expect(after.displayRun!.results.map((r) => r.index)).toEqual([0, 1]);
  });
});
