import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../../src/App';
import { GameProvider, useGame } from '../../src/app/GameProvider';
import type { GameContextValue } from '../../src/app/GameProvider';
import { LEVEL_LABEL, LEVEL_TEXT } from '../../src/app/hooks/useWarningLevel';
import { normalizeConfig } from '../../src/core/config';
import { createFakeWorkerFactory } from '../helpers/fakeWorker';

if (typeof Range !== 'undefined') {
  const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects ??= (() => [] as unknown as DOMRectList) as never;
  Range.prototype.getBoundingClientRect ??= (() => rect as DOMRect) as never;
}

// Slow drain so the interval never fires; sanity is driven by explicit DRAIN_TICK dispatches (1 per tick).
const CFG = normalizeConfig({ drainIntervalMs: 60_000, drainAmount: 1 });
let game: GameContextValue;
function Probe(): ReactNode {
  game = useGame();
  return null;
}
function setup() {
  const fake = createFakeWorkerFactory();
  const r = render(
    <GameProvider config={CFG} workerFactory={fake.factory}>
      <Probe />
      <App />
    </GameProvider>,
  );
  act(() => void fireEvent.click(screen.getByRole('button', { name: 'Begin' })));
  return r;
}
/** Drains sanity to exactly `target` (from the current value) in a single act. */
function drainTo(target: number): void {
  act(() => {
    while (game.store.getState().sanity.value > target) {
      game.dispatch({ type: 'DRAIN_TICK', roundId: game.store.getState().activeRoundId as number });
    }
  });
}
const root = () => document.querySelector('.play-screen') as HTMLElement;
const warning = () => screen.getByTestId('level-warning');
const levelClasses = (el: Element) => Array.from(el.classList).filter((c) => /^level-/.test(c));
const meterLevel = () => document.querySelector('.sanity-meter__level')?.textContent;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.level;
});

const CASES: Array<[number, 'calm' | 'uneasy' | 'distressed' | 'critical']> = [
  [100, 'calm'],
  [71, 'calm'],
  [70, 'uneasy'],
  [41, 'uneasy'],
  [40, 'distressed'],
  [21, 'distressed'],
  [20, 'critical'],
  [1, 'critical'],
];

describe('Warning level treatments', () => {
  it.each(CASES)('sanity %i is %s with text, meter word, class and html data-level', (value, level) => {
    setup();
    drainTo(value);
    expect(game.store.getState().sanity.value).toBe(value);
    expect(levelClasses(root())).toEqual([`level-${level}`]);
    expect(document.documentElement.dataset.level).toBe(level);
    expect(warning().textContent).toBe(LEVEL_TEXT[level]);
    expect(meterLevel()).toBe(LEVEL_LABEL[level]);
  });

  it('uses the specified warning copy', () => {
    expect(LEVEL_TEXT).toEqual({ calm: '', uneasy: 'Uneasy', distressed: 'It is watching your hands.', critical: 'Do not look away.' });
  });

  it('sanity 0 is critical (the lost state still reports critical)', () => {
    setup();
    act(() => game.dispatch({ type: 'DRAIN_TICK', roundId: 1 }));
    drainTo(1);
    // Force the last tick through the real reducer: phase becomes lost with sanity 0.
    act(() => game.dispatch({ type: 'DRAIN_TICK', roundId: game.store.getState().activeRoundId ?? 1 }));
    expect(game.store.getState().sanity.value).toBe(0);
    expect(game.store.getState().phase).toBe('lost');
    expect(document.documentElement.dataset.level).toBeUndefined();
  });

  it('swaps the level class in one commit (never both or neither)', () => {
    setup();
    const el = root();
    const seen: string[] = [];
    const obs = new MutationObserver((records) => {
      for (const r of records) seen.push(r.oldValue ?? '');
    });
    obs.observe(el, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    drainTo(70);
    obs.takeRecords().forEach((r) => seen.push(r.oldValue ?? ''));
    obs.disconnect();
    expect(seen.length).toBe(1);
    for (const old of seen) expect(old.split(/\s+/).filter((c) => c.startsWith('level-'))).toEqual(['level-calm']);
    expect(levelClasses(el)).toEqual(['level-uneasy']);
    expect(document.documentElement.dataset.level).toBe('uneasy');
  });

  it('announces text once per level change only', () => {
    setup();
    const el = warning();
    let changes = 0;
    const obs = new MutationObserver((records) => {
      changes += records.length;
    });
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    const flush = () => {
      changes += obs.takeRecords().length;
    };
    // Within calm: no text change.
    for (let v = 99; v >= 71; v -= 7) drainTo(v);
    flush();
    expect(changes).toBe(0);
    drainTo(70);
    flush();
    expect(changes).toBeGreaterThan(0);
    const afterUneasy = changes;
    expect(el.textContent).toBe('Uneasy');
    drainTo(55);
    drainTo(41);
    flush();
    expect(changes).toBe(afterUneasy);
    drainTo(40);
    flush();
    expect(changes).toBeGreaterThan(afterUneasy);
    expect(el.textContent).toBe('It is watching your hands.');
    obs.disconnect();
  });

  it('the status region is polite and stays mounted across levels', () => {
    setup();
    const el = warning();
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
    drainTo(20);
    expect(warning()).toBe(el);
    expect(el.textContent).toBe('Do not look away.');
  });

  it('keeps the previous level when sanity is invalid', () => {
    setup();
    drainTo(30); // distressed
    expect(levelClasses(root())).toEqual(['level-distressed']);
    // Make the store report NaN sanity for the next render (documented approach: spy on getState).
    const real = game.store.getState.bind(game.store);
    const cache = new WeakMap<object, object>();
    vi.spyOn(game.store, 'getState').mockImplementation(() => {
      const s = real();
      if (!cache.has(s)) cache.set(s, { ...s, sanity: { value: Number.NaN } });
      return cache.get(s) as ReturnType<typeof real>;
    });
    act(() => game.dispatch({ type: 'DRAIN_TICK', roundId: real().activeRoundId as number }));
    expect(levelClasses(root())).toEqual(['level-distressed']);
    expect(document.documentElement.dataset.level).toBe('distressed');
    expect(warning().textContent).toBe(LEVEL_TEXT.distressed);
  });

  it('removes html data-level when the phase leaves playing, and on unmount', () => {
    const { unmount } = setup();
    expect(document.documentElement.dataset.level).toBe('calm');
    drainTo(1);
    expect(document.documentElement.dataset.level).toBe('critical');
    act(() => game.dispatch({ type: 'DRAIN_TICK', roundId: game.store.getState().activeRoundId as number }));
    expect(game.store.getState().phase).toBe('lost');
    expect(document.documentElement.dataset.level).toBeUndefined();
    unmount();
    expect(document.documentElement.dataset.level).toBeUndefined();
  });

  it('does not set data-level on the start screen', () => {
    render(
      <GameProvider config={CFG} workerFactory={createFakeWorkerFactory().factory}>
        <App />
      </GameProvider>,
    );
    expect(document.documentElement.dataset.level).toBeUndefined();
  });
});
