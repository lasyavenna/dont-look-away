import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { normalizeConfig } from '../../src/core/config';
import { initialState, step } from '../../src/core/reducer';
import { CHALLENGE, SECOND_CHALLENGE } from '../../src/core/challenge';
import { SECOND_CANDIDATES, cutLines } from '../../src/core/mutations';
import { runTestCases } from '../../src/core/execute';
import type { GameEvent, GameState } from '../../src/core/types';
import { setWound, woundMarker } from '../../src/components/woundMarker';

const config = normalizeConfig();
const go = (state: GameState, event: GameEvent) => step(state, event, config).state;
const start = () => go(initialState(config), { type: 'START' });

function finish(state: GameState, code: string): GameState {
  let next = go(state, { type: 'CODE_CHANGED', roundId: state.activeRoundId!, code });
  next = go(next, { type: 'RUN_REQUESTED', roundId: next.activeRoundId! });
  const roundId = next.activeRoundId!;
  const runId = next.run!.runId;
  const challenge = next.roomIndex === 0 ? CHALLENGE : SECOND_CHALLENGE;
  runTestCases(code, challenge.functionName, challenge.tests, (result) => {
    next = go(next, { type: 'RUN_RESULT', roundId, runId, result });
  });
  return go(next, { type: 'RUN_DONE', roundId, runId, count: challenge.tests.length });
}

describe('persistent wounds and deliberate look-away', () => {
  it('uses exactly the same cost and mutation for a hold as for a tab return', () => {
    const state = start();
    const id = state.activeRoundId!;
    const held = go(state, { type: 'LOOK_AWAY', roundId: id });
    const hidden = go(state, { type: 'VISIBILITY_HIDDEN', roundId: id });
    const returned = go(hidden, { type: 'VISIBILITY_VISIBLE', roundId: id });
    expect(held).toEqual(returned);
    const again = go(held, { type: 'LOOK_AWAY', roundId: id });
    expect(again.sanity.value).toBe(80);
    expect(again.round!.applied).toEqual(held.round!.applied);
  });

  it('keeps the cut after the notice timer expires, clearing only on repair', () => {
    let state = start();
    const id = state.activeRoundId!;
    state = go(state, { type: 'LOOK_AWAY', roundId: id });
    const record = state.round!.applied!;
    expect(cutLines(record).after).toContain('length - 1');
    state = go(state, { type: 'NOTICED_EXPIRED', roundId: id, seq: state.round!.noticedSeq });
    expect(state.notice).toBe('none');
    expect(state.round!.woundResolved).not.toBe(true);
    state = go(state, { type: 'CODE_CHANGED', roundId: id, code: '// thinking\n' + state.code });
    expect(state.round!.woundResolved).toBe(false);
    state = go(state, { type: 'CODE_CHANGED', roundId: id, code: state.code.replace('length - 1', 'length') });
    expect(state.round!.woundResolved).toBe(true);
    expect(state.round!.applied).toEqual(record);
  });

  it('stales a running test, ignores hidden holds, and loses without a cut at zero', () => {
    let state = start();
    const id = state.activeRoundId!;
    state = go(state, { type: 'RUN_REQUESTED', roundId: id });
    expect(go(state, { type: 'LOOK_AWAY', roundId: id }).run!.status).toBe('stale');
    const hidden = go(state, { type: 'VISIBILITY_HIDDEN', roundId: id });
    expect(go(hidden, { type: 'LOOK_AWAY', roundId: id })).toBe(hidden);
    const lost = go({ ...state, sanity: { value: 10 } }, { type: 'LOOK_AWAY', roundId: id });
    expect(lost.phase).toBe('lost');
    expect(lost.round!.applied).toBeNull();
  });

  it('maps the editor marker when lines are inserted above it', () => {
    let state = EditorState.create({ doc: 'first\ncut\nlast', extensions: [woundMarker] });
    state = state.update({ effects: setWound.of(state.doc.line(2).from) }).state;
    state = state.update({ changes: { from: 0, insert: 'new\n' } }).state;
    const positions: number[] = [];
    state.field(woundMarker).between(0, state.doc.length, (from) => { positions.push(from); });
    expect(positions).toEqual([state.doc.line(3).from]);
    state = state.update({ effects: setWound.of(null) }).state;
    expect(state.field(woundMarker).size).toBe(0);
  });
});

describe('two-room progression', () => {
  const solution = SECOND_CHALLENGE.starterCode.replace('let i = 1', 'let i = 0');
  it('validates the second starter, solution, and all three distinct cuts', () => {
    const statuses = (code: string) => {
      const results: string[] = [];
      runTestCases(code, SECOND_CHALLENGE.functionName, SECOND_CHALLENGE.tests, (result) => results.push(result.status));
      return results;
    };
    expect(statuses(SECOND_CHALLENGE.starterCode)).toContain('pass');
    expect(statuses(SECOND_CHALLENGE.starterCode)).toContain('fail');
    expect(statuses(solution).every((status) => status === 'pass')).toBe(true);
    expect(new Set(SECOND_CANDIDATES.map((cut) => cut.id)).size).toBe(3);
    for (const cut of SECOND_CANDIDATES) {
      expect(solution).toContain(cut.target);
      expect(() => new Function(cut.transform(solution))).not.toThrow();
      expect(statuses(cut.transform(solution)).some((status) => status !== 'pass')).toBe(true);
    }
  });

  it('advances only after winning, resets resources, and rejects old-room events', () => {
    const first = start();
    expect(go(first, { type: 'NEXT_ROOM' })).toBe(first);
    const won = finish(first, CHALLENGE.starterCode.replace('>=', '>'));
    expect(won.phase).toBe('won');
    let second = go(won, { type: 'NEXT_ROOM' });
    expect(second.roomIndex).toBe(1);
    expect(second.phase).toBe('playing');
    expect(second.sanity.value).toBe(100);
    expect(second.run).toBeNull();
    expect(second.round!.applied).toBeNull();
    expect(second.activeRoundId).not.toBe(first.activeRoundId);
    expect(go(second, { type: 'LOOK_AWAY', roundId: first.activeRoundId! })).toBe(second);
    second = go(second, { type: 'LOOK_AWAY', roundId: second.activeRoundId! });
    expect(second.round!.applied!.id).toBe('borrowed-second');
    expect(second.code).toContain('return seconds - 1');
    const complete = finish(second, solution);
    expect(complete.phase).toBe('won');
    expect(go(complete, { type: 'NEXT_ROOM' })).toBe(complete);
    expect(go(complete, { type: 'RESTART' }).roomIndex).toBe(0);
  });

  it('uses room two expected values when a run times out', () => {
    const won = finish(start(), CHALLENGE.starterCode.replace('>=', '>'));
    let second = go(won, { type: 'NEXT_ROOM' });
    second = go(second, { type: 'RUN_REQUESTED', roundId: second.activeRoundId! });
    second = go(second, { type: 'RUN_TIMEOUT', roundId: second.activeRoundId!, runId: second.run!.runId });
    expect(second.run!.results.map((result) => result.expectedText)).toEqual(['0', '4', '9', '8', '0']);
  });
});
