import type { GameConfig } from './config';
import type { WarningLevel } from './types';

/** Integer 0..100: NaN => 0, +/-Infinity clamp to 100/0, finite values are truncated then clamped. */
function sanitizeValue(v: number): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0;
  return Math.min(100, Math.max(0, Math.trunc(v)));
}

/** Non-negative integer amount: finite values are truncated; negative/NaN/non-number => 0; +Infinity => 100. */
function sanitizeAmount(a: unknown): number {
  if (typeof a !== 'number' || Number.isNaN(a) || a <= 0) return 0;
  return Math.min(100, Math.trunc(a));
}

/** Subtracts the per-tick drain from `value`; always returns an integer in 0..100. */
export function applyDrain(value: number, cfg: GameConfig): number {
  return sanitizeValue(sanitizeValue(value) - sanitizeAmount(cfg.drainAmount));
}

/** Subtracts the Absence cost from `value`; always returns an integer in 0..100. */
export function applyAbsenceCost(value: number, cfg: GameConfig): number {
  return sanitizeValue(sanitizeValue(value) - sanitizeAmount(cfg.absenceCost));
}

/**
 * Maps a sanity value to its Warning_Level. Returns null for non-integers
 * (including NaN/Infinity) and values outside 0..100; callers keep the previous level.
 */
export function warningLevelFor(value: number, cfg: GameConfig): WarningLevel | null {
  if (!Number.isInteger(value) || value < 0 || value > 100) return null;
  const { calmMin, uneasyMin, distressedMin } = cfg.thresholds;
  if (value >= calmMin) return 'calm';
  if (value >= uneasyMin) return 'uneasy';
  if (value >= distressedMin) return 'distressed';
  return 'critical';
}

export const severity: Record<WarningLevel, number> = {
  calm: 0,
  uneasy: 1,
  distressed: 2,
  critical: 3,
};
