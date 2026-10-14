import { createShapeAccess, type NamedShape } from '@core/access/shape';
import { type Check, type LaserProfile, type PrintProfile, type TopologyRef, type Vec3 } from '@core/contracts';
import { SketchBuilder } from '@core/contracts/testing/sketch-builder';
import { circleLoop, profile, rectangleLoop } from '@core/contracts/testing/profiles';
import { drawCircle, drawRectangle, type Edge, type Face, makeBaseBox, type Shape3D, weldShellsAndFaces } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { type AnalysisEngine, createAnalysisEngine, type NamedBody } from './index';

const shapes = createShapeAccess();
let engine: AnalysisEngine;
beforeAll(async () => {
  engine = createAnalysisEngine(shapes);
  await shapes.ready();
});

/** Stores a shape with faces named face0, face1, … and edges edge0, edge1, …; returns it as a body. */
function body(id: string, shape: Shape3D): NamedBody & { named: NamedShape } {
  const named: NamedShape = {
    shape,
    faces: new Map(shape.faces.map((f, i) => [f.hashCode, `face${i}`])),
    edges: new Map(shape.edges.map((e, i) => [e.hashCode, `edge${i}`])),
  };
  shapes.put(id, named);
  return { id, key: id, name: id, named };
}

function faceRef(b: { id: string; named: NamedShape }, test: (face: Face) => boolean): TopologyRef {
  const face = b.named.shape.faces.find(test);
  if (!face) throw new Error('No such face');
  return { kind: 'face', body: b.id, name: b.named.faces.get(face.hashCode) as string };
}

function edgeRef(b: { id: string; named: NamedShape }, test: (edge: Edge) => boolean): TopologyRef {
  const edge = b.named.shape.edges.find(test);
  if (!edge) throw new Error('No such edge');
  return { kind: 'edge', body: b.id, name: b.named.edges.get(edge.hashCode) as string };
}

const at = (face: Face | Edge, axis: 0 | 1 | 2, value: number) => Math.abs((face.boundingBox.center as Vec3)[axis] - value) < 1e-6;

/** 40 × 20 × 10 block centred on the Z axis with an 8 mm hole through it. */
const block = () =>
  body(
    'block',
    (drawRectangle(40, 20).sketchOnPlane('XY').extrude(10) as Shape3D).cut(drawCircle(4).sketchOnPlane('XY').extrude(10) as Shape3D),
  );

const fdm: PrintProfile = { kind: 'print', name: 'test', bed: [250, 200, 200], nozzle: 0.4, layerHeight: 0.2, maxOverhang: 45 };
const byId = (checks: readonly Check[], id: string) => checks.find((c) => c.id === id) as Check;

describe('AnalysisEngine measure', () => {
  it('measures area of faces and the radius of a cylinder', async () => {
    const b = block();
    const top = await engine.measure([b], [faceRef(b, (f) => at(f, 2, 10))]);
    expect(top.ok && top.value.area).toBeCloseTo(800 - Math.PI * 16, 6);
    expect(top.ok && top.value.radius).toBeUndefined();
    const hole = await engine.measure([b], [faceRef(b, (f) => f.geomType === 'CYLINDRE')]);
    expect(hole.ok && hole.value).toMatchObject({ radius: 4 });
    expect(hole.ok && hole.value.area).toBeCloseTo(2 * Math.PI * 4 * 10, 6);
  });

  it('measures length and radius of edges', async () => {
    const b = block();
    const circle = await engine.measure([b], [edgeRef(b, (e) => e.geomType === 'CIRCLE' && at(e, 2, 10))]);
    expect(circle.ok && circle.value.length).toBeCloseTo(8 * Math.PI, 6);
    expect(circle.ok && circle.value.radius).toBeCloseTo(4, 9);
  });

  it('measures distance, closest points and angle between two picks', async () => {
    const b = block();
    const top = faceRef(b, (f) => at(f, 2, 10));
    const bottom = faceRef(b, (f) => at(f, 2, 0) && f.geomType === 'PLANE');
    const side = faceRef(b, (f) => at(f, 0, 20));
    const parallel = await engine.measure([b], [top, bottom]);
    expect(parallel.ok && parallel.value).toMatchObject({ distance: 10, angle: 0 });
    const points = parallel.ok ? parallel.value.points : undefined;
    expect(points?.[0][2]).toBeCloseTo(10);
    expect(points?.[1][2]).toBeCloseTo(0);
    const square = await engine.measure([b], [top, side]);
    expect(square.ok && square.value.angle).toBeCloseTo(Math.PI / 2, 9);
    expect(square.ok && square.value.distance).toBeCloseTo(0, 9);
    const edges = await engine.measure([b], [
      edgeRef(b, (e) => e.geomType === 'LINE' && at(e, 1, -10) && at(e, 2, 10)),
      edgeRef(b, (e) => e.geomType === 'LINE' && at(e, 1, 10) && at(e, 2, 0)),
    ]);
    expect(edges.ok && edges.value.distance).toBeCloseTo(Math.hypot(20, 10), 9);
    expect(edges.ok && edges.value.angle).toBeCloseTo(0, 9);
    expect(edges.ok && edges.value.length).toBeCloseTo(80, 9);
  });

  it('fails for references that no longer exist', async () => {
    const b = block();
    const result = await engine.measure([b], [{ kind: 'face', body: 'block', name: 'gone' }]);
    expect(result.ok || result.error.code).toBe('missing-reference');
  });
});

