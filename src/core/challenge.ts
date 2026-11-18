export interface TestCase {
  name: string;
  args: unknown[];
  expected: unknown;
}

export interface Challenge {
  description: string;
  functionName: string;
  starterCode: string;
  tests: readonly TestCase[];
}

// Starter code is data only; it is never evaluated when this module loads.
const STARTER_CODE = `// The candles remember who burned brightest.
// Return the index of the brightest candle. Ties go to the first one.
// No candles? Return -1.
function brightestCandle(candles) {
  let best = -1;
  for (let i = 0; i < candles.length; i++) {
    if (best === -1 || candles[i] >= candles[best]) {
      best = i;
    }
  }
  return best;
}
`;

export const CHALLENGE: Challenge = {
  description:
    'The candles remember who burned brightest. Return the index of the brightest candle in the list. If two candles burn equally bright, the first one wins. If there are no candles, return -1.',
  functionName: 'brightestCandle',
  starterCode: STARTER_CODE,
  tests: [
    { name: 'no candles', args: [[]], expected: -1 },
    { name: 'a single flame', args: [[7]], expected: 0 },
    { name: 'brightest in the middle', args: [[2, 9, 4]], expected: 1 },
    { name: 'brightest at the end', args: [[2, 4, 9]], expected: 2 },
    { name: 'ties go to the first candle', args: [[5, 8, 8, 3]], expected: 1 },
  ],
};

// Room two uses a separate function and fixtures. Both rooms share the same game rules.
export const SECOND_CHALLENGE: Challenge = {
  description: 'Seal the door. Return the number of seconds until the last candle goes dark. The candles burn together, so use the longest duration. An empty room goes dark immediately.',
  functionName: 'secondsUntilDark',
  starterCode: `// The door opens when the last flame dies.
// Candles burn at the same time. Return the longest duration.
// An empty room takes 0 seconds.
function secondsUntilDark(candles) {
  let seconds = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i] > seconds) {
      seconds = candles[i];
    }
  }
  return seconds;
}
`,
  tests: [
    { name: 'an empty room', args: [[]], expected: 0 },
    { name: 'one fading flame', args: [[4]], expected: 4 },
    { name: 'the middle candle lingers', args: [[2, 9, 3]], expected: 9 },
    { name: 'the final candle lingers', args: [[1, 3, 8]], expected: 8 },
    { name: 'all flames already out', args: [[0, 0]], expected: 0 },
  ],
};

export const ROOMS = [
  { name: 'The Candle Room', challenge: CHALLENGE },
  { name: 'The Last Flame', challenge: SECOND_CHALLENGE },
] as const;

export function roomAt(index: number) {
  return ROOMS[index] ?? ROOMS[0];
}
