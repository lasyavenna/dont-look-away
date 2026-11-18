export interface GameConfig {
  drainIntervalMs: number;
  drainAmount: number;
  absenceCost: number;
  thresholds: { calmMin: number; uneasyMin: number; distressedMin: number };
  runTimeoutMs: number;
  editorMaxLength: number;
  noticedDurationMs: number;
  volumeCap: number;
  testCountMin: number;
  testCountMax: number;
  candidateOrder: readonly string[];
}

export const DEFAULT_CONFIG: GameConfig = {
  drainIntervalMs: 2000,
  drainAmount: 1,
  absenceCost: 10,
  thresholds: { calmMin: 71, uneasyMin: 41, distressedMin: 21 },
  runTimeoutMs: 3000,
  editorMaxLength: 100_000,
  noticedDurationMs: 3000,
  volumeCap: 0.5,
  testCountMin: 4,
  testCountMax: 8,
  candidateOrder: ['off-by-one', 'flipped-comparison', 'lost-name'],
};

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** Finite integer within min..max, else fallback (no rounding or clamping). */
function strictInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return fallback;
  return v;
}

function isPermutation(order: unknown, ids: readonly string[]): order is string[] {
  if (!Array.isArray(order) || order.length !== ids.length) return false;
  const seen = new Set<unknown>(order);
  return seen.size === ids.length && ids.every((id) => seen.has(id));
}

export function normalizeConfig(partial: Partial<GameConfig> = {}): GameConfig {
  const d = DEFAULT_CONFIG;
  const p: Partial<GameConfig> = partial && typeof partial === 'object' ? partial : {};

  const t = (p.thresholds ?? {}) as Partial<GameConfig['thresholds']>;
  const calmMin = t.calmMin;
  const uneasyMin = t.uneasyMin;
  const distressedMin = t.distressedMin;
  let thresholds = { ...d.thresholds };
  if (
    Number.isInteger(calmMin) &&
    Number.isInteger(uneasyMin) &&
    Number.isInteger(distressedMin) &&
    (distressedMin as number) > 0 &&
    (distressedMin as number) < (uneasyMin as number) &&
    (uneasyMin as number) < (calmMin as number) &&
    (calmMin as number) <= 100
  ) {
    thresholds = {
      calmMin: calmMin as number,
      uneasyMin: uneasyMin as number,
      distressedMin: distressedMin as number,
    };
  }

  let testCountMin = clampInt(p.testCountMin, 1, 20, d.testCountMin);
  let testCountMax = clampInt(p.testCountMax, 1, 20, d.testCountMax);
  if (testCountMin > testCountMax) {
    testCountMin = d.testCountMin;
    testCountMax = d.testCountMax;
  }

  return {
    drainIntervalMs: clampNum(p.drainIntervalMs, 100, 60_000, d.drainIntervalMs),
    drainAmount: strictInt(p.drainAmount, 0, 100, d.drainAmount),
    absenceCost: strictInt(p.absenceCost, 0, 100, d.absenceCost),
    thresholds,
    runTimeoutMs: clampNum(p.runTimeoutMs, 200, 30_000, d.runTimeoutMs),
    editorMaxLength: clampInt(p.editorMaxLength, 1000, 1_000_000, d.editorMaxLength),
    noticedDurationMs: clampNum(p.noticedDurationMs, 200, 30_000, d.noticedDurationMs),
    volumeCap: clampNum(p.volumeCap, 0, 0.5, d.volumeCap),
    testCountMin,
    testCountMax,
    candidateOrder: isPermutation(p.candidateOrder, d.candidateOrder)
      ? [...p.candidateOrder]
      : [...d.candidateOrder],
  };
}

function parseNumber(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Pure: parses a query string (e.g. "?drainMs=500") over `base`. Never reads `location`. */
export function parseConfigOverrides(search: string, base: GameConfig): GameConfig {
  const overrides: Partial<GameConfig> = {};
  try {
    const params = new URLSearchParams(typeof search === 'string' ? search : '');
    const num = (key: string, apply: (n: number) => void): void => {
      const raw = params.get(key);
      if (raw === null) return;
      const n = parseNumber(raw);
      if (n !== undefined) apply(n);
    };
    num('drainMs', (n) => { overrides.drainIntervalMs = n; });
    num('drainAmount', (n) => { overrides.drainAmount = n; });
    num('absenceCost', (n) => { overrides.absenceCost = n; });
    num('runTimeoutMs', (n) => { overrides.runTimeoutMs = n; });
    num('noticedMs', (n) => { overrides.noticedDurationMs = n; });
    num('editorMax', (n) => { overrides.editorMaxLength = n; });
    num('volume', (n) => { overrides.volumeCap = n; });
    const order = params.get('order');
    if (order !== null) {
      overrides.candidateOrder = order.split(',').map((s) => s.trim());
    }
  } catch {
    // fall through with whatever was parsed
  }
  return normalizeConfig({ ...base, ...overrides });
}