describe('AnalysisEngine properties', () => {
  it('gives volume, mass, area, centre of mass and bounding box', async () => {
    const [p] = await engine.properties([block()], 1.24);
    const volume = 40 * 20 * 10 - Math.PI * 16 * 10;
    expect(p?.volume).toBeCloseTo(volume, 6);
    expect(p?.mass).toBeCloseTo((volume * 1.24) / 1000, 6);
    expect(p?.area).toBeCloseTo(2 * (800 - Math.PI * 16) + 2 * (40 * 10 + 20 * 10) + 2 * Math.PI * 4 * 10, 6);
    expect(p?.centerOfMass.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 5]);
    expect(p?.box).toEqual({ min: [-20, -10, 0], max: [20, 10, 10] });
  });
});

describe('AnalysisEngine print checks', () => {
  it('passes a plain block', async () => {
    const checks = await engine.validate({ bodies: [block()], sketches: [] }, fdm);
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ['closed', 'pass'],
      ['bed', 'pass'],
      ['overhang', 'pass'],
      ['walls', 'pass'],
    ]);
  });

  it('fails open shells', async () => {
    const box = makeBaseBox(10, 10, 10);
    const open = body('open', weldShellsAndFaces(box.faces.slice(1)) as unknown as Shape3D);
    expect(byId(await engine.validate({ bodies: [open], sketches: [] }, fdm), 'closed').status).toBe('fail');
  });

  it('checks the build volume, turned by 90° if that helps', async () => {
    const wide = body('wide', makeBaseBox(230, 20, 5));
    const deep = body('deep', makeBaseBox(20, 230, 5));
    const huge = body('huge', makeBaseBox(300, 20, 5));
    expect(byId(await engine.validate({ bodies: [wide], sketches: [] }, fdm), 'bed').status).toBe('pass');
    const turned = byId(await engine.validate({ bodies: [deep], sketches: [] }, fdm), 'bed');
    expect(turned).toMatchObject({ status: 'warning', message: expect.stringContaining('turned by 90°') });
    const tooBig = byId(await engine.validate({ bodies: [huge], sketches: [] }, fdm), 'bed');
    expect(tooBig).toMatchObject({ status: 'fail', message: expect.stringContaining('huge (300 × 20 × 5 mm)') });
  });

  it('flags faces overhanging more than the printer manages', async () => {
    // A 30 × 30 slab on a 10 × 10 post: the slab's underside hangs in the air.
    const mushroom = body('mushroom', makeBaseBox(10, 10, 10).fuse(makeBaseBox(30, 30, 5).translateZ(10)));
    const check = byId(await engine.validate({ bodies: [mushroom], sketches: [] }, fdm), 'overhang');
    expect(check.status).toBe('warning');
    expect(check.message).toContain('800 mm²');
    const underside = mushroom.named.shape.faces.find((f) => at(f, 2, 10) && f.normalAt(f.center).z < 0);
    expect(check.faces?.map((f) => f.name)).toEqual([mushroom.named.faces.get(underside?.hashCode ?? 0)]);
    // A 45° chamfer under the slab is still fine.
    expect(byId(await engine.validate({ bodies: [mushroom], sketches: [] }, { ...fdm, maxOverhang: 90 }), 'overhang').status).toBe('pass');
  });

  it('finds walls thinner than the nozzle allows', async () => {
    const shellOf = (wall: number) => makeBaseBox(20, 20, 20).cut(makeBaseBox(20 - 2 * wall, 20 - 2 * wall, 20).translateZ(wall));
    const fine = byId(await engine.validate({ bodies: [body('fine', shellOf(1))], sketches: [] }, fdm), 'walls');
    expect(fine.status).toBe('pass');
    const weak = byId(await engine.validate({ bodies: [body('weak', shellOf(0.6))], sketches: [] }, fdm), 'walls');
    expect(weak).toMatchObject({ status: 'warning', message: expect.stringContaining('0.6 mm') });
    expect(weak.faces?.length).toBe(10); // four walls and the floor, inside and outside
    const broken = byId(await engine.validate({ bodies: [body('broken', shellOf(0.3))], sketches: [] }, fdm), 'walls');
    expect(broken).toMatchObject({ status: 'fail', message: expect.stringContaining('0.3 mm') });
  });
});

