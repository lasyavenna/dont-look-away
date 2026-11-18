import { useEffect, useSyncExternalStore } from 'react';
import type { GameConfig } from '../../core/config';
import { createRegistry } from '../../core/registry';
import { addTimeout } from '../resources';
import type { GameStore } from '../store';

/** While a noticed window is active, expires it after the configured duration for the captured round and seq. */
export function useNoticed(store: GameStore, config: GameConfig): void {
  const key = useSyncExternalStore(store.subscribe, () => {
    const s = store.getState();
    return s.phase === 'playing' && s.activeRoundId !== null && s.round && s.round.noticedActive
      ? `${s.activeRoundId}:${s.round.noticedSeq}`
      : '';
  });
  useEffect(() => {
    if (key === '') return;
    const [r, q] = key.split(':');
    const roundId = Number(r);
    const seq = Number(q);
    const registry = createRegistry();
    addTimeout(registry, () => store.dispatch({ type: 'NOTICED_EXPIRED', roundId, seq }), config.noticedDurationMs);
    return () => registry.disposeAll();
  }, [store, config.noticedDurationMs, key]);
}
