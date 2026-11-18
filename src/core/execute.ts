import { deepEqual, serializeValue, truncateForDisplay } from './format';
import type { TestResult } from './types';

/** Minimal structural test-case shape (kept local to avoid coupling to challenge.ts). */
export interface TestCaseDef {
  name: string;
  args: unknown[];
  expected: unknown;
}

const DISPLAY_MAX = 500;

function display(value: unknown): string {
  return truncateForDisplay(serializeValue(value), DISPLAY_MAX);
}

function errorText(e: unknown): string {
  try {
    return String(e);
  } catch {
    return 'Unknown error';
  }
}

function compile(code: string, fnName: string): { fn: (...a: unknown[]) => unknown } | { error: string } {
  let candidate: unknown;
  try {
    candidate = new Function(
      '"use strict";\n' +
        code +
        '\n;return typeof ' +
        fnName +
        " === 'function' ? " +
        fnName +
        ' : undefined;',
    )();
  } catch (e) {
    return { error: errorText(e) };
  }
  if (typeof candidate !== 'function') {
    return { error: `Function \`${fnName}\` is not defined` };
  }
  return { fn: candidate as (...a: unknown[]) => unknown };
}

/**
 * Compiles `code` once (strict mode), then runs each test with deep-cloned args.
 * Calls onResult exactly once per test, in order, with the test's zero-based index.
 */
export function runTestCases(
  code: string,
  fnName: string,
  tests: readonly TestCaseDef[],
  onResult: (r: TestResult) => void,
): void {
  const compiled = compile(code, fnName);

  for (let index = 0; index < tests.length; index++) {
    const test = tests[index];
    const expectedText = display(test.expected);

    if ('error' in compiled) {
      onResult({ index, status: 'error', message: compiled.error, expectedText, actualText: null });
      continue;
    }

    let result: TestResult;
    try {
      const args = structuredClone(test.args);
      const actual = compiled.fn(...args);
      const pass = deepEqual(actual, test.expected);
      result = {
        index,
        status: pass ? 'pass' : 'fail',
        message: pass ? 'Passed' : 'Expected a different result',
        expectedText,
        actualText: display(actual),
      };
    } catch (e) {
      result = { index, status: 'error', message: errorText(e), expectedText, actualText: null };
    }
    onResult(result);
  }
}
