import { useEffect, useRef } from 'react';
import type { AudioManager } from '../../audio/audioManager';
import { warningLevelFor } from '../../core/sanity';
import type { WarningLevel } from '../../core/types';
import { useGame } from '../GameProvider';

/**
 * Drives the audio manager from game state (Req 19.7, 19.12, 19.13).
 * Call exactly once, inside the provider tree. `getManager` returns the live
 * manager or null; the hook never creates one (only the Mute_Control does).
 */
export function useAudio(getManager: () => AudioManager | null, soundOn: boolean): void {
  const { state, config } = useGame();
  const phase = state.phase;
  const absenceEndSeq = state.round?.absenceEndSeq ?? 0;

  // Keep the previous level when the sanity value is unusable.
  const levelRef = useRef<WarningLevel>('calm');
  const raw = warningLevelFor(state.sanity.value, config);
  if (raw !== null) levelRef.current = raw;
  const level = levelRef.current;

  // Watcher cue: once per ended Absence while playing.
  const seenSeq = useRef(absenceEndSeq);
  useEffect(() => {
    const prev = seenSeq.current;
    seenSeq.current = absenceEndSeq;
    if (absenceEndSeq > prev && phase === 'playing' && soundOn) {
      getManager()?.playWatcherCue();
    }
  }, [absenceEndSeq, phase, soundOn, getManager]);

  // Looping tension sound while critical.
  const tensionOn = soundOn && phase === 'playing' && level === 'critical';
  useEffect(() => {
    if (!tensionOn) return undefined;
    getManager()?.setTension(true);
    return () => {
      getManager()?.setTension(false);
    };
  }, [tensionOn, getManager]);

  // Quiet ambient bed while playing.
  const ambientOn = soundOn && phase === 'playing';
  useEffect(() => {
    if (!ambientOn) return undefined;
    getManager()?.startAmbient();
    return () => {
      getManager()?.stopAmbient();
    };
  }, [ambientOn, getManager]);

  // Round ended or restarted: silence everything.
  useEffect(() => {
    if (phase !== 'playing') getManager()?.silenceAll();
  }, [phase, getManager]);
}
