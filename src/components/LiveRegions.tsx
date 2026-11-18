import type { ReactNode } from 'react';

/** Shared visually-hidden polite status region. Use at most once per announcement. */
export function PoliteRegion({ id, children }: { id?: string; children?: ReactNode }) {
  return (
    <div id={id} role="status" aria-live="polite" className="visually-hidden">
      {children}
    </div>
  );
}
