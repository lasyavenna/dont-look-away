import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { normalizeConfig } from '../../src/core/config';
import { initialState, step } from '../../src/core/reducer';
import type { GameEvent, GameState, Phase } from '../../src/core/types';

const cfg = normalizeConfig({ drainAmount: 7 });
const PERMITTED = new Set(['ready>playing', 'playing>won', 'playing>lost', 'won>ready', 'lost>ready']);

const arbEvent: fc.Arbitrary<GameEvent> = fc.oneof(
  { weight: 3, arbitrary: fc.constant<GameEvent>({ type: 'START' }) },
  { weight: 2, arbitrary: fc.constant<GameEvent>({ type: 'RESTART' }) },
  { weight: 8, arbitrary: fc.integer({ min: 0, max: 4 }).map((roundId): GameEvent => ({ type: 'DRAIN_TICK', roundId })) },
  {
    weight: 3,
    arbitrary: fc
      .tuple(fc.integer({ min: 0, max: 4 }), fc.string())
      .map(([roundId, code]): GameEvent => ({ type: 'CODE_CHANGED', roundId, code })),
  },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 4 }).map((roundId): GameEvent => ({ type: 'VISIBILITY_HIDDEN', roundId })) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 4 }).map((roundId): GameEvent => ({ type: 'VISIBILITY_VISIBLE', roundId })) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 4 }).map((roundId): GameEvent => ({ type: 'RUN_REQUESTED', roundId })) },
  {
    weight: 1,
    arbitrary: fc.integer({ min: 0, max: 4 }).map((roundId): GameEvent => ({ type: 'NOTICED_EXPIRED', roundId, seq: 1 })),
  },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 4 }).map((roundId): GameEvent => ({ type: 'RUN_ABORT', roundId, runId: 1 })) },
);
const arbEvents = fc.array(arbEvent, { maxLength: 80 });

function trace(events: GameEvent[]) {
  let s = initialState(cfg);
  const out: { prev: GameState; event: GameEvent; next: GameState; outcome: string }[] = [];
  for (const event of events) {
    const r = step(s, event, cfg);
    out.push({ prev: s, event, next: r.state, outcome: r.outcome });
    s = r.state;
  }
  return out;
}

const drainToLoss = (s: GameState): GameState => {
  let cur = s;
  for (let i = 0; i < 100 && cur.phase === 'playing'; i++) {
    cur = step(cur, { type: 'DRAIN_TICK', roundId: cur.activeRoundId! }, cfg).state;
  }
  return cur;
};
const started = () => step(initialState(cfg), { type: 'START' }, cfg).state;

describe('Property 3: Only permitted transitions occur', () => {
  // **Validates: Requirements 1.1, 1.3, 1.8, 14.2, 14.3, 22.8**
  it('phase changes only along permitted edges; non-applied events leave state unchanged', () => {
    fc.assert(
      fc.property(arbEvents, (events) => {
        for (const { prev, next, outcome } of trace(events)) {
          if (next.phase !== prev.phase) {
            expect(PERMITTED.has(`${prev.phase}>${next.phase}`)).toBe(true);
            expect(outcome).toBe('applied');
          }
          if (outcome !== 'applied') expect(next).toBe(prev);
        }
      }),
    );
  });
});

describe('Property 4: Terminal outcomes are final', () => {
  // **Validates: Requirements 1.9, 1.10, 14.6, 22.9**
  it('in won/lost, only RESTART changes the phase, and only to ready', () => {
    fc.assert(
      fc.property(arbEvents, (events) => {
        for (const { prev, event, next } of trace(events)) {
          const terminal: Phase[] = ['won', 'lost'];
          if (terminal.includes(prev.phase) && event.type !== 'RESTART') {
            expect(next).toEqual(prev);
          }
          if (terminal.includes(prev.phase) && event.type === 'RESTART') {
            expect(next.phase).toBe('ready');
          }
        }
      }),
    );
  });
});

describe('Property 13: Restart restores the initial state', () => {
  // **Validates: Requirements 1.12, 14.8, 22.10**
  it('after RESTART, state equals initialState except carried id counters', () => {
    fc.assert(
      fc.property(arbEvents, (events) => {
        for (const { prev, event, next, outcome } of trace(events)) {
          if (event.type === 'RESTART' && outcome === 'applied') {
            expect(next).toEqual({
              ...initialState(cfg),
              nextRoundId: prev.nextRoundId,
              nextRunId: prev.nextRunId,
            });
            expect(next.sanity.value).toBe(100);
          }
        }
      }),
    );
  });
});

