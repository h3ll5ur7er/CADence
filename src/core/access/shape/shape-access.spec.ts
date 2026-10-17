import { makeBox, type Shape3D } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { createShapeAccess, type NamedShape } from './index';

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
});
