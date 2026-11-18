import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createAudioManager } from '../audio/audioManager';
import type { AudioManager } from '../audio/audioManager';
import { useGame } from './GameProvider';
import { useAudio } from './hooks/useAudio';

export interface SoundContextValue {
  soundOn: boolean;
  /** Enables sound (inside the click handler) or mutes it. */
  toggleSound(): void;
}

const SoundContext = createContext<SoundContextValue | null>(null);

const OFF: SoundContextValue = { soundOn: false, toggleSound: () => undefined };

export interface AudioProviderProps {
  /** Injectable for tests; defaults to createAudioManager. */
  createManager?: (cfg: { volumeCap: number }) => AudioManager;
  children?: ReactNode;
}

/**
 * Holds the in-memory sound preference above the screens (survives RESTART).
 * Starts off on every page load and is never persisted (Req 19.1, 19.8, 19.9).
 */
export function AudioProvider({ createManager = createAudioManager, children }: AudioProviderProps) {
  const { config } = useGame();
  const [soundOn, setSoundOn] = useState(false);
  const managerRef = useRef<AudioManager | null>(null);
  const factoryRef = useRef(createManager);
  factoryRef.current = createManager;
  const volumeCap = config.volumeCap;

  const getManager = useCallback(() => managerRef.current, []);

  // The manager is created lazily on the first Enable click; recreated after a dispose.
  const ensure = useCallback((): AudioManager | null => {
    if (!managerRef.current) {
      try {
        managerRef.current = factoryRef.current({ volumeCap });
      } catch {
        managerRef.current = null;
      }
    }
    return managerRef.current;
  }, [volumeCap]);

  useEffect(
    () => () => {
      const m = managerRef.current;
      managerRef.current = null;
      m?.dispose();
    },
    [],
  );

  const toggleSound = useCallback(() => {
    if (soundOn) {
      managerRef.current?.mute();
      setSoundOn(false);
      return;
    }
    const m = ensure();
    if (!m) return;
    let p: Promise<boolean>;
    try {
      p = m.enable(); // synchronous part runs in the user gesture
    } catch {
      return;
    }
    p.then(
      (ok) => {
        if (managerRef.current === m) setSoundOn(ok && m.isEnabled());
      },
      () => {
        if (managerRef.current === m) setSoundOn(false);
      },
    );
  }, [soundOn, ensure]);

  useAudio(getManager, soundOn);

  const value = useMemo(() => ({ soundOn, toggleSound }), [soundOn, toggleSound]);
  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

/** Outside an AudioProvider, sound is permanently off and the toggle does nothing. */
export function useSound(): SoundContextValue {
  return useContext(SoundContext) ?? OFF;
}
