import { describe, expect, it } from 'vitest';
import { CHALLENGE } from '../../src/core/challenge';
import { runTestCases } from '../../src/core/execute';
import { CANDIDATES } from '../../src/core/mutations';
import { REFERENCE_SOLUTION } from './referenceSolution';

function statuses(code: string): string[] {
  const out: string[] = [];
  runTestCases(code, CHALLENGE.functionName, CHALLENGE.tests, (r) => {
    out[r.index] = r.status;
  });
  return out;
}

const code = (s: string[]) => s.map((x) => (x === 'pass' ? 'P' : x === 'fail' ? 'F' : 'E'));

describe('Challenge field limits', () => {
  it('has valid description, function name, and starter lengths', () => {
    expect(CHALLENGE.description.length).toBeGreaterThanOrEqual(1);
    expect(CHALLENGE.description.length).toBeLessThanOrEqual(500);
    expect(CHALLENGE.functionName).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
    expect(CHALLENGE.functionName.length).toBeLessThanOrEqual(50);
    expect(CHALLENGE.starterCode.length).toBeGreaterThanOrEqual(1);
    expect(CHALLENGE.starterCode.length).toBeLessThanOrEqual(5000);
  });

  it('has 4 to 8 tests with unique names of 1 to 80 characters', () => {
    const n = CHALLENGE.tests.length;
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(8);
    const names = CHALLENGE.tests.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name.length).toBeGreaterThanOrEqual(1);
      expect(name.length).toBeLessThanOrEqual(80);
    }
  });
});

describe('starter and reference relationship', () => {
  it('starter passes at least one and fails at least one test', () => {
    const s = statuses(CHALLENGE.starterCode);
    expect(s).toContain('pass');
    expect(s).toContain('fail');
  });

  it('differ in exactly one line (>= versus >), sharing leading comments', () => {
    const a = CHALLENGE.starterCode.split('\n');
    const b = REFERENCE_SOLUTION.split('\n');
    expect(a.length).toBe(b.length);
    const diff = a.map((_l, i) => i).filter((i) => a[i] !== b[i]);
    expect(diff.length).toBe(1);
    expect(a[diff[0]]).toContain('>=');
    expect(b[diff[0]]).not.toContain('>=');
    expect(b[diff[0]]).toContain('>');
    const leading = (lines: string[]) => lines.slice(0, lines.findIndex((l) => !l.startsWith('//')));
    expect(leading(a).length).toBeGreaterThan(0);
    expect(leading(a)).toEqual(leading(b));
    expect(CHALLENGE.starterCode.replace('>=', '>')).toBe(REFERENCE_SOLUTION);
  });
});

describe('exact outcome table', () => {
  const ref = REFERENCE_SOLUTION;
  const byId = (id: string) => CANDIDATES.find((c) => c.id === id)!;

  it('reference passes all 5', () => {
    expect(code(statuses(ref))).toEqual(['P', 'P', 'P', 'P', 'P']);
  });
  it('starter is P,P,P,P,F', () => {
    expect(code(statuses(CHALLENGE.starterCode))).toEqual(['P', 'P', 'P', 'P', 'F']);
  });
  it('reference + off-by-one is P,F,P,F,P', () => {
    expect(code(statuses(byId('off-by-one').transform(ref)))).toEqual(['P', 'F', 'P', 'F', 'P']);
  });
  it('reference + flipped-comparison is P,P,F,F,F', () => {
    expect(code(statuses(byId('flipped-comparison').transform(ref)))).toEqual(['P', 'P', 'F', 'F', 'F']);
  });
  it('reference + lost-name is E,E,E,E,E with error status', () => {
    expect(statuses(byId('lost-name').transform(ref))).toEqual(['error', 'error', 'error', 'error', 'error']);
  });
});

describe.each(CANDIDATES.map((c) => [c.id, c] as const))('candidate %s', (_id, c) => {
  it('target occurs in both starter and reference', () => {
    expect(CHALLENGE.starterCode).toContain(c.target);
    expect(REFERENCE_SOLUTION).toContain(c.target);
  });
  it('mutated reference compiles and at least one test fails', () => {
    const mutated = c.transform(REFERENCE_SOLUTION);
    expect(mutated).not.toBe(REFERENCE_SOLUTION);
    expect(() => new Function('"use strict";\n' + mutated)).not.toThrow();
    expect(statuses(mutated).some((s) => s !== 'pass')).toBe(true);
  });
});
