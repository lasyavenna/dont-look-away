import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { normalizeConfig } from '../../src/core/config';
import { initialState, step } from '../../src/core/reducer';
import type { GameEvent, GameState, TestResult } from '../../src/core/types';

const cfg = normalizeConfig({ drainAmount: 7, absenceCost: 15 });
const drain = cfg.drainAmount;
const cost = cfg.absenceCost;
const N = 5;

const res = (index: number, status: TestResult['status']): TestResult => ({
  index,
  status,
  message: '',
  expectedText: 'x',
  actualText: status === 'pass' || status === 'fail' ? 'y' : null,
});

/** Abstract event; roundId/runId are resolved against the live state when applied. */
type Abs =
  | { k: 'START' }
  | { k: 'RESTART' }
  | { k: 'DRAIN'; wrong: boolean }
  | { k: 'HIDDEN'; wrong: boolean }
  | { k: 'VISIBLE'; wrong: boolean }
  | { k: 'CODE'; wrong: boolean; code: string }
  | { k: 'REQ'; wrong: boolean }
  | { k: 'RESULT'; wrong: boolean; index: number; status: TestResult['status'] }
  | { k: 'DONE'; wrong: boolean }
  | { k: 'ABORT' }
  | { k: 'TIMEOUT' }
  | { k: 'FAILED' };

// mostly correct ids (~14% wrong); weighted by fast-check so it is seeded and shrinks toward `false`
const arbWrong = fc.oneof(
  { weight: 6, arbitrary: fc.constant(false) },
  { weight: 1, arbitrary: fc.constant(true) },
);
const arbAbs: fc.Arbitrary<Abs> = fc.oneof(
  { weight: 1, arbitrary: fc.constant<Abs>({ k: 'START' }) },
  { weight: 1, arbitrary: fc.constant<Abs>({ k: 'RESTART' }) },
  { weight: 5, arbitrary: arbWrong.map((wrong): Abs => ({ k: 'DRAIN', wrong })) },
  { weight: 4, arbitrary: arbWrong.map((wrong): Abs => ({ k: 'HIDDEN', wrong })) },
  { weight: 4, arbitrary: arbWrong.map((wrong): Abs => ({ k: 'VISIBLE', wrong })) },
  { weight: 2, arbitrary: fc.tuple(arbWrong, fc.string()).map(([wrong, code]): Abs => ({ k: 'CODE', wrong, code })) },
  { weight: 2, arbitrary: arbWrong.map((wrong): Abs => ({ k: 'REQ', wrong })) },
  {
    weight: 4,
    arbitrary: fc
      .tuple(arbWrong, fc.integer({ min: 0, max: N - 1 }), fc.constantFrom<TestResult['status']>('pass', 'fail', 'error', 'timeout'))
      .map(([wrong, index, status]): Abs => ({ k: 'RESULT', wrong, index, status })),
  },
  { weight: 2, arbitrary: arbWrong.map((wrong): Abs => ({ k: 'DONE', wrong })) },
  { weight: 1, arbitrary: fc.constant<Abs>({ k: 'ABORT' }) },
  { weight: 1, arbitrary: fc.constant<Abs>({ k: 'TIMEOUT' }) },
  { weight: 1, arbitrary: fc.constant<Abs>({ k: 'FAILED' }) },
);

function resolve(a: Abs, s: GameState): GameEvent {
  const good = s.activeRoundId ?? s.round?.roundId ?? 1;
  const runId = s.run?.runId ?? s.nextRunId;
  const rid = (wrong: boolean) => (wrong ? good + 1000 : good);
  switch (a.k) {
    case 'START':
      return { type: 'START' };
    case 'RESTART':
      return { type: 'RESTART' };
    case 'DRAIN':
      return { type: 'DRAIN_TICK', roundId: rid(a.wrong) };
    case 'HIDDEN':
      return { type: 'VISIBILITY_HIDDEN', roundId: rid(a.wrong) };
    case 'VISIBLE':
      return { type: 'VISIBILITY_VISIBLE', roundId: rid(a.wrong) };
    case 'CODE':
      return { type: 'CODE_CHANGED', roundId: rid(a.wrong), code: a.code };
    case 'REQ':
      return { type: 'RUN_REQUESTED', roundId: rid(a.wrong) };
    case 'RESULT':
      return { type: 'RUN_RESULT', roundId: rid(false), runId: a.wrong ? runId + 1000 : runId, result: res(a.index, a.status) };
    case 'DONE':
      return { type: 'RUN_DONE', roundId: rid(false), runId: a.wrong ? runId + 1000 : runId, count: N };
    case 'ABORT':
      return { type: 'RUN_ABORT', roundId: rid(false), runId };
    case 'TIMEOUT':
      return { type: 'RUN_TIMEOUT', roundId: rid(false), runId };
    case 'FAILED':
      return { type: 'RUN_FAILED', roundId: rid(false), runId, message: 'boom' };
  }
}

