// Test-only fixture. Never imported by anything under src/.
// Identical to the starter code except `>` instead of `>=`.
export const REFERENCE_SOLUTION = `// The candles remember who burned brightest.
// Return the index of the brightest candle. Ties go to the first one.
// No candles? Return -1.
function brightestCandle(candles) {
  let best = -1;
  for (let i = 0; i < candles.length; i++) {
    if (best === -1 || candles[i] > candles[best]) {
      best = i;
    }
  }
  return best;
}
`;
