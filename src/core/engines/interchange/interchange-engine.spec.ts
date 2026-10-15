import DxfParser from 'dxf-parser';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { SketchBuilder } from '@core/contracts/testing/sketch-builder';
import { createInterchangeEngine } from './index';

const engine = createInterchangeEngine();
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** A 40 × 20 plate with a hole, a quarter arc and a construction diagonal. */
function plate() {
  const b = new SketchBuilder();
  b.polygon([0, 0], [40, 0], [40, 20], [0, 20]);
  b.circle(b.point(30, 10), 4);
  b.arc(b.point(10, 10), b.point(15, 10), b.point(10, 15));
  b.line('p1', 'p3', true);
  return b.build();
}

describe('InterchangeEngine drawings', () => {
  it('writes DXF that a DXF reader understands, in millimetres', async () => {
    const dxf = new DxfParser().parseSync(text(await engine.exportDrawing(plate(), 'dxf')));
    expect(dxf?.header['$INSUNITS']).toBe(4);
    const entities = dxf?.entities ?? [];
    expect(entities.map((e) => e.type).sort()).toEqual(['ARC', 'CIRCLE', 'LINE', 'LINE', 'LINE', 'LINE']);
    const circle = entities.find((e) => e.type === 'CIRCLE') as unknown as { center: { x: number; y: number }; radius: number };
    expect(circle.center).toMatchObject({ x: 30, y: 10 });
    expect(circle.radius).toBe(4);
    const arc = entities.find((e) => e.type === 'ARC') as unknown as { startAngle: number; endAngle: number; radius: number };
    expect(arc.radius).toBeCloseTo(5);
    expect(arc.startAngle).toBeCloseTo(0);
    expect(arc.endAngle).toBeCloseTo(Math.PI / 2);
  });

  it('writes SVG sized in millimetres with Y pointing up', async () => {
    const svg = text(await engine.exportDrawing(plate(), 'svg'));
    const root = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document.documentElement;
    expect(root.getAttribute('width')).toBe('40mm');
    expect(root.getAttribute('height')).toBe('20mm');
    expect(root.getAttribute('viewBox')).toBe('0 -20 40 20');
    expect(root.querySelectorAll('line')).toHaveLength(4);
    expect(root.querySelector('circle')?.getAttribute('cy')).toBe('-10');
    // Counter-clockwise in sketch space is clockwise on screen once Y is flipped: sweep flag 0.
    expect(root.querySelector('path')?.getAttribute('d')).toBe('M 15 -10 A 5 5 0 0 0 10 -15');
  });

  it('leaves construction geometry out', async () => {
    const svg = text(await engine.exportDrawing(plate(), 'svg'));
    expect(svg).not.toContain('x1="0" y1="0" x2="40" y2="-20"');
  });
});
