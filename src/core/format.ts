export const TRUNCATION_INDICATOR = '… [truncated]';

/** Returns text unchanged when within max; otherwise the first max chars plus a visible indicator. */
export function truncateForDisplay(text: string, max = 500): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + TRUNCATION_INDICATOR;
}

/** Always returns a string. Never throws. Cycle-safe. */
export function serializeValue(value: unknown): string {
  try {
    const ancestors: unknown[] = [];
    const replacer = function (this: unknown, _key: string, v: unknown): unknown {
      if (v === undefined) return '[undefined]';
      if (typeof v === 'bigint') return `${v.toString()}n`;
      if (typeof v === 'function') return '[function]';
      if (typeof v === 'symbol') return v.toString();
      if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
      if (typeof v === 'object' && v !== null) {
        // Maintain the ancestor chain so only true cycles are flagged.
        while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
          ancestors.pop();
        }
        if (ancestors.includes(v)) return '[Circular]';
        ancestors.push(v);
      }
      return v;
    };
    const out = JSON.stringify(value, replacer);
    if (typeof out === 'string') return out;
    return safeString(value);
  } catch {
    return safeString(value);
  }
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[unserializable]';
  }
}

/** Structural equality. NaN equals NaN; handles arrays, plain objects, and cycles. */
export function deepEqual(a: unknown, b: unknown): boolean {
  return eq(a, b, []);
}

function eq(a: unknown, b: unknown, seen: Array<[unknown, unknown]>): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (seen.some(([x, y]) => x === a && y === b)) return true;
  seen.push([a, b]);
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    const x = a as unknown[];
    const y = b as unknown[];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!eq(x[i], y[i], seen)) return false;
    return true;
  }
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(rb, k)) return false;
    if (!eq(ra[k], rb[k], seen)) return false;
  }
  return true;
}
