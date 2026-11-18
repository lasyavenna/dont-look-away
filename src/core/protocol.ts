import type { TestResult } from './types';

export interface TestCasePayload {
  name: string;
  args: unknown[];
  expected: unknown;
}

export type MainToWorker = {
  type: 'run';
  roundId: number;
  runId: number;
  code: string;
  fnName: string;
  tests: TestCasePayload[];
};

export type WorkerToMain =
  | { type: 'result'; roundId: number; runId: number; result: TestResult }
  | { type: 'done'; roundId: number; runId: number; count: number }
  | { type: 'fatal'; roundId: number; runId: number; message: string };

const STATUSES: readonly string[] = ['pass', 'fail', 'error', 'timeout'];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

function isTestResult(r: unknown): r is TestResult {
  if (!isObj(r)) return false;
  return (
    typeof r.status === 'string' &&
    STATUSES.includes(r.status) &&
    typeof r.index === 'number' &&
    Number.isInteger(r.index) &&
    typeof r.message === 'string' &&
    typeof r.expectedText === 'string' &&
    (r.actualText === null || typeof r.actualText === 'string')
  );
}

/** Shape guard only. Ids are checked against current state by the reducer. */
export function isWorkerToMain(x: unknown): x is WorkerToMain {
  if (!isObj(x)) return false;
  if (typeof x.roundId !== 'number' || typeof x.runId !== 'number') return false;
  switch (x.type) {
    case 'result':
      return isTestResult(x.result);
    case 'done':
      return typeof x.count === 'number' && Number.isInteger(x.count);
    case 'fatal':
      return typeof x.message === 'string';
    default:
      return false;
  }
}
