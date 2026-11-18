import { CHALLENGE } from './challenge';
import type { GameConfig } from './config';
import { applyDrain } from './sanity';
import type { CoreDeps, GameEvent, GameState, Round, StepResult } from './types';

const MAX_SANITY = 100;

export function initialState(_config: GameConfig): GameState {
  return {
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

/** Round-tagged events (everything except START and RESTART) carry a roundId. */
function isRoundTagged(e: GameEvent): e is Exclude<GameEvent, { type: 'START' | 'RESTART' }> {
  return e.type !== 'START' && e.type !== 'RESTART';
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
  _deps?: CoreDeps,
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
        code: CHALLENGE.starterCode,
        round: newRound(roundId),
        run: null,
        displayRun: null,
        resultsOutdated: false,
        notice: 'none',
      });
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
      const run = state.run && state.run.status === 'running' ? { ...state.run, status: 'stale' as const } : state.run;
      return applied({ ...state, code: event.code, run });
    }
    case 'DRAIN_TICK': {
      if (state.round?.absenceActive) return discarded(state);
      const value = applyDrain(state.sanity.value, config);
      if (value <= 0) {
        return applied({ ...state, phase: 'lost', activeRoundId: null, sanity: { value: 0 } });
      }
      return applied({ ...state, sanity: { value } });
    }
    // Milestone B (run events: RUN_REQUESTED, RUN_RESULT, RUN_DONE, RUN_ABORT,
    // RUN_TIMEOUT, RUN_FAILED) and Milestone C (VISIBILITY_*, NOTICED_EXPIRED)
    // add cases here; until then they are discarded with state unchanged.
    default:
      return discarded(state);
  }
}
