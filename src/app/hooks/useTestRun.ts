import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { GameConfig } from '../../core/config';
import { roomAt } from '../../core/challenge';
import { isWorkerToMain } from '../../core/protocol';
import type { MainToWorker } from '../../core/protocol';
import { createRegistry } from '../../core/registry';
import type { WorkerFactory } from '../../worker/createExecutionWorker';
import { addTimeout, addWorker } from '../resources';
import type { GameStore } from '../store';

export interface TestRunApi {
  /** Dispatches RUN_REQUESTED for the active round while playing. */
  requestRun(): void;
}

/**
 * Owns the execution worker. A worker exists only while the latest run is
 * running. The code posted is `state.code` at effect start; any code change
 * stales a running run, so it equals the code at request time.
 */
export function useTestRun(store: GameStore, workerFactory: WorkerFactory, config: GameConfig): TestRunApi {
  const run = useSyncExternalStore(store.subscribe, () => store.getState().run);
  const roundId = run?.roundId ?? null;
  const runId = run?.runId ?? null;
  const playing = useSyncExternalStore(store.subscribe, () => store.getState().phase === 'playing');
  // A round ending (e.g. sanity reaching 0) leaves the run 'running' in state; the worker must not outlive it.
  const running = run?.status === 'running' && playing;

  useEffect(() => {
    if (!running || roundId === null || runId === null) return;
    const registry = createRegistry();
    const cRound = roundId;
    const cRun = runId;
    const fail = (message: string): void => store.dispatch({ type: 'RUN_FAILED', roundId: cRound, runId: cRun, message });

    let worker;
    try {
      worker = workerFactory();
    } catch {
      fail('Tests could not run.');
      return;
    }
    addWorker(registry, worker);

    let timedOut = false;
    addTimeout(
      registry,
      () => {
        if (timedOut) return;
        timedOut = true;
        store.dispatch({ type: 'RUN_TIMEOUT', roundId: cRound, runId: cRun });
      },
      config.runTimeoutMs,
    );

    worker.onmessage = (ev) => {
      const data = ev.data;
      if (!isWorkerToMain(data)) return;
      switch (data.type) {
        case 'result':
          store.dispatch({ type: 'RUN_RESULT', roundId: data.roundId, runId: data.runId, result: data.result });
          break;
        case 'done':
          store.dispatch({ type: 'RUN_DONE', roundId: data.roundId, runId: data.runId, count: data.count });
          break;
        case 'fatal':
          store.dispatch({ type: 'RUN_FAILED', roundId: data.roundId, runId: data.runId, message: data.message });
          break;
      }
    };
    worker.onerror = () => fail('Tests could not run.');
    worker.onmessageerror = () => fail('Tests could not run.');

    const challenge = roomAt(store.getState().roomIndex).challenge;
    const message: MainToWorker = {
      type: 'run',
      roundId: cRound,
      runId: cRun,
      code: store.getState().code,
      fnName: challenge.functionName,
      tests: challenge.tests.map((t) => ({ name: t.name, args: t.args, expected: t.expected })),
    };
    try {
      worker.postMessage(message);
    } catch {
      fail('Tests could not run.');
    }

    return () => registry.disposeAll();
  }, [store, workerFactory, config.runTimeoutMs, roundId, runId, running]);

  const requestRun = useCallback((): void => {
    const state = store.getState();
    const id = store.getActiveRoundId();
    if (state.phase !== 'playing' || id === null) return;
    store.dispatch({ type: 'RUN_REQUESTED', roundId: id });
  }, [store]);

  return { requestRun };
}
