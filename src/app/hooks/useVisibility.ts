import { useEffect, useSyncExternalStore } from 'react';
import { createRegistry } from '../../core/registry';
import { addListener } from '../resources';
import type { GameStore } from '../store';

/** While playing, reports tab visibility changes (document.visibilityState only) for the captured round. */
export function useVisibility(store: GameStore): void {
  const roundId = useSyncExternalStore(store.subscribe, () => {
    const s = store.getState();
    return s.phase === 'playing' ? s.activeRoundId : null;
  });
  useEffect(() => {
    if (roundId === null) return;
    const registry = createRegistry();
    addListener(registry, document, 'visibilitychange', () => {
      store.dispatch({
        type: document.visibilityState === 'hidden' ? 'VISIBILITY_HIDDEN' : 'VISIBILITY_VISIBLE',
        roundId,
      });
    });
    return () => registry.disposeAll();
  }, [store, roundId]);
}
