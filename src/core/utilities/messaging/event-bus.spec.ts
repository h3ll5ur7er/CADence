import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './index';

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
});
