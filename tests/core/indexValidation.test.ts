import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { normalizeConfig } from '../../src/core/config';
import { initialState, step } from '../../src/core/reducer';
import type { GameState, TestResult, TestStatus } from '../../src/core/types';

const cfg = normalizeConfig({});
const N = 5;

const mk = (index: number, status: TestStatus): TestResult => ({
  index,
  status,
  message: '',
  expectedText: '',
  actualText: null,
});

const arbIndex = fc.oneof(
  { weight: 4, arbitrary: fc.integer({ min: 0, max: N - 1 }) },
  fc.integer({ min: -5, max: -1 }),
  fc.integer({ min: N, max: N + 5 }),
  fc.double({ noInteger: true, noNaN: true, min: -3, max: 8 }),
  fc.constantFrom(NaN, Infinity, -Infinity),
);
const arbStatus = fc.constantFrom<TestStatus>('pass', 'fail', 'error', 'timeout');
const arbMsgs = fc.array(fc.tuple(arbIndex, arbStatus), { maxLength: 30 });

function startRun(): { s: GameState; roundId: number; runId: number } {
  let s = step(initialState(cfg), { type: 'START' }, cfg).state;
  const roundId = s.activeRoundId!;
  s = step(s, { type: 'RUN_REQUESTED', roundId }, cfg).state;
  return { s, roundId, runId: s.run!.runId };
}

describe('Property 16: Run indices are validated and a win needs every index exactly once', () => {
  // **Validates: Requirements 5.4, 5.13, 5.14, 22.21**
  it('accepts only the first result per valid index; wins iff all five pass and done arrives', () => {
    fc.assert(
      fc.property(arbMsgs, fc.boolean(), (msgs, passBias) => {
        const { s: s0, roundId, runId } = startRun();
        let s = s0;
        const expected = new Map<number, TestStatus>();
        for (const [index, rawStatus] of msgs) {
          const status = passBias && rawStatus !== 'pass' && index === 0 ? 'pass' : rawStatus;
          const valid = Number.isInteger(index) && index >= 0 && index < N;
          const isNew = valid && !expected.has(index);
          const r = step(s, { type: 'RUN_RESULT', roundId, runId, result: mk(index, status) }, cfg);
          if (isNew) {
            expected.set(index, status);
            expect(r.outcome).toBe('applied');
          } else {
            expect(r.outcome).toBe('discarded');
            expect(r.state).toBe(s);
          }
          s = r.state;
          expect(s.phase).toBe('playing');
        }
        expect(s.run!.results.map((r) => [r.index, r.status])).toEqual(
          [...expected.entries()].sort((a, b) => a[0] - b[0]),
        );

        const done = step(s, { type: 'RUN_DONE', roundId, runId, count: N }, cfg);
        expect(done.outcome).toBe('applied');
        const results = done.state.run!.results;
        expect(results.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
        for (let i = 0; i < N; i++) {
          expect(results[i].status).toBe(expected.get(i) ?? 'error');
        }
        const shouldWin = expected.size === N && [...expected.values()].every((v) => v === 'pass');
        expect(done.state.phase).toBe(shouldWin ? 'won' : 'playing');
      }),
      { numRuns: 200 },
    );
  });

  it('a later pass duplicate does not flip an earlier fail', () => {
    const { s: s0, roundId, runId } = startRun();
    let s = step(s0, { type: 'RUN_RESULT', roundId, runId, result: mk(2, 'fail') }, cfg).state;
    for (const i of [0, 1, 3, 4]) {
      s = step(s, { type: 'RUN_RESULT', roundId, runId, result: mk(i, 'pass') }, cfg).state;
    }
    const dup = step(s, { type: 'RUN_RESULT', roundId, runId, result: mk(2, 'pass') }, cfg);
    expect(dup.outcome).toBe('discarded');
    const done = step(dup.state, { type: 'RUN_DONE', roundId, runId, count: N }, cfg);
    expect(done.state.phase).toBe('playing');
    expect(done.state.run!.results[2].status).toBe('fail');
  });

  it('missing indices at done become error and never win; mismatched count is discarded', () => {
    const { s: s0, roundId, runId } = startRun();
    let s = s0;
    for (const i of [0, 1, 2, 3]) {
      s = step(s, { type: 'RUN_RESULT', roundId, runId, result: mk(i, 'pass') }, cfg).state;
    }
    const bad = step(s, { type: 'RUN_DONE', roundId, runId, count: N - 1 }, cfg);
    expect(bad.outcome).toBe('discarded');
    expect(bad.state).toBe(s);
    const done = step(s, { type: 'RUN_DONE', roundId, runId, count: N }, cfg);
    expect(done.state.run!.results[4].status).toBe('error');
    expect(done.state.phase).toBe('playing');
  });

  it('wins when all five distinct indices pass before done', () => {
    const { s: s0, roundId, runId } = startRun();
    let s = s0;
    for (const i of [4, 2, 0, 3, 1]) {
      s = step(s, { type: 'RUN_RESULT', roundId, runId, result: mk(i, 'pass') }, cfg).state;
    }
    expect(step(s, { type: 'RUN_DONE', roundId, runId, count: N }, cfg).state.phase).toBe('won');
  });
});
