import { describe, expect, it } from 'vitest';
import { expose, remote, stoppable, type StoppablePort, transferables } from './index';

interface Calculator {
  add(a: number, b: number): number;
  scaled(values: Float32Array, factor: number): Promise<Float32Array>;
  fail(): never;
}

const calculator: Calculator = {
  add: (a, b) => a + b,
  scaled: async (values, factor) => values.map((v) => v * factor),
  fail: () => {
    throw new RangeError('out of range');
  },
};

function connected() {
  const channel = new MessageChannel();
  expose(channel.port1, { calculator });
  return { client: remote<Calculator>(channel.port2, 'calculator'), close: () => (channel.port1.close(), channel.port2.close()) };
}

describe('rpc', () => {
  it('calls methods on the other side', async () => {
    const { client, close } = connected();
    expect(await client.add(2, 3)).toBe(5);
    expect([...(await client.scaled(new Float32Array([1, 2]), 3))]).toEqual([3, 6]);
    close();
  });

  it('rejects with the remote error', async () => {
    const { client, close } = connected();
    await expect(client.fail()).rejects.toMatchObject({ name: 'RangeError', message: 'out of range' });
    close();
  });

  it('stops a worker whose call takes too long, and starts a new one for the next call (CAD-125)', async () => {
    const started: { port: MessagePort; stopped: boolean }[] = [];
    const start = (): StoppablePort => {
      const channel = new MessageChannel();
      // A worker that never answers `hang`, as a kernel stuck in a long computation.
      expose(channel.port1, { calculator: { ...calculator, hang: () => new Promise(() => undefined) } });
      const worker = { port: channel.port2, stopped: false };
      started.push(worker);
      return Object.assign(channel.port2, { terminate: () => ((worker.stopped = true), channel.port1.close(), channel.port2.close()) });
    };
    const client = stoppable<Calculator & { hang(): Promise<void> }>(start, 'calculator', 50);
    expect(await client.add(1, 2)).toBe(3);
    await expect(client.hang()).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(started.map((w) => w.stopped)).toEqual([true]);
    expect(await client.add(2, 2)).toBe(4);
    expect(started.map((w) => w.stopped)).toEqual([true, false]);
    started[1]?.port.close();
  });

  it('finds the buffers to transfer', () => {
    const a = new Float32Array(2);
    const b = new Uint32Array(3);
    expect(transferables({ meshes: [{ a, b }, { a }] })).toEqual([a.buffer, b.buffer]);
  });
});
