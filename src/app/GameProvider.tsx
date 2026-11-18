import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_CONFIG, normalizeConfig, parseConfigOverrides } from '../core/config';
import type { GameConfig } from '../core/config';
import type { GameEvent, GameState } from '../core/types';
import { createExecutionWorker } from '../worker/createExecutionWorker';
import type { WorkerFactory } from '../worker/createExecutionWorker';
import { useDrain } from './hooks/useDrain';
import { useReducedMotion } from './hooks/useReducedMotion';
import { useNoticed } from './hooks/useNoticed';
import { useTestRun } from './hooks/useTestRun';
import { useVisibility } from './hooks/useVisibility';
import { createGameStore } from './store';
import type { GameStore } from './store';

export interface GameContextValue {
  state: GameState;
  dispatch(event: GameEvent): void;
  config: GameConfig;
  store: GameStore;
  requestRun(): void;
  workerFactory: WorkerFactory;
  reducedMotion: boolean;
}

const GameContext = createContext<GameContextValue | null>(null);

export interface GameProviderProps {
  config?: GameConfig;
  workerFactory?: WorkerFactory;
  children?: ReactNode;
}

function resolveConfig(base: GameConfig | undefined): GameConfig {
  const normalized = base ?? normalizeConfig(DEFAULT_CONFIG);
  // Query overrides are a dev/playtest affordance only; location is read here, in the app layer.
  if (import.meta.env.DEV || import.meta.env.VITE_PLAYTEST === '1') {
    return parseConfigOverrides(window.location.search, normalized);
  }
  return normalized;
}

export function GameProvider({ config: configProp, workerFactory = createExecutionWorker, children }: GameProviderProps) {
  // Created once; never disposed by an effect.
  const [setup] = useState(() => {
    const config = resolveConfig(configProp);
    return { config, store: createGameStore(config) };
  });
  const { config, store } = setup;
  const state = useSyncExternalStore(store.subscribe, store.getState);

  useEffect(() => () => store.detach(), [store]);

  const dispatch = useCallback((event: GameEvent) => store.dispatch(event), [store]);
  const { requestRun } = useTestRun(store, workerFactory, config);
  useDrain(store, config);
  useVisibility(store);
  useNoticed(store, config);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    document.documentElement.setAttribute('data-reduced-motion', reducedMotion ? 'true' : 'false');
  }, [reducedMotion]);

  const value = useMemo<GameContextValue>(
    () => ({ state, dispatch, config, store, requestRun, workerFactory, reducedMotion }),
    [state, dispatch, config, store, requestRun, workerFactory, reducedMotion],
  );
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within a GameProvider');
  return ctx;
}
