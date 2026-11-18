import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createRegistry } from '../../src/core/registry';

describe('registry', () => {
  it('Property 14: Cleanup callbacks are idempotent and complete', () => {
    // **Validates: Requirements 15.7, 15.9**
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { maxLength: 15 }), // true = release throws
        fc.array(fc.nat(), { maxLength: 60 }), // call sequence (indices, any multiplicity)
        fc.boolean(), // finish with disposeAll
        (throwing, calls, useDisposeAll) => {
          const reg = createRegistry();
          const counts = throwing.map(() => 0);
          const cleanups = throwing.map((t, i) =>
            reg.register(() => {
              counts[i]++;
              if (t) throw new Error('boom');
            }),
          );
          expect(reg.activeCount()).toBe(cleanups.length);

          if (cleanups.length > 0) {
            for (const n of calls) {
              expect(() => cleanups[n % cleanups.length]()).not.toThrow();
            }
          }
          for (const c of counts) expect(c).toBeLessThanOrEqual(1);

          if (useDisposeAll) {
            expect(() => reg.disposeAll()).not.toThrow();
            expect(() => reg.disposeAll()).not.toThrow();
          } else {
            for (const c of cleanups) expect(() => c()).not.toThrow();
          }
          expect(reg.activeCount()).toBe(0);
          expect(counts.every((c) => c === 1)).toBe(true);

          // calling again after completion changes nothing
          for (const c of cleanups) c();
          expect(counts.every((c) => c === 1)).toBe(true);
        },
      ),
    );
  });
});
