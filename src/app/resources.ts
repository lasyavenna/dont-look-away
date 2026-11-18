import type { Cleanup, Registry } from '../core/registry';
import type { WorkerLike } from '../worker/createExecutionWorker';

/** Each helper registers its release in the registry and returns an idempotent cleanup. */

export function addTimeout(registry: Registry, fn: () => void, ms: number): Cleanup {
  const id = setTimeout(fn, ms);
  return registry.register(() => clearTimeout(id));
}

export function addInterval(registry: Registry, fn: () => void, ms: number): Cleanup {
  const id = setInterval(fn, ms);
  return registry.register(() => clearInterval(id));
}

export function addListener(
  registry: Registry,
  target: EventTarget,
  type: string,
  handler: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): Cleanup {
  target.addEventListener(type, handler, options);
  return registry.register(() => target.removeEventListener(type, handler, options));
}

/** Nulls handlers, then terminates. A throwing terminate() is swallowed by the registry. */
export function addWorker(registry: Registry, worker: WorkerLike): Cleanup {
  return registry.register(() => {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  });
}

export interface AudioNodeLike {
  stop?(): void;
  disconnect(): void;
}

export function addAudioNode(registry: Registry, node: AudioNodeLike): Cleanup {
  return registry.register(() => {
    try {
      node.stop?.();
    } catch {
      // already stopped
    }
    node.disconnect();
  });
}
