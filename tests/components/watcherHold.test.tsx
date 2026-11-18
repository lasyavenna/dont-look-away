import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameProvider, useGame, type GameContextValue } from '../../src/app/GameProvider';
import { Watcher } from '../../src/components/Watcher';
import { normalizeConfig } from '../../src/core/config';

let game: GameContextValue;
function Probe() { game = useGame(); return <Watcher />; }
const config = normalizeConfig({ drainIntervalMs: 60_000 });

beforeEach(() => {
  vi.useFakeTimers();
  render(<StrictMode><GameProvider config={config}><Probe /></GameProvider></StrictMode>);
  act(() => game.dispatch({ type: 'START' }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const hold = () => screen.getByRole('button', { name: /Hold the Watcher/ });
it('requires two full seconds, ignores key repeat, and fires only once until release', () => {
  fireEvent.keyDown(hold(), { key: 'Enter' });
  act(() => vi.advanceTimersByTime(1999));
  expect(game.state.sanity.value).toBe(100);
  fireEvent.keyDown(hold(), { key: 'Enter', repeat: true });
  act(() => vi.advanceTimersByTime(1));
  expect(game.state.sanity.value).toBe(90);
  expect(game.state.round!.applied).not.toBeNull();
  fireEvent.keyDown(hold(), { key: 'Enter', repeat: true });
  act(() => vi.advanceTimersByTime(5000));
  expect(game.state.sanity.value).toBe(90);
  fireEvent.keyUp(hold(), { key: 'Enter' });
  fireEvent.keyDown(hold(), { key: ' ' });
  act(() => vi.advanceTimersByTime(2000));
  expect(game.state.sanity.value).toBe(80);
});

it('cancels an early release or blur, with no delayed penalty', () => {
  fireEvent.keyDown(hold(), { key: ' ' });
  act(() => vi.advanceTimersByTime(1000));
  fireEvent.keyUp(hold(), { key: ' ' });
  act(() => vi.advanceTimersByTime(2000));
  expect(game.state.sanity.value).toBe(100);
  fireEvent.keyDown(hold(), { key: 'Enter' });
  fireEvent.blur(hold());
  act(() => vi.advanceTimersByTime(2000));
  expect(game.state.sanity.value).toBe(100);
});

it('cancels a hold when the page becomes hidden, avoiding a double charge', () => {
  fireEvent.keyDown(hold(), { key: 'Enter' });
  act(() => game.dispatch({ type: 'VISIBILITY_HIDDEN', roundId: game.state.activeRoundId! }));
  act(() => vi.advanceTimersByTime(2000));
  expect(game.state.sanity.value).toBe(100);
  act(() => game.dispatch({ type: 'VISIBILITY_VISIBLE', roundId: game.state.activeRoundId! }));
  expect(game.state.sanity.value).toBe(90);
});
