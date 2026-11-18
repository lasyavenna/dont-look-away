import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { GameProvider, useGame } from '../../src/app/GameProvider';
import type { GameContextValue } from '../../src/app/GameProvider';
import { StartScreen, INSTRUCTIONS_ERROR } from '../../src/app/screens/StartScreen';
import { CHALLENGE } from '../../src/core/challenge';
import { normalizeConfig } from '../../src/core/config';
import type { GameConfig } from '../../src/core/config';
import type { TestResult } from '../../src/core/types';
import { createFakeWorkerFactory } from '../helpers/fakeWorker';
import type { FakeWorker } from '../helpers/fakeWorker';

// CodeMirror measures ranges under jsdom.
if (typeof Range !== 'undefined') {
  const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects ??= (() => [] as unknown as DOMRectList) as never;
  Range.prototype.getBoundingClientRect ??= (() => rect as DOMRect) as never;
}

/*
 * Approach: typing into CodeMirror under jsdom is unreliable, so a small Probe component sits inside
 * the GameProvider and exposes useGame() (dispatch, store). CODE_CHANGED is dispatched through it with
 * the active round id, exactly as PlayScreen's onChange does.
 */
let game: GameContextValue;
function Probe() {
  game = useGame();
  return null;
}

function setup(opts: { config?: GameConfig; children?: React.ReactNode } = {}) {
  const fw = createFakeWorkerFactory();
  const utils = render(
    <GameProvider config={opts.config ?? normalizeConfig()} workerFactory={fw.factory}>
      <Probe />
      {opts.children ?? <App />}
    </GameProvider>,
  );
  return { fw, user: userEvent.setup(), ...utils };
}

const res = (index: number, status: TestResult['status'] = 'pass'): TestResult => ({
  index,
  status,
  message: '',
  expectedText: 'x',
  actualText: status === 'pass' ? 'x' : 'y',
});
const ids = () => {
  const run = game.store.getState().run!;
  return { roundId: run.roundId, runId: run.runId };
};
const emitResult = (w: FakeWorker, i: number, status: TestResult['status'] = 'pass') =>
  act(() => w.emit({ type: 'result', ...ids(), result: res(i, status) }));
const emitDone = (w: FakeWorker) => act(() => w.emit({ type: 'done', ...ids(), count: CHALLENGE.tests.length }));
const begin = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Begin' }));
const runButton = () => screen.getByRole('button', { name: /Running|Run Tests/ });
const statusTexts = () => Array.from(document.querySelectorAll('.test-panel__status')).map((e) => e.textContent);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('one screen per phase', () => {
  it('renders exactly one h1 and one main for ready, playing, won and lost', async () => {
    const { user, fw } = setup();
    const check = (name: RegExp | string) => {
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getAllByRole('main')).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name })).toBeTruthy();
    };
    check("Don't Look Away");
    await begin(user);
    check(/Repair/);
    await user.click(screen.getByRole('button', { name: 'Run Tests' }));
    const w = fw.workers[0];
    CHALLENGE.tests.forEach((_, i) => emitResult(w, i));
    emitDone(w);
    check('You won');
    await user.click(screen.getByRole('button', { name: 'Look again' }));
    check("Don't Look Away");
  });

  it('renders one h1 and one main on the lost screen', () => {
    setup({ config: normalizeConfig({ drainAmount: 100 }) });
    act(() => game.dispatch({ type: 'START' }));
    act(() => game.dispatch({ type: 'DRAIN_TICK', roundId: game.store.getActiveRoundId()! }));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('You lost');
  });
});

function setupTracked(opts: Parameters<typeof setup>[0] = {}) {
  return setup(opts);
}