describe('AnalysisEngine laser checks', () => {
  const laser: LaserProfile = { kind: 'laser', name: 'test', bed: [300, 200], kerf: 0.2, thickness: 3 };

  /** A 100 × 50 plate with a 4 mm hole, as sketch and profile; `extra` adds a loose line. */
  function plate(width = 100, extra = false, hole = 4) {
    const b = new SketchBuilder();
    const [p1, p2, p3, p4] = [b.point(0, 0), b.point(width, 0), b.point(width, 50), b.point(0, 50)] as [string, string, string, string];
    b.line(p1, p2, false, 'r-bottom');
    b.line(p2, p3, false, 'r-right');
    b.line(p3, p4, false, 'r-top');
    b.line(p4, p1, false, 'r-left');
    b.circle(b.point(20, 25), hole, false, 'hole');
    if (extra) b.line(b.point(40, 10), b.point(60, 10));
    const sketch = b.build();
    return { sketch, profiles: [profile(rectangleLoop(0, 0, width, 50, 'r'), [circleLoop(20, 25, hole, 'hole', false)])] };
  }

  it('passes a closed plate that fits the bed', async () => {
    const checks = await engine.validate({ bodies: [body('sheet', makeBaseBox(100, 50, 3))], sketches: [plate()] }, laser);
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ['sheet', 'pass'],
      ['outlines', 'pass'],
      ['bed', 'pass'],
      ['kerf', 'pass'],
    ]);
  });

  it('warns about open curves, wrong sheet thickness, and fails oversize sketches and tiny holes', async () => {
    const checks = await engine.validate({ bodies: [body('thick', makeBaseBox(100, 50, 5))], sketches: [plate(400, true, 0.05)] }, laser);
    expect(byId(checks, 'sheet')).toMatchObject({ status: 'warning', message: 'thick is 5 mm thick; the sheet is 3 mm.' });
    expect(byId(checks, 'outlines')).toMatchObject({ status: 'warning', message: expect.stringContaining('Sketch 1 has 1 open curve') });
    expect(byId(checks, 'bed')).toMatchObject({ status: 'fail', message: expect.stringContaining('400 × 50 mm') });
    expect(byId(checks, 'kerf').status).toBe('fail');
  });

  it('has nothing to check without sketches or bodies', async () => {
    expect(await engine.validate({ bodies: [], sketches: [] }, laser)).toMatchObject([{ status: 'fail' }]);
  });
});

describe('AnalysisEngine interference', () => {
  it('finds overlapping instances and ignores touching ones', async () => {
    const cube = body('cube', makeBaseBox(10, 10, 10));
    const at = (x: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
    const parts = [
      { instance: 'a', bodies: [cube], transform: at(0) },
      { instance: 'b', bodies: [cube], transform: at(8) }, // 2 mm into a
      { instance: 'c', bodies: [cube], transform: at(18) }, // touches b
    ];
    const found = await engine.interference(parts);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ a: 'a', b: 'b' });
    expect(found[0]?.volume).toBeCloseTo(2 * 10 * 10, 6);
    expect(found[0]?.center[0]).toBeCloseTo(4, 6); // makeBaseBox is centred on x; the overlap spans 3 to 5
  });
});
