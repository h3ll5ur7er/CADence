export type Handler<T> = (payload: T) => void | Promise<void>;

/**
 * Typed publish/subscribe with queued delivery: handlers never run inside `publish`,
 * so a publisher is never blocked by (or coupled to) its subscribers.
 */
export class EventBus<Events extends object> {
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly onError: (error: unknown) => void = (e) => console.error(e)) {}

  subscribe<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(handler as Handler<never>);
    this.handlers.set(type, set);
    return () => set.delete(handler as Handler<never>);
  }

  publish<K extends keyof Events>(type: K, payload: Events[K]): void {
    const handlers = [...(this.handlers.get(type) ?? [])] as Handler<Events[K]>[];
    this.pending = this.pending.then(() =>
      Promise.all(
        handlers.map(async (handle) => {
          try {
            await handle(payload);
          } catch (error) {
            this.onError(error);
          }
        }),
      ).then(() => undefined),
    );
  }

  /** Resolves once every event published so far has been handled. */
  drained(): Promise<void> {
    return this.pending;
  }
}
export { expose, type Port, remote, type Remote, restartable, stoppable, type StoppablePort, transferables } from './rpc';

/** What relays messages between the app's tabs and windows: a `BroadcastChannel`. */
export interface MessageChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
}

/**
 * Relays events between the buses of the app's tabs and windows: what is published here goes out
 * (by the name `outgoing` gives it, or not at all), and what comes in is published here; events that
 * came in are never sent back out.
 */
export function relayEvents<Events extends object>(bus: EventBus<Events>, channel: MessageChannelLike, outgoing: Partial<Record<keyof Events, keyof Events>>): () => void {
  const received = new WeakSet<object>();
  const names = new Set(Object.values(outgoing) as (keyof Events)[]);
  const stops = (Object.entries(outgoing) as [keyof Events, keyof Events][]).map(([type, as]) =>
    bus.subscribe(type, (payload) => {
      if (!received.has(payload as object)) channel.postMessage({ type: as, payload });
    }),
  );
  const listen = ({ data }: { readonly data: unknown }) => {
    const { type, payload } = (data ?? {}) as { type?: keyof Events; payload?: object };
    if (type === undefined || !names.has(type) || !payload || typeof payload !== 'object') return;
    received.add(payload);
    bus.publish(type, payload as Events[keyof Events]);
  };
  channel.addEventListener('message', listen);
  return () => {
    stops.forEach((stop) => stop());
    channel.removeEventListener('message', listen);
  };
}
