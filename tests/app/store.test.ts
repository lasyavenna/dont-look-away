import { describe, it, expect, vi } from 'vitest';
import { createGameStore } from '../../src/app/store';
import { normalizeConfig } from '../../src/core/config';

const cfg = normalizeConfig({ drainAmount: 7 });

function playing(deps = {}) {
  const store = createGameStore(cfg, deps);
  store.dispatch({ type: 'START' });
  return store;
}

describe('store queue', () => {
  it('processes events in order and notifies once after the queue empties', () => {
    const store = createGameStore(cfg);
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: 'START' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().phase).toBe('playing');
  });

  it('queues dispatches from a subscriber and processes them after the current one', () => {
    const store = createGameStore(cfg);
    const seen: string[] = [];
    let first = true;
    store.subscribe(() => {
      const s = store.getState();
      seen.push(`${s.phase}:${s.code}`);
      if (first) {
        first = false;
        store.dispatch({ type: 'CODE_CHANGED', roundId: s.activeRoundId as number, code: 'x' });
        // not re-entrant: state unchanged until the current notification returns
        expect(store.getState().code).toBe(s.code);
      }
    });
    store.dispatch({ type: 'START' });
    expect(seen).toHaveLength(2);
    expect(seen[0].startsWith('playing:')).toBe(true);
    expect(seen[1]).toBe('playing:x');
    expect(store.getState().code).toBe('x');
  });

  it('processes multiple queued subscriber events in dispatch order', () => {
    const store = playing();
    const id = store.getActiveRoundId() as number;
    let once = true;
    store.subscribe(() => {
      if (!once) return;
      once = false;
      store.dispatch({ type: 'CODE_CHANGED', roundId: id, code: 'a' });
      store.dispatch({ type: 'CODE_CHANGED', roundId: id, code: 'b' });
    });
    store.dispatch({ type: 'DRAIN_TICK', roundId: id });
    expect(store.getState().code).toBe('b');
  });

  it('does not wedge when a step throws', () => {
    const store = playing({
      saveSnapshot: () => {
        throw new Error('boom');
      },
    });
    const id = store.getActiveRoundId() as number;
    const before = store.getState();
    let threw = false;
    for (let i = 0; i < 300 && !threw; i++) {
      try {
        store.dispatch({ type: 'DRAIN_TICK', roundId: id });
      } catch {
        threw = true;
      }
      if (store.getState().phase !== 'playing') break;
    }
    // Whether or not the stub was reached, the store must keep accepting events.
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: 'RESTART' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState()).not.toBe(before);
  });
});

describe('store detach', () => {
  it('is a no-op in ready', () => {
    const store = createGameStore(cfg);
    const s = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);
    store.detach();
    expect(store.getState()).toBe(s);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does nothing while playing with no running run', () => {
    const store = playing();
    const s = store.getState();
    store.detach();
    expect(store.getState()).toBe(s);
  });

  it('stales a running run, keeps the round, is idempotent, and the store stays usable', () => {
    const store = playing();
    const id = store.getActiveRoundId() as number;
    store.dispatch({ type: 'RUN_REQUESTED', roundId: id });
    const running = store.getState().run;
    expect(running?.status).toBe('running');
    const { sanity, code } = store.getState();

    store.detach();
    const after = store.getState();
    expect(after.run?.status).toBe('stale');
    expect(after.activeRoundId).toBe(id);
    expect(after.phase).toBe('playing');
    expect(after.sanity).toEqual(sanity);
    expect(after.code).toBe(code);

    store.detach();
    expect(store.getState()).toBe(after);

    store.dispatch({ type: 'CODE_CHANGED', roundId: id, code: 'still works' });
    expect(store.getState().code).toBe('still works');
  });
});
