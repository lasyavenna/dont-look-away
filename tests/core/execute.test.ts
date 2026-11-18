import { describe, it, expect } from 'vitest';
import { runTestCases } from '../../src/core/execute';
import type { TestResult } from '../../src/core/types';

function run(code: string, tests: Array<{ name: string; args: unknown[]; expected: unknown }>) {
  const results: TestResult[] = [];
  runTestCases(code, 'f', tests, (r) => results.push(r));
  return results;
}

const tests = [
  { name: 'a', args: [1], expected: 2 },
  { name: 'b', args: [2], expected: 3 },
  { name: 'c', args: [3], expected: 99 },
];

describe('runTestCases', () => {
  it('reports pass/fail with one result per test and correct index', () => {
    const r = run('function f(x){ return x + 1; }', tests);
    expect(r.map((x) => x.index)).toEqual([0, 1, 2]);
    expect(r.map((x) => x.status)).toEqual(['pass', 'pass', 'fail']);
    expect(r[2].actualText).toBe('4');
    expect(r[2].expectedText).toBe('99');
  });

  it('gives error for all tests on a parse error', () => {
    const r = run('function f( {', tests);
    expect(r).toHaveLength(3);
    expect(r.every((x) => x.status === 'error')).toBe(true);
    expect(r.map((x) => x.index)).toEqual([0, 1, 2]);
  });

  it('gives error for all tests when the function is missing', () => {
    const r = run('const y = 1;', tests);
    expect(r.every((x) => x.status === 'error' && x.message.includes('`f`'))).toBe(true);
  });

  it('continues after a throwing test', () => {
    const r = run('function f(x){ if (x === 1) throw new Error("boom"); return x + 1; }', tests);
    expect(r.map((x) => x.status)).toEqual(['error', 'pass', 'fail']);
    expect(r[0].message).toContain('boom');
  });

  it('deep-clones args so tests cannot corrupt each other', () => {
    const shared = [1];
    const r = run('function f(a){ a.push(9); return a.length; }', [
      { name: 'x', args: [shared], expected: 2 },
      { name: 'y', args: [shared], expected: 2 },
    ]);
    expect(r.map((x) => x.status)).toEqual(['pass', 'pass']);
    expect(shared).toEqual([1]);
  });

  it('truncates long display text', () => {
    const r = run('function f(){ return "a".repeat(600); }', [{ name: 'x', args: [], expected: 1 }]);
    expect(r[0].actualText!.endsWith('[truncated]')).toBe(true);
  });
});
