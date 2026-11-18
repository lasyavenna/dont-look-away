import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { normalizeConfig } from '../../src/core/config';
import { CHALLENGE } from '../../src/core/challenge';
import { initialState, step } from '../../src/core/reducer';
import type { GameEvent, GameState, TestResult, TestStatus } from '../../src/core/types';

const cfg = normalizeConfig({});
const N = CHALLENGE.tests.length;

const run = (s: GameState, e: GameEvent) => step(s, e, cfg);
const started = () => run(initialState(cfg), { type: 'START' }).state;
const mk = (index: number, status: TestStatus): TestResult => ({
  index,
  status,
  message: `m${index}`,
  expectedText: `e${index}`,
  actualText: status === 'error' ? null : `a${index}`,
});

function begin(): { s: GameState; roundId: number; runId: number } {
  let s = started();
  const roundId = s.activeRoundId!;
  s = run(s, { type: 'RUN_REQUESTED', roundId }).state;
  return { s, roundId, runId: s.run!.runId };
}

const arbReceived = fc
  .shuffledSubarray(Array.from({ length: N }, (_, i) => i))
  .chain((idxs) =>
    fc.tuple(...idxs.map((i) => fc.constantFrom<TestStatus>('pass', 'fail', 'error').map((st) => mk(i, st)))),
  );

describe('Property 8: Timeout keeps received results and fills the rest', () => {
  // **Validates: Requirements 5.4, 5.6, 6.1, 22.19**
  it('preserves received results, fills missing with timeout, never wins', () => {
    fc.assert(
      fc.property(arbReceived, fc.constantFrom('pass', 'mixed'), (received, mode) => {
        const { s: s0, roundId, runId } = begin();
        let s = s0;
        const sent = received.map((r) => (mode === 'pass' ? mk(r.index, 'pass') : r));
        for (const result of sent) s = run(s, { type: 'RUN_RESULT', roundId, runId, result }).state;
        const before = s;
        const r = run(s, { type: 'RUN_TIMEOUT', roundId, runId });
        expect(r.outcome).toBe('applied');
        const t = r.state;
        expect(t.run!.status).toBe('timedOut');
        expect(t.displayRun).toBe(t.run);
        const results = t.run!.results;
        expect(results.map((x) => x.index)).toEqual(Array.from({ length: N }, (_, i) => i));
        const byIdx = new Map(sent.map((x) => [x.index, x]));
        for (const x of results) {
          const orig = byIdx.get(x.index);
          if (orig) expect(x).toEqual(orig);
          else {
            expect(x.status).toBe('timeout');
            expect(x.message.length).toBeGreaterThan(0);
          }
        }
        // cannot win; phase and sanity unchanged
        expect(t.phase).toBe('playing');
        expect(t.activeRoundId).toBe(roundId);
        expect(t.sanity).toEqual(before.sanity);

        // later results / done for the timed-out run are discarded
        const late = run(t, { type: 'RUN_RESULT', roundId, runId, result: mk(0, 'pass') });
        expect(late.outcome).toBe('discarded');
        expect(late.state).toBe(t);
        const done = run(t, { type: 'RUN_DONE', roundId, runId, count: N });
        expect(done.outcome).toBe('discarded');
        expect(done.state).toBe(t);
        expect(done.state.phase).toBe('playing');

        // a new run is allowed and gets a new runId
        const again = run(t, { type: 'RUN_REQUESTED', roundId });
        expect(again.outcome).toBe('applied');
        expect(again.state.run!.runId).not.toBe(runId);
        expect(again.state.run!.status).toBe('running');
      }),
      { numRuns: 100 },
    );
  });
});

describe('timeout regression', () => {
  it('timeout preserves completed results and allows another run', () => {
    const { s: s0, roundId, runId } = begin();
    let s = s0;
    s = run(s, { type: 'RUN_RESULT', roundId, runId, result: mk(0, 'pass') }).state;
    s = run(s, { type: 'RUN_RESULT', roundId, runId, result: mk(1, 'fail') }).state;
    s = run(s, { type: 'RUN_TIMEOUT', roundId, runId }).state;
    expect(s.run!.status).toBe('timedOut');
    expect(s.run!.results[0]).toEqual(mk(0, 'pass'));
    expect(s.run!.results[1]).toEqual(mk(1, 'fail'));
    expect(s.run!.results.slice(2).every((r) => r.status === 'timeout')).toBe(true);
    expect(s.phase).toBe('playing');

    // second run wins with all passes
    s = run(s, { type: 'RUN_REQUESTED', roundId }).state;
    const runId2 = s.run!.runId;
    expect(runId2).not.toBe(runId);
    for (let i = 0; i < N; i++) {
      s = run(s, { type: 'RUN_RESULT', roundId, runId: runId2, result: mk(i, 'pass') }).state;
    }
    s = run(s, { type: 'RUN_DONE', roundId, runId: runId2, count: N }).state;
    expect(s.phase).toBe('won');
    expect(s.run!.status).toBe('complete');
  });
});
