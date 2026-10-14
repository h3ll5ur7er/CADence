import { SketchBuilder } from '@core/contracts/testing/sketch-builder';
import { describe, expect, it } from 'vitest';
import { drawingCurves, type DrawingCurve } from './drawing';
import { readDxf, readSvg, sketchEntities } from './drawing-readers';
import { writeDxf } from './dxf';
import { writeSvg } from './svg';

const text = (s: string) => new TextEncoder().encode(s);

/** The plate of the export tests: 40 × 20 with a ⌀8 hole and a quarter arc. */
function plate() {
  const b = new SketchBuilder();
  b.polygon([0, 0], [40, 0], [40, 20], [0, 20]);
  b.circle(b.point(30, 10), 4);
  b.arc(b.point(10, 10), b.point(15, 10), b.point(10, 15));
  return b.build();
}

/** Curves with numbers rounded, for comparing. */
const round = (curves: readonly DrawingCurve[]) =>
  curves.map((c) => JSON.parse(JSON.stringify(c, (_, v: unknown) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 + 0 : v))) as DrawingCurve);

const dxf = (header: string, entities: string) => text(`0\nSECTION\n2\nHEADER\n${header}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`);

describe('DXF reader', () => {
  it('reads back what the DXF writer wrote', () => {
    const curves = drawingCurves(plate());
    expect(round(readDxf(text(writeDxf(curves))))).toEqual(round(curves));
  });

  it('turns polyline bulges into exact arcs', () => {
    // A 10 × 10 slot: straight sides, half circles at the ends.
    const slot = dxf('', '0\nLWPOLYLINE\n90\n4\n70\n1\n10\n0\n20\n0\n10\n10\n20\n0\n42\n1\n10\n10\n20\n10\n10\n0\n20\n10\n42\n1\n');
    const curves = round(readDxf(slot));
    expect(curves.map((c) => c.kind)).toEqual(['line', 'arc', 'line', 'arc']);
    expect(curves[1]).toEqual({ kind: 'arc', center: [10, 5], radius: 5, startAngle: -1.570796, sweep: 3.141593 });
    expect(curves[3]).toMatchObject({ center: [0, 5], radius: 5, sweep: 3.141593 });
  });

  it('scales by $INSUNITS and samples splines and ellipses within tolerance', () => {
    const inches = dxf('9\n$INSUNITS\n70\n1\n', '0\nLINE\n10\n0\n20\n0\n11\n1\n21\n0\n');
    expect(readDxf(inches)).toEqual([{ kind: 'line', start: [0, 0], end: [25.4, 0] }]);
    // A clamped quadratic B-spline from (0,0) to (20,0) with the control point (10,10): y = x(20 − x)/20.
    const spline = dxf('', '0\nSPLINE\n71\n2\n40\n0\n40\n0\n40\n0\n40\n1\n40\n1\n40\n1\n10\n0\n20\n0\n10\n10\n20\n10\n10\n20\n20\n0\n');
    const lines = readDxf(spline) as Extract<DrawingCurve, { kind: 'line' }>[];
    expect(lines.length).toBeGreaterThan(8);
    expect(lines[0]).toMatchObject({ start: [0, 0] });
    expect(lines.at(-1)?.end[0]).toBeCloseTo(20, 6);
    for (const line of lines) expect(line.start[1]).toBeCloseTo((line.start[0] * (20 - line.start[0])) / 20, 6);
  });

  it('refuses files without drawable entities', () => {
    expect(() => readDxf(dxf('', '0\nTEXT\n1\nhello\n'))).toThrow('no lines');
    expect(() => readDxf(text('0\nEOF\n'))).toThrow('no ENTITIES');
  });
});

describe('SVG reader', () => {
  it('reads back what the SVG writer wrote', () => {
    const curves = drawingCurves(plate());
    expect(round(readSvg(text(writeSvg(curves))))).toEqual(round(curves));
  });

  it('scales by the root size and viewBox, applies transforms and flips Y', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 200 100">
      <g transform="translate(20 20)"><rect width="40" height="20"/></g>
      <circle cx="100" cy="50" r="10" transform="scale(2) translate(-50 -25)"/>
      <path d="M 0 0 C 0 10 10 20 20 20"/>
      <defs><rect width="999" height="999"/></defs>
    </svg>`;
    const curves = readSvg(text(svg));
    const rect = curves.slice(0, 4).map((c) => (c.kind === 'line' ? c.start : undefined));
    // 0.5 mm per user unit; the bottom of the 100-unit-high view box is y = 0.
    expect(rect).toEqual([
      [10, 40],
      [30, 40],
      [30, 30],
      [10, 30],
    ]);
    expect(round([curves[4] as DrawingCurve])).toEqual([{ kind: 'circle', center: [50, 25], radius: 10 }]);
    const bezier = curves.slice(5) as { kind: 'line'; start: [number, number]; end: [number, number] }[];
    expect(bezier.length).toBeGreaterThan(8);
    expect(bezier.at(-1)?.end.map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([10, 40]);
  });

  it('keeps rounded rectangle corners as arcs', () => {
    const curves = readSvg(text('<svg viewBox="0 0 10 10" width="10mm" height="10mm"><rect width="10" height="10" rx="2"/></svg>'));
    expect(curves.map((c) => c.kind)).toEqual(['line', 'arc', 'line', 'arc', 'line', 'arc', 'line', 'arc']);
    expect(curves.filter((c) => c.kind === 'arc').every((c) => c.kind === 'arc' && Math.abs(c.radius - 2) < 1e-9 && Math.abs(c.sweep - Math.PI / 2) < 1e-9)).toBe(true);
  });
});

describe('drawing curves to sketch entities', () => {
  it('shares the points where curves meet and keeps arcs and circles exact', () => {
    const curves = drawingCurves(plate());
    const entities = sketchEntities(curves, 'imp');
    const kinds = entities.reduce<Record<string, number>>((n, e) => ({ ...n, [e.kind]: (n[e.kind] ?? 0) + 1 }), {});
    // 4 corners, the circle's centre, the arc's centre and its two ends.
    expect(kinds).toEqual({ point: 8, line: 4, circle: 1, arc: 1 });
    expect(entities.every((e) => e.id.startsWith('imp'))).toBe(true);
    expect(new Set(entities.map((e) => e.id)).size).toBe(entities.length);
  });
});
