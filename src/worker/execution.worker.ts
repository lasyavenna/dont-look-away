import { runTestCases } from '../core/execute';
import type { MainToWorker, WorkerToMain } from '../core/protocol';

export type Post = (msg: WorkerToMain) => void;

function errorText(e: unknown): string {
  try {
    return String(e);
  } catch {
    return 'Unknown error';
  }
}

function isRunMessage(x: unknown): x is MainToWorker {
  if (typeof x !== 'object' || x === null) return false;
  const m = x as Record<string, unknown>;
  return (
    m.type === 'run' &&
    typeof m.roundId === 'number' &&
    typeof m.runId === 'number' &&
    typeof m.code === 'string' &&
    typeof m.fnName === 'string' &&
    Array.isArray(m.tests)
  );
}

/**
 * Runs one `run` message: one `result` per test (streamed), then `done`.
 * Any unexpected exception posts `fatal`. Every message carries roundId/runId.
 */
export function handleMessage(msg: unknown, post: Post): void {
  if (!isRunMessage(msg)) return;
  const { roundId, runId } = msg;
  try {
    let count = 0;
    runTestCases(msg.code, msg.fnName, msg.tests, (result) => {
      count++;
      post({ type: 'result', roundId, runId, result });
    });
    post({ type: 'done', roundId, runId, count });
  } catch (e) {
    try {
      post({ type: 'fatal', roundId, runId, message: errorText(e) });
    } catch {
      /* nothing more can be done */
    }
  }
}

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

// Only wire inside a dedicated worker; importing in Node/jsdom does nothing.
const scope = globalThis as unknown as Partial<WorkerScope> & { constructor?: { name?: string } };
if (
  typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined' &&
  typeof scope.postMessage === 'function'
) {
  const s = scope as WorkerScope;
  s.onmessage = (ev) => handleMessage(ev.data, (m) => s.postMessage(m));
}
