/**
 * Test helper: a fake execution worker and a recording factory.
 *
 *   const { factory, workers } = createFakeWorkerFactory();
 *   // factory is a WorkerFactory; each call creates a FakeWorker pushed to `workers`.
 *   workers[0].emit({ type: 'result', roundId, runId, result });  // delivers via current onmessage
 *   workers[0].emitError();                                        // calls onerror
 *   workers[0].posted / .terminateCount / .onmessage / .onerror
 *
 * Set `throwOnCreate = true` (or pass a function) to make the factory throw,
 * and `throwOnTerminate` on a worker to make terminate() throw.
 */
import type { WorkerFactory, WorkerLike } from '../../src/worker/createExecutionWorker';

export class FakeWorker implements WorkerLike {
  posted: unknown[] = [];
  terminateCount = 0;
  throwOnTerminate = false;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessageerror: ((ev: unknown) => void) | null = null;

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminateCount++;
    if (this.throwOnTerminate) throw new Error('terminate failed');
  }

  /** Delivers a message to the current onmessage handler (no-op when null). */
  emit(data: unknown): void {
    this.onmessage?.({ data });
  }

  emitError(): void {
    this.onerror?.({});
  }
}

export interface FakeWorkerFactory {
  factory: WorkerFactory;
  workers: FakeWorker[];
  /** Number of workers not yet terminated. */
  live(): number;
  setThrowOnCreate(v: boolean): void;
  /** Applied to every worker created afterwards. */
  setThrowOnTerminate(v: boolean): void;
}

export function createFakeWorkerFactory(): FakeWorkerFactory {
  const workers: FakeWorker[] = [];
  let throwOnCreate = false;
  let throwOnTerminate = false;
  const factory: WorkerFactory = () => {
    if (throwOnCreate) throw new Error('cannot create worker');
    const w = new FakeWorker();
    w.throwOnTerminate = throwOnTerminate;
    workers.push(w);
    return w;
  };
  return {
    factory,
    workers,
    live: () => workers.filter((w) => w.terminateCount === 0).length,
    setThrowOnCreate: (v) => {
      throwOnCreate = v;
    },
    setThrowOnTerminate: (v) => {
      throwOnTerminate = v;
    },
  };
}
