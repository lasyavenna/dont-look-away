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
