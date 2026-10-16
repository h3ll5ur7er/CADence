import { describe, expect, it } from 'vitest';
import { decodePicture, encodePng } from '../picture';
import { rasterize, rasterViews } from '.';

/** A unit square in the XY plane facing +Z, as two triangles, with its outline. */
const square = (color: string, transform?: number[]) => ({
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  edges: new Float32Array([0, 0, 0, 1, 0, 0]),
  color,
  ...(transform ? { transform } : {}),
});

describe('raster', () => {
  it('draws meshes from a direction, nearer ones in front, on a transparent ground', () => {
    // A red square, and a blue one half a unit nearer the viewer (above it), shifted right.
    const pixels = rasterize([square('#ff0000'), square('#0000ff', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, 0, 0.5, 1])], { width: 60, height: 40, ...rasterViews.top });
    const at = (x: number, y: number) => Array.from(pixels.subarray((y * 60 + x) * 4, (y * 60 + x) * 4 + 4));
    expect(at(0, 0)[3]).toBe(0); // outside the model
    const left = at(12, 20);
    expect(left[0]).toBeGreaterThan(100);
    expect(left[2]).toBe(0);
    const middle = at(30, 20); // both squares here: the blue one is nearer
    expect(middle[2]).toBeGreaterThan(100);
    expect(middle[0]).toBe(0);
  });

  it('writes pictures as PNG', async () => {
    const pixels = rasterize([square('#a9b6c2')], { width: 32, height: 24, ...rasterViews.iso, background: [255, 255, 255, 255] });
    const png = await encodePng({ width: 32, height: 24, data: pixels });
    const back = await decodePicture(png);
    expect([back.width, back.height]).toEqual([32, 24]);
    expect(Array.from(back.data.subarray(0, 4))).toEqual([255, 255, 255, 255]);
  });
});
