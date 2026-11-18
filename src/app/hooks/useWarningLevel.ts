import { useLayoutEffect, useRef } from 'react';
import { useGame } from '../GameProvider';
import { warningLevelFor } from '../../core/sanity';
import type { WarningLevel } from '../../core/types';

/** Visible label shown next to the meter for each level. */
export const LEVEL_LABEL: Record<WarningLevel, string> = {
  calm: 'Calm',
  uneasy: 'Uneasy',
  distressed: 'Distressed',
  critical: 'Critical',
};

/** Warning text per level (calm has none). Announced via the polite live region. */
export const LEVEL_TEXT: Record<WarningLevel, string> = {
  calm: '',
  uneasy: 'Uneasy',
  distressed: 'It is watching your hands.',
  critical: 'Do not look away.',
};

/**
 * Current Warning_Level from state.sanity.value. Keeps the previous level when
 * the value is invalid (warningLevelFor returns null). While phase === 'playing'
 * mirrors the level to <html data-level>; removes it otherwise and on unmount.
 */
export function useWarningLevel(): WarningLevel {
  const { state, config } = useGame();
  const last = useRef<WarningLevel>('calm');
  const next = warningLevelFor(state.sanity.value, config);
  const level = next ?? last.current;
  last.current = level;
  const playing = state.phase === 'playing';

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (playing) root.dataset.level = level;
    else delete root.dataset.level;
    return () => {
      delete root.dataset.level;
    };
  }, [level, playing]);

  return level;
}