describe('Property 2: Sanity stays bounded and changes only through allowed events', () => {
  /** **Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 22.4, 22.5, 22.12, 1.7** */
  it('sanity is bounded and changes only by drain, ended Absence, and START/RESTART', () => {
    fc.assert(
      fc.property(fc.array(arbAbs, { maxLength: 80 }), (seq) => {
        let s = initialState(cfg);
        for (const a of seq) {
          const before = s;
          const e = resolve(a, before);
          const r = step(before, e, cfg);
          s = r.state;
          const v = s.sanity.value;
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);

          const b = before.sanity.value;
          const wasPlaying = before.phase === 'playing';
          let expected = b; // default: unchanged
          if (r.outcome === 'applied') {
            if (e.type === 'START' || e.type === 'RESTART') expected = 100;
            else if (e.type === 'DRAIN_TICK') {
              expect(wasPlaying).toBe(true);
              expect(before.round?.absenceActive).toBe(false);
              expected = Math.max(0, b - drain);
            } else if (e.type === 'VISIBILITY_VISIBLE') {
              expect(wasPlaying).toBe(true);
              expect(before.round?.absenceActive).toBe(true);
              expected = Math.max(0, b - cost);
            }
          } else {
            expect(s).toEqual(before);
          }
          expect(v).toBe(expected);

          // sanity 0 while playing never persists: the round is lost
          if (before.phase === 'playing' && v === 0 && r.outcome === 'applied' && expected !== b) {
            expect(s.phase).toBe('lost');
          }
          // run events and events in won/lost never change sanity
          if (e.type.startsWith('RUN_') || e.type === 'CODE_CHANGED') expect(v).toBe(b);
          if ((before.phase === 'won' || before.phase === 'lost') && e.type !== 'RESTART') {
            expect(s.sanity.value).toBe(b);
          }
          // absence events outside playing do nothing
          if (before.phase !== 'playing' && (e.type === 'VISIBILITY_HIDDEN' || e.type === 'VISIBILITY_VISIBLE')) {
            expect(s).toEqual(before);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  /** **Validates: Requirements 8.2, 22.4** */
  it('ended Absence at cost >= sanity floors at 0 and loses without a Mutation', () => {
    let s = step(initialState(cfg), { type: 'START' }, cfg).state;
    const roundId = s.activeRoundId as number;
    s = { ...s, sanity: { value: cost } };
    s = step(s, { type: 'VISIBILITY_HIDDEN', roundId }, cfg).state;
    const r = step(s, { type: 'VISIBILITY_VISIBLE', roundId }, cfg);
    expect(r.state.sanity.value).toBe(0);
    expect(r.state.phase).toBe('lost');
    expect(r.state.round?.applied).toBeNull();
  });
});

describe('Property 5 extension: sanity-zero Absence end is lost, never won', () => {
  /** **Validates: Requirements 1.7, 8.6, 22.12** */
  it('a passing run completing after a sanity-zero Absence end is discarded and stays lost', () => {
    fc.assert(
      fc.property(fc.shuffledSubarray([0, 1, 2, 3, 4], { minLength: N, maxLength: N }), fc.integer({ min: 0, max: N }), (order, k) => {
        let s = step(initialState(cfg), { type: 'START' }, cfg).state;
        const roundId = s.activeRoundId as number;
        const runId = s.nextRunId;
        s = step(s, { type: 'RUN_REQUESTED', roundId }, cfg).state;
        const results = order.map((i): GameEvent => ({ type: 'RUN_RESULT', roundId, runId, result: res(i, 'pass') }));
        for (const e of results.slice(0, k)) s = step(s, e, cfg).state;
        s = { ...s, sanity: { value: Math.min(cost, 100) } };
        s = step(s, { type: 'VISIBILITY_HIDDEN', roundId }, cfg).state;
        s = step(s, { type: 'VISIBILITY_VISIBLE', roundId }, cfg).state;
        expect(s.phase).toBe('lost');
        expect(s.sanity.value).toBe(0);
        expect(s.round?.applied).toBeNull();
        const lost = s;
        for (const e of [...results.slice(k), { type: 'RUN_DONE', roundId, runId, count: N } as GameEvent]) {
          const r = step(s, e, cfg);
          expect(r.outcome).toBe('discarded');
          s = r.state;
        }
        expect(s).toEqual(lost);
        expect(s.phase).not.toBe('won');
      }),
    );
  });
});
