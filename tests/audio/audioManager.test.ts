import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudioManager, MAX_MASTER_VOLUME } from '../../src/audio/audioManager';
import type { AudioContextLike } from '../../src/audio/audioManager';

interface FakeNode {
  kind: string;
  started: number;
  stopped: number;
  disconnected: number;
  gain: { value: number; setValueAtTime: (v: number, t: number) => void };
  frequency: { value: number; setValueAtTime: (v: number, t: number) => void };
  type: string;
  buffer: unknown;
  connect: (d: unknown) => void;
  disconnect: () => void;
  start: () => void;
  stop: () => void;
}

function param() {
  const p = { value: 0, setValueAtTime: (v: number) => void (p.value = v) };
  return p;
}

function makeFake(opts: { resumeRejects?: boolean } = {}) {
  const nodes: FakeNode[] = [];
  const node = (kind: string): FakeNode => {
    const n: FakeNode = {
      kind,
      started: 0,
      stopped: 0,
      disconnected: 0,
      gain: param(),
      frequency: param(),
      type: '',
      buffer: null,
      connect: () => undefined,
      disconnect: () => void n.disconnected++,
      start: () => void n.started++,
      stop: () => void n.stopped++,
    };
    nodes.push(n);
    return n;
  };
  const state = { resumeRejects: opts.resumeRejects ?? false, resumeCalls: 0, suspendCalls: 0, closeCalls: 0, state: 'suspended' };
  const ctx = {
    currentTime: 0,
    sampleRate: 100,
    get state() {
      return state.state;
    },
    destination: {},
    createGain: () => node('gain'),
    createOscillator: () => node('osc'),
    createBiquadFilter: () => node('filter'),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => node('buffer'),
    resume: () => {
      state.resumeCalls++;
      if (state.resumeRejects) return Promise.reject(new Error('blocked'));
      state.state = 'running';
      return Promise.resolve();
    },
    suspend: () => {
      state.suspendCalls++;
      state.state = 'suspended';
      return Promise.resolve();
    },
    close: () => {
      state.closeCalls++;
      return Promise.resolve();
    },
  } as unknown as AudioContextLike;
  const sources = () => nodes.filter((n) => n.kind === 'osc' || n.kind === 'buffer');
  const master = () => nodes[0];
  return { ctx, nodes, state, sources, master };
}

afterEach(() => vi.useRealTimers());

