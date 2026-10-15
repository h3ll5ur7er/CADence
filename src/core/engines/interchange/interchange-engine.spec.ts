import DxfParser from 'dxf-parser';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { SketchBuilder } from '@core/contracts/testing/sketch-builder';
import { createShapeAccess } from '@core/access/shape';
import { draw, drawCircle, importSTEP, measureVolume, type Shape3D } from 'replicad';
import { createInterchangeEngine } from './index';
import { meshVolume } from './solids';
import { unzip } from './zip';

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

describe('InterchangeEngine solids', () => {
  const shapes = createShapeAccess();
  const solids = createInterchangeEngine(shapes);
  /** A 40 × 20 × 4 plate with a ⌀10 hole, stored the way the Modeling Engine stores bodies. */
  const body = async () => {
    await shapes.ready();
    if (!shapes.has('plate')) {
      const outline = draw([0, 0]).hLine(40).vLine(20).hLine(-40).close().cut(drawCircle(5).translate(20, 10));
      shapes.put('plate', { shape: outline.sketchOnPlane('XY').extrude(4) as Shape3D, faces: new Map(), edges: new Map() });
    }
    return [{ name: 'Plate', key: 'plate' }];
  };
  const expected = 40 * 20 * 4 - Math.PI * 25 * 4;

  it('writes STEP that reads back to the same solid', async () => {
    const bytes = await solids.exportBodies(await body(), 'step');
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('ISO-10303-21');
    expect(text).toContain("'Plate'");
    const imported = await importSTEP(new Blob([bytes as BlobPart]));
    expect(measureVolume(imported as Shape3D)).toBeCloseTo(expected, 3);
  });

  it('writes binary STL enclosing the same volume', async () => {
    const bytes = await solids.exportBodies(await body(), 'stl');
    const view = new DataView(bytes.buffer);
    const count = view.getUint32(80, true);
    expect(bytes.length).toBe(84 + 50 * count);
    const positions: number[] = [];
    for (let t = 0; t < count; t++) for (let k = 0; k < 9; k++) positions.push(view.getFloat32(84 + t * 50 + 12 + k * 4, true));
    expect(meshVolume(positions, positions.map((_, i) => i).slice(0, positions.length / 3))).toBeCloseTo(expected, -1);
  });

  it('writes OBJ and 3MF meshes', async () => {
    const obj = new TextDecoder().decode(await solids.exportBodies(await body(), 'obj'));
    expect(obj).toMatch(/^o Plate$/m);
    expect(obj.match(/^f /gm)?.length).toBeGreaterThan(10);

    const archive = unzip(await solids.exportBodies(await body(), '3mf'));
    expect([...archive.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
    const model = new TextDecoder().decode(archive.get('3D/3dmodel.model'));
    expect(model).toContain('unit="millimeter"');
    const positions = [...model.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].flatMap((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    const indices = [...model.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].flatMap((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    expect(meshVolume(positions, indices)).toBeCloseTo(expected, -1);
  });
});
