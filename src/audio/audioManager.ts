/**
 * Audio_Manager: synthesizes every sound with the Web Audio API (Req 19.15).
 * No audio files, no external hosts. No DOM globals at module top level; the
 * AudioContext constructor is looked up through globalThis inside enable().
 */

export const MAX_MASTER_VOLUME = 0.5;

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime?(value: number, time: number): unknown;
  exponentialRampToValueAtTime?(value: number, time: number): unknown;
  cancelScheduledValues?(time: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: unknown): unknown;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike;
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: string;
  frequency: AudioParamLike;
  detune?: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: string;
  frequency: AudioParamLike;
}

export interface AudioBufferLike {
  getChannelData(channel: number): Float32Array;
}

export interface BufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop?: boolean;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: unknown;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): BufferSourceNodeLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close?(): Promise<void>;
}

export interface AudioManagerConfig {
  volumeCap: number;
}

export interface AudioManagerDeps {
  createContext?: () => AudioContextLike;
}

export interface AudioManager {
  /** Create/resume the context inside a click handler and unmute. Resolves false on failure. */
  enable(): Promise<boolean>;
  isEnabled(): boolean;
  /** The AudioContext, or null until enable() has created one (Req 19.2). */
  readonly context: AudioContextLike | null;
  /** Master gain level currently configured (<= 0.5). */
  readonly masterVolume: number;
  mute(): void;
  unmute(): Promise<boolean>;
  playWatcherCue(): void;
  setTension(on: boolean): void;
  startAmbient(): void;
  stopAmbient(): void;
  /** Stops cue, tension, and ambient without changing the enabled preference. */
  silenceAll(): void;
  dispose(): void;
}

interface Voice {
  stop(): void;
}

function attempt(fn: () => void): void {
  try {
    fn();
  } catch {
    // Audio failures never surface to the player (Req 19.11).
  }
}

function defaultCreateContext(): AudioContextLike {
  const g = globalThis as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) throw new Error('AudioContext unavailable');
  return new Ctor();
}

export function clampVolume(cap: number): number {
  const n = Number.isFinite(cap) ? cap : MAX_MASTER_VOLUME;
  return Math.min(Math.max(n, 0), MAX_MASTER_VOLUME);
}

