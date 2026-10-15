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
export { expose, type Port, remote, type Remote, transferables } from './rpc';
