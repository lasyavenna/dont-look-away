import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../../src/App';
import { GameProvider, useGame } from '../../src/app/GameProvider';
import type { GameContextValue } from '../../src/app/GameProvider';
import { DiffView } from '../../src/components/DiffView';
import { normalizeConfig } from '../../src/core/config';
import { createFakeWorkerFactory } from '../helpers/fakeWorker';

// CodeMirror measures ranges under jsdom.
if (typeof Range !== 'undefined') {
  const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects ??= (() => [] as unknown as DOMRectList) as never;
  Range.prototype.getBoundingClientRect ??= (() => rect as DOMRect) as never;
}

let game: GameContextValue;
function Probe() {
  game = useGame();
  return null;
}

function setup() {
  const fw = createFakeWorkerFactory();
  const utils = render(
    <GameProvider config={normalizeConfig({ drainAmount: 100 })} workerFactory={fw.factory}>
      <Probe />
      <App />
    </GameProvider>,
  );
  return { fw, user: userEvent.setup(), ...utils };
}

const roundId = () => game.store.getActiveRoundId()!;

/** START, then an Absence (optionally after replacing the code), then drain to lost. */
function playToLost(code?: string) {
  act(() => game.dispatch({ type: 'START' }));
  if (code !== undefined) act(() => game.dispatch({ type: 'CODE_CHANGED', roundId: roundId(), code }));
  act(() => game.dispatch({ type: 'VISIBILITY_HIDDEN', roundId: roundId() }));
  act(() => game.dispatch({ type: 'VISIBILITY_VISIBLE', roundId: roundId() }));
  act(() => game.dispatch({ type: 'DRAIN_TICK', roundId: roundId() }));
}

const lineTexts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.diff-line')).map((l) => l.textContent);

afterEach(cleanup);

describe('DiffView markers', () => {
  it('prefixes lines with "- ", "+ " and two spaces as text, including unchanged lines', () => {
    const { container } = render(<DiffView before={'a\nold\nc'} after={'a\nnew\nc'} />);
    expect(lineTexts(container)).toEqual([
      '  a\n',
      'removed: - old\n',
      'added: + new\n',
      '  c\n',
    ]);
    expect(container.querySelectorAll('.diff-same')).toHaveLength(2);
  });
});

describe('Results with a mutation', () => {
  it('shows one comparison with the description, focuses the h1, and counts 1 mutation', () => {
    setup();
    playToLost();
    expect(game.state.phase).toBe('lost');
    const applied = game.state.round!.applied!;
    expect(applied).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('You lost');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    expect(screen.getAllByLabelText('Code comparison')).toHaveLength(1);
    expect(document.querySelectorAll('.diff-view')).toHaveLength(1);
    expect(screen.getByText(applied.description)).toBeTruthy();
    expect(screen.queryByText('The Watcher changed nothing.')).toBeNull();
    expect(screen.getByText('Mutations applied').nextElementSibling!.textContent).toBe('1');
    const lines = lineTexts(document.body as HTMLElement);
    expect(lines.some((l) => l!.includes('- ') && l!.startsWith('removed: '))).toBe(true);
    expect(lines.some((l) => l!.startsWith('added: + '))).toBe(true);
    expect(lines.some((l) => l!.startsWith('  '))).toBe(true);
  });

  it('restart clears the snapshot and records', async () => {
    const { user } = setup();
    playToLost();
    await user.click(screen.getByRole('button', { name: 'Look again' }));
    expect(game.state.phase).toBe('ready');
    await user.click(screen.getByRole('button', { name: 'Begin' }));
    expect(game.state.phase).toBe('playing');
    expect(game.state.round!.applied).toBeNull();
    expect(game.state.round!.absenceActive).toBe(false);
    expect(document.querySelector('.diff-view')).toBeNull();
  });
});

describe('Results without a mutation', () => {
  it('says the Watcher changed nothing and shows no diff after a win', async () => {
    const { fw, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Begin' }));
    await user.click(screen.getByRole('button', { name: 'Run Tests' }));
    const run = game.store.getState().run!;
    const w = fw.workers[0];
    const count = run.testCount;
    for (let i = 0; i < count; i++) {
      act(() =>
        w.emit({
          type: 'result',
          roundId: run.roundId,
          runId: run.runId,
          result: { index: i, status: 'pass', message: '', expectedText: 'x', actualText: 'x' },
        }),
      );
    }
    act(() => w.emit({ type: 'done', roundId: run.roundId, runId: run.runId, count }));
    expect(game.state.phase).toBe('won');
    expect(screen.getByText('The Watcher changed nothing.')).toBeTruthy();
    expect(document.querySelector('.diff-view')).toBeNull();
    expect(screen.getByText('Mutations applied').nextElementSibling!.textContent).toBe('0');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('never shows a skipped attempt: applied stays null when every candidate is skipped', () => {
    setup();
    playToLost('nothing to mutate here');
    expect(game.state.round!.applied).toBeNull();
    expect(game.state.round!.lastAttemptSkipped.length).toBeGreaterThan(0);
    expect(screen.getByText('The Watcher changed nothing.')).toBeTruthy();
    expect(document.querySelector('.diff-view')).toBeNull();
    expect(screen.getByText('Mutations applied').nextElementSibling!.textContent).toBe('0');
  });
});
