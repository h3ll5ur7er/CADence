import DxfParser from 'dxf-parser';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { SketchBuilder } from '@core/contracts/testing/sketch-builder';
import { circleLoop, profile, rectangleLoop } from '@core/contracts/testing/profiles';
import { createShapeAccess } from '@core/access/shape';
import { draw, drawCircle, drawRectangle, importSTEP, makeBox, measureVolume, type Shape3D } from 'replicad';
import { createInterchangeEngine } from './index';
import { readStl } from './mesh-readers';
import { maxSeparateSolids, store } from './solid-readers';
import { meshVolume, writeStl } from './solids';
import { readZip } from '@core/utilities/archive';
import { scan } from './testing';

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

  it('writes ellipses and splines: exact in SVG, as fine polylines in DXF', async () => {
    const b = new SketchBuilder();
    b.ellipse(b.point(0, 0), b.point(20, 0), 10);
    b.spline([b.point(-20, -15), b.point(0, -10), b.point(20, -15)]);
    const svg = new JSDOM(text(await engine.exportDrawing(b.build(), 'svg')), { contentType: 'image/svg+xml' }).window.document;
    expect(svg.querySelector('ellipse')?.getAttribute('rx')).toBe('20');
    expect(svg.querySelector('ellipse')?.getAttribute('ry')).toBe('10');
    expect([...svg.querySelectorAll('path')].map((p) => p.getAttribute('d')?.split(' ')[3])).toEqual(['C', 'C']);
    expect(svg.documentElement.getAttribute('width')).toBe('40mm');
    const dxf = new DxfParser().parseSync(text(await engine.exportDrawing(b.build(), 'dxf')));
    const polylines = (dxf?.entities ?? []) as unknown as { type: string; vertices: { x: number; y: number }[] }[];
    expect(polylines.map((e) => e.type)).toEqual(['POLYLINE', 'POLYLINE', 'POLYLINE']);
    const xs = polylines[0]?.vertices.map((v) => v.x) ?? [];
    // Within 0.005 mm of the ellipse.
    expect(20 - Math.max(...xs)).toBeLessThan(0.005);
    expect(20 + Math.min(...xs)).toBeLessThan(0.005);
  });

  it('writes text as its outlines', async () => {
    const b = new SketchBuilder();
    const label = b.text(b.point(0, 0), 'L', 10);
    const outline = [
      [
        { kind: 'line' as const, start: [0, 0] as const, end: [6, 0] as const, source: label },
        { kind: 'line' as const, start: [6, 0] as const, end: [6, 10] as const, source: label },
        { kind: 'line' as const, start: [6, 10] as const, end: [0, 0] as const, source: label },
      ],
    ];
    const svg = text(await engine.exportDrawing(b.build(), 'svg', undefined, new Map([[label, outline]])));
    expect(svg.match(/<line /g)).toHaveLength(3);
  });

  it('leaves construction geometry out', async () => {
    const svg = text(await engine.exportDrawing(plate(), 'svg'));
    expect(svg).not.toContain('x1="0" y1="0" x2="40" y2="-20"');
  });

  it('compensates the kerf: outlines grow and holes shrink by half the kerf, loose curves stay', async () => {
    const b = new SketchBuilder();
    const corners = [b.point(0, 0), b.point(40, 0), b.point(40, 20), b.point(0, 20)];
    ['bottom', 'right', 'top', 'left'].forEach((side, i) => b.line(corners[i] as string, corners[(i + 1) % 4] as string, false, `r-${side}`));
    b.circle(b.point(30, 10), 4, false, 'hole');
    b.line(b.point(5, 5), b.point(15, 5), false, 'engrave');
    const profiles = [profile(rectangleLoop(0, 0, 40, 20, 'r'), [circleLoop(30, 10, 4, 'hole', false)])];
    const dxf = new DxfParser().parseSync(text(await engine.exportDrawing(b.build(), 'dxf', { profiles, kerf: 0.2 })));
    const entities = (dxf?.entities ?? []) as unknown as { type: string; radius?: number; vertices?: { x: number; y: number }[] }[];
    expect(entities.map((e) => e.type).sort()).toEqual(['ARC', 'ARC', 'LINE', 'LINE', 'LINE', 'LINE', 'LINE']);
    expect(entities.filter((e) => e.type === 'ARC').map((e) => e.radius)).toEqual([3.9, 3.9]);
    const xs = entities.filter((e) => e.type === 'LINE').flatMap((e) => e.vertices?.map((v) => v.x) ?? []);
    expect(Math.min(...xs)).toBeCloseTo(-0.1);
    expect(Math.max(...xs)).toBeCloseTo(40.1);
    expect(xs).toContain(5); // the engraving line is not moved
  });

  it('refuses kerf compensation when a detail is smaller than the kerf', async () => {
    const b = new SketchBuilder();
    b.circle(b.point(0, 0), 0.05, false, 'pin');
    const profiles = [profile(circleLoop(0, 0, 0.05, 'pin', false))];
    await expect(engine.exportDrawing(b.build(), 'svg', { profiles, kerf: 0.2 })).rejects.toThrow('smaller than the kerf');
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

  it('meshes more finely at a finer quality', async () => {
    const triangles = async (quality: 'draft' | 'normal' | 'fine') => new DataView((await solids.exportBodies(await body(), 'stl', quality)).buffer).getUint32(80, true);
    const [draft, normal, fine] = [await triangles('draft'), await triangles('normal'), await triangles('fine')];
    expect(draft).toBeLessThan(normal);
    expect(normal).toBeLessThan(fine);
  });

  it('writes OBJ and 3MF meshes', async () => {
    const obj = new TextDecoder().decode(await solids.exportBodies(await body(), 'obj'));
    expect(obj).toMatch(/^o Plate$/m);
    expect(obj.match(/^f /gm)?.length).toBeGreaterThan(10);

    const archive = await readZip(await solids.exportBodies(await body(), '3mf'));
    expect([...archive.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
    const model = new TextDecoder().decode(archive.get('3D/3dmodel.model'));
    expect(model).toContain('unit="millimeter"');
    const positions = [...model.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].flatMap((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    const indices = [...model.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].flatMap((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    expect(meshVolume(positions, indices)).toBeCloseTo(expected, -1);
  });
});

describe('InterchangeEngine placed bodies', () => {
  it('exports each body where its transform puts it', async () => {
    const shapes = createShapeAccess();
    const solids = createInterchangeEngine(shapes);
    await shapes.ready();
    shapes.put('cube', { shape: drawRectangle(10, 10).sketchOnPlane('XY').extrude(10) as Shape3D, faces: new Map(), edges: new Map() });
    const at = (x: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
    const bytes = await solids.exportBodies([{ name: 'Left', key: 'cube' }, { name: 'Right', key: 'cube', transform: at(100) }], 'step');
    const imported = (await importSTEP(new Blob([bytes as BlobPart]))) as Shape3D;
    const box = imported.boundingBox.bounds;
    expect(box[0][0]).toBeCloseTo(-5);
    expect(box[1][0]).toBeCloseTo(105);
    expect(measureVolume(imported)).toBeCloseTo(2000, 3);
    expect(new TextDecoder().decode(bytes)).toContain("'Right'");
  });
});

describe('InterchangeEngine imports', () => {
  const shapes = createShapeAccess();
  const engine = createInterchangeEngine(shapes);
  const cubeMesh = { name: 'Cube', positions: [-5, -5, -5, 5, -5, -5, 5, 5, -5, -5, 5, -5, -5, -5, 5, 5, -5, 5, 5, 5, 5, -5, 5, 5], indices: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7] };
  const plateStep = async () => {
    await shapes.ready();
    shapes.put('import-plate', { shape: drawRectangle(40, 20).sketchOnPlane('XY').extrude(4) as Shape3D, faces: new Map(), edges: new Map() });
    return engine.exportBodies([{ name: 'Plate', key: 'import-plate' }], 'step');
  };
  const volumeOf = (key: string) => measureVolume((shapes.get(key) as { shape: Shape3D }).shape);
  const ok = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };

  it('reads STEP solids once per key', async () => {
    const step = await plateStep();
    const keys = ok(await engine.readSolids(step, 'step', 'asset-1'));
    expect(keys).toEqual(['asset-1:0']);
    expect(volumeOf('asset-1:0')).toBeCloseTo(40 * 20 * 4, 3);
    expect(ok(await engine.readSolids(new Uint8Array(), 'step', 'asset-1'))).toBe(keys);
  });

  it('keeps a file of many solids as one body (a board with its parts, CAD-135)', async () => {
    await shapes.ready();
    const boxes = (n: number) => Array.from({ length: n }, (_, i) => makeBox([i * 2, 0, 0], [i * 2 + 1, 1, 1]) as Shape3D);
    expect(store(shapes, 'few', boxes(3))).toEqual(['few:0', 'few:1', 'few:2']);
    const many = store(shapes, 'many', boxes(maxSeparateSolids + 1));
    expect(many).toEqual(['many:0']);
    expect(volumeOf('many:0')).toBeCloseTo(maxSeparateSolids + 1, 6);
  });

  it('turns closed meshes into solids with merged flat faces', async () => {
    const [key] = ok(await engine.readSolids(writeStl([cubeMesh]), 'stl', 'asset-cube'));
    expect(volumeOf(key as string)).toBeCloseTo(1000, 6);
    expect((shapes.get(key as string) as { shape: Shape3D }).shape.faces).toHaveLength(6);
  });

  it('keeps very large meshes as meshes', async () => {
    const triangles = 100_001;
    const positions = Array.from({ length: triangles * 9 }, (_, i) => (i % 9 === 3 ? 1 : i % 9 === 7 ? 1 : 0) + Math.floor(i / 9));
    const big = writeStl([{ name: 'Big', positions, indices: Array.from({ length: triangles * 3 }, (_, i) => i) }]);
    const result = await engine.readSolids(big, 'stl', 'asset-big');
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining('100,001 triangles') } });
    const display = ok(await engine.readMesh(big, 'stl', 'asset-big'));
    expect(display.triangles).toBe(triangles);
  });

  it('repairs open meshes before they become solids (CAD-169)', async () => {
    const open = { ...cubeMesh, indices: cubeMesh.indices.slice(0, -3) };
    const [key] = ok(await engine.readSolids(writeStl([open]), 'stl', 'asset-open-cube'));
    expect(volumeOf(key as string)).toBeCloseTo(1000, 6);
  });

  it('simplifies a 500,000-triangle scan into a mesh that becomes a solid (CAD-169)', async () => {
    const big = writeStl([scan(501, 500)]);
    expect(await engine.readSolids(big, 'stl', 'asset-scan')).toMatchObject({ ok: false, error: { message: expect.stringContaining('Simplify it first') } });
    const simple = ok(await engine.simplifyMesh(big, 'stl', 3000, 'preview-scan'));
    expect(simple.before).toBeGreaterThan(499_000);
    expect(simple.preview.triangles).toBeLessThanOrEqual(3000);
    expect(simple.preview.usableAsSolid).toBe(true);
    expect(simple.repair).toMatchObject({ closedHoles: 0, flippedTriangles: 0 });
    const [key] = ok(await engine.readSolids(simple.file, 'stl', 'asset-scan-simple'));
    expect(volumeOf(key as string) / ((4 / 3) * Math.PI * 20 ** 3)).toBeCloseTo(1, 1);
    expect(await engine.simplifyMesh(big, 'stl', 2, 'preview-scan')).toMatchObject({ ok: false });
  }, 120_000);

  it('prepares meshes for display with their volume, extent and fold edges', async () => {
    const display = ok(await engine.readMesh(writeStl([cubeMesh]), 'stl', 'asset-cube'));
    expect(display).toMatchObject({ triangles: 12, min: [-5, -5, -5], max: [5, 5, 5] });
    expect(display.volume).toBeCloseTo(1000, 6);
    expect(display.meshes[0]?.edges[0]?.count).toBe(24); // the cube's 12 edges, not the diagonals
  });

  it('reads drawings into sketch entities', async () => {
    const { entities } = ok(await engine.readDrawing(await engine.exportDrawing(plate(), 'dxf'), 'dxf', 'd'));
    expect(entities.filter((e) => e.kind !== 'point').map((e) => e.kind).sort()).toEqual(['arc', 'circle', 'line', 'line', 'line', 'line']);
  });

  it('reads texts of drawings as editable text, and outlines them when converting', async () => {
    const svg = new TextEncoder().encode('<svg viewBox="0 0 100 50" width="100mm" height="50mm"><text x="50" y="40" font-size="10" text-anchor="end">Hi</text></svg>');
    const { entities, texts } = ok(await engine.readDrawing(svg, 'svg', 'd'));
    const label = entities.find((e) => e.kind === 'text');
    // An em size of 10 makes capitals about 7.3 tall; the end of the text is at x = 50.
    expect(label).toMatchObject({ text: 'Hi', height: expect.closeTo(7.275, 2) });
    const xs = [...texts.values()].flat(2).map((e) => e.end[0]);
    expect(Math.max(...xs)).toBeLessThan(50);
    expect(Math.max(...xs)).toBeGreaterThan(48);
    const dxf = text(ok(await engine.convert(svg, 'svg', 'dxf')));
    expect(dxf).toContain('POLYLINE');
  });

  it('converts between formats of the same kind', async () => {
    const step = await plateStep();
    const stl = ok(await engine.convert(step, 'step', 'stl'));
    const [mesh] = readStl(stl);
    expect(meshVolume(mesh?.positions ?? [], mesh?.indices ?? [])).toBeCloseTo(3200, 0);
    const mf = ok(await engine.convert(writeStl([cubeMesh]), 'stl', '3mf'));
    expect((await readZip(mf)).has('3D/3dmodel.model')).toBe(true);
    const fromMesh = ok(await engine.convert(writeStl([cubeMesh]), 'stl', 'step'));
    expect(measureVolume((await importSTEP(new Blob([fromMesh as BlobPart]))) as Shape3D)).toBeCloseTo(1000, 3);
    const svg = ok(await engine.convert(await engine.exportDrawing(plate(), 'dxf'), 'dxf', 'svg'));
    expect(text(svg)).toContain('<circle');
    expect(await engine.convert(svg, 'svg', 'stl')).toMatchObject({ ok: false, error: { message: expect.stringContaining('Drawings convert to drawings') } });
  });
});
