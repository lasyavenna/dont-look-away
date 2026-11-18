export type Cleanup = () => void;

export interface Registry {
  register(release: () => void): Cleanup;
  activeCount(): number;
  disposeAll(): void;
}

export function createRegistry(): Registry {
  const active = new Set<Cleanup>();

  const register = (release: () => void): Cleanup => {
    let done = false;
    const cleanup: Cleanup = () => {
      if (done) return;
      done = true;
      active.delete(cleanup);
      try {
        release();
      } catch {
        // release failures are swallowed
      }
    };
    active.add(cleanup);
    return cleanup;
  };

  return {
    register,
    activeCount: () => active.size,
    disposeAll: () => {
      for (const c of Array.from(active)) c();
    },
  };
}
