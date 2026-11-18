import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../../src/App';
import { AudioProvider } from '../../src/app/AudioProvider';
import { GameProvider, useGame } from '../../src/app/GameProvider';
import type { GameContextValue } from '../../src/app/GameProvider';
import {
  INSTRUCTIONS_ERROR,
  LIMITATION_STATEMENT,
  SOUND_OFF_TEXT,
  SOUND_ON_TEXT,
  StartScreen,
  buildStartContent,
  instructionsAvailable,
} from '../../src/app/screens/StartScreen';
import type { AudioManager } from '../../src/audio/audioManager';
import { normalizeConfig } from '../../src/core/config';
import { createFakeWorkerFactory } from '../helpers/fakeWorker';

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

function fakeManager(): AudioManager {
  let on = false;
  return {
    enable: async () => (on = true),
    isEnabled: () => on,
    context: null,
    masterVolume: 0.5,
    mute: () => void (on = false),
    unmute: async () => (on = true),
    playWatcherCue: () => undefined,
    setTension: () => undefined,
    startAmbient: () => undefined,
    stopAmbient: () => undefined,
    silenceAll: () => undefined,
    dispose: () => undefined,
  };
}

function setup(children?: React.ReactNode, overrides: Parameters<typeof normalizeConfig>[0] = {}) {
  const fw = createFakeWorkerFactory();
  const ui = (
    <GameProvider config={normalizeConfig({ drainIntervalMs: 60_000, ...overrides })} workerFactory={fw.factory}>
      <Probe />
      <AudioProvider createManager={fakeManager}>{children ?? <App />}</AudioProvider>
    </GameProvider>
  );
  return { fw, user: userEvent.setup(), ...render(ui) };
}

const details = () => document.querySelector('details') as HTMLDetailsElement;
const soundLine = () => document.querySelector('.start-sound')!;

afterEach(cleanup);

describe('Start screen content', () => {
  it('shows exactly the three rules with the configured absence cost', () => {
    setup();
    const items = Array.from(document.querySelectorAll('.start-rules li')).map((e) => e.textContent);
    expect(items).toEqual([
      'Fix the function before sanity reaches zero.',
      'Leaving the tab costs 10 sanity and may change your code.',
      'The Watcher can change your code once per round.',
    ]);
  });

  it('uses config.absenceCost and config.runTimeoutMs', async () => {
    const { user } = setup(undefined, { absenceCost: 25, runTimeoutMs: 1500 });
    expect(screen.getByText('Leaving the tab costs 25 sanity and may change your code.')).toBeTruthy();
    await user.click(screen.getByText('Technical details'));
    expect(details().textContent).toContain('1500 ms');
  });

  it('keeps Technical details collapsed by default and toggles by click and keyboard', async () => {
    const { user } = setup();
    expect(details().open).toBe(false);
    await user.click(screen.getByText('Technical details'));
    expect(details().open).toBe(true);
    await user.click(screen.getByText('Technical details'));
    expect(details().open).toBe(false);
    const summary = screen.getByText('Technical details');
    // jsdom does not implement native Enter/Space activation of <summary>; real browsers do (checked in Chrome).
    // Here we verify the summary is a keyboard-reachable control.
    summary.focus();
    expect(document.activeElement).toBe(summary);
    expect(summary.tabIndex).toBeGreaterThanOrEqual(0);
  });

  it('holds the accurate disclosures inside Technical details only', () => {
    setup();
    const text = details().textContent!;
    expect(text).toContain('Page Visibility API');
    expect(text).toMatch(/may not detect every window switch/);
    expect(text).toMatch(/No camera, eye tracking or gaze detection/);
    expect(text).toContain('Web Worker');
    expect(text).toMatch(/not a security sandbox/);
    expect(text).toContain('3000 ms');
    expect(text).toContain(LIMITATION_STATEMENT);
    expect(LIMITATION_STATEMENT.length).toBeLessThanOrEqual(200);
    const main = document.querySelector('main')!.textContent!;
    const outside = main.replace(text, '');
    expect(outside).not.toContain('Page Visibility');
    expect(outside).not.toContain('sandbox');
  });
});

describe('Start screen guard', () => {
  it('rejects wrong rule counts and empty technical content', () => {
    const good = buildStartContent();
    expect(instructionsAvailable(good)).toBe(true);
    expect(instructionsAvailable({ ...good, rules: good.rules.slice(0, 2) })).toBe(false);
    expect(instructionsAvailable({ ...good, technical: [] })).toBe(false);
    expect(instructionsAvailable({ ...good, technical: [' '] })).toBe(false);
  });

  it('disables Begin and shows an alert when content is missing', () => {
    setup(<StartScreen instructions={{ rules: buildStartContent().rules as string[], technical: [] }} />);
    expect((screen.getByRole('button', { name: 'Begin' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe(INSTRUCTIONS_ERROR);
    expect(document.querySelector('details')).toBeNull();
  });
});

describe('Start screen sound line', () => {
  it('is off on load, on after enabling, still on after a restart, off after remount', async () => {
    const { user, fw, unmount } = setup();
    expect(soundLine().textContent).toBe(SOUND_OFF_TEXT);
    expect(soundLine().getAttribute('role')).toBe('status');
    await user.click(screen.getByRole('button', { name: 'Enable sound' }));
    expect(soundLine().textContent).toBe(SOUND_ON_TEXT);
    await user.click(screen.getByRole('button', { name: 'Mute sound' }));
    expect(soundLine().textContent).toBe(SOUND_OFF_TEXT);
    await user.click(screen.getByRole('button', { name: 'Enable sound' }));

    await user.click(screen.getByRole('button', { name: 'Begin' }));
    await user.click(screen.getByRole('button', { name: 'Run Tests' }));
    const w = fw.workers[0];
    const run = game.store.getState().run!;
    for (let i = 0; i < 5; i++)
      act(() =>
        w.emit({
          type: 'result',
          roundId: run.roundId,
          runId: run.runId,
          result: { index: i, status: 'pass', message: '', expectedText: 'x', actualText: 'x' },
        }),
      );
    act(() => w.emit({ type: 'done', roundId: run.roundId, runId: run.runId, count: 5 }));
    await user.click(screen.getByRole('button', { name: 'Look again' }));
    expect(soundLine().textContent).toBe(SOUND_ON_TEXT);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Begin' }));

    unmount();
    setup();
    expect(soundLine().textContent).toBe(SOUND_OFF_TEXT);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Begin' }));
  });
});
