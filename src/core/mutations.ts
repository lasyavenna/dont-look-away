import type { MutationRecord, SkippedRecord } from './types';

export interface CandidateMutation {
  id: string; // 1..64 chars
  description: string; // 1..200 chars; shown on Results only
  target: string; // exact substring
  transform: (code: string) => string; // pure
}

export type AttemptResult =
  | { kind: 'applied'; record: MutationRecord; skipped: SkippedRecord[] }
  | { kind: 'none'; skipped: SkippedRecord[] } // all skipped
  | { kind: 'cancelled'; skipped: SkippedRecord[] }; // snapshot store failed

export const replaceFirst =
  (target: string, replacement: string) =>
  (code: string): string => {
    const i = code.indexOf(target);
    return i < 0 ? code : code.slice(0, i) + replacement + code.slice(i + target.length);
  };

export const CANDIDATES: readonly CandidateMutation[] = [
  {
    id: 'off-by-one',
    description: 'The Watcher shortened the loop by one step.',
    target: 'i < candles.length',
    transform: replaceFirst('i < candles.length', 'i < candles.length - 1'),
  },
  {
    id: 'flipped-comparison',
    description: 'The Watcher turned the brightest candle into the dimmest.',
    target: 'candles[i] >',
    transform: replaceFirst('candles[i] >', 'candles[i] <'),
  },
  {
    id: 'lost-name',
    description: 'The Watcher renamed what you were holding onto, and left a note.',
    target: 'let best = -1;',
    transform: replaceFirst('let best = -1;', 'let beast = -1; // the light is not yours'),
  },
];

export function attemptMutation(
  code: string,
  candidates: readonly CandidateMutation[],
  save: (s: string) => boolean,
  maxLength: number,
): AttemptResult {
  const skipped: SkippedRecord[] = [];
  for (const c of candidates) {
    if (!code.includes(c.target)) {
      skipped.push({ id: c.id, reason: 'target-missing' });
      continue;
    }
    let out: string;
    try {
      out = c.transform(code);
    } catch {
      skipped.push({ id: c.id, reason: 'transform-failed' });
      continue;
    }
    if (typeof out !== 'string') {
      skipped.push({ id: c.id, reason: 'transform-failed' });
      continue;
    }
    if (out === code) {
      skipped.push({ id: c.id, reason: 'no-change' });
      continue;
    }
    if (out.length > maxLength) {
      skipped.push({ id: c.id, reason: 'size-limit' });
      continue;
    }
    let saved: boolean;
    try {
      saved = save(code) === true;
    } catch {
      saved = false;
    }
    if (!saved) return { kind: 'cancelled', skipped };
    return {
      kind: 'applied',
      record: { id: c.id, description: c.description, snapshot: code, resultingCode: out },
      skipped,
    };
  }
  return { kind: 'none', skipped };
}