export function createAudioManager(
  cfg: AudioManagerConfig,
  deps: AudioManagerDeps = {},
): AudioManager {
  const volume = clampVolume(cfg.volumeCap);
  const createContext = deps.createContext ?? defaultCreateContext;

  let ctx: AudioContextLike | null = null;
  let master: GainNodeLike | null = null;
  let enabled = false;
  let disposed = false;
  let tension: Voice | null = null;
  let ambient: Voice | null = null;
  const cues = new Set<Voice>();

  function ensureContext(): boolean {
    if (ctx && master) return true;
    try {
      const c = createContext();
      const m = c.createGain();
      m.gain.value = 0;
      m.connect(c.destination);
      ctx = c;
      master = m;
      return true;
    } catch {
      ctx = null;
      master = null;
      return false;
    }
  }

  function setMaster(value: number): void {
    if (!ctx || !master) return;
    const m = master;
    const t = ctx.currentTime;
    attempt(() => m.gain.cancelScheduledValues?.(t));
    attempt(() => m.gain.setValueAtTime(value, t));
    attempt(() => {
      m.gain.value = value;
    });
  }

  function makeVoice(nodes: AudioNodeLike[], sources: { stop(when?: number): void }[]): Voice {
    let stopped = false;
    return {
      stop() {
        if (stopped) return;
        stopped = true;
        for (const s of sources) attempt(() => s.stop());
        for (const n of nodes) attempt(() => n.disconnect());
      },
    };
  }

  function noiseBuffer(c: AudioContextLike, seconds: number): AudioBufferLike {
    const len = Math.max(1, Math.floor(c.sampleRate * seconds));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    // Deterministic LCG noise.
    let seed = 0x2f6e2b1;
    for (let i = 0; i < len; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = seed / 0x80000000 - 1;
    }
    return buf;
  }

  function stopTension(): void {
    const v = tension;
    tension = null;
    v?.stop();
  }

  function stopAmbientVoice(): void {
    const v = ambient;
    ambient = null;
    v?.stop();
  }

  function stopCues(): void {
    const all = [...cues];
    cues.clear();
    for (const v of all) v.stop();
  }

  function silenceAll(): void {
    stopTension();
    stopAmbientVoice();
    stopCues();
  }

  function canPlay(): boolean {
    return !disposed && enabled && ctx !== null && master !== null;
  }

  function playWatcherCue(): void {
    if (!canPlay()) return;
    attempt(() => {
      const c = ctx as AudioContextLike;
      const out = master as GainNodeLike;
      const t = c.currentTime;
      const dur = 0.6;

      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, t);
      osc.frequency.exponentialRampToValueAtTime?.(110, t + dur);
      const oscGain = c.createGain();
      oscGain.gain.setValueAtTime(0.6, t);
      oscGain.gain.linearRampToValueAtTime?.(0, t + dur);
      osc.connect(oscGain);
      oscGain.connect(out);

      const noise = c.createBufferSource();
      noise.buffer = noiseBuffer(c, 0.15);
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(900, t);
      const noiseGain = c.createGain();
      noiseGain.gain.setValueAtTime(0.25, t);
      noiseGain.gain.linearRampToValueAtTime?.(0, t + 0.15);
      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(out);

      const voice = makeVoice([osc, oscGain, noise, filter, noiseGain], [osc, noise]);
      cues.add(voice);
      osc.start(t);
      osc.stop(t + dur);
      noise.start(t);
      noise.stop(t + 0.15);
      const g = globalThis as unknown as {
        setTimeout?: (fn: () => void, ms: number) => unknown;
      };
      g.setTimeout?.(() => {
        cues.delete(voice);
        voice.stop();
      }, dur * 1000 + 100);
    });
  }

  function setTension(on: boolean): void {
    if (!on) {
      stopTension();
      return;
    }
    if (!canPlay() || tension) return;
    attempt(() => {
      const c = ctx as AudioContextLike;
      const out = master as GainNodeLike;
      const t = c.currentTime;
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(110, t);
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.35, t);
      const lfo = c.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(0.5, t);
      const lfoDepth = c.createGain();
      lfoDepth.gain.setValueAtTime(0.25, t);
      lfo.connect(lfoDepth);
      lfoDepth.connect(gain.gain);
      osc.connect(gain);
      gain.connect(out);
      const voice = makeVoice([osc, gain, lfo, lfoDepth], [osc, lfo]);
      tension = voice;
      osc.start(t);
      lfo.start(t);
    });
  }

  function startAmbient(): void {
    if (!canPlay() || ambient) return;
    attempt(() => {
      const c = ctx as AudioContextLike;
      const out = master as GainNodeLike;
      const t = c.currentTime;
      const a = c.createOscillator();
      a.type = 'sine';
      a.frequency.setValueAtTime(55, t);
      const b = c.createOscillator();
      b.type = 'sine';
      b.frequency.setValueAtTime(55.4, t);
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(200, t);
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.15, t);
      a.connect(filter);
      b.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      ambient = makeVoice([a, b, filter, gain], [a, b]);
      a.start(t);
      b.start(t);
    });
  }

  function mute(): void {
    enabled = false;
    attempt(() => setMaster(0));
    attempt(silenceAll);
    const c = ctx;
    if (c && c.state !== 'closed') {
      attempt(() => {
        const p = c.suspend() as Promise<void> | undefined;
        p?.catch?.(() => undefined);
      });
    }
  }

  async function enable(): Promise<boolean> {
    if (disposed) return false;
    try {
      if (!ensureContext()) {
        enabled = false;
        return false;
      }
      const c = ctx as AudioContextLike;
      // Unmute synchronously, in the same call as the click handler.
      enabled = true;
      setMaster(volume);
      let p: Promise<void> | undefined;
      try {
        p = c.resume() as Promise<void> | undefined;
      } catch {
        enabled = false;
        setMaster(0);
        return false;
      }
      try {
        await p;
      } catch {
        // Resume failed; stay silent and allow a retry on the next enable().
        if (ctx === c && !disposed) {
          enabled = false;
          setMaster(0);
          attempt(silenceAll);
        }
        return false;
      }
      return enabled && !disposed;
    } catch {
      enabled = false;
      return false;
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    enabled = false;
    attempt(silenceAll);
    attempt(() => setMaster(0));
    const m = master;
    const c = ctx;
    master = null;
    ctx = null;
    if (m) attempt(() => m.disconnect());
    if (c?.close) {
      attempt(() => {
        const p = c.close?.() as Promise<void> | undefined;
        p?.catch?.(() => undefined);
      });
    }
  }

  return {
    enable,
    isEnabled: () => enabled && !disposed,
    get context() {
      return ctx;
    },
    masterVolume: volume,
    mute,
    unmute: enable,
    playWatcherCue,
    setTension,
    startAmbient,
    stopAmbient: stopAmbientVoice,
    silenceAll: () => attempt(silenceAll),
    dispose,
  };
}
