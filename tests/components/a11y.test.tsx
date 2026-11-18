import { readFileSync } from 'node:fs';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../../src/App';
import { AudioProvider } from '../../src/app/AudioProvider';
import { GameProvider, useGame } from '../../src/app/GameProvider';
import type { GameContextValue } from '../../src/app/GameProvider';
import type { AudioManager } from '../../src/audio/audioManager';
import { DiffView } from '../../src/components/DiffView';
import { CHALLENGE } from '../../src/core/challenge';
import { normalizeConfig } from '../../src/core/config';
import type { TestResult } from '../../src/core/types';
import { createFakeWorkerFactory } from '../helpers/fakeWorker';
import type { FakeWorker } from '../helpers/fakeWorker';

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

/** Minimal AudioManager stand-in: enable resolves true without any real audio. */
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

function setup(overrides: Parameters<typeof normalizeConfig>[0] = {}) {
  const fw = createFakeWorkerFactory();
  const utils = render(
    <GameProvider config={normalizeConfig({ drainIntervalMs: 60_000, ...overrides })} workerFactory={fw.factory}>
      <Probe />
      <AudioProvider createManager={fakeManager}>
        <App />
      </AudioProvider>
    </GameProvider>,
  );
  return { fw, user: userEvent.setup(), ...utils };
}

const res = (index: number, status: TestResult['status'] = 'pass'): TestResult => ({
  index,
  status,
  message: '',
  expectedText: 'x',
  actualText: 'x',
});
const ids = () => {
  const run = game.store.getState().run!;
  return { roundId: run.roundId, runId: run.runId };
};
const emitResult = (w: FakeWorker, i: number, status: TestResult['status'] = 'pass') =>
  act(() => w.emit({ type: 'result', ...ids(), result: res(i, status) }));
const emitDone = (w: FakeWorker) => act(() => w.emit({ type: 'done', ...ids(), count: CHALLENGE.tests.length }));
const roundId = () => game.store.getActiveRoundId()!;

type User = ReturnType<typeof userEvent.setup>;

function toStart() {
  /* Start screen is the initial state. */
}
function toPlay() {
  act(() => game.dispatch({ type: 'START' }));
}
function toLost() {
  act(() => game.dispatch({ type: 'START' }));
  act(() => game.dispatch({ type: 'VISIBILITY_HIDDEN', roundId: roundId() }));
  act(() => game.dispatch({ type: 'VISIBILITY_VISIBLE', roundId: roundId() }));
  act(() => game.dispatch({ type: 'DRAIN_TICK', roundId: roundId() }));
}
function toWon(fw: ReturnType<typeof createFakeWorkerFactory>) {
  act(() => game.dispatch({ type: 'START' }));
  act(() => game.requestRun());
  const w = fw.workers[0];
  CHALLENGE.tests.forEach((_, i) => emitResult(w, i));
  emitDone(w);
}

const SCREENS: Array<[string, (fw: ReturnType<typeof createFakeWorkerFactory>) => void]> = [
  ['Start', toStart],
  ['Play', toPlay],
  ['Won', toWon],
  ['Lost', toLost],
];
const config100 = { drainAmount: 100 };

function label(el: Element | null): string {
  if (!el) return 'null';
  return (el.getAttribute('aria-label') || el.textContent || el.tagName).trim();
}

/** Tab through every focusable element from the document start; leaves the editor with Escape. */
async function tabOrder(user: User): Promise<Element[]> {
  (document.activeElement as HTMLElement | null)?.blur();
  const seen: Element[] = [];
  for (let i = 0; i < 30; i++) {
    const before = document.activeElement;
    if (before && before.classList.contains('cm-content')) await user.keyboard('{Escape}');
    await user.tab();
    const el = document.activeElement;
    if (!el || el === document.body || seen.includes(el)) break;
    seen.push(el);
  }
  return seen;
}

afterEach(cleanup);

