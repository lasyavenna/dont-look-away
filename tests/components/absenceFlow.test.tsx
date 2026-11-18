import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../../src/App';
import { GameProvider, useGame } from '../../src/app/GameProvider';
import type { GameContextValue } from '../../src/app/GameProvider';
import { CHALLENGE } from '../../src/core/challenge';
import { normalizeConfig } from '../../src/core/config';
import type { GameConfig } from '../../src/core/config';
import { createFakeWorkerFactory } from '../helpers/fakeWorker';
import type { FakeWorkerFactory } from '../helpers/fakeWorker';

// Minimal geometry stubs; CodeMirror measures ranges under jsdom.
if (typeof Range !== 'undefined') {
  const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects ??= (() => [] as unknown as DOMRectList) as never;
  Range.prototype.getBoundingClientRect ??= (() => rect as DOMRect) as never;
}

const NOTICED_MS = 5000;
// Slow drain so absence math is exact unless a test advances past the drain interval on purpose.
const SLOW = normalizeConfig({ drainIntervalMs: 60_000, noticedDurationMs: NOTICED_MS });
const FAST = normalizeConfig({ noticedDurationMs: NOTICED_MS }); // drain 2000

let visibility: 'visible' | 'hidden' = 'visible';
let game: GameContextValue;
function Probe(): ReactNode {
  game = useGame();
  return null;
}

// Tracked resources (only those with the delays/intervals this game uses).
const intervals = new Set<unknown>();
const noticedTimers = new Set<unknown>();
let listenerBalance = 0;
let currentDrainMs = FAST.drainIntervalMs;

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  intervals.clear();
  noticedTimers.clear();
  listenerBalance = 0;
  const si = globalThis.setInterval;
  const ci = globalThis.clearInterval;
  const st = globalThis.setTimeout;
  const ct = globalThis.clearTimeout;
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((...a: Parameters<typeof si>) => {
    const id = si(...a);
    if (a[1] === currentDrainMs) intervals.add(id);
    return id;
  }) as typeof si);
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(((id: Parameters<typeof ci>[0]) => {
    intervals.delete(id);
    return ci(id);
  }) as typeof ci);
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((...a: Parameters<typeof st>) => {
    const id = st(...a);
    if (a[1] === NOTICED_MS) noticedTimers.add(id);
    return id;
  }) as typeof st);
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((id: Parameters<typeof ct>[0]) => {
    noticedTimers.delete(id);
    return ct(id);
  }) as typeof ct);
  const add = document.addEventListener.bind(document);
  const remove = document.removeEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation(((type: string, ...rest: unknown[]) => {
    if (type === 'visibilitychange') listenerBalance++;
    return (add as (...a: unknown[]) => void)(type, ...rest);
  }) as typeof document.addEventListener);
  vi.spyOn(document, 'removeEventListener').mockImplementation(((type: string, ...rest: unknown[]) => {
    if (type === 'visibilitychange') listenerBalance--;
    return (remove as (...a: unknown[]) => void)(type, ...rest);
  }) as typeof document.removeEventListener);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (document as unknown as Record<string, unknown>).visibilityState;
});

function setup(config: GameConfig, strict = false): { fake: FakeWorkerFactory; unmount: () => void } {
  currentDrainMs = config.drainIntervalMs;
  const fake = createFakeWorkerFactory();
  const tree = (
    <GameProvider config={config} workerFactory={fake.factory}>
      <Probe />
      <App />
    </GameProvider>
  );
  const { unmount } = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { fake, unmount };
}

const click = (name: string) => act(() => void fireEvent.click(screen.getByRole('button', { name })));
const meter = () => screen.getByRole('meter').getAttribute('aria-valuenow');
const editorText = () => document.querySelector('.cm-content')?.textContent ?? '';
const state = () => game.store.getState();
const notice = () => document.querySelector('.play-screen__notice')?.textContent ?? '';

