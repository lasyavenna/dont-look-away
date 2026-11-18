import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../../src/App';
import { AudioProvider } from '../../src/app/AudioProvider';
import { GameProvider, useGame } from '../../src/app/GameProvider';
import type { GameContextValue } from '../../src/app/GameProvider';
import { createAudioManager } from '../../src/audio/audioManager';
import { CHALLENGE } from '../../src/core/challenge';
import { normalizeConfig } from '../../src/core/config';
import type { GameConfig } from '../../src/core/config';
import { createFakeWorkerFactory } from '../helpers/fakeWorker';
import type { FakeWorkerFactory } from '../helpers/fakeWorker';

if (typeof Range !== 'undefined') {
  const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects ??= (() => [] as unknown as DOMRectList) as never;
  Range.prototype.getBoundingClientRect ??= (() => rect as DOMRect) as never;
}

interface FakeNode {
  kind: string;
  started: number;
  stopped: number;
  disconnected: number;
  gain: { value: number; setValueAtTime: (v: number) => void };
  frequency: { value: number; setValueAtTime: (v: number) => void };
}

const env = {
  constructed: 0,
  throwOnConstruct: false,
  resumeRejects: false,
  nodes: [] as FakeNode[],
  suspendCalls: 0,
  state: 'suspended',
};

function param() {
  const p = { value: 0, setValueAtTime: (v: number) => void (p.value = v) };
  return p;
}
function makeNode(kind: string) {
  const n = {
    kind,
    started: 0,
    stopped: 0,
    disconnected: 0,
    gain: param(),
    frequency: param(),
    type: '',
    buffer: null as unknown,
    connect: () => undefined,
    disconnect: () => void n.disconnected++,
    start: () => void n.started++,
    stop: () => void n.stopped++,
  };
  env.nodes.push(n);
  return n;
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 100;
  destination = {};
  get state() {
    return env.state;
  }
  constructor() {
    env.constructed++;
    if (env.throwOnConstruct) throw new Error('no audio');
  }
  createGain = () => makeNode('gain');
  createOscillator = () => makeNode('osc');
  createBiquadFilter = () => makeNode('filter');
  createBuffer = (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) });
  createBufferSource = () => makeNode('buffer');
  resume = () => {
    if (env.resumeRejects) return Promise.reject(new Error('blocked'));
    env.state = 'running';
    return Promise.resolve();
  };
  suspend = () => {
    env.suspendCalls++;
    env.state = 'suspended';
    return Promise.resolve();
  };
  close = () => Promise.resolve();
}

let visibility: 'visible' | 'hidden' = 'visible';
let game: GameContextValue;
function Probe(): ReactNode {
  game = useGame();
  return null;
}

const SLOW = normalizeConfig({ drainIntervalMs: 60_000 });
let fake: FakeWorkerFactory;

