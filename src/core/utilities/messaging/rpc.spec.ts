import { describe, expect, it } from 'vitest';
import { expose, remote, transferables } from './index';

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

  it('finds the buffers to transfer', () => {
    const a = new Float32Array(2);
    const b = new Uint32Array(3);
    expect(transferables({ meshes: [{ a, b }, { a }] })).toEqual([a.buffer, b.buffer]);
  });
});
