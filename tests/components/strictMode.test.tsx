import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../../src/App';
import { GameProvider } from '../../src/app/GameProvider';
import { createGameStore } from '../../src/app/store';
import type { GameStore } from '../../src/app/store';
import { useDrain } from '../../src/app/hooks/useDrain';
import { useTestRun } from '../../src/app/hooks/useTestRun';
import { CHALLENGE } from '../../src/core/challenge';
import { DEFAULT_CONFIG, normalizeConfig } from '../../src/core/config';
import { createFakeWorkerFactory } from '../helpers/fakeWorker';
import type { FakeWorker, FakeWorkerFactory } from '../helpers/fakeWorker';

// Minimal geometry stubs; CodeMirror measures ranges under jsdom.
if (typeof Range !== 'undefined') {
  const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects ??= (() => [] as unknown as DOMRectList) as never;
  Range.prototype.getBoundingClientRect ??= (() => rect as DOMRect) as never;
}

const config = normalizeConfig(DEFAULT_CONFIG);

// Active intervals (CodeMirror and React add unrelated timers, so count intervals only).
const activeIntervals = new Set<unknown>();
const activeTimeouts = new Set<unknown>();
const timerCount = () => activeIntervals.size;

beforeEach(() => {
  vi.useFakeTimers();
  activeIntervals.clear();
  activeTimeouts.clear();
  const si = globalThis.setInterval;
  const ci = globalThis.clearInterval;
  const st = globalThis.setTimeout;
  const ct = globalThis.clearTimeout;
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((...a: Parameters<typeof si>) => {
    const id = si(...a);
    if (a[1] === config.drainIntervalMs) activeIntervals.add(id);
    return id;
  }) as typeof si);
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(((id: Parameters<typeof ci>[0]) => {
    activeIntervals.delete(id);
    return ci(id);
  }) as typeof ci);
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((...a: Parameters<typeof st>) => {
    const id = st(...a);
    if (a[1] === config.runTimeoutMs) activeTimeouts.add(id);
    return id;
  }) as typeof st);
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((id: Parameters<typeof ct>[0]) => {
    activeTimeouts.delete(id);
    return ct(id);
  }) as typeof ct);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function passAll(worker: FakeWorker): void {
  const run = worker.posted[0] as { roundId: number; runId: number };
  act(() => {
    CHALLENGE.tests.forEach((t, index) => {
      worker.emit({
        type: 'result',
        roundId: run.roundId,
        runId: run.runId,
        result: {
          index,
          status: 'pass',
          message: '',
          expectedText: JSON.stringify(t.expected),
          actualText: JSON.stringify(t.expected),
        },
      });
    });
    worker.emit({ type: 'done', roundId: run.roundId, runId: run.runId, count: CHALLENGE.tests.length });
  });
}

const click = (name: string) => act(() => void fireEvent.click(screen.getByRole('button', { name })));
const meter = () => screen.getByRole('meter').getAttribute('aria-valuenow');
const editorText = () => document.querySelector('.cm-content')?.textContent ?? '';

describe('StrictMode full game', () => {
  it('plays, wins, restarts and leaves no stale state or leaked resources', () => {
    const fake = createFakeWorkerFactory();
    const { unmount } = render(
      <StrictMode>
        <GameProvider workerFactory={fake.factory}>
          <App />
        </GameProvider>
      </StrictMode>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Begin' }));
    const base = 0;

    click('Begin');
    expect(screen.getByRole('button', { name: 'Run Tests' })).toBeTruthy();
    // Exactly one drain interval, no workers.
    expect(timerCount()).toBe(base + 1);
    expect(fake.live()).toBe(0);

    act(() => void vi.advanceTimersByTime(2000));
    expect(meter()).toBe('99');

    click('Run Tests');
    expect(fake.workers).toHaveLength(1);
    expect(fake.live()).toBe(base + 1);
    passAll(fake.workers[0]);
    expect(screen.getByRole('heading', { name: 'You won' })).toBeTruthy();
    expect(fake.live()).toBe(0);
    expect(timerCount()).toBe(base);

    click('Look again');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Begin' }));

    click('Begin');
    expect(editorText().replace(/\s+/g, '')).toBe(CHALLENGE.starterCode.replace(/\s+/g, ''));
    expect(screen.getAllByText('not run')).toHaveLength(CHALLENGE.tests.length);
    expect(timerCount()).toBe(base + 1);
    expect(fake.live()).toBe(0);

    unmount();
    expect(timerCount()).toBe(base);
    expect(fake.live()).toBe(0);
  });
});

function Harness({ store, fake }: { store: GameStore; fake: FakeWorkerFactory }): ReactNode {
  useTestRun(store, fake.factory, config);
  useDrain(store, config);
  return null;
}

describe('StrictMode setup-cleanup-setup with detach on one store', () => {
  it('stales a running run on detach, re-enables running and the round continues to a win', () => {
    const fake = createFakeWorkerFactory();
    const store = createGameStore(config);
    const mount = () =>
      render(
        <StrictMode>
          <Harness store={store} fake={fake} />
        </StrictMode>,
      );

    let view = mount();
    act(() => store.dispatch({ type: 'START' }));
    expect(store.getState().phase).toBe('playing');
    expect(timerCount()).toBe(1);

    const roundId = store.getActiveRoundId() as number;
    act(() => store.dispatch({ type: 'RUN_REQUESTED', roundId }));
    expect(store.getState().run?.status).toBe('running');
    expect(fake.live()).toBe(1);

    // Simulated cleanup of the provider effect, then remount (setup again).
    view.unmount();
    expect(fake.live()).toBe(0);
    expect(timerCount()).toBe(0);
    act(() => store.detach());
    expect(store.getState().phase).toBe('playing');
    expect(store.getState().run?.status).toBe('stale');
    store.detach(); // idempotent
    view = mount();
    expect(store.getState().run?.status).toBe('stale');
    expect(timerCount()).toBe(1);
    expect(fake.live()).toBe(0);

    // The round continues: a new run can start and win.
    act(() => store.dispatch({ type: 'RUN_REQUESTED', roundId }));
    expect(store.getState().run?.status).toBe('running');
    expect(fake.live()).toBe(1);
    passAll(fake.workers[fake.workers.length - 1]);
    expect(store.getState().phase).toBe('won');
    expect(fake.live()).toBe(0);
    expect(timerCount()).toBe(0);

    view.unmount();
    expect(timerCount()).toBe(0);
    expect(fake.live()).toBe(0);
  });
});
