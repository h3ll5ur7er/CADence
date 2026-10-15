import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { signedArea, type Vec2 } from '../math';
import { type Contour, loadFont, type TextFont } from './index';

let font: TextFont;
beforeAll(async () => {
  const bytes = readFileSync('node_modules/@fontsource/inter/files/inter-latin-400-normal.woff');
  font = await loadFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
});

const points = (contours: readonly Contour[]): Vec2[] => contours.flatMap((c) => c.flatMap((e) => [e.start, e.end]));
const extent = (contours: readonly Contour[]) => {
  const ps = points(contours);
  return { minX: Math.min(...ps.map((p) => p[0])), maxX: Math.max(...ps.map((p) => p[0])), minY: Math.min(...ps.map((p) => p[1])), maxY: Math.max(...ps.map((p) => p[1])) };
};

describe('text outlines', () => {
  it('draws capital letters as tall as asked, on the baseline, closed', () => {
    const contours = font.outline('H', { at: [5, 2], height: 10, angle: 0 });
    expect(contours).toHaveLength(1);
    const { minY, maxY, minX } = extent(contours);
    expect(minY).toBeCloseTo(2, 6);
    expect(maxY).toBeCloseTo(12, 6);
    expect(minX).toBeGreaterThan(5);
    for (const contour of contours) {
      contour.forEach((e, i) => expect(e.start).toEqual((contour[(i + contour.length - 1) % contour.length] as (typeof contour)[number]).end));
    }
  });

  it('gives letters with holes an inner contour, and runs text along its angle', () => {
    const o = font.outline('o', { at: [0, 0], height: 10, angle: 0 });
    expect(o).toHaveLength(2);
    const areas = o.map((c) => signedArea(c.map((e) => e.start)));
    expect(Math.sign(areas[0] as number)).not.toBe(Math.sign(areas[1] as number));
    const turned = extent(font.outline('HH', { at: [0, 0], height: 10, angle: Math.PI / 2 }));
    expect(turned.maxY).toBeGreaterThan(10); // the text runs upwards
    expect(turned.maxX).toBeLessThan(1e-6); // and its letters lean to the left of the baseline
  });

  it('lays out characters one after another by their advance, umlauts included', () => {
    const one = extent(font.outline('A', { at: [0, 0], height: 10, angle: 0 }));
    const two = extent(font.outline('AA', { at: [0, 0], height: 10, angle: 0 }));
    expect(two.maxX - one.maxX).toBeCloseTo((1413 / 1490) * 10, 6); // Inter's advance of A over its capital height
    expect(font.outline('ä', { at: [0, 0], height: 10, angle: 0 }).length).toBeGreaterThanOrEqual(3);
  });
});