describe('audioManager', () => {
  it('creates no context until enable() and plays nothing before then', () => {
    const create = vi.fn(() => makeFake().ctx);
    const m = createAudioManager({ volumeCap: 0.3 }, { createContext: create });
    m.playWatcherCue();
    m.setTension(true);
    m.startAmbient();
    expect(create).not.toHaveBeenCalled();
    expect(m.context).toBeNull();
    expect(m.isEnabled()).toBe(false);
  });

  it('enable() creates one context, resumes it and sets master gain to the cap', async () => {
    const f = makeFake();
    const create = vi.fn(() => f.ctx);
    const m = createAudioManager({ volumeCap: 0.3 }, { createContext: create });
    await expect(m.enable()).resolves.toBe(true);
    await m.enable();
    expect(create).toHaveBeenCalledTimes(1);
    expect(f.state.resumeCalls).toBe(2);
    expect(m.isEnabled()).toBe(true);
    expect(f.master().gain.value).toBe(0.3);
  });

  it('never lets the master gain exceed 0.5', async () => {
    for (const cap of [5, Infinity, 0.51]) {
      const f = makeFake();
      const m = createAudioManager({ volumeCap: cap }, { createContext: () => f.ctx });
      await m.enable();
      expect(f.master().gain.value).toBeLessThanOrEqual(MAX_MASTER_VOLUME);
      expect(m.masterVolume).toBeLessThanOrEqual(0.5);
    }
  });

  it('mute() zeroes gain, stops and disconnects every source, and suspends the context', async () => {
    const f = makeFake();
    const m = createAudioManager({ volumeCap: 0.5 }, { createContext: () => f.ctx });
    await m.enable();
    m.playWatcherCue();
    m.setTension(true);
    m.startAmbient();
    expect(f.sources().length).toBeGreaterThan(0);
    m.mute();
    expect(m.isEnabled()).toBe(false);
    expect(f.master().gain.value).toBe(0);
    expect(f.state.suspendCalls).toBe(1);
    for (const s of f.sources()) {
      expect(s.stopped).toBeGreaterThan(0);
      expect(s.disconnected).toBeGreaterThan(0);
    }
    // After mute nothing new plays.
    const count = f.nodes.length;
    m.playWatcherCue();
    m.setTension(true);
    expect(f.nodes.length).toBe(count);
    // Enable works again.
    await expect(m.enable()).resolves.toBe(true);
    expect(f.master().gain.value).toBe(0.5);
    m.playWatcherCue();
    expect(f.nodes.length).toBeGreaterThan(count);
  });

  it('setTension(true) loops once and setTension(false) stops it', async () => {
    const f = makeFake();
    const m = createAudioManager({ volumeCap: 0.5 }, { createContext: () => f.ctx });
    await m.enable();
    m.setTension(true);
    m.setTension(true);
    const osc = f.sources();
    expect(osc).toHaveLength(2);
    expect(osc.every((o) => o.started === 1 && o.stopped === 0)).toBe(true);
    m.setTension(false);
    expect(osc.every((o) => o.stopped === 1)).toBe(true);
  });

  it('silenceAll() stops cue, tension and ambient but keeps the preference', async () => {
    const f = makeFake();
    const m = createAudioManager({ volumeCap: 0.5 }, { createContext: () => f.ctx });
    await m.enable();
    m.playWatcherCue();
    m.setTension(true);
    m.startAmbient();
    m.silenceAll();
    expect(f.sources().every((s) => s.stopped > 0)).toBe(true);
    expect(m.isEnabled()).toBe(true);
  });

  it('plays the cue and removes it after its duration', async () => {
    vi.useFakeTimers();
    const f = makeFake();
    const m = createAudioManager({ volumeCap: 0.5 }, { createContext: () => f.ctx });
    await m.enable();
    m.playWatcherCue();
    const before = f.sources().map((s) => s.disconnected);
    expect(before.every((d) => d === 0)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(f.sources().every((s) => s.disconnected > 0)).toBe(true);
  });

  it('survives a constructor that throws and allows retry', async () => {
    const f = makeFake();
    let fail = true;
    const m = createAudioManager({ volumeCap: 0.5 }, {
      createContext: () => {
        if (fail) throw new Error('no audio');
        return f.ctx;
      },
    });
    await expect(m.enable()).resolves.toBe(false);
    expect(m.isEnabled()).toBe(false);
    expect(() => m.playWatcherCue()).not.toThrow();
    fail = false;
    await expect(m.enable()).resolves.toBe(true);
  });

  it('handles resume() rejection: false, silent, and retry succeeds', async () => {
    const f = makeFake({ resumeRejects: true });
    const m = createAudioManager({ volumeCap: 0.5 }, { createContext: () => f.ctx });
    await expect(m.enable()).resolves.toBe(false);
    expect(m.isEnabled()).toBe(false);
    expect(f.master().gain.value).toBe(0);
    m.playWatcherCue();
    expect(f.sources()).toHaveLength(0);
    f.state.resumeRejects = false;
    await expect(m.enable()).resolves.toBe(true);
    expect(m.isEnabled()).toBe(true);
    expect(f.master().gain.value).toBe(0.5);
  });

  it('dispose() silences, closes the context and disables', async () => {
    const f = makeFake();
    const m = createAudioManager({ volumeCap: 0.5 }, { createContext: () => f.ctx });
    await m.enable();
    m.startAmbient();
    m.dispose();
    expect(f.state.closeCalls).toBe(1);
    expect(f.sources().every((s) => s.stopped > 0)).toBe(true);
    expect(m.isEnabled()).toBe(false);
    await expect(m.enable()).resolves.toBe(false);
  });
});