describe('Sanity bound', () => {
  // **Validates: Requirements 22.4**
  it('sanity stays within 0..100 as an integer across arbitrary sequences', () => {
    fc.assert(
      fc.property(arbEvents, (events) => {
        for (const { next } of trace(events)) {
          expect(Number.isInteger(next.sanity.value)).toBe(true);
          expect(next.sanity.value).toBeGreaterThanOrEqual(0);
          expect(next.sanity.value).toBeLessThanOrEqual(100);
        }
      }),
    );
  });
  it('START and RESTART reset sanity to 100', () => {
    const lost = drainToLoss(started());
    expect(lost.sanity.value).toBe(0);
    expect(step(lost, { type: 'RESTART' }, cfg).state.sanity.value).toBe(100);
    const again = step(step(lost, { type: 'RESTART' }, cfg).state, { type: 'START' }, cfg).state;
    expect(again.sanity.value).toBe(100);
  });
});

describe('state machine unit tests', () => {
  it('START moves ready to playing with an active round', () => {
    const s = started();
    expect(s.phase).toBe('playing');
    expect(s.activeRoundId).toBe(1);
  });
  it('START outside ready is rejected', () => {
    const playing = started();
    const r = step(playing, { type: 'START' }, cfg);
    expect(r.outcome).toBe('rejected');
    expect(r.state).toBe(playing);
    const lost = drainToLoss(playing);
    expect(step(lost, { type: 'START' }, cfg).outcome).toBe('rejected');
  });
  it('RESTART in ready or playing is rejected', () => {
    expect(step(initialState(cfg), { type: 'RESTART' }, cfg).outcome).toBe('rejected');
    expect(step(started(), { type: 'RESTART' }, cfg).outcome).toBe('rejected');
  });
  it('double RESTART: second is rejected', () => {
    const lost = drainToLoss(started());
    const first = step(lost, { type: 'RESTART' }, cfg);
    expect(first.outcome).toBe('applied');
    const second = step(first.state, { type: 'RESTART' }, cfg);
    expect(second.outcome).toBe('rejected');
    expect(second.state).toBe(first.state);
  });
  it('drain reaching 0 gives lost with activeRoundId null in the same step', () => {
    let s = started();
    while (s.sanity.value > 0) {
      expect(s.phase).toBe('playing');
      s = step(s, { type: 'DRAIN_TICK', roundId: s.activeRoundId! }, cfg).state;
    }
    expect(s.phase).toBe('lost');
    expect(s.activeRoundId).toBeNull();
    expect(s.sanity.value).toBe(0);
  });
  it('further events after lost are discarded and state unchanged', () => {
    const lost = drainToLoss(started());
    const r = step(lost, { type: 'DRAIN_TICK', roundId: 1 }, cfg);
    expect(r.outcome).toBe('discarded');
    expect(r.state).toEqual(lost);
  });
  it('tagged events with a non-matching roundId are discarded', () => {
    const s = started();
    for (const e of [
      { type: 'DRAIN_TICK', roundId: 99 },
      { type: 'CODE_CHANGED', roundId: 99, code: 'x' },
    ] as GameEvent[]) {
      const r = step(s, e, cfg);
      expect(r.outcome).toBe('discarded');
      expect(r.state).toEqual(s);
    }
  });
  it('CODE_CHANGED with matching roundId updates code', () => {
    const r = step(started(), { type: 'CODE_CHANGED', roundId: 1, code: 'abc' }, cfg);
    expect(r.outcome).toBe('applied');
    expect(r.state.code).toBe('abc');
  });
  it('ids never repeat after restart', () => {
    let s = started();
    const seen = [s.activeRoundId];
    for (let i = 0; i < 3; i++) {
      s = step(drainToLoss(s), { type: 'RESTART' }, cfg).state;
      s = step(s, { type: 'START' }, cfg).state;
      expect(seen).not.toContain(s.activeRoundId);
      seen.push(s.activeRoundId);
    }
    expect(seen).toEqual([1, 2, 3, 4]);
  });
  it('stale drain from a previous round is discarded after restart', () => {
    let s = drainToLoss(started());
    s = step(step(s, { type: 'RESTART' }, cfg).state, { type: 'START' }, cfg).state;
    const r = step(s, { type: 'DRAIN_TICK', roundId: 1 }, cfg);
    expect(r.outcome).toBe('discarded');
    expect(r.state).toEqual(s);
  });
});

describe('reducer sanity stays integer 0..100 with unnormalized config', () => {
  it('DRAIN_TICK with fractional/NaN drainAmount yields integer sanity in 0..100', () => {
    for (const amt of [1.5, NaN, Infinity, -2, 0.3]) {
      const bad = { ...cfg, drainAmount: amt };
      let s = step(initialState(bad), { type: 'START' }, bad).state;
      for (let i = 0; i < 5 && s.phase === 'playing'; i++) {
        s = step(s, { type: 'DRAIN_TICK', roundId: s.activeRoundId! }, bad).state;
        expect(Number.isInteger(s.sanity.value)).toBe(true);
        expect(s.sanity.value).toBeGreaterThanOrEqual(0);
        expect(s.sanity.value).toBeLessThanOrEqual(100);
      }
    }
  });
});