describe.each(SCREENS)('%s screen landmarks and skip link', (name, goto) => {
  const arrange = () => {
    const ctx = setup(name === 'Lost' ? config100 : {});
    goto(ctx.fw);
    return ctx;
  };

  it('has exactly one header, main, footer and a single h1', () => {
    arrange();
    expect(document.querySelectorAll('header, [role="banner"]')).toHaveLength(1);
    expect(document.querySelectorAll('main, [role="main"]')).toHaveLength(1);
    expect(document.querySelectorAll('footer, [role="contentinfo"]')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('has the Skip_Link as the first tabbable element', async () => {
    const { user } = arrange();
    (document.activeElement as HTMLElement | null)?.blur();
    await user.tab();
    const el = document.activeElement as HTMLElement;
    expect(el.classList.contains('skip-link')).toBe(true);
    expect(el.textContent).toMatch(/^Skip to /);
  });

  it('has no positive tabindex', () => {
    arrange();
    const positive = Array.from(document.querySelectorAll('[tabindex]')).filter(
      (e) => Number(e.getAttribute('tabindex')) > 0,
    );
    expect(positive).toHaveLength(0);
  });

  it('puts the skip link before the mute control before main content in tab order', async () => {
    const { user } = arrange();
    const order = await tabOrder(user);
    expect(order[0].classList.contains('skip-link')).toBe(true);
    const mute = order.findIndex((e) => e.classList.contains('mute-control'));
    if (name === 'Start' || name === 'Play') {
      expect(mute).toBe(1);
      const main = document.querySelector('main')!;
      const mainControls = order.filter((e) => main.contains(e));
      expect(mainControls.length).toBeGreaterThan(0);
      order
        .filter((e) => main.contains(e))
        .forEach((e) => expect(order.indexOf(e)).toBeGreaterThan(mute));
    } else {
      expect(mute).toBe(-1);
    }
  });
});

describe('skip link targets', () => {
  it('Start: Enter moves focus to main, never the editor', async () => {
    const { user } = setup();
    (document.activeElement as HTMLElement).blur();
    await user.tab();
    expect(label(document.activeElement)).toBe('Skip to main content');
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(document.querySelector('main'));
    expect(document.activeElement!.closest('.cm-editor')).toBeNull();
  });

  it('Play: Enter moves focus to the code editor', async () => {
    const { user } = setup();
    toPlay();
    (document.activeElement as HTMLElement).blur();
    await user.tab();
    expect(label(document.activeElement)).toBe('Skip to code editor');
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(document.querySelector('.cm-content'));
  });

  it.each([
    ['Won', 'won'],
    ['Lost', 'lost'],
  ])('%s: Enter moves focus to main, never the editor', async (_n, which) => {
    const { user, fw } = setup(config100);
    if (which === 'won') toWon(fw);
    else toLost();
    (document.activeElement as HTMLElement).blur();
    await user.tab();
    expect(label(document.activeElement)).toBe('Skip to main content');
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(document.querySelector('main'));
    expect(document.querySelector('main')!.id).toBe('main-content');
    expect(document.querySelector('.cm-content')).toBeNull();
  });
});

describe('tab order on Start and Play', () => {
  it('Start: skip, mute, Technical details, Begin', async () => {
    const { user } = setup();
    const order = (await tabOrder(user)).map(label);
    expect(order).toEqual(['Skip to main content', 'Enable sound', 'Technical details', 'Begin']);
  });

  it('Play: skip, mute, editor, Run Tests in reading order', async () => {
    const { user } = setup();
    toPlay();
    const order = await tabOrder(user);
    const names = order.map(label);
    expect(names[0]).toBe('Skip to code editor');
    expect(names[1]).toBe('Enable sound');
    const editor = names.indexOf('Code editor');
    const run = names.indexOf('Run Tests');
    expect(editor).toBeGreaterThan(1);
    expect(run).toBeGreaterThan(editor);
  });
});

describe('test result announcement', () => {
  function observeLive() {
    const live = document.querySelector('.test-panel__live')!;
    const seen: string[] = [];
    const mo = new MutationObserver(() => seen.push(live.textContent ?? ''));
    mo.observe(live, { childList: true, characterData: true, subtree: true });
    return { live, seen, mo };
  }

  it('announces "3 of 5 tests passed" exactly once, not per streamed result', async () => {
    const { fw } = setup();
    toPlay();
    act(() => game.requestRun());
    const w = fw.workers[0];
    const { live, seen, mo } = observeLive();
    emitResult(w, 0, 'pass');
    emitResult(w, 1, 'fail');
    emitResult(w, 2, 'pass');
    emitResult(w, 3, 'fail');
    emitResult(w, 4, 'pass');
    expect(live.textContent).toBe('');
    emitDone(w);
    await act(async () => {
      await Promise.resolve();
    });
    mo.disconnect();
    expect(live.textContent).toBe('3 of 5 tests passed');
    expect(seen.filter((t) => t !== '')).toEqual(['3 of 5 tests passed']);
    expect(live.getAttribute('role')).toBe('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
  });

  it('announces once for a timed-out run too', async () => {
    const { fw } = setup();
    toPlay();
    act(() => game.requestRun());
    const w = fw.workers[0];
    const { live, seen, mo } = observeLive();
    emitResult(w, 0, 'pass');
    emitResult(w, 1, 'pass');
    act(() => game.dispatch({ type: 'RUN_TIMEOUT', ...ids() }));
    await act(async () => {
      await Promise.resolve();
    });
    mo.disconnect();
    expect(live.textContent).toBe('2 of 5 tests passed');
    expect(seen.filter((t) => t !== '')).toEqual(['2 of 5 tests passed']);
  });
});

describe('mute control', () => {
  it('flips label and aria-pressed with a stubbed audio manager', async () => {
    const { user } = setup();
    const btn = () => screen.getByRole('button', { name: /^(Enable|Mute) sound$/ });
    expect(btn().textContent).toBe('Enable sound');
    expect(btn().getAttribute('aria-pressed')).toBe('false');
    await user.click(btn());
    expect(btn().textContent).toBe('Mute sound');
    expect(btn().getAttribute('aria-pressed')).toBe('true');
    await user.click(btn());
    expect(btn().textContent).toBe('Enable sound');
    expect(btn().getAttribute('aria-pressed')).toBe('false');
  });
});

describe('keyboard-only flow', () => {
  it('starts, runs and restarts without a pointer', async () => {
    const { user, fw } = setup();
    // Begin is focused on mount.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Begin' }));
    await user.keyboard('{Enter}');
    expect(game.state.phase).toBe('playing');

    // Reach Run Tests by Tab: skip, mute, editor (Escape releases the trap), Run Tests.
    (document.activeElement as HTMLElement).blur();
    let guard = 0;
    while (document.activeElement?.textContent !== 'Run Tests' && guard++ < 10) {
      if (document.activeElement?.classList.contains('cm-content')) await user.keyboard('{Escape}');
      await user.tab();
    }
    expect(label(document.activeElement)).toBe('Run Tests');
    await user.keyboard('{Enter}');
    expect(fw.workers).toHaveLength(1);
    const w = fw.workers[0];
    CHALLENGE.tests.forEach((_, i) => emitResult(w, i));
    emitDone(w);
    expect(game.state.phase).toBe('won');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('You won');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));

    // Tab to "Look again" and activate it.
    await user.tab();
    expect(label(document.activeElement)).toBe('Look again');
    await user.keyboard('{Enter}');
    expect(game.state.phase).toBe('ready');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Begin' }));
  });

  it('Ctrl+Enter in the editor runs the tests', async () => {
    const { user, fw } = setup();
    toPlay();
    await user.keyboard('{Control>}{Enter}{/Control}'); // focus is on h1, not editor: no run
    expect(fw.workers).toHaveLength(0);
    (document.querySelector('.cm-content') as HTMLElement).focus();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(fw.workers).toHaveLength(1);
  });
});

describe('editor Tab handling', () => {
  it('Escape then Tab leaves the editor and Tab is not prevented', async () => {
    const { user } = setup();
    toPlay();
    const content = document.querySelector('.cm-content') as HTMLElement;
    content.focus();
    expect(document.activeElement).toBe(content);
    await user.keyboard('{Escape}');
    const tab = new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true, cancelable: true });
    content.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    await user.tab();
    expect(document.activeElement).not.toBeNull();
    expect(document.activeElement!.closest('.cm-editor')).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('Tab while armed is consumed by the editor (default prevented, focus stays)', async () => {
    const { user } = setup();
    toPlay();
    const content = document.querySelector('.cm-content') as HTMLElement;
    content.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true, cancelable: true });
    content.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    await user.tab();
    expect(document.activeElement).toBe(content);
  });
});

