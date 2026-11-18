import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { normalizeConfig } from '../../src/core/config';
import { initialState, step } from '../../src/core/reducer';
import type { GameEvent, GameState, TestResult } from '../../src/core/types';

const cfg = normalizeConfig({});
const run = (s: GameState, e: GameEvent) => step(s, e, cfg);

const res = (index: number, status: TestResult['status'] = 'pass'): TestResult => ({
  index,
  status,
  message: '',
  expectedText: 'x',
  actualText: status === 'pass' ? 'x' : 'y',
});

const started = () => run(initialState(cfg), { type: 'START' }).state;
/** Playing state with a running run; returns ids. */
function running() {
  const s0 = started();
  const roundId = s0.activeRoundId!;
  const s1 = run(s0, { type: 'RUN_REQUESTED', roundId }).state;
  return { s: s1, roundId, runId: s1.run!.runId, count: s1.run!.testCount };
}

describe('Property 6: Stale, foreign, and ended-round events are no-ops', () => {
  // **Validates: Requirements 5.9, 7.3, 7.4, 7.6, 14.9, 15.1, 15.10, 15.11, 22.13, 22.18, 22.20**

  it('RUN_RESULT with wrong roundId or runId is discarded with the same state reference', () => {
    const { s, roundId, runId, count } = running();
    fc.assert(
      fc.property(
        fc.integer({ min: -3, max: 8 }),
        fc.integer({ min: -3, max: 8 }),
        fc.integer({ min: 0, max: count - 1 }),
        (r, u, index) => {
          fc.pre(r !== roundId || u !== runId);
          const out = run(s, { type: 'RUN_RESULT', roundId: r, runId: u, result: res(index) });
          expect(out.outcome).toBe('discarded');
          expect(out.state).toBe(s);
        },
      ),
    );
  });

  it('RUN_DONE / RUN_ABORT / RUN_TIMEOUT / RUN_FAILED with wrong ids are discarded', () => {
    const { s, roundId, runId, count } = running();
    fc.assert(
      fc.property(fc.integer({ min: -3, max: 8 }), fc.integer({ min: -3, max: 8 }), (r, u) => {
        fc.pre(r !== roundId || u !== runId);
        const events: GameEvent[] = [
          { type: 'RUN_DONE', roundId: r, runId: u, count },
          { type: 'RUN_ABORT', roundId: r, runId: u },
          { type: 'RUN_TIMEOUT', roundId: r, runId: u },
          { type: 'RUN_FAILED', roundId: r, runId: u, message: 'boom' },
        ];
        for (const e of events) {
          const out = run(s, e);
          expect(out.outcome).toBe('discarded');
          expect(out.state).toBe(s);
        }
      }),
    );
  });

  it('invalid indices (negative, fractional, >= testCount, NaN) are ignored', () => {
    const { s, roundId, runId, count } = running();
    const bad = fc.oneof(
      fc.integer({ min: -50, max: -1 }),
      fc.integer({ min: count, max: count + 50 }),
      fc.double({ noInteger: true, noNaN: true, min: -10, max: 10 }),
      fc.constant(NaN),
      fc.constant(Infinity),
    );
    fc.assert(
      fc.property(bad, (index) => {
        const out = run(s, { type: 'RUN_RESULT', roundId, runId, result: res(index) });
        expect(out.outcome).toBe('discarded');
        expect(out.state).toBe(s);
      }),
    );
  });

  it('duplicate indices are ignored and the first result is kept', () => {
    const { s, roundId, runId, count } = running();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: count - 1 }), (index) => {
        const first = run(s, { type: 'RUN_RESULT', roundId, runId, result: res(index, 'fail') });
        expect(first.outcome).toBe('applied');
        const dup = run(first.state, { type: 'RUN_RESULT', roundId, runId, result: res(index, 'pass') });
        expect(dup.outcome).toBe('discarded');
        expect(dup.state).toBe(first.state);
        expect(dup.state.run!.results.filter((r) => r.index === index)).toHaveLength(1);
        expect(dup.state.run!.results[0].status).toBe('fail');
      }),
    );
  });

  it('RUN_DONE with wrong count is discarded and cannot win', () => {
    const { s, roundId, runId, count } = running();
    let cur = s;
    for (let i = 0; i < count; i++) {
      cur = run(cur, { type: 'RUN_RESULT', roundId, runId, result: res(i) }).state;
    }
    fc.assert(
      fc.property(fc.integer({ min: -5, max: count + 5 }), (c) => {
        fc.pre(c !== count);
        const out = run(cur, { type: 'RUN_DONE', roundId, runId, count: c });
        expect(out.outcome).toBe('discarded');
        expect(out.state).toBe(cur);
        expect(out.state.phase).toBe('playing');
      }),
    );
  });

  it('events after the round ends (won/lost) are no-ops', () => {
    const { s, roundId, runId, count } = running();
    let won = s;
    for (let i = 0; i < count; i++) {
      won = run(won, { type: 'RUN_RESULT', roundId, runId, result: res(i) }).state;
    }
    won = run(won, { type: 'RUN_DONE', roundId, runId, count }).state;
    expect(won.phase).toBe('won');
    expect(won.activeRoundId).toBeNull();

    let lost = running().s;
    while (lost.phase === 'playing') lost = run(lost, { type: 'DRAIN_TICK', roundId: lost.activeRoundId! }).state;
    expect(lost.phase).toBe('lost');

    const endedEvents: GameEvent[] = [
      { type: 'RUN_REQUESTED', roundId },
      { type: 'RUN_RESULT', roundId, runId, result: res(0, 'fail') },
      { type: 'RUN_DONE', roundId, runId, count },
      { type: 'RUN_ABORT', roundId, runId },
      { type: 'RUN_TIMEOUT', roundId, runId },
      { type: 'RUN_FAILED', roundId, runId, message: 'x' },
      { type: 'CODE_CHANGED', roundId, code: 'zzz' },
    ];
    for (const end of [won, lost]) {
      for (const e of endedEvents) {
        const out = run(end, e);
        expect(out.outcome).toBe('discarded');
        expect(out.state).toBe(end);
      }
    }
  });

  it('a message with mismatched ids is not accepted even if one field matches the latest', () => {
    const { s, roundId, runId } = running();
    for (const [r, u] of [
      [roundId, runId + 1],
      [roundId, runId - 1],
      [roundId + 1, runId],
    ]) {
      const out = run(s, { type: 'RUN_RESULT', roundId: r, runId: u, result: res(0) });
      expect(out.outcome).toBe('discarded');
      expect(out.state).toBe(s);
    }
  });

  describe('regressions', () => {
    it('stale results after editing are discarded and displayRun is unchanged', () => {
      const { s, roundId, runId } = running();
      const shown = run(s, { type: 'RUN_RESULT', roundId, runId, result: res(0) }).state;
      const edited = run(shown, { type: 'CODE_CHANGED', roundId, code: 'changed' }).state;
      expect(edited.run!.status).toBe('stale');
      const before = edited.displayRun;
      for (const e of [
        { type: 'RUN_RESULT', roundId, runId, result: res(1) },
        { type: 'RUN_DONE', roundId, runId, count: edited.run!.testCount },
        { type: 'RUN_TIMEOUT', roundId, runId },
        { type: 'RUN_FAILED', roundId, runId, message: 'x' },
      ] as GameEvent[]) {
        const out = run(edited, e);
        expect(out.outcome).toBe('discarded');
        expect(out.state).toBe(edited);
        expect(out.state.displayRun).toBe(before);
        expect(out.state.phase).toBe('playing');
      }
    });

    it('wrong round/run IDs: earlier, future runs and rounds do not change state', () => {
      const { s, roundId, runId } = running();
      for (const [r, u] of [
        [roundId, runId - 1],
        [roundId, runId + 1],
        [roundId - 1, runId],
        [roundId + 1, runId],
      ]) {
        const out = run(s, { type: 'RUN_RESULT', roundId: r, runId: u, result: res(0) });
        expect(out.state).toBe(s);
      }
    });

    it('invalid or duplicate indices leave results unchanged', () => {
      const { s, roundId, runId, count } = running();
      const one = run(s, { type: 'RUN_RESULT', roundId, runId, result: res(0) }).state;
      for (const index of [-1, 0.5, count, NaN]) {
        expect(run(one, { type: 'RUN_RESULT', roundId, runId, result: res(index) }).state).toBe(one);
      }
      expect(run(one, { type: 'RUN_RESULT', roundId, runId, result: res(0, 'fail') }).state).toBe(one);
    });

    it('a late result from round 1 arriving in round 2 after restart is discarded', () => {
      const { s, roundId, runId, count } = running();
      let lost = s;
      while (lost.phase === 'playing') lost = run(lost, { type: 'DRAIN_TICK', roundId: lost.activeRoundId! }).state;
      const ready = run(lost, { type: 'RESTART' }).state;
      const round2 = run(ready, { type: 'START' }).state;
      expect(round2.activeRoundId).not.toBe(roundId);
      const r2 = run(round2, { type: 'RUN_REQUESTED', roundId: round2.activeRoundId! }).state;
      const events: GameEvent[] = [
        { type: 'RUN_RESULT', roundId, runId, result: res(0) },
        { type: 'RUN_DONE', roundId, runId, count },
      ];
      for (const base of [round2, r2]) {
        for (const e of events) {
          const out = run(base, e);
          expect(out.outcome).toBe('discarded');
          expect(out.state).toBe(base);
          expect(out.state.phase).toBe('playing');
        }
      }
    });
  });
});
