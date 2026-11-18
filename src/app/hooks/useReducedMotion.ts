import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function getMql(): MediaQueryList | null {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
    return window.matchMedia(QUERY) ?? null;
  } catch {
    return null;
  }
}

function getSnapshot(): boolean {
  const mql = getMql();
  return mql ? mql.matches : true;
}

function getServerSnapshot(): boolean {
  return true;
}

function subscribe(onChange: () => void): () => void {
  const mql = getMql();
  if (!mql) return () => {};
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }
  mql.addListener?.(onChange);
  return () => mql.removeListener?.(onChange);
}

/** True when the user prefers reduced motion, or when the preference cannot be read. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
