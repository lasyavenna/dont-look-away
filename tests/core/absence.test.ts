import { describe, it, expect } from 'vitest';
import { normalizeConfig } from '../../src/core/config';
import { CHALLENGE } from '../../src/core/challenge';
import { initialState, step } from '../../src/core/reducer';
import type { CoreDeps, GameEvent, GameState, TestResult } from '../../src/core/types';

const cfg = normalizeConfig({});
const COST = cfg.absenceCost;

const pass = (index: number): TestResult => ({
  index,
  status: 'pass',
  message: '',
  expectedText: 'x',
  actualText: 'x',
});

function play(config = cfg): { s: GameState; id: number } {
  const s = step(initialState(config), { type: 'START' }, config).state;
  return { s, id: s.activeRoundId as number };
}

function go(s: GameState, e: GameEvent, deps?: CoreDeps, config = cfg): GameState {
  return step(s, e, config, deps).state;
}

function absence(s: GameState, id: number, deps?: CoreDeps, config = cfg): GameState {
  const h = go(s, { type: 'VISIBILITY_HIDDEN', roundId: id }, deps, config);
  return go(h, { type: 'VISIBILITY_VISIBLE', roundId: id }, deps, config);
}

const okDeps: CoreDeps = { saveSnapshot: () => true };

describe('Absence handling', () => {
  it('duplicate VISIBILITY_HIDDEN joins the existing Absence', () => {
    const { s, id } = play();
    const h1 = step(s, { type: 'VISIBILITY_HIDDEN', roundId: id }, cfg);
    expect(h1.state.round?.absenceActive).toBe(true);
    const h2 = step(h1.state, { type: 'VISIBILITY_HIDDEN', roundId: id }, cfg);
    expect(h2.outcome).toBe('discarded');
    expect(h2.state).toBe(h1.state);
    const v = go(h2.state, { type: 'VISIBILITY_VISIBLE', roundId: id }, okDeps);
    expect(v.sanity.value).toBe(100 - COST); // charged once
  });

  it('VISIBILITY_VISIBLE without an Absence is discarded', () => {
    const { s, id } = play();
    const r = step(s, { type: 'VISIBILITY_VISIBLE', roundId: id }, cfg, okDeps);
    expect(r.outcome).toBe('discarded');
    expect(r.state).toBe(s);
  });

  it('Absence is discarded when the round ends by a win', () => {
    let { s, id } = play();
    const runId = s.nextRunId;
    s = go(s, { type: 'RUN_REQUESTED', roundId: id });
    s = go(s, { type: 'VISIBILITY_HIDDEN', roundId: id });
    for (let i = 0; i < CHALLENGE.tests.length; i++) {
      s = go(s, { type: 'RUN_RESULT', roundId: id, runId, result: pass(i) });
    }
    s = go(s, { type: 'RUN_DONE', roundId: id, runId, count: CHALLENGE.tests.length });
    expect(s.phase).toBe('won');
    expect(s.round?.applied).toBeNull();
    expect(s.sanity.value).toBe(100);
    const codeBefore = s.code;
    const v = step(s, { type: 'VISIBILITY_VISIBLE', roundId: id }, cfg, okDeps);
    expect(v.outcome).toBe('discarded');
    expect(v.state.sanity.value).toBe(100);
    expect(v.state.code).toBe(codeBefore);
    expect(v.state.round?.applied).toBeNull();
  });

  it('Absence cost reaching 0 loses without a Mutation', () => {
    const c = normalizeConfig({ absenceCost: 100 });
    const { s, id } = play(c);
    let saves = 0;
    const out = absence(s, id, { saveSnapshot: () => (saves++, true) }, c);
    expect(out.phase).toBe('lost');
    expect(out.sanity.value).toBe(0);
    expect(out.code).toBe(CHALLENGE.starterCode);
    expect(out.round?.applied).toBeNull();
    expect(out.activeRoundId).toBeNull();
    expect(saves).toBe(0);
  });

  it('sanity reaching zero ends the round without a mutation', () => {
    const c = normalizeConfig({ drainAmount: 100 });
    const { s, id } = play(c);
    const out = go(s, { type: 'DRAIN_TICK', roundId: id }, okDeps, c);
    expect(out.phase).toBe('lost');
    expect(out.sanity.value).toBe(0);
    expect(out.activeRoundId).toBeNull();
    expect(out.code).toBe(CHALLENGE.starterCode);
    expect(out.round?.applied).toBeNull();
  });

  it.each([
    ['returns false', () => false],
    [
      'throws',
      () => {
        throw new Error('quota');
      },
    ],
  ])('a saveSnapshot that %s cancels the Mutation; a later Absence retries', (_n, fail) => {
    const { s, id } = play();
    const a1 = absence(s, id, { saveSnapshot: fail });
    expect(a1.code).toBe(CHALLENGE.starterCode);
    expect(a1.round?.applied).toBeNull();
    expect(a1.sanity.value).toBe(100 - COST);
    expect(a1.notice).toBe('none');
    const a2 = absence(a1, id, okDeps);
    expect(a2.round?.applied?.id).toBe('off-by-one');
    expect(a2.code).not.toBe(CHALLENGE.starterCode);
    expect(a2.notice).toBe('watcherChanged');
  });

  it('all candidates skipped: no Mutation, then success after restoring a target', () => {
    let { s, id } = play();
    s = go(s, { type: 'CODE_CHANGED', roundId: id, code: 'nothing here' });
    const a1 = absence(s, id, okDeps);
    expect(a1.code).toBe('nothing here');
    expect(a1.round?.applied).toBeNull();
    expect(a1.round?.lastAttemptSkipped.map((k) => k.reason)).toEqual([
      'target-missing',
      'target-missing',
      'target-missing',
    ]);
    expect(a1.sanity.value).toBe(100 - COST);
    const restored = go(a1, { type: 'CODE_CHANGED', roundId: id, code: CHALLENGE.starterCode });
    const a2 = absence(restored, id, okDeps);
    expect(a2.round?.applied?.id).toBe('off-by-one');
    expect(a2.round?.lastAttemptSkipped).toEqual([]);
  });

  it('size-limit skip falls through to the next candidate', () => {
    const c = normalizeConfig({ editorMaxLength: 1000 });
    let { s, id } = play(c);
    const base = CHALLENGE.starterCode;
    const code = base + '/'.repeat(1000 - base.length);
    expect(code.length).toBe(1000);
    s = go(s, { type: 'CODE_CHANGED', roundId: id, code }, undefined, c);
    const out = absence(s, id, okDeps, c);
    expect(out.round?.lastAttemptSkipped).toEqual([{ id: 'off-by-one', reason: 'size-limit' }]);
    expect(out.round?.applied?.id).toBe('flipped-comparison');
    expect(out.code).toContain('candles[i] <');
  });

  it('second Absence costs sanity but applies no second Mutation', () => {
    const { s, id } = play();
    const a1 = absence(s, id, okDeps);
    const applied = a1.round?.applied;
    expect(applied).not.toBeNull();
    let saves = 0;
    const a2 = absence(a1, id, { saveSnapshot: () => (saves++, true) });
    expect(a2.sanity.value).toBe(100 - 2 * COST);
    expect(a2.code).toBe(a1.code);
    expect(a2.round?.applied).toBe(applied);
    expect(saves).toBe(0);
  });

  it('a run in progress becomes stale on a Mutation', () => {
    let { s, id } = play();
    s = go(s, { type: 'RUN_REQUESTED', roundId: id });
    expect(s.run?.status).toBe('running');
    const out = absence(s, id, okDeps);
    expect(out.run?.status).toBe('stale');
    expect(out.round?.applied).not.toBeNull();
  });

  it('NOTICED_EXPIRED applies on matching seq and is discarded when superseded', () => {
    const { s, id } = play();
    const a1 = absence(s, id, okDeps);
    expect(a1.round?.noticedActive).toBe(true);
    const seq1 = a1.round?.noticedSeq as number;
    const ok = step(a1, { type: 'NOTICED_EXPIRED', roundId: id, seq: seq1 }, cfg);
    expect(ok.outcome).toBe('applied');
    expect(ok.state.round?.noticedActive).toBe(false);
    expect(ok.state.notice).toBe('none');

    const a2 = absence(a1, id, okDeps);
    expect(a2.round?.noticedSeq).toBeGreaterThan(seq1);
    const stale = step(a2, { type: 'NOTICED_EXPIRED', roundId: id, seq: seq1 }, cfg);
    expect(stale.outcome).toBe('discarded');
    expect(stale.state.round?.noticedActive).toBe(true);
    const cur = step(a2, { type: 'NOTICED_EXPIRED', roundId: id, seq: a2.round?.noticedSeq as number }, cfg);
    expect(cur.state.round?.noticedActive).toBe(false);
  });

  it('drain ticks are discarded during an Absence and resume after', () => {
    const { s, id } = play();
    const h = go(s, { type: 'VISIBILITY_HIDDEN', roundId: id });
    const t = step(h, { type: 'DRAIN_TICK', roundId: id }, cfg);
    expect(t.outcome).toBe('discarded');
    expect(t.state.sanity.value).toBe(100);
    const v = go(h, { type: 'VISIBILITY_VISIBLE', roundId: id }, okDeps);
    const after = go(v, { type: 'DRAIN_TICK', roundId: id });
    expect(after.sanity.value).toBe(100 - COST - cfg.drainAmount);
  });

  it('Absence duration is irrelevant: an immediate hidden/visible pair works', () => {
    const { s, id } = play();
    const out = absence(s, id, okDeps);
    expect(out.sanity.value).toBe(100 - COST);
    expect(out.round?.absenceActive).toBe(false);
    expect(out.round?.applied).not.toBeNull();
  });

  it('visibility events with the wrong roundId are discarded', () => {
    const { s, id } = play();
    const h = step(s, { type: 'VISIBILITY_HIDDEN', roundId: id + 1 }, cfg);
    expect(h.outcome).toBe('discarded');
    expect(h.state).toBe(s);
    const hidden = go(s, { type: 'VISIBILITY_HIDDEN', roundId: id });
    const v = step(hidden, { type: 'VISIBILITY_VISIBLE', roundId: id + 1 }, cfg, okDeps);
    expect(v.outcome).toBe('discarded');
    expect(v.state).toBe(hidden);
  });

  it('Restart clears absence state and mutation records; old-round events are discarded', () => {
    const c = normalizeConfig({ absenceCost: 50 });
    const { s, id } = play(c);
    let lost = absence(s, id, okDeps, c); // 50, mutation applied
    lost = go(lost, { type: 'VISIBILITY_HIDDEN', roundId: id }, okDeps, c);
    lost = go(lost, { type: 'VISIBILITY_VISIBLE', roundId: id }, okDeps, c); // 0 -> lost
    expect(lost.phase).toBe('lost');
    expect(lost.round?.applied).not.toBeNull();

    const restarted = go(lost, { type: 'RESTART' }, undefined, c);
    const fresh = go(restarted, { type: 'START' }, undefined, c);
    expect(fresh.activeRoundId).not.toBe(id);
    expect(fresh.round?.absenceActive).toBe(false);
    expect(fresh.round?.applied).toBeNull();
    expect(fresh.round?.lastAttemptSkipped).toEqual([]);
    expect(fresh.round?.noticedSeq).toBe(0);
    expect(fresh.round?.absenceEndSeq).toBe(0);
    expect(fresh.round?.noticedActive).toBe(false);
    expect(fresh.code).toBe(CHALLENGE.starterCode);
    expect(fresh.sanity.value).toBe(100);
    expect(fresh.notice).toBe('none');

    const old = step(fresh, { type: 'VISIBILITY_HIDDEN', roundId: id }, c);
    expect(old.outcome).toBe('discarded');
    expect(old.state.round?.absenceActive).toBe(false);
  });
});
