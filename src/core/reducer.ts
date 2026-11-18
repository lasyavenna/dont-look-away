import { ROOMS, roomAt } from './challenge';
import type { GameConfig } from './config';
import { candidatesForRoom, attemptMutation, cutRestored } from './mutations';
import type { CandidateMutation } from './mutations';
import { applyAbsenceCost, applyDrain } from './sanity';
import { serializeValue, truncateForDisplay } from './format';
import type { CoreDeps, GameEvent, GameState, Round, Run, StepResult, TestResult } from './types';

const MAX_SANITY = 100;

export function initialState(_config: GameConfig): GameState {
  return {
    roomIndex: 0,
    phase: 'ready',
    activeRoundId: null,
    nextRoundId: 1,
    nextRunId: 1,
    sanity: { value: MAX_SANITY },
    code: '',
    round: null,
    run: null,
    displayRun: null,
    resultsOutdated: false,
    notice: 'none',
  };
}

const applied = (state: GameState): StepResult => ({ state, outcome: 'applied' });
const discarded = (state: GameState): StepResult => ({ state, outcome: 'discarded' });
const rejected = (state: GameState): StepResult => ({ state, outcome: 'rejected' });

function newRound(roundId: number): Round {
  return {
    roundId,
    absenceActive: false,
    applied: null,
    lastAttemptSkipped: [],
    noticedSeq: 0,
    absenceEndSeq: 0,
    noticedActive: false,
  };
}

/** The latest run, only if it is running and the event's own runId matches it. */
function currentRunning(state: GameState, runId: number): Run | null {
  const run = state.run;
  if (!run || run.status !== 'running' || run.runId !== runId) return null;
  return run;
}

/** Marks a running run stale; keeps displayRun in sync when it shows that run. */
function staleRunning(state: GameState): GameState {
  const run = state.run;
  if (!run || run.status !== 'running') return state;
  const stale: Run = { ...run, status: 'stale' };
  const displayRun = state.displayRun && state.displayRun.runId === run.runId ? stale : state.displayRun;
  return { ...state, run: stale, displayRun };
}

