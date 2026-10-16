import { describe, expect, it } from 'vitest';
import { area, decodePicture, pictureSize, traceOutlines } from './index';
import { png } from './testing';

describe('pictures', () => {
  it('reads the size of PNG and JPEG pictures from their headers', async () => {
    expect(pictureSize(await png(30, 20, () => false))).toEqual({ width: 30, height: 20, mediaType: 'image/png' });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x48, 0x00, 0x64, 0x03]);
    expect(pictureSize(jpeg)).toEqual({ width: 100, height: 72, mediaType: 'image/jpeg' });
    expect(pictureSize(new TextEncoder().encode('<svg/>'))).toBeUndefined();
  });

  it('traces dark shapes, with their holes, into simple outlines', async () => {
    // A 10 × 10 square with a 4 × 4 hole, and a speck that is left out.
    const pixels = await decodePicture(
      await png(20, 20, (x, y) => (x >= 3 && x < 13 && y >= 3 && y < 13 && !(x >= 6 && x < 10 && y >= 6 && y < 10)) || (x === 17 && y === 17)),
    );
    expect([pixels.width, pixels.height, pixels.data.length]).toEqual([20, 20, 1600]);
    const loops = traceOutlines(pixels, { threshold: 0.5, minimumArea: 4, tolerance: 0.5 });
    expect(loops.map((l) => [l.length, Math.abs(area(l))]).sort((a, b) => (b[1] as number) - (a[1] as number))).toEqual([
      [4, 100],
      [4, 16],
    ]);
    // Outer outline and hole run in opposite directions.
    expect(Math.sign(area(loops[0] as never)) * Math.sign(area(loops[1] as never))).toBe(-1);
  });
});
