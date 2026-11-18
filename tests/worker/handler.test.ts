import { describe, it, expect } from 'vitest';
import { handleMessage } from '../../src/worker/execution.worker';
import { isWorkerToMain, type WorkerToMain } from '../../src/core/protocol';
import { CHALLENGE } from '../../src/core/challenge';
import { REFERENCE_SOLUTION } from '../fixtures/referenceSolution';

function run(code: string, tests = CHALLENGE.tests.map((t) => ({ ...t }))) {
  const msgs: WorkerToMain[] = [];
  handleMessage(
    { type: 'run', roundId: 3, runId: 7, code, fnName: CHALLENGE.functionName, tests },
    (m) => msgs.push(m),
  );
  return msgs;
}

const results = (msgs: WorkerToMain[]) =>
  msgs.flatMap((m) => (m.type === 'result' ? [m.result] : []));

describe('worker handleMessage', () => {
  it('posts one result per test then done with count 5, indices 0..4 once', () => {
    const msgs = run(CHALLENGE.starterCode);
    expect(msgs).toHaveLength(6);
    expect(msgs.slice(0, 5).every((m) => m.type === 'result')).toBe(true);
    expect(msgs[5]).toMatchObject({ type: 'done', count: 5 });
    expect(results(msgs).map((r) => r.index).sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('reference solution passes all tests', () => {
    expect(results(run(REFERENCE_SOLUTION)).every((r) => r.status === 'pass')).toBe(true);
  });

  it('starter code passes 4 and fails 1', () => {
    const rs = results(run(CHALLENGE.starterCode));
    expect(rs.filter((r) => r.status === 'pass')).toHaveLength(4);
    expect(rs.filter((r) => r.status === 'fail')).toHaveLength(1);
  });

  it('parse failure yields error for every test and still done', () => {
    const msgs = run('function (((');
    const rs = results(msgs);
    expect(rs).toHaveLength(5);
    expect(rs.every((r) => r.status === 'error')).toBe(true);
    expect(msgs[msgs.length - 1]).toMatchObject({ type: 'done', count: 5 });
  });

  it('a throwing test does not stop the others', () => {
    const code = `function brightestCandle(c) { if (c.length === 1) throw new Error('boom'); return c.length === 0 ? -1 : c.indexOf(Math.max(...c)); }`;
    const rs = results(run(code));
    expect(rs).toHaveLength(5);
    expect(rs.filter((r) => r.status === 'error')).toHaveLength(1);
    expect(rs.filter((r) => r.status === 'pass')).toHaveLength(4);
  });

  it('every message carries roundId and runId, is cloneable and valid', () => {
    for (const m of [...run(CHALLENGE.starterCode), ...run('function (((')]) {
      expect(m.roundId).toBe(3);
      expect(m.runId).toBe(7);
      expect(isWorkerToMain(m)).toBe(true);
      expect(isWorkerToMain(structuredClone(m))).toBe(true);
    }
  });

  it('ignores malformed messages', () => {
    const post = () => {
      throw new Error('should not post');
    };
    for (const bad of [null, undefined, 42, 'run', {}, { type: 'run' }, { type: 'nope', roundId: 1, runId: 1 },
      { type: 'run', roundId: 1, runId: 1, code: 1, fnName: 'f', tests: [] },
      { type: 'run', roundId: 1, runId: 1, code: '', fnName: 'f', tests: 'x' }]) {
      expect(() => handleMessage(bad, post)).not.toThrow();
    }
  });
});
