import { describe, expect, it, vi } from 'vitest';
import { EventBus, type MessageChannelLike, relayEvents } from './index';

interface TestEvents {
  ping: { n: number };
  pong: { text: string };
}

describe('EventBus', () => {
  it('delivers events queued, after the publisher continues', async () => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];
    bus.subscribe('ping', ({ n }) => {
      order.push(`handled ${n}`);
    });
    bus.publish('ping', { n: 1 });
    order.push('published');
    await bus.drained();
    expect(order).toEqual(['published', 'handled 1']);
  });

  it('only notifies subscribers of the published event type', async () => {
    const bus = new EventBus<TestEvents>();
    const pong = vi.fn();
    bus.subscribe('pong', pong);
    bus.publish('ping', { n: 1 });
    await bus.drained();
    expect(pong).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', async () => {
    const bus = new EventBus<TestEvents>();
    const ping = vi.fn();
    const unsubscribe = bus.subscribe('ping', ping);
    unsubscribe();
    bus.publish('ping', { n: 1 });
    await bus.drained();
    expect(ping).not.toHaveBeenCalled();
  });

  it('isolates a failing handler from the others', async () => {
    const errors: unknown[] = [];
    const bus = new EventBus<TestEvents>((e) => errors.push(e));
    const ping = vi.fn();
    bus.subscribe('ping', () => {
      throw new Error('boom');
    });
    bus.subscribe('ping', ping);
    bus.publish('ping', { n: 2 });
    await bus.drained();
    expect(ping).toHaveBeenCalledWith({ n: 2 });
    expect(errors).toHaveLength(1);
  });

  it('relays events between the buses of tabs, renamed where asked, never echoing them back', async () => {
    // Two tabs joined by a channel that delivers to the other side, as a BroadcastChannel does.
    type Listener = (event: { readonly data: unknown }) => void;
    const ends: Set<Listener>[] = [new Set(), new Set()];
    const end = (i: 0 | 1): MessageChannelLike => ({
      postMessage: (message) => ends[1 - i]?.forEach((listen) => listen({ data: structuredClone(message) })),
      addEventListener: (_type, listener) => ends[i]?.add(listener),
      removeEventListener: (_type, listener) => ends[i]?.delete(listener),
    });
    interface Events {
      saved: { id: string };
      changed: { id: string };
      local: { id: string };
    }
    const [a, b] = [new EventBus<Events>(), new EventBus<Events>()];
    const outgoing = { saved: 'changed', changed: 'changed' } as const;
    relayEvents(a, end(0), outgoing);
    relayEvents(b, end(1), outgoing);
    const heard: string[] = [];
    a.subscribe('changed', ({ id }) => void heard.push(`a:${id}`));
    b.subscribe('changed', ({ id }) => void heard.push(`b:${id}`));
    b.subscribe('saved', ({ id }) => void heard.push(`b saved:${id}`));
    a.publish('saved', { id: '1' });
    a.publish('local', { id: '2' });
    await a.drained();
    await b.drained();
    await a.drained();
    expect(heard).toEqual(['b:1']);
  });
});
