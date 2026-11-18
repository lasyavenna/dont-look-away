import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { normalizeConfig } from '../../src/core/config';
import { initialState, step } from '../../src/core/reducer';
import type { GameEvent, GameState, TestResult } from '../../src/core/types';

const cfg = normalizeConfig({ drainAmount: 7 });
const N = 5;

const res = (index: number, status: TestResult['status'] = 'pass'): TestResult => ({
  index,
  status,
  message: '',
  expectedText: 'x',
  actualText: status === 'pass' ? 'x' : 'y',
});

function run(s: GameState, events: GameEvent[]): GameState {
  return events.reduce((acc, e) => step(acc, e, cfg).state, s);
}

function started(): { s: GameState; roundId: number; runId: number } {
  let s = step(initialState(cfg), { type: 'START' }, cfg).state;
  const roundId = s.activeRoundId as number;
  const runId = s.nextRunId;
  s = step(s, { type: 'RUN_REQUESTED', roundId }, cfg).state;
  return { s, roundId, runId };
}

const arbOrder = fc.shuffledSubarray([0, 1, 2, 3, 4], { minLength: N, maxLength: N });

describe('Property 5: Ordered-event win and loss', () => {
  /** **Validates: Requirements 1.5, 22.11** */
  it('direct flow: START -> RUN_REQUESTED -> 5 passes -> RUN_DONE => won', () => {
    const { s, roundId, runId } = started();
    const mid = run(
      s,
      [0, 1, 2, 3, 4].map((i): GameEvent => ({ type: 'RUN_RESULT', roundId, runId, result: res(i) })),
    );
    expect(mid.phase).toBe('playing');
    const end = step(mid, { type: 'RUN_DONE', roundId, runId, count: N }, cfg).state;
    expect(end.phase).toBe('won');
    expect(end.activeRoundId).toBeNull();
  });

  /** **Validates: Requirements 1.5, 22.11** */
  it('complete all-pass run in any order with sanity > 0 wins in the same step', () => {
    fc.assert(
      fc.property(arbOrder, fc.integer({ min: 1, max: 100 }), (order, sanity) => {
        const { s, roundId, runId } = started();
        const mid = run(
          { ...s, sanity: { value: sanity } },
          order.map((i): GameEvent => ({ type: 'RUN_RESULT', roundId, runId, result: res(i) })),
        );
        expect(mid.phase).toBe('playing');
        const end = step(mid, { type: 'RUN_DONE', roundId, runId, count: N }, cfg).state;
        expect(end.phase).toBe('won');
        expect(end.activeRoundId).toBeNull();
      }),
    );
  });

  /** **Validates: Requirements 1.6, 22.21** */
  it('complete all-pass run completing with sanity 0 is lost', () => {
    fc.assert(
      fc.property(arbOrder, (order) => {
        const { s, roundId, runId } = started();
        const mid = run(
          { ...s, sanity: { value: 0 } },
          order.map((i): GameEvent => ({ type: 'RUN_RESULT', roundId, runId, result: res(i) })),
        );
        const end = step(mid, { type: 'RUN_DONE', roundId, runId, count: N }, cfg).state;
        expect(end.phase).toBe('lost');
        expect(end.activeRoundId).toBeNull();
      }),
    );
  });

  /** **Validates: Requirements 1.6, 1.7, 22.21** */
  it('drain to zero before the passing RUN_DONE => lost; later results are discarded and terminal is final', () => {
    fc.assert(
      fc.property(arbOrder, fc.integer({ min: 0, max: N }), (order, k) => {
        const { s, roundId, runId } = started();
        const drained = run({ ...s, sanity: { value: 1 } }, [{ type: 'DRAIN_TICK', roundId }]);
        expect(drained.phase).toBe('lost');
        expect(drained.sanity.value).toBe(0);
        const events: GameEvent[] = [
          ...order.slice(0, k).map((i): GameEvent => ({ type: 'RUN_RESULT', roundId, runId, result: res(i) })),
          ...order.slice(k).map((i): GameEvent => ({ type: 'RUN_RESULT', roundId, runId, result: res(i) })),
          { type: 'RUN_DONE', roundId, runId, count: N },
        ];
        let cur = drained;
        for (const e of events) {
          const r = step(cur, e, cfg);
          expect(r.outcome).toBe('discarded');
          cur = r.state;
        }
        expect(cur).toEqual(drained);
      }),
    );
  });

  /** **Validates: Requirements 1.7, 5.13** */
  it('a won round never changes phase afterwards except by RESTART', () => {
    const { s, roundId, runId } = started();
    const won = run(s, [
      ...[0, 1, 2, 3, 4].map((i): GameEvent => ({ type: 'RUN_RESULT', roundId, runId, result: res(i) })),
      { type: 'RUN_DONE', roundId, runId, count: N },
    ]);
    expect(won.phase).toBe('won');
    const after = run(won, [
      { type: 'DRAIN_TICK', roundId },
      { type: 'CODE_CHANGED', roundId, code: 'z' },
      { type: 'RUN_REQUESTED', roundId },
    ]);
    expect(after).toEqual(won);
  });

  /** **Validates: Requirements 1.5, 22.11** */
  it('a run with a non-pass result never wins', () => {
    fc.assert(
      fc.property(
        arbOrder,
        fc.integer({ min: 0, max: 4 }),
        fc.constantFrom<TestResult['status']>('fail', 'error', 'timeout'),
        (order, bad, status) => {
          const { s, roundId, runId } = started();
          const mid = run(
            s,
            order.map((i): GameEvent => ({ type: 'RUN_RESULT', roundId, runId, result: res(i, i === bad ? status : 'pass') })),
          );
          const end = step(mid, { type: 'RUN_DONE', roundId, runId, count: N }, cfg).state;
          expect(end.phase).toBe('playing');
        },
      ),
    );
  });

  /** **Validates: Requirements 1.5, 5.13** */
  it('partial runs (missing index, no RUN_DONE) never win', () => {
    fc.assert(
      fc.property(arbOrder, fc.integer({ min: 0, max: N - 1 }), (order, n) => {
        const { s, roundId, runId } = started();
        const sub = order.slice(0, n);
        const mid = run(
          s,
          sub.map((i): GameEvent => ({ type: 'RUN_RESULT', roundId, runId, result: res(i) })),
        );
        expect(mid.phase).toBe('playing');
        // RUN_DONE with missing indices fills errors, never wins
        const done = step(mid, { type: 'RUN_DONE', roundId, runId, count: N }, cfg).state;
        expect(done.phase).toBe('playing');
        // RUN_DONE with wrong count is discarded
        const bad = step(mid, { type: 'RUN_DONE', roundId, runId, count: N - 1 }, cfg);
        expect(bad.outcome).toBe('discarded');
        expect(bad.state.phase).toBe('playing');
      }),
    );
  });

  /** **Validates: Requirements 1.5, 22.11** */
  it('duplicate index results do not substitute for a missing index', () => {
    const { s, roundId, runId } = started();
    const mid = run(
      s,
      [0, 0, 1, 1, 2, 3].map((i): GameEvent => ({ type: 'RUN_RESULT', roundId, runId, result: res(i) })),
    );
    const end = step(mid, { type: 'RUN_DONE', roundId, runId, count: N }, cfg).state;
    expect(end.phase).toBe('playing');
  });

  /** **Validates: Requirements 1.5, 22.11** */
  it('timeout, failure, abort, and stale runs never win', () => {
    const { s, roundId, runId } = started();
    const all = [0, 1, 2, 3, 4].map((i): GameEvent => ({ type: 'RUN_RESULT', roundId, runId, result: res(i) }));
    const done: GameEvent = { type: 'RUN_DONE', roundId, runId, count: N };
    const endings: GameEvent[] = [
      { type: 'RUN_TIMEOUT', roundId, runId },
      { type: 'RUN_FAILED', roundId, runId, message: 'boom' },
      { type: 'RUN_ABORT', roundId, runId },
      { type: 'CODE_CHANGED', roundId, code: 'edited' },
    ];
    for (const ending of endings) {
      expect(run(s, [...all, ending, done]).phase).toBe('playing');
      expect(run(s, [...all.slice(0, 2), ending, ...all.slice(2), done]).phase).toBe('playing');
    }
  });

  /** **Validates: Requirements 1.5, 22.11** */
  it('events for a stale run id or wrong round never win', () => {
    const { s, roundId, runId } = started();
    const mid = run(
      s,
      [0, 1, 2, 3, 4].map((i): GameEvent => ({ type: 'RUN_RESULT', roundId, runId: runId + 1, result: res(i) })),
    );
    expect(step(mid, { type: 'RUN_DONE', roundId, runId: runId + 1, count: N }, cfg).state.phase).toBe('playing');
    const wrongRound = run(
      s,
      [
        ...[0, 1, 2, 3, 4].map((i): GameEvent => ({ type: 'RUN_RESULT', roundId: roundId + 1, runId, result: res(i) })),
        { type: 'RUN_DONE', roundId: roundId + 1, runId, count: N },
      ],
    );
    expect(wrongRound.phase).toBe('playing');
  });
});
