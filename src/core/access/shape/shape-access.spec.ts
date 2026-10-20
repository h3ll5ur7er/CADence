import { makeBox, type Shape3D } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { createShapeAccess, guarded, kernelFailure, type NamedShape } from './index';

const box = (size: number): NamedShape => ({ shape: makeBox([0, 0, 0], [size, size, size]) as Shape3D, faces: new Map(), edges: new Map() });

describe('ShapeAccess', () => {
  const shapes = createShapeAccess({ capacity: 2 });
  beforeAll(() => shapes.ready());

  it('evicts the least recently used entries, but never kept ones (CAD-121)', () => {
    shapes.put('a', box(1));
    shapes.keep(['a'], true);
    shapes.keep(['a'], true); // two holders
    for (const key of ['b', 'c', 'd', 'e']) shapes.put(key, box(2));
    expect(['a', 'b', 'c', 'd', 'e'].filter((k) => shapes.has(k))).toEqual(['a', 'd', 'e']);
    shapes.keep(['a'], false);
    shapes.put('f', box(3));
    expect(shapes.has('a')).toBe(true);
    // Let go by both, it is evicted like any other.
    shapes.keep(['a'], false);
    shapes.put('g', box(3));
    expect(['a', 'e', 'f', 'g'].filter((k) => shapes.has(k))).toEqual(['f', 'g']);
  });

  it('starts a new kernel after one that ran out of memory, without its shapes (CAD-133)', async () => {
    expect(kernelFailure('Standard_OutOfMemory: Standard_MMgrRaw::Allocate(): malloc failed')).toBe('it ran out of memory');
    expect(kernelFailure(new Error('null function or function signature mismatch'))).toBe('it failed inside');
    expect(kernelFailure('The profile is open.')).toBeUndefined();
    const other = createShapeAccess();
    await other.ready();
    other.put('x', box(1));
    const before = other.generation();
    // An engine's result that tells of the failure is enough.
    const engine = guarded({ build: async () => ({ ok: false, error: { message: 'Standard_OutOfMemory: malloc failed' } }) }, other);
    await engine.build();
    await other.ready();
    expect(other.generation()).toBe(before + 1);
    expect(other.has('x')).toBe(false);
    // The new kernel works, for every store of this thread.
    await shapes.ready();
    expect(shapes.has('g')).toBe(false);
    shapes.put('h', box(2));
    expect(shapes.get('h')?.shape.boundingBox.width).toBeCloseTo(2, 6);
  });
});