function mount(config: GameConfig = SLOW, opts: { strict?: boolean; volumeCap?: number } = {}) {
  fake = createFakeWorkerFactory();
  const tree = (
    <GameProvider config={config} workerFactory={fake.factory}>
      <Probe />
      <AudioProvider
        createManager={opts.volumeCap === undefined ? undefined : (c) => createAudioManager({ volumeCap: opts.volumeCap ?? c.volumeCap })}
      >
        <App />
      </AudioProvider>
    </GameProvider>
  );
  return render(opts.strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const soundBtn = () => screen.getByRole('button', { name: /^(Enable|Mute) sound$/ });
const click = async (name: string) => {
  await act(async () => void fireEvent.click(screen.getByRole('button', { name })));
};
const enableSound = () => click('Enable sound');
const expectOn = () => {
  expect(soundBtn().textContent).toBe('Mute sound');
  expect(soundBtn().getAttribute('aria-pressed')).toBe('true');
};
const expectOff = () => {
  expect(soundBtn().textContent).toBe('Enable sound');
  expect(soundBtn().getAttribute('aria-pressed')).toBe('false');
};
const masterGain = () => env.nodes.find((n) => n.kind === 'gain');
const sources = () => env.nodes.filter((n) => n.kind === 'osc' || n.kind === 'buffer');
const liveSources = () => sources().filter((n) => n.started > 0 && n.stopped === 0);
const cueCount = () => env.nodes.filter((n) => n.kind === 'buffer' && n.started > 0).length;

function winRound() {
  const w = fake.workers[fake.workers.length - 1];
  const run = game.store.getState().run!;
  const ids = { roundId: run.roundId, runId: run.runId };
  CHALLENGE.tests.forEach((_, index) =>
    act(() =>
      w.emit({
        type: 'result',
        ...ids,
        result: { index, status: 'pass', message: '', expectedText: 'x', actualText: 'x' },
      }),
    ),
  );
  act(() => w.emit({ type: 'done', ...ids, count: CHALLENGE.tests.length }));
}
async function playToWin() {
  await click('Begin');
  await click('Run Tests');
  winRound();
  expect(game.store.getState().phase).toBe('won');
}
function setVisibility(v: 'visible' | 'hidden') {
  visibility = v;
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
}
function tabSwitch() {
  setVisibility('hidden');
  setVisibility('visible');
}
const drain = () =>
  act(() => game.dispatch({ type: 'DRAIN_TICK', roundId: game.store.getActiveRoundId() as number }));

beforeEach(() => {
  env.constructed = 0;
  env.throwOnConstruct = false;
  env.resumeRejects = false;
  env.nodes = [];
  env.suspendCalls = 0;
  env.state = 'suspended';
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  (globalThis as unknown as Record<string, unknown>).AudioContext = FakeAudioContext;
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (globalThis as unknown as Record<string, unknown>).AudioContext;
  delete (document as unknown as Record<string, unknown>).visibilityState;
});

describe('audio: lazy creation and enabling', () => {
  it('constructs no AudioContext on load or Begin, and exactly one on Enable sound', async () => {
    mount();
    expect(env.constructed).toBe(0);
    expectOff();
    await click('Begin');
    expect(env.constructed).toBe(0);
    await enableSound();
    expect(env.constructed).toBe(1);
    expectOn();
  });

  it('one click enables; muting silences everything and a following Enable works', async () => {
    mount();
    await click('Begin');
    await enableSound();
    expectOn();
    expect(masterGain()!.gain.value).toBeGreaterThan(0);
    expect(liveSources().length).toBeGreaterThan(0); // ambient

    await click('Mute sound');
    expectOff();
    expect(masterGain()!.gain.value).toBe(0);
    expect(liveSources()).toHaveLength(0);
    expect(sources().every((s) => s.disconnected > 0)).toBe(true);
    expect(env.state).toBe('suspended');

    await enableSound();
    expectOn();
    expect(env.constructed).toBe(1);
    expect(masterGain()!.gain.value).toBeGreaterThan(0);
  });

  it('caps master gain at 0.5 even with volumeCap 5', async () => {
    mount(SLOW, { volumeCap: 5 });
    await enableSound();
    expect(masterGain()!.gain.value).toBeLessThanOrEqual(0.5);
    expect(masterGain()!.gain.value).toBeGreaterThan(0);
  });
});

describe('audio: no persistence', () => {
  it('stored values do not enable sound', async () => {
    for (const key of ['soundOn', 'sound', 'audio', 'muted']) {
      localStorage.setItem(key, 'true');
      sessionStorage.setItem(key, 'true');
    }
    mount();
    expectOff();
    await click('Begin');
    expectOff();
    expect(env.constructed).toBe(0);
  });

  it('never calls Storage.setItem when enabling, muting or restarting', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    mount();
    await enableSound();
    await click('Mute sound');
    await enableSound();
    await click('Begin');
    await click('Run Tests');
    winRound();
    await click('Look again');
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps the preference across restart in memory, and is off after remount', async () => {
    const first = mount();
    await enableSound();
    await playToWin();
    await click('Look again');
    expect(game.store.getState().phase).toBe('ready');
    expectOn();
    await click('Begin');
    expectOn();
    first.unmount();
    mount();
    expectOff();
    expect(env.constructed).toBe(1);
  });
});

describe('audio: failures stay silent', () => {
  it('a throwing AudioContext constructor leaves gameplay working and the button off', async () => {
    env.throwOnConstruct = true;
    mount();
    await enableSound();
    expectOff();
    expect(screen.queryByRole('alert')).toBeNull();
    await click('Begin');
    expect(game.store.getState().phase).toBe('playing');
    expectOff();
    await click('Run Tests');
    winRound();
    expect(game.store.getState().phase).toBe('won');
  });

  it('a rejecting resume() keeps the button off, and the next Enable retries', async () => {
    env.resumeRejects = true;
    mount();
    await click('Begin');
    await enableSound();
    expectOff();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(masterGain()!.gain.value).toBe(0);
    expect(game.store.getState().phase).toBe('playing');
    env.resumeRejects = false;
    await enableSound();
    expectOn();
  });
});

describe('audio: gameplay sounds', () => {
  it('plays the Watcher cue once per Absence end, only when sound is on', async () => {
    mount();
    await click('Begin');
    tabSwitch();
    expect(env.constructed).toBe(0);
    expect(cueCount()).toBe(0);

    await enableSound();
    tabSwitch();
    expect(cueCount()).toBe(1);
    setVisibility('hidden');
    expect(cueCount()).toBe(1);
    setVisibility('visible');
    expect(cueCount()).toBe(2);

    await click('Mute sound');
    tabSwitch();
    expect(cueCount()).toBe(2);
  });

  it('starts the tension loop at critical; stops it on mute and on round end', async () => {
    const cfg = normalizeConfig({ drainIntervalMs: 60_000, drainAmount: 80 });
    mount(cfg);
    await click('Begin');
    await enableSound();
    const tensionOsc = () => liveSources().filter((s) => s.frequency.value === 110 || s.frequency.value === 0.5);
    expect(tensionOsc()).toHaveLength(0);
    drain(); // 100 -> 20: critical
    expect(game.store.getState().sanity.value).toBe(20);
    expect(tensionOsc()).toHaveLength(2);

    await click('Mute sound');
    expect(liveSources()).toHaveLength(0);
    await enableSound();
    expect(tensionOsc()).toHaveLength(2);

    drain(); // lost
    expect(game.store.getState().phase).toBe('lost');
    expect(liveSources()).toHaveLength(0);
  });

  it('stops gameplay sounds when the round is won, and does not start tension outside critical', async () => {
    mount();
    await click('Begin');
    await enableSound();
    expect(liveSources().length).toBeGreaterThan(0);
    await click('Run Tests');
    winRound();
    expect(liveSources()).toHaveLength(0);
    await click('Look again'); // results screen has no mute control
    expectOn();
  });

  it('works under StrictMode with one context', async () => {
    mount(SLOW, { strict: true });
    await enableSound();
    expect(env.constructed).toBe(1);
    expectOn();
  });
});