function setVisibility(v: 'visible' | 'hidden'): void {
  visibility = v;
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
}
function tabSwitch(): void {
  setVisibility('hidden');
  setVisibility('visible');
}
function setCode(code: string): void {
  act(() => game.dispatch({ type: 'CODE_CHANGED', roundId: state().activeRoundId as number, code }));
}
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('Absence flow', () => {
  it('applies cost, one mutation, replaces editor code, stales a run, and announces the change', () => {
    const { fake } = setup(SLOW);
    click('Begin');
    click('Run Tests');
    expect(state().run?.status).toBe('running');
    expect(screen.getByRole('button', { name: 'Running…' }).hasAttribute('disabled')).toBe(true);
    expect(fake.live()).toBe(1);

    tabSwitch();

    expect(meter()).toBe('90');
    expect(state().round?.applied?.id).toBe('off-by-one');
    expect(state().code).toContain('i < candles.length - 1');
    expect(editorText()).toContain('candles.length - 1');
    expect(state().run?.status).toBe('stale');
    expect(fake.live()).toBe(0);
    expect(screen.getByRole('button', { name: 'Run Tests' }).hasAttribute('disabled')).toBe(false);
    expect(notice()).toBe('The Watcher changed your code.');
    expect(notice()).not.toMatch(/off-by-one|loop|candles|shortened/i);
    expect(state().round?.noticedActive).toBe(true);
  });

  it('a second Absence costs sanity, applies no second mutation, and supersedes the noticed timer', () => {
    setup(SLOW);
    click('Begin');
    tabSwitch();
    const afterFirst = state().code;
    expect(state().round?.noticedSeq).toBe(1);
    advance(3000);
    expect(state().round?.noticedActive).toBe(true);

    tabSwitch();
    expect(meter()).toBe('80');
    expect(state().code).toBe(afterFirst);
    expect(state().round?.applied?.id).toBe('off-by-one');
    expect(state().round?.noticedSeq).toBe(2);
    expect(notice()).toBe('');
    // Only one noticed timer is pending (first was cleared by supersession).
    expect(noticedTimers.size).toBe(1);

    // 3000 + 4000 ms after the first absence, but only 4000 after the second: still noticed.
    advance(NOTICED_MS - 1);
    expect(state().round?.noticedActive).toBe(true);
    advance(1);
    expect(state().round?.noticedActive).toBe(false);
    expect(noticedTimers.size).toBe(0);
  });

  it('pauses drain while hidden and resumes when visible', () => {
    setup(FAST);
    click('Begin');
    advance(2000);
    expect(meter()).toBe('99');
    setVisibility('hidden');
    advance(10_000);
    expect(meter()).toBe('99');
    setVisibility('visible');
    expect(meter()).toBe('89');
    advance(2000);
    expect(meter()).toBe('88');
  });

  it('retries a missing target later: first Absence applies nothing, a later one applies', () => {
    setup(SLOW);
    click('Begin');
    setCode('function brightestCandle() { return 0; }');
    tabSwitch();
    expect(meter()).toBe('90');
    expect(state().round?.applied).toBeNull();
    expect(state().code).toBe('function brightestCandle() { return 0; }');
    expect(notice()).toBe('');

    setCode(CHALLENGE.starterCode);
    tabSwitch();
    expect(meter()).toBe('80');
    expect(state().round?.applied?.id).toBe('off-by-one');
    expect(editorText()).toContain('candles.length - 1');
    expect(notice()).toBe('The Watcher changed your code.');
  });

  it('losing by Absence cost ends the round with no mutation', () => {
    setup(normalizeConfig({ drainIntervalMs: 60_000, absenceCost: 100 }));
    click('Begin');
    tabSwitch();
    expect(state().phase).toBe('lost');
    expect(state().sanity.value).toBe(0);
    expect(state().round?.applied).toBeNull();
    expect(state().code).toBe(CHALLENGE.starterCode);
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('restart clears absence state and mutation records', () => {
    setup(normalizeConfig({ drainIntervalMs: 60_000, absenceCost: 45 }));
    click('Begin');
    tabSwitch();
    expect(state().round?.applied).not.toBeNull();
    tabSwitch();
    tabSwitch();
    expect(state().phase).toBe('lost');

    click('Look again');
    click('Begin');
    expect(state().phase).toBe('playing');
    expect(meter()).toBe('100');
    expect(state().round?.applied).toBeNull();
    expect(state().round?.absenceActive).toBe(false);
    expect(state().round?.noticedSeq).toBe(0);
    expect(state().notice).toBe('none');
    expect(state().code).toBe(CHALLENGE.starterCode);
    expect(editorText().replace(/\s+/g, '')).toBe(CHALLENGE.starterCode.replace(/\s+/g, ''));
  });
});

describe('Absence flow under StrictMode', () => {
  it('keeps exactly one listener, one drain interval and at most one noticed timer; leaves none after unmount', () => {
    const { unmount } = setup(FAST, true);
    expect(listenerBalance).toBe(0);
    click('Begin');
    expect(listenerBalance).toBe(1);
    expect(intervals.size).toBe(1);
    expect(noticedTimers.size).toBe(0);

    tabSwitch();
    expect(meter()).toBe('90');
    expect(state().round?.applied?.id).toBe('off-by-one');
    expect(editorText()).toContain('candles.length - 1');
    expect(notice()).toBe('The Watcher changed your code.');
    expect(listenerBalance).toBe(1);
    expect(intervals.size).toBe(1);
    expect(noticedTimers.size).toBe(1);

    tabSwitch();
    expect(meter()).toBe('80');
    expect(noticedTimers.size).toBe(1);
    expect(listenerBalance).toBe(1);

    unmount();
    expect(listenerBalance).toBe(0);
    expect(intervals.size).toBe(0);
    expect(noticedTimers.size).toBe(0);
  });

  it('removes the listener and timers when the round ends', () => {
    setup(normalizeConfig({ absenceCost: 50, noticedDurationMs: NOTICED_MS }), true);
    click('Begin');
    expect(listenerBalance).toBe(1);
    tabSwitch();
    expect(noticedTimers.size).toBe(1);
    tabSwitch();
    expect(state().phase).toBe('lost');
    expect(listenerBalance).toBe(0);
    expect(intervals.size).toBe(0);
    expect(noticedTimers.size).toBe(0);
  });
});