describe('Start screen', () => {
  it('focuses the Begin button on mount', () => {
    setup();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Begin' }));
  });

  it('disables Begin and shows the error when instructions are unavailable', () => {
    setup({ children: <StartScreen instructions={{ rules: [], technical: [] }} /> });
    expect((screen.getByRole('button', { name: 'Begin' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(INSTRUCTIONS_ERROR).textContent).toBe('The instructions could not be loaded.');
  });
});

describe('Play screen', () => {
  it('disables Run while running with an indicator and re-enables after completion', async () => {
    const { user, fw } = setupTracked();
    await begin(user);
    expect((runButton() as HTMLButtonElement).disabled).toBe(false);
    await user.click(runButton());
    expect((runButton() as HTMLButtonElement).disabled).toBe(true);
    expect(runButton().textContent).toMatch(/Running/);
    const w = fw.workers[0];
    emitResult(w, 0, 'fail');
    CHALLENGE.tests.slice(1).forEach((_, i) => emitResult(w, i + 1));
    emitDone(w);
    expect((runButton() as HTMLButtonElement).disabled).toBe(false);
    expect(runButton().textContent).toBe('Run Tests');
  });

  it('shows the outdated badge after editing following a completed run', async () => {
    const { user, fw } = setupTracked();
    await begin(user);
    await user.click(runButton());
    const w = fw.workers[0];
    emitResult(w, 0, 'fail');
    CHALLENGE.tests.slice(1).forEach((_, i) => emitResult(w, i + 1));
    emitDone(w);
    expect(screen.queryByText('outdated')).toBeNull();
    act(() =>
      game.dispatch({ type: 'CODE_CHANGED', roundId: game.store.getActiveRoundId()!, code: game.state.code + ' ' }),
    );
    expect(screen.getByText('outdated')).toBeTruthy();
  });

  it('streams per-test results and replaces the previous run as the new one reports', async () => {
    const { user, fw } = setupTracked();
    await begin(user);
    await user.click(runButton());
    const w1 = fw.workers[0];
    // Nothing displayed until the first result arrives.
    expect(statusTexts().every((t) => t === 'not run')).toBe(true);
    emitResult(w1, 0, 'fail');
    expect(statusTexts()[0]).toBe('✗ fail');
    expect(statusTexts()[1]).toBe('… running');
    CHALLENGE.tests.slice(1).forEach((_, i) => emitResult(w1, i + 1, 'fail'));
    emitDone(w1);
    expect(statusTexts().every((t) => t === '✗ fail')).toBe(true);

    await user.click(runButton());
    const w2 = fw.workers[1];
    emitResult(w2, 2, 'pass');
    expect(statusTexts()).toEqual(['… running', '… running', '✓ pass', '… running', '… running']);
  });

  it('exposes the meter with role, label, aria-valuenow and the integer shown', () => {
    const { user } = setupTracked();
    return begin(user).then(() => {
      const meter = screen.getByRole('meter', { name: 'Sanity' });
      expect(meter.getAttribute('aria-valuenow')).toBe(String(Math.round(game.state.sanity.value)));
      expect(meter.getAttribute('aria-valuenow')).toBe('100');
      expect(meter.parentElement!.textContent).toContain('100');
      act(() => game.dispatch({ type: 'DRAIN_TICK', roundId: game.store.getActiveRoundId()! }));
      expect(screen.getByRole('meter', { name: 'Sanity' }).getAttribute('aria-valuenow')).toBe('99');
      expect(within(meter.parentElement!).getByText('99')).toBeTruthy();
    });
  });
});

describe('late results and restart', () => {
  it('discards a late result from a previous run after restart', async () => {
    const { user, fw } = setupTracked();
    await begin(user);
    await user.click(runButton());
    const w = fw.workers[0];
    const old = ids();
    // Win to reach a restartable phase, then restart.
    CHALLENGE.tests.forEach((_, i) => emitResult(w, i));
    emitDone(w);
    await user.click(screen.getByRole('button', { name: 'Look again' }));
    expect(game.state.phase).toBe('ready');
    act(() => w.emit({ type: 'result', ...old, result: res(0, 'fail') }));
    act(() => w.emit({ type: 'done', ...old, count: CHALLENGE.tests.length }));
    expect(game.state.phase).toBe('ready');
    expect(game.state.run).toBeNull();
    expect(game.state.displayRun).toBeNull();
    await begin(user);
    expect(game.state.phase).toBe('playing');
    expect(statusTexts().every((t) => t === 'not run')).toBe(true);
  });

  it('restarts once when "Look again" is activated twice quickly', async () => {
    const { user, fw } = setupTracked();
    await begin(user);
    await user.click(runButton());
    const w = fw.workers[0];
    CHALLENGE.tests.forEach((_, i) => emitResult(w, i));
    emitDone(w);
    const btn = screen.getByRole('button', { name: 'Look again' });
    const nextRound = game.state.nextRoundId;
    const nextRun = game.state.nextRunId;
    await act(async () => {
      btn.click();
      btn.click();
    });
    expect(game.state.phase).toBe('ready');
    expect(game.state.nextRoundId).toBe(nextRound);
    expect(game.state.nextRunId).toBe(nextRun);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await begin(user);
    expect(game.state.activeRoundId).toBe(nextRound);
    expect(fw.live()).toBe(0);
  });
});

describe('flows', () => {
  it('win flow shows results with no mutation', async () => {
    const { user, fw } = setupTracked();
    await begin(user);
    await user.click(runButton());
    const w = fw.workers[0];
    CHALLENGE.tests.forEach((_, i) => emitResult(w, i));
    emitDone(w);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('You won');
    expect(screen.getByText('Final sanity').nextElementSibling!.textContent).toBe('100');
    expect(screen.getByText('Mutations applied').nextElementSibling!.textContent).toBe('0');
    expect(screen.getByText('The Watcher changed nothing.')).toBeTruthy();
  });

  it('loss flow: draining sanity to zero shows You lost', () => {
    vi.useFakeTimers();
    const config = normalizeConfig({ drainIntervalMs: 100, drainAmount: 50 });
    setup({ config });
    act(() => {
      game.dispatch({ type: 'START' });
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('You lost');
    expect(screen.getByText('Final sanity').nextElementSibling!.textContent).toBe('0');
  });
});

describe('regressions', () => {
  it('Restart restores the starter code and clears old results', async () => {
    const { user, fw } = setupTracked();
    await begin(user);
    act(() => game.dispatch({ type: 'CODE_CHANGED', roundId: game.store.getActiveRoundId()!, code: 'changed' }));
    await user.click(runButton());
    const w = fw.workers[0];
    CHALLENGE.tests.forEach((_, i) => emitResult(w, i));
    emitDone(w);
    await user.click(screen.getByRole('button', { name: 'Look again' }));
    expect(game.state.displayRun).toBeNull();
    await begin(user);
    expect(game.state.code).toBe(CHALLENGE.starterCode);
    expect(statusTexts().every((t) => t === 'not run')).toBe(true);
    expect(screen.queryByText('outdated')).toBeNull();
  });

  it('Passing tests produce a win', async () => {
    const { user, fw } = setupTracked();
    await begin(user);
    await user.click(runButton());
    const w = fw.workers[0];
    CHALLENGE.tests.forEach((_, i) => emitResult(w, i));
    emitDone(w);
    expect(game.state.phase).toBe('won');
  });
});
