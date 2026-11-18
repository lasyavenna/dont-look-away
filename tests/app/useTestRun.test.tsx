import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTestRun } from '../../src/app/hooks/useTestRun';
import { createGameStore } from '../../src/app/store';
import type { GameStore } from '../../src/app/store';
import { DEFAULT_CONFIG, normalizeConfig } from '../../src/core/config';
import type { GameConfig } from '../../src/core/config';
import type { TestResult } from '../../src/core/types';
import { REFERENCE_SOLUTION } from '../fixtures/referenceSolution';
import { createFakeWorkerFactory } from '../helpers/fakeWorker';
import type { FakeWorker, FakeWorkerFactory } from '../helpers/fakeWorker';

const COUNT = 5;

function res(index: number, status: TestResult['status'] = 'pass'): TestResult {
  return { index, status, message: '', expectedText: 'x', actualText: status === 'pass' ? 'x' : 'y' };
}

interface Ctx {
  store: GameStore;
  fw: FakeWorkerFactory;
  requestRun(): void;
  ids(): { roundId: number; runId: number };
  result(w: FakeWorker, i: number, status?: TestResult['status']): void;
  done(w: FakeWorker, count?: number): void;
  unmount(): void;
}

function setup(config: GameConfig = DEFAULT_CONFIG): Ctx {
  const store = createGameStore(config);
  store.dispatch({ type: 'START' });
  const fw = createFakeWorkerFactory();
  const { result, unmount } = renderHook(() => useTestRun(store, fw.factory, config));
  const ids = () => {
    const run = store.getState().run!;
    return { roundId: run.roundId, runId: run.runId };
  };
  return {
    store,
    fw,
    requestRun: () => act(() => result.current.requestRun()),
    ids,
    result: (w, i, status = 'pass') =>
      act(() => w.emit({ type: 'result', ...ids(), result: res(i, status) })),
    done: (w, count = COUNT) => act(() => w.emit({ type: 'done', ...ids(), count })),
    unmount,
  };
}

