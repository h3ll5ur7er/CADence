/**
 * Minimal typed request/response RPC over postMessage (workers, message ports).
 * Typed-array buffers in arguments and results are transferred, not copied.
 */

export interface Port {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  start?(): void;
}

/** Every method returns a promise on the calling side. */
export type Remote<T> = {
  readonly [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
};

interface Request {
  readonly rpc: 'request';
  readonly id: number;
  readonly service: string;
  readonly method: string;
  readonly args: readonly unknown[];
}

type Response =
  | { readonly rpc: 'response'; readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly rpc: 'response'; readonly id: number; readonly ok: false; readonly error: { name: string; message: string } };

/** ArrayBuffers behind the typed arrays in a value, each once. */
export function transferables(value: unknown, found = new Set<ArrayBuffer>()): ArrayBuffer[] {
  if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof ArrayBuffer) found.add(value.buffer);
  } else if (Array.isArray(value)) {
    for (const item of value) transferables(item, found);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) transferables(item, found);
  }
  return [...found];
}

/** Serves `services` (by name) to requests arriving on `port`. */
export function expose(port: Port, services: Readonly<Record<string, object>>): void {
  port.addEventListener('message', (event: MessageEvent) => {
    const request = event.data as Request;
    if (request?.rpc !== 'request') return;
    void (async () => {
      let response: Response;
      try {
        const service = services[request.service] as Record<string, (...args: unknown[]) => unknown> | undefined;
        const method = service?.[request.method];
        if (!service || typeof method !== 'function') throw new Error(`Unknown method ${request.service}.${request.method}`);
        response = { rpc: 'response', id: request.id, ok: true, value: await method.apply(service, [...request.args]) };
      } catch (error) {
        const e = error instanceof Error ? error : new Error(String(error));
        response = { rpc: 'response', id: request.id, ok: false, error: { name: e.name, message: e.message } };
      }
      port.postMessage(response, response.ok ? transferables(response.value) : []);
    })();
  });
  port.start?.();
}

/** A proxy whose method calls run on the other side of `port`. */
export function remote<T extends object>(port: Port, service: string): Remote<T> {
  return new Proxy({} as Remote<T>, {
    get: (_target, method) => {
      if (typeof method !== 'string' || method === 'then') return undefined;
      return (...args: unknown[]) => call(port, service, method, args);
    },
  });
}

/** A worker that can be stopped: a port with `terminate`. */
export interface StoppablePort extends Port {
  terminate(): void;
}

/**
 * A proxy whose method calls run in a worker of their own and may take at most `limit` ms (CAD-125):
 * a call that takes longer stops the worker (WebAssembly cannot be interrupted otherwise) and fails
 * with a `TimeoutError`, as do the calls waiting with it; the next call starts a new worker. An
 * infinite `limit` lets calls take as long as they take (CAD-168); `idle` stops the worker that
 * long (ms) after its last call has answered, to give back its memory.
 */
export function stoppable<T extends object>(start: () => StoppablePort, service: string, limit: number, options: { readonly idle?: number } = {}): Remote<T> {
  let worker: StoppablePort | undefined;
  let calls = 0;
  let resting: ReturnType<typeof setTimeout> | undefined;
  return new Proxy({} as Remote<T>, {
    get: (_target, method) => {
      if (typeof method !== 'string' || method === 'then') return undefined;
      return async (...args: unknown[]) => {
        clearTimeout(resting);
        const port = (worker ??= start());
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<never>((_resolve, reject) => {
          // setTimeout runs at once on delays it cannot hold.
          if (!Number.isFinite(limit)) return;
          timer = setTimeout(() => {
            const error = Object.assign(new Error(`${service}.${method} took longer than ${limit / 1000} s.`), { name: 'TimeoutError' });
            if (worker === port) worker = undefined;
            port.terminate();
            for (const waiting of pending.get(port)?.values() ?? []) waiting.reject(error);
            reject(error);
          }, limit);
        });
        calls += 1;
        try {
          return await Promise.race([call(port, service, method, args), late]);
        } finally {
          clearTimeout(timer);
          calls -= 1;
          if (options.idle !== undefined && calls === 0 && worker === port) {
            resting = setTimeout(() => {
              if (calls > 0 || worker !== port) return;
              worker = undefined;
              port.terminate();
            }, options.idle);
            (resting as { unref?: () => void }).unref?.();
          }
        }
      };
    },
  });
}

/**
 * A port to a worker that starts on first use and can be stopped and started again (CAD-134): a
 * cancelled computation stops it, and the calls waiting on it fail with `error`. The worker may tell
 * of its kernel's failures with `{ cadence: 'kernel-failed' }`; both count as `restarts`.
 */
export function restartable(start: () => StoppablePort): { readonly port: Port; restart(error: Error): void; restarts(): number } {
  let worker: StoppablePort | undefined;
  let count = 0;
  const listeners: ((event: MessageEvent) => void)[] = [];
  const failures = (event: MessageEvent) => {
    if ((event.data as { cadence?: string } | undefined)?.cadence === 'kernel-failed') count += 1;
  };
  const current = () => {
    if (!worker) {
      worker = start();
      for (const listener of [failures, ...listeners]) worker.addEventListener('message', listener);
    }
    return worker;
  };
  const port: Port = {
    postMessage: (message, transfer) => current().postMessage(message, transfer),
    addEventListener: (_type, listener) => {
      listeners.push(listener);
      worker?.addEventListener('message', listener);
    },
  };
  return {
    port,
    restarts: () => count,
    restart(error) {
      if (!worker) return;
      worker.terminate();
      worker = undefined;
      count += 1;
      const waiting = pending.get(port);
      for (const call of waiting?.values() ?? []) call.reject(error);
      waiting?.clear();
    },
  };
}

const pending = new WeakMap<Port, Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>>();
let nextId = 0;

function call(port: Port, service: string, method: string, args: unknown[]): Promise<unknown> {
  let calls = pending.get(port);
  if (!calls) {
    const map = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    calls = map;
    pending.set(port, map);
    port.addEventListener('message', (event: MessageEvent) => {
      const response = event.data as Response;
      if (response?.rpc !== 'response') return;
      const waiting = map.get(response.id);
      if (!waiting) return;
      map.delete(response.id);
      if (response.ok) waiting.resolve(response.value);
      else waiting.reject(Object.assign(new Error(response.error.message), { name: response.error.name }));
    });
    port.start?.();
  }
  const id = ++nextId;
  const request: Request = { rpc: 'request', id, service, method, args };
  const promise = new Promise((resolve, reject) => calls.set(id, { resolve, reject }));
  port.postMessage(request, transferables(args));
  return promise;
}
