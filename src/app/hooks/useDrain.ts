import { useEffect, useSyncExternalStore } from 'react';
import type { GameConfig } from '../../core/config';
import { createRegistry } from '../../core/registry';
import { addInterval } from '../resources';
import type { GameStore } from '../store';

/** While playing and not in an Absence, ticks sanity drain for the captured round. */
export function useDrain(store: GameStore, config: GameConfig): void {
  const roundId = useSyncExternalStore(store.subscribe, () => {
    const s = store.getState();
    return s.phase === 'playing' && s.activeRoundId !== null && s.round && !s.round.absenceActive ? s.activeRoundId : null;
  });
  useEffect(() => {
    if (roundId === null) return;
    const registry = createRegistry();
    addInterval(registry, () => store.dispatch({ type: 'DRAIN_TICK', roundId }), config.drainIntervalMs);
    return () => registry.disposeAll();
  }, [store, config.drainIntervalMs, roundId]);
}
