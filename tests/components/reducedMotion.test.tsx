import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../../src/App';
import { GameProvider, useGame } from '../../src/app/GameProvider';
import type { GameContextValue } from '../../src/app/GameProvider';
import { normalizeConfig } from '../../src/core/config';
import { createFakeWorkerFactory } from '../helpers/fakeWorker';

if (typeof Range !== 'undefined') {
  const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects ??= (() => [] as unknown as DOMRectList) as never;
  Range.prototype.getBoundingClientRect ??= (() => rect as DOMRect) as never;
}

const NOTICED_MS = 3000;
const CFG = normalizeConfig({ drainIntervalMs: 60_000 });
let visibility: 'visible' | 'hidden' = 'visible';
let game: GameContextValue;
function Probe(): ReactNode {
  game = useGame();
  return null;
}

class FakeMql {
  matches: boolean;
  adds = 0;
  removes = 0;
  listeners = new Set<() => void>();
  constructor(matches: boolean) {
    this.matches = matches;
  }
  addEventListener(_t: string, l: () => void) {
    this.adds++;
    this.listeners.add(l);
  }
  removeEventListener(_t: string, l: () => void) {
    this.removes++;
    this.listeners.delete(l);
  }
  set(v: boolean) {
    this.matches = v;
    act(() => this.listeners.forEach((l) => l()));
  }
}
const original = window.matchMedia;
function stubMatchMedia(mql: FakeMql): void {
  // Only the reduced-motion query gets the controllable fake; other queries (e.g. CodeMirror's print) get an inert one.
  const inert = { matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  window.matchMedia = ((q: string) => (q.includes('prefers-reduced-motion') ? mql : inert)) as unknown as typeof window.matchMedia;
}
const attr = () => document.documentElement.getAttribute('data-reduced-motion');

function setup(strict = false) {
  const fake = createFakeWorkerFactory();
  const tree = (
    <GameProvider config={CFG} workerFactory={fake.factory}>
      <Probe />
      <App />
    </GameProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}
const begin = () => act(() => void fireEvent.click(screen.getByRole('button', { name: 'Begin' })));
const watcher = () => document.querySelector('.watcher');
const noticed = () => document.querySelector('.watcher--noticed') !== null;
function setVisibility(v: 'visible' | 'hidden'): void {
  visibility = v;
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
}
const tabSwitch = () => {
  setVisibility('hidden');
  setVisibility('visible');
};
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.matchMedia = original;
  delete (document as unknown as Record<string, unknown>).visibilityState;
  document.documentElement.removeAttribute('data-reduced-motion');
});

describe('Reduced motion preference', () => {
  it('a matchMedia change flips data-reduced-motion with game state intact', () => {
    const mql = new FakeMql(false);
    stubMatchMedia(mql);
    setup();
    begin();
    act(() => game.dispatch({ type: 'DRAIN_TICK', roundId: game.store.getState().activeRoundId as number }));
    expect(attr()).toBe('false');
    expect(game.reducedMotion).toBe(false);
    const before = game.store.getState();
    const snap = { sanity: before.sanity.value, code: before.code, phase: before.phase };
    mql.set(true);
    expect(attr()).toBe('true');
    expect(game.reducedMotion).toBe(true);
    const after = game.store.getState();
    expect({ sanity: after.sanity.value, code: after.code, phase: after.phase }).toEqual(snap);
    expect(after).toBe(before);
    mql.set(false);
    expect(attr()).toBe('false');
    expect(game.store.getState()).toBe(before);
  });

  it('matchMedia throwing gives reduced motion', () => {
    window.matchMedia = (() => {
      throw new Error('boom');
    }) as unknown as typeof window.matchMedia;
    setup();
    expect(attr()).toBe('true');
    expect(game.reducedMotion).toBe(true);
  });

  it('matchMedia undefined gives reduced motion', () => {
    (window as unknown as Record<string, unknown>).matchMedia = undefined;
    setup();
    expect(attr()).toBe('true');
    expect(game.reducedMotion).toBe(true);
  });

  it('subscribes one balanced change listener under StrictMode and removes it on unmount', () => {
    const mql = new FakeMql(false);
    stubMatchMedia(mql);
    const { unmount } = setup(true);
    expect(mql.adds - mql.removes).toBe(1);
    expect(mql.listeners.size).toBe(1);
    unmount();
    expect(mql.listeners.size).toBe(0);
    expect(mql.adds).toBe(mql.removes);
  });

  it('removes the listener on unmount without StrictMode', () => {
    const mql = new FakeMql(true);
    stubMatchMedia(mql);
    const { unmount } = setup();
    expect(mql.listeners.size).toBe(1);
    unmount();
    expect(mql.listeners.size).toBe(0);
  });
});

describe('Watcher noticed lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubMatchMedia(new FakeMql(false));
  });

  it('is absent on the start screen', () => {
    setup();
    expect(noticed()).toBe(false);
  });

  it('appears after an absence and clears after noticedDurationMs', () => {
    setup();
    begin();
    expect(watcher()).not.toBeNull();
    expect(noticed()).toBe(false);
    tabSwitch();
    expect(noticed()).toBe(true);
    advance(NOTICED_MS - 1);
    expect(noticed()).toBe(true);
    advance(1);
    expect(noticed()).toBe(false);
  });

  it('a second absence supersedes and restarts the duration', () => {
    setup();
    begin();
    tabSwitch();
    advance(2000);
    tabSwitch();
    advance(2000); // 4000 after the first, 2000 after the second
    expect(noticed()).toBe(true);
    advance(NOTICED_MS - 2000 - 1);
    expect(noticed()).toBe(true);
    advance(1);
    expect(noticed()).toBe(false);
  });

  it('losing clears noticed in the same commit and it is absent on Results', () => {
    setup();
    begin();
    tabSwitch();
    expect(noticed()).toBe(true);
    act(() => {
      // Drain from the current sanity to zero through real ticks.
      while (game.store.getState().phase === 'playing') {
        game.dispatch({ type: 'DRAIN_TICK', roundId: game.store.getState().activeRoundId as number });
      }
    });
    expect(game.store.getState().phase).toBe('lost');
    expect(noticed()).toBe(false);
    expect(document.querySelector('.watcher--noticed')).toBeNull();
  });

  it('noticed is a static class swap in reduced motion', () => {
    stubMatchMedia(new FakeMql(true));
    setup();
    begin();
    expect(attr()).toBe('true');
    tabSwitch();
    expect(noticed()).toBe(true);
    advance(NOTICED_MS);
    expect(noticed()).toBe(false);
  });
});

describe('Reduced-motion CSS rules', () => {
  const css = (f: string) => readFileSync(resolve(__dirname, '../../src/styles', f), 'utf8');
  it('motion.css disables animation and transitions for both the media query and the attribute', () => {
    const c = css('motion.css');
    expect(c).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(c).toMatch(/\[data-reduced-motion="true"\]/);
    expect(c).toMatch(/animation:\s*none\s*!important/);
    expect(c).toMatch(/transition:\s*none\s*!important/);
  });
  it('watcher.css keeps a static noticed treatment and disables animation in reduced motion', () => {
    const c = css('watcher.css');
    expect(c).toMatch(/\.watcher--noticed \.watcher__mouth\s*\{\s*opacity:\s*1/);
    expect(c).toMatch(/data-reduced-motion='true'\]\s*\.watcher/);
  });
});