function fillMissing(state: GameState, run: Run, status: 'error' | 'timeout', message: string): TestResult[] {
  const have = new Set(run.results.map((r) => r.index));
  const out = [...run.results];
  for (let i = 0; i < run.testCount; i++) {
    if (have.has(i)) continue;
    out.push({
      index: i,
      status,
      message,
      expectedText: truncateForDisplay(serializeValue(roomAt(state.roomIndex).challenge.tests[i]?.expected), 500),
      actualText: null,
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Round-tagged events (everything except START and RESTART) carry a roundId. */
function isRoundTagged(e: GameEvent): e is Exclude<GameEvent, { type: 'START' | 'RESTART' | 'NEXT_ROOM' }> {
  return e.type !== 'START' && e.type !== 'RESTART' && e.type !== 'NEXT_ROOM';
}

/**
 * Pure reducer. Runs exactly one event. `outcome` is:
 * - 'rejected'  : transition not permitted by the phase rules (state unchanged)
 * - 'discarded' : tagged event that no longer matches, or not handled yet (state unchanged)
 * - 'applied'   : state processed the event
 */
export function step(
  state: GameState,
  event: GameEvent,
  config: GameConfig,
  deps?: CoreDeps,
): StepResult {
  switch (event.type) {
    case 'START': {
      if (state.phase !== 'ready') return rejected(state);
      const roundId = state.nextRoundId;
      return applied({
        ...state,
        phase: 'playing',
        activeRoundId: roundId,
        nextRoundId: roundId + 1,
        sanity: { value: MAX_SANITY },
        code: roomAt(state.roomIndex).challenge.starterCode,
        round: newRound(roundId),
        run: null,
        displayRun: null,
        resultsOutdated: false,
        notice: 'none',
      });
    }
    case 'NEXT_ROOM': {
      if (state.phase !== 'won' || state.roomIndex >= ROOMS.length - 1) return rejected(state);
      const ready = {
        ...initialState(config),
        roomIndex: state.roomIndex + 1,
        nextRoundId: state.nextRoundId,
        nextRunId: state.nextRunId,
      };
      return step(ready, { type: 'START' }, config, deps);
    }
    case 'RESTART': {
      if (state.phase !== 'won' && state.phase !== 'lost') return rejected(state);
      return applied({
        ...initialState(config),
        nextRoundId: state.nextRoundId,
        nextRunId: state.nextRunId,
      });
    }
    default:
      break;
  }

  // Tagged events: stale or wrong-round events are dropped before any handling.
  if (!isRoundTagged(event)) return discarded(state);
  if (state.phase !== 'playing' || state.activeRoundId === null || event.roundId !== state.activeRoundId) {
    return discarded(state);
  }

  switch (event.type) {
    case 'CODE_CHANGED': {
      const record = state.round?.applied;
      const round = record && state.round
        ? { ...state.round, woundResolved: cutRestored(record, event.code) }
        : state.round;
      return applied({ ...staleRunning(state), round, code: event.code, resultsOutdated: state.displayRun !== null || state.resultsOutdated });
    }
    case 'RUN_REQUESTED': {
      if (state.run?.status === 'running') return discarded(state);
      const run: Run = {
        runId: state.nextRunId,
        roundId: event.roundId,
        status: 'running',
        testCount: roomAt(state.roomIndex).challenge.tests.length,
        results: [],
        doneReceived: false,
      };
      return applied({ ...state, nextRunId: state.nextRunId + 1, run });
    }
    case 'RUN_RESULT': {
      const run = currentRunning(state, event.runId);
      if (!run) return discarded(state);
      const { result } = event;
      const idx = result?.index;
      if (!Number.isInteger(idx) || idx < 0 || idx >= run.testCount) return discarded(state);
      if (run.results.some((r) => r.index === idx)) return discarded(state);
      const results = [...run.results, result].sort((a, b) => a.index - b.index);
      const next: Run = { ...run, results };
      // Progressive display: the new run's first result replaces the displayed results.
      return applied({ ...state, run: next, displayRun: next, resultsOutdated: false });
    }
    case 'RUN_DONE': {
      const run = currentRunning(state, event.runId);
      if (!run || event.count !== run.testCount) return discarded(state);
      const allReceived = run.results.length === run.testCount;
      const filled = allReceived ? run.results : fillMissing(state, run, 'error', 'The test worker finished early.');
      const next: Run = { ...run, results: filled, doneReceived: true, status: 'complete' };
      const base: GameState = { ...state, run: next, displayRun: next, resultsOutdated: false };
      if (allReceived && filled.every((r) => r.status === 'pass')) {
        return applied({
          ...base,
          phase: state.sanity.value > 0 ? 'won' : 'lost',
          activeRoundId: null,
        });
      }
      return applied(base);
    }
    case 'RUN_ABORT': {
      if (!currentRunning(state, event.runId)) return discarded(state);
      return applied(staleRunning(state));
    }
    case 'RUN_TIMEOUT': {
      const run = currentRunning(state, event.runId);
      if (!run) return discarded(state);
      const next: Run = { ...run, results: fillMissing(state, run, 'timeout', 'The test timed out.'), status: 'timedOut' };
      return applied({ ...state, run: next, displayRun: next, resultsOutdated: false });
    }
    case 'RUN_FAILED': {
      const run = currentRunning(state, event.runId);
      if (!run) return discarded(state);
      const next: Run = {
        ...run,
        results: fillMissing(state, run, 'error', 'Tests could not run.'),
        status: 'failed',
        error: String(event.message),
      };
      return applied({ ...state, run: next, displayRun: next, resultsOutdated: false });
    }
    case 'DRAIN_TICK': {
      if (state.round?.absenceActive) return discarded(state);
      const value = applyDrain(state.sanity.value, config);
      if (value <= 0) {
        return applied({ ...state, phase: 'lost', activeRoundId: null, sanity: { value: 0 } });
      }
      return applied({ ...state, sanity: { value } });
    }
    case 'VISIBILITY_HIDDEN': {
      const round = state.round;
      if (!round || round.absenceActive) return discarded(state);
      return applied({ ...state, round: { ...round, absenceActive: true } });
    }
    case 'LOOK_AWAY':
    case 'VISIBILITY_VISIBLE': {
      const round = state.round;
      if (!round) return discarded(state);
      if (event.type === 'VISIBILITY_VISIBLE' ? !round.absenceActive : round.absenceActive) return discarded(state);
      const base: Round = {
        ...round,
        absenceActive: false,
        noticedSeq: round.noticedSeq + 1,
        absenceEndSeq: round.absenceEndSeq + 1,
      };
      const value = applyAbsenceCost(state.sanity.value, config);
      if (value <= 0) {
        // Lost by the Absence cost: no Mutation, round ends in this same step.
        return applied({
          ...state,
          phase: 'lost',
          activeRoundId: null,
          sanity: { value: 0 },
          round: { ...base, noticedActive: false },
          notice: 'none',
        });
      }
      const withCost: GameState = { ...state, sanity: { value } };
      if (round.applied !== null) {
        return applied({ ...withCost, round: { ...base, noticedActive: true }, notice: 'none' });
      }
      const roomCandidates = candidatesForRoom(state.roomIndex);
      const candidates = state.roomIndex === 0 ? config.candidateOrder
        .map((id) => roomCandidates.find((c) => c.id === id))
        .filter((c): c is CandidateMutation => c !== undefined) : roomCandidates;
      const save = deps?.saveSnapshot ?? (() => true);
      const result = attemptMutation(state.code, candidates, save, config.editorMaxLength);
      if (result.kind === 'applied') {
        const marked = staleRunning(withCost);
        return applied({
          ...marked,
          code: result.record.resultingCode,
          resultsOutdated: state.displayRun !== null || state.resultsOutdated,
          round: { ...base, applied: result.record, lastAttemptSkipped: result.skipped, noticedActive: true },
          notice: 'watcherChanged',
        });
      }
      return applied({
        ...withCost,
        round: { ...base, lastAttemptSkipped: result.skipped, noticedActive: true },
        notice: 'none',
      });
    }
    case 'NOTICED_EXPIRED': {
      const round = state.round;
      if (!round || event.seq !== round.noticedSeq) return discarded(state);
      return applied({ ...state, round: { ...round, noticedActive: false }, notice: 'none' });
    }
    default:
      return discarded(state);
  }
}