describe('useTestRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates no worker while no run is running', () => {
    const c = setup();
    expect(c.fw.workers).toHaveLength(0);
    c.requestRun();
    expect(c.fw.workers).toHaveLength(1);
    c.result(c.fw.workers[0], 0);
    c.done(c.fw.workers[0]);
    expect(c.fw.live()).toBe(0);
  });

  it('posts a run message with the current ids and code', () => {
    const c = setup();
    c.requestRun();
    const msg = c.fw.workers[0].posted[0] as Record<string, unknown>;
    expect(msg).toMatchObject({ type: 'run', ...c.ids(), code: c.store.getState().code, fnName: 'brightestCandle' });
    expect((msg.tests as unknown[]).length).toBe(COUNT);
  });

  it('streams results progressively', () => {
    const c = setup();
    c.requestRun();
    const w = c.fw.workers[0];
    c.result(w, 0);
    expect(c.store.getState().run!.results).toHaveLength(1);
    c.result(w, 2, 'fail');
    c.result(w, 1);
    const run = c.store.getState().run!;
    expect(run.results.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(run.status).toBe('running');
    expect(c.store.getState().displayRun).toBe(run);
  });

  it('discards messages whose own ids do not match', () => {
    const c = setup();
    c.requestRun();
    const w = c.fw.workers[0];
    const { roundId, runId } = c.ids();
    const before = c.store.getState();
    act(() => w.emit({ type: 'result', roundId, runId: runId + 1, result: res(0) }));
    act(() => w.emit({ type: 'result', roundId: roundId + 1, runId, result: res(0) }));
    act(() => w.emit({ type: 'done', roundId, runId: runId + 1, count: COUNT }));
    act(() => w.emit({ type: 'fatal', roundId: roundId + 1, runId, message: 'boom' }));
    expect(c.store.getState()).toBe(before);
  });

  it('ignores out-of-range, fractional and duplicate indices', () => {
    const c = setup();
    c.requestRun();
    const w = c.fw.workers[0];
    c.result(w, 0);
    const before = c.store.getState();
    c.result(w, -1);
    c.result(w, COUNT);
    c.result(w, 1.5);
    c.result(w, 0, 'fail');
    expect(c.store.getState().run!.results).toEqual(before.run!.results);
    expect(c.store.getState().run!.results[0].status).toBe('pass');
  });

  it('ignores malformed messages', () => {
    const c = setup();
    c.requestRun();
    const w = c.fw.workers[0];
    const before = c.store.getState();
    for (const bad of [null, undefined, 42, 'x', {}, { type: 'result' }, { type: 'result', roundId: 1, runId: 1, result: {} },
      { type: 'done', roundId: 1, runId: 1, count: 1.5 }, { type: 'nope', roundId: 1, runId: 1 }]) {
      act(() => w.emit(bad));
    }
    expect(c.store.getState()).toBe(before);
  });

  it('does not win with five passes but no done', () => {
    const c = setup();
    c.requestRun();
    const w = c.fw.workers[0];
    for (let i = 0; i < COUNT; i++) c.result(w, i);
    expect(c.store.getState().phase).toBe('playing');
    expect(c.store.getState().run!.status).toBe('running');
  });

  it('passing tests produce a win', () => {
    const c = setup();
    c.requestRun();
    const w = c.fw.workers[0];
    for (let i = 0; i < COUNT; i++) c.result(w, i);
    c.done(w);
    expect(c.store.getState().phase).toBe('won');
    expect(w.terminateCount).toBe(1);
    expect(w.onmessage).toBeNull();
  });

  it('terminates exactly once on complete with failures, and a second run uses a new worker', () => {
    const c = setup();
    c.requestRun();
    const w1 = c.fw.workers[0];
    for (let i = 0; i < COUNT; i++) c.result(w1, i, i === 0 ? 'fail' : 'pass');
    c.done(w1);
    expect(c.store.getState().run!.status).toBe('complete');
    expect(w1.terminateCount).toBe(1);
    c.requestRun();
    expect(c.fw.workers).toHaveLength(2);
    expect(c.fw.workers[1]).not.toBe(w1);
    expect(w1.terminateCount).toBe(1);
  });

  it('timeout keeps received results, fills the rest, terminates, and allows another run', () => {
    const config = normalizeConfig({ runTimeoutMs: 3000 });
    const c = setup(config);
    c.requestRun();
    const w1 = c.fw.workers[0];
    c.result(w1, 0);
    c.result(w1, 1);
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(c.store.getState().run!.status).toBe('running');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const run = c.store.getState().run!;
    expect(run.status).toBe('timedOut');
    expect(run.results.map((r) => r.status)).toEqual(['pass', 'pass', 'timeout', 'timeout', 'timeout']);
    expect(w1.terminateCount).toBe(1);
    expect(w1.onmessage).toBeNull();
    // late message from the dead worker is discarded
    const before = c.store.getState();
    act(() => w1.onmessage?.({ data: { type: 'done', ...c.ids(), count: COUNT } }));
    expect(c.store.getState()).toBe(before);

    c.store.dispatch({ type: 'CODE_CHANGED', roundId: c.store.getActiveRoundId()!, code: REFERENCE_SOLUTION });
    c.requestRun();
    expect(c.fw.workers).toHaveLength(2);
    const w2 = c.fw.workers[1];
    expect((w2.posted[0] as { code: string }).code).toBe(REFERENCE_SOLUTION);
    for (let i = 0; i < COUNT; i++) c.result(w2, i);
    c.done(w2);
    expect(c.store.getState().phase).toBe('won');
    expect(w1.terminateCount).toBe(1);
    expect(w2.terminateCount).toBe(1);
  });

  it('terminates once when the run goes stale and discards late messages', () => {
    const c = setup();
    c.requestRun();
    const w = c.fw.workers[0];
    const ids = c.ids();
    c.result(w, 0);
    act(() => c.store.dispatch({ type: 'CODE_CHANGED', roundId: ids.roundId, code: 'x' }));
    expect(c.store.getState().run!.status).toBe('stale');
    expect(w.terminateCount).toBe(1);
    expect(w.onmessage).toBeNull();
    const before = c.store.getState();
    act(() => w.onmessage?.({ data: { type: 'result', ...ids, result: res(1) } }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(c.store.getState()).toBe(before);
    expect(w.terminateCount).toBe(1);
  });

  it('terminates the worker when the round ends mid-run and on unmount', () => {
    const config = normalizeConfig({ drainAmount: 100 });
    const c = setup(config);
    c.requestRun();
    const w = c.fw.workers[0];
    act(() => c.store.dispatch({ type: 'DRAIN_TICK', roundId: c.store.getActiveRoundId()! }));
    expect(c.store.getState().phase).toBe('lost');
    expect(w.terminateCount).toBe(1);
    act(() => c.store.dispatch({ type: 'RESTART' }));
    expect(w.terminateCount).toBe(1);
    expect(c.fw.live()).toBe(0);

    const d = setup();
    d.requestRun();
    d.unmount();
    expect(d.fw.workers[0].terminateCount).toBe(1);
    expect(d.fw.workers[0].onmessage).toBeNull();
  });

  it('a throwing terminate() does not break a restart', () => {
    const config = normalizeConfig({ drainAmount: 100 });
    const c = setup(config);
    c.fw.setThrowOnTerminate(true);
    c.requestRun();
    const w = c.fw.workers[0];
    expect(() => act(() => c.store.dispatch({ type: 'DRAIN_TICK', roundId: c.store.getActiveRoundId()! }))).not.toThrow();
    expect(c.store.getState().phase).toBe('lost');
    expect(() => act(() => c.store.dispatch({ type: 'RESTART' }))).not.toThrow();
    act(() => c.store.dispatch({ type: 'START' }));
    expect(c.store.getState().phase).toBe('playing');
    c.fw.setThrowOnTerminate(false);
    c.requestRun();
    expect(c.fw.workers).toHaveLength(2);
    expect(w.terminateCount).toBe(1);
  });

  it('factory throw dispatches RUN_FAILED', () => {
    const c = setup();
    c.fw.setThrowOnCreate(true);
    c.requestRun();
    const run = c.store.getState().run!;
    expect(run.status).toBe('failed');
    expect(run.error).toBe('Tests could not run.');
    expect(run.results.every((r) => r.status === 'error')).toBe(true);
  });

  it('worker onerror dispatches RUN_FAILED and terminates once', () => {
    const c = setup();
    c.requestRun();
    const w = c.fw.workers[0];
    act(() => w.emitError());
    const run = c.store.getState().run!;
    expect(run.status).toBe('failed');
    expect(run.error).toBe('Tests could not run.');
    expect(w.terminateCount).toBe(1);
    expect(w.onerror).toBeNull();
  });
});
