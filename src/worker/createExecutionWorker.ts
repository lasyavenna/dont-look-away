/** Minimal structural worker interface so tests can supply fakes. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessageerror: ((ev: unknown) => void) | null;
}

export type WorkerFactory = () => WorkerLike;

export const createExecutionWorker: WorkerFactory = () =>
  new Worker(new URL('./execution.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