describe('diff region and limit region', () => {
  it('diff block is focusable, labelled, and scrollable by CSS', () => {
    const { container } = render(<DiffView before={'a\nb'} after={'a\nc'} />);
    const pre = container.querySelector('pre')!;
    expect(pre.getAttribute('tabindex')).toBe('0');
    expect(pre.getAttribute('role')).toBe('region');
    expect(pre.getAttribute('aria-label')).toBe('Code changes (scrollable)');
    const css = readFileSync('src/styles/results.css', 'utf8');
    const rule = css.match(/\.diff-view\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/overflow-x:\s*auto/);
  });

  it('the editor limit message region is polite', () => {
    setup();
    toPlay();
    const limit = document.querySelector('.code-editor__limit')!;
    expect(limit.getAttribute('role')).toBe('status');
    expect(limit.getAttribute('aria-live')).toBe('polite');
  });
});

describe('text accompanies colour indicators', () => {
  it('TestPanel statuses carry visible text', () => {
    const { fw } = setup();
    toPlay();
    expect(Array.from(document.querySelectorAll('.test-panel__status')).map((e) => e.textContent)).toEqual(
      Array(5).fill('not run'),
    );
    act(() => game.requestRun());
    const w = fw.workers[0];
    emitResult(w, 0, 'pass');
    emitResult(w, 1, 'fail');
    emitResult(w, 2, 'error');
    emitResult(w, 3, 'timeout');
    const texts = Array.from(document.querySelectorAll('.test-panel__status')).map((e) => e.textContent!);
    expect(texts[0]).toMatch(/pass/);
    expect(texts[1]).toMatch(/fail/);
    expect(texts[2]).toMatch(/error/);
    expect(texts[3]).toMatch(/timeout/);
    expect(texts[4]).toMatch(/running/);
  });

  it('diff rows carry +/- markers as text', () => {
    const { container } = render(<DiffView before={'a\nold'} after={'a\nnew'} />);
    const markers = Array.from(container.querySelectorAll('.diff-marker')).map((e) => e.textContent!.trim());
    expect(markers).toEqual(['', '-', '+']);
  });

  it('the sanity meter shows a level word', () => {
    setup();
    toPlay();
    expect(document.querySelector('.sanity-meter__level')!.textContent).toMatch(/^(Calm|Uneasy|Distressed|Critical)$/);
  });
});

describe('focus indicator styles', () => {
  it('a11y.css defines :focus-visible with an outline of at least 3px', () => {
    const css = readFileSync('src/styles/a11y.css', 'utf8');
    const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).filter(([, sel]) => sel.includes(':focus-visible'));
    expect(rules.length).toBeGreaterThan(0);
    const widths = rules
      .map(([, , body]) => body.match(/outline:\s*(\d+(?:\.\d+)?)px/)?.[1])
      .filter((w): w is string => w !== undefined)
      .map(Number);
    expect(widths.length).toBeGreaterThan(0);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(3);
  });
});
