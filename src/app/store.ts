import type { GameConfig } from '../core/config';
import { initialState, step } from '../core/reducer';
import type { CoreDeps, GameEvent, GameState } from '../core/types';

export interface GameStore {
  getState(): GameState;
  subscribe(listener: () => void): () => void;
  dispatch(event: GameEvent): void;
  getActiveRoundId(): number | null;
  /** Idempotent. Aborts a running run while playing; never disposes the store. */
  detach(): void;
}

/** Framework-free store: FIFO queue, synchronous drain through `step`, one notification per drain. */
export function createGameStore(config: GameConfig, deps: CoreDeps = {}): GameStore {
  let state: GameState = initialState(config);
  const queue: GameEvent[] = [];
  const listeners = new Set<() => void>();
  let draining = false;

  function drain(): void {
    draining = true;
    try {
      while (queue.length > 0) {
        const event = queue.shift() as GameEvent;
        state = step(state, event, config, deps).state;
      }
    } finally {
      draining = false;
    }
    // Snapshot so (un)subscribes during notification do not affect this pass.
    // Dispatches made by listeners are queued and drained after this pass.
    for (const listener of Array.from(listeners)) {
      if (listeners.has(listener)) listener();
    }
  }

  function dispatch(event: GameEvent): void {
    queue.push(event);
    if (draining) return;
    // Loop so events dispatched by listeners (queued while notifying) are
    // processed in order, each drain followed by its own notification.
    notifying: {
      if (notifyDepth > 0) break notifying;
      notifyDepth++;
      try {
        while (queue.length > 0) drain();
      } finally {
        notifyDepth--;
      }
    }
  }
  let notifyDepth = 0;

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,
    getActiveRoundId: () => state.activeRoundId,
    detach() {
      const run = state.run;
      if (state.phase === 'playing' && state.activeRoundId !== null && run && run.status === 'running') {
        dispatch({ type: 'RUN_ABORT', roundId: state.activeRoundId, runId: run.runId });
      }
    },
  };
}
