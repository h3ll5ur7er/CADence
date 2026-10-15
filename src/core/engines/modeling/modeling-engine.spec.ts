import { createShapeAccess, type NamedShape } from '@core/access/shape';
import { measureVolume } from 'replicad';
import { originFrames, type TopologyRef } from '@core/contracts';
import { curveArea, curveAt } from '@core/utilities/math';
import { circleLoop, profile, rectangleLoop } from '@core/contracts/testing/profiles';
import { beforeAll, describe, expect, it } from 'vitest';
import { type BodyState, createModelingEngine, type ModelingEngine, type ModelingOutcome } from './index';

let engine: ModelingEngine;
const shapes = createShapeAccess();
beforeAll(() => {
  engine = createModelingEngine(shapes);
});

const XY = originFrames.XY;
const plateProfile = profile(rectangleLoop(0, 0, 80, 40, 'plate'));

function ok(outcome: ModelingOutcome): readonly BodyState[] {
  if (outcome.error) throw new Error(outcome.error);
  return outcome.bodies;
}

async function plate(distance = 5, key = `plate-${distance}`): Promise<ModelingOutcome> {
  return engine.apply({
    type: 'extrude',
    feature: 'plate',
    key,
    bodies: [],
    frame: XY,
    profiles: [plateProfile],
    distance,
    direction: 'normal',
    operation: 'new-body',
  });
}

async function volume(bodies: readonly BodyState[]): Promise<number> {
  return bodies.reduce((sum, b) => sum + measureVolume((shapes.get(b.key) as NamedShape).shape), 0);
}

async function names(bodies: readonly BodyState[]) {
  const [mesh] = await engine.tessellate(bodies);
  return { faces: mesh?.faces.map((f) => f.name).sort() ?? [], edges: mesh?.edges.map((e) => e.name) ?? [] };
}

describe('ModelingEngine', () => {
  it('extrudes a profile and names faces by how they were made', async () => {
    const bodies = ok(await plate());
    expect(bodies).toEqual([{ id: 'plate', key: 'plate-5:plate' }]);
    expect(await volume(bodies)).toBeCloseTo(80 * 40 * 5);
    expect((await names(bodies)).faces).toEqual([
      'f:plate:end',
      'f:plate:side:plate-bottom',
      'f:plate:side:plate-left',
      'f:plate:side:plate-right',
      'f:plate:side:plate-top',
      'f:plate:start',
    ]);
    expect((await names(bodies)).edges).toContain('e:f:plate:end|f:plate:side:plate-top');
  });

  it('extrudes ellipses and spline pieces exactly, naming their sides', async () => {
    const ellipse = { center: [0, 0] as const, a: 20, b: 10, rotation: Math.PI / 6 };
    const at = (t: number) => curveAt({ kind: 'ellipse', ellipse }, t);
    const oval = profile({
      edges: [
        { kind: 'ellipse', source: 'oval', start: at(0), end: at(Math.PI), ...ellipse, ccw: true },
        { kind: 'ellipse', source: 'oval', start: at(Math.PI), end: at(0), ...ellipse, ccw: true },
      ],
      polygon: [],
    });
    const solid = ok(await engine.apply({ type: 'extrude', feature: 'o', key: 'oval', bodies: [], frame: XY, profiles: [oval], distance: 4, direction: 'normal', operation: 'new-body' }));
    expect(await volume(solid)).toBeCloseTo(Math.PI * 20 * 10 * 4, 6);
    expect((await names(solid)).faces).toEqual(['f:o:end', 'f:o:side:oval~1', 'f:o:side:oval~2', 'f:o:start']);

    const curve = { kind: 'bezier' as const, points: [[40, 0], [40, 20], [0, 20], [0, 0]] as const };
    const dome = profile({
      edges: [
        { kind: 'line', source: 'floor', start: [0, 0], end: [40, 0] },
        { kind: 'bezier', source: 'roof', start: [40, 0], c1: [40, 20], c2: [0, 20], end: [0, 0] },
      ],
      polygon: [],
    });
    const area = curveArea(curve, 0, 1);
    const shape = ok(await engine.apply({ type: 'extrude', feature: 'd', key: 'dome', bodies: [], frame: XY, profiles: [dome], distance: 3, direction: 'normal', operation: 'new-body' }));
    expect(await volume(shape)).toBeCloseTo(area * 3, 6);
    expect((await names(shape)).faces).toContain('f:d:side:roof');
  });

  it('extrudes with holes, in reverse and symmetrically', async () => {
    const holed = profile(rectangleLoop(0, 0, 80, 40), [circleLoop(40, 20, 6, 'hole', false)]);
    for (const direction of ['normal', 'reverse', 'symmetric'] as const) {
      const bodies = ok(
        await engine.apply({ type: 'extrude', feature: 'f', key: `holed-${direction}`, bodies: [], frame: XY, profiles: [holed], distance: 10, direction, operation: 'new-body' }),
      );
      expect(await volume(bodies)).toBeCloseTo(80 * 40 * 10 - Math.PI * 36 * 10, 3);
    }
  });

  it('cuts holes, joins bosses and intersects', async () => {
    const base = ok(await plate());
    const cut = ok(
      await engine.apply({ type: 'extrude', feature: 'hole', key: 'cut', bodies: base, frame: XY, profiles: [profile(circleLoop(20, 20, 5, 'hole-circle'))], distance: 5, direction: 'normal', operation: 'cut' }),
    );
    expect(await volume(cut)).toBeCloseTo(16000 - Math.PI * 25 * 5, 3);
    expect((await names(cut)).faces).toContain('f:hole:side:hole-circle');

    const boss = ok(
      await engine.apply({ type: 'extrude', feature: 'boss', key: 'join', bodies: cut, frame: { ...XY, origin: [0, 0, 5] }, profiles: [profile(circleLoop(60, 20, 8, 'boss-circle'))], distance: 10, direction: 'normal', operation: 'join' }),
    );
    expect(boss).toHaveLength(1);
    expect(await volume(boss)).toBeCloseTo(16000 - Math.PI * 25 * 5 + Math.PI * 64 * 10, 2);

    const common = ok(
      await engine.apply({ type: 'extrude', feature: 'keep', key: 'common', bodies: base, frame: XY, profiles: [profile(rectangleLoop(0, 0, 10, 10))], distance: 50, direction: 'normal', operation: 'intersect' }),
    );
    expect(await volume(common)).toBeCloseTo(10 * 10 * 5);
  });

  it('revolves profiles around an axis', async () => {
    const ring = profile(rectangleLoop(10, 0, 5, 20, 'ring'));
    const full = ok(
      await engine.apply({ type: 'revolve', feature: 'ring', key: 'ring', bodies: [], frame: originFrames.XZ, profiles: [ring], axis: { origin: [0, 0, 0], direction: [0, 0, 1] }, angle: 2 * Math.PI, operation: 'new-body' }),
    );
    expect(await volume(full)).toBeCloseTo(Math.PI * (15 * 15 - 10 * 10) * 20, 3);
    expect((await names(full)).faces).toEqual(expect.arrayContaining(['f:ring:side:ring-left', 'f:ring:side:ring-right', 'f:ring:side:ring-top']));

    const half = ok(
      await engine.apply({ type: 'revolve', feature: 'half', key: 'half', bodies: [], frame: originFrames.XZ, profiles: [ring], axis: { origin: [0, 0, 0], direction: [0, 0, 1] }, angle: Math.PI, operation: 'new-body' }),
    );
    expect(await volume(half)).toBeCloseTo((Math.PI * (15 * 15 - 10 * 10) * 20) / 2, 3);
    expect((await names(half)).faces).toEqual(expect.arrayContaining(['f:half:start', 'f:half:end']));
  });

  it('keeps edge references valid when an earlier dimension changes', async () => {
    const edge: TopologyRef = { kind: 'edge', body: 'plate', name: 'e:f:plate:end|f:plate:side:plate-top' };
    for (const distance of [5, 12]) {
      const base = ok(await plate(distance));
      const rounded = ok(await engine.apply({ type: 'fillet', feature: 'round', key: `round-${distance}`, bodies: base, edges: [edge], size: 2 }));
      const removed = (4 - Math.PI) * 80; // 2 mm fillet along an 80 mm edge removes (r² - πr²/4) per mm
      expect(await volume(rounded)).toBeCloseTo(80 * 40 * distance - removed, 2);
      expect((await names(rounded)).faces).toContain(`f:round:round:${edge.name}`);
    }
  });

  it('chamfers edges and reports impossible sizes', async () => {
    const base = ok(await plate());
    const edge: TopologyRef = { kind: 'edge', body: 'plate', name: 'e:f:plate:end|f:plate:side:plate-left' };
    const bevelled = ok(await engine.apply({ type: 'chamfer', feature: 'bevel', key: 'bevel', bodies: base, edges: [edge], size: 1 }));
    expect(await volume(bevelled)).toBeCloseTo(16000 - 0.5 * 40, 2);
    const tooBig = await engine.apply({ type: 'fillet', feature: 'big', key: 'big', bodies: base, edges: [edge], size: 30 });
    expect(tooBig.error).toMatch(/geometry kernel could not build/);
    const lost = await engine.apply({ type: 'fillet', feature: 'x', key: 'lost', bodies: base, edges: [{ ...edge, name: 'e:nothing' }], size: 1 });
    expect(lost.error).toMatch(/no longer exists/);
  });

  it('shells a body, opening the picked faces', async () => {
    const cube = ok(
      await engine.apply({ type: 'extrude', feature: 'cube', key: 'cube', bodies: [], frame: XY, profiles: [profile(rectangleLoop(0, 0, 20, 20, 'cube'))], distance: 20, direction: 'normal', operation: 'new-body' }),
    );
    const top: TopologyRef = { kind: 'face', body: 'cube', name: 'f:cube:end' };
    const cup = ok(await engine.apply({ type: 'shell', feature: 'cup', key: 'cup', bodies: cube, faces: [top], thickness: 2 }));
    expect(await volume(cup)).toBeCloseTo(20 * 20 * 20 - 16 * 16 * 18, 2);
  });

  it('repeats and mirrors the effect of earlier features', async () => {
    const base = ok(await plate());
    const hole = await engine.apply({ type: 'extrude', feature: 'hole', key: 'hole-for-pattern', bodies: base, frame: XY, profiles: [profile(circleLoop(10, 10, 3, 'h'))], distance: 5, direction: 'normal', operation: 'cut' });
    const tools = [{ feature: 'hole', toolKey: hole.toolKey as string, operation: 'cut' as const }];
    const one = 16000 - Math.PI * 9 * 5;

    const linear = ok(await engine.apply({ type: 'linear-pattern', feature: 'row', key: 'row', bodies: hole.bodies, tools, direction: { origin: [0, 0, 0], direction: [1, 0, 0] }, count: 3, spacing: 20 }));
    expect(await volume(linear)).toBeCloseTo(16000 - 3 * Math.PI * 9 * 5, 2);

    const circular = ok(
      await engine.apply({ type: 'circular-pattern', feature: 'ring', key: 'ring-pattern', bodies: hole.bodies, tools, axis: { origin: [20, 20, 0], direction: [0, 0, 1] }, count: 4, angle: 2 * Math.PI }),
    );
    expect(await volume(circular)).toBeCloseTo(16000 - 4 * Math.PI * 9 * 5, 2);

    const mirrored = ok(await engine.apply({ type: 'mirror', feature: 'mirror', key: 'mirror', bodies: hole.bodies, tools, plane: { origin: [40, 0, 0], u: [0, 1, 0], v: [0, 0, 1] } }));
    expect(await volume(mirrored)).toBeCloseTo(one - Math.PI * 9 * 5, 2);
    expect((await names(mirrored)).faces.some((n) => n.endsWith('@mirror.1'))).toBe(true);
  });

  it('gives the plane of a flat face', async () => {
    const base = ok(await plate());
    const frame = await engine.planeOf(base, { kind: 'face', body: 'plate', name: 'f:plate:end' });
    expect(frame.ok && frame.value.origin).toEqual([expect.closeTo(40), expect.closeTo(20), expect.closeTo(5)]);
    const curved = await engine.planeOf(ok(await engine.apply({ type: 'extrude', feature: 'c', key: 'cyl', bodies: [], frame: XY, profiles: [profile(circleLoop(0, 0, 5, 'cyl'))], distance: 5, direction: 'normal', operation: 'new-body' })), { kind: 'face', body: 'c', name: 'f:c:side:cyl' });
    expect(curved).toMatchObject({ ok: false, error: { code: 'not-planar' } });
  });

  it('returns cached outcomes for equal keys', async () => {
    expect(await plate(5, 'same')).toBe(await plate(5, 'same'));
  });

  it('tessellates with named faces and edges', async () => {
    const [mesh] = await engine.tessellate(ok(await plate()));
    expect(mesh?.faces).toHaveLength(6);
    expect(mesh?.edges).toHaveLength(12);
    expect(mesh?.indices.length).toBeGreaterThanOrEqual(36);
    expect(mesh?.edgePositions.length).toBeGreaterThan(0);
  });
});

describe('face planes', () => {
  it('orient like the origin planes', async () => {
    const shapes = createShapeAccess();
    const local = createModelingEngine(shapes);
    const box = await local.apply({ type: 'extrude', feature: 'box', key: 'orient', bodies: [], frame: originFrames.XY, profiles: [profile(rectangleLoop(0, 0, 10, 10, 'box'))], distance: 10, direction: 'normal', operation: 'new-body' });
    const top = await local.planeOf(box.bodies, { kind: 'face', body: 'box', name: 'f:box:end' });
    const front = await local.planeOf(box.bodies, { kind: 'face', body: 'box', name: 'f:box:side:box-bottom' });
    const round = (v: readonly number[]) => v.map((x) => Math.round(x * 1e6) / 1e6 + 0);
    expect(top.ok && [round(top.value.u), round(top.value.v)]).toEqual([[1, 0, 0], [0, 1, 0]]);
    expect(front.ok && [round(front.value.u), round(front.value.v)]).toEqual([[1, 0, 0], [0, 0, 1]]);
  });
});

describe('component results and joint frames', () => {
  const round = (v: readonly number[]) => v.map((x) => Math.round(x * 1e6) / 1e6 + 0);
  const holed = profile(rectangleLoop(0, 0, 80, 40, 'plate'), [circleLoop(20, 20, 5, 'hole', false)]);
  const holedPlate = () =>
    engine.apply({ type: 'extrude', feature: 'plate', key: 'joint-plate', bodies: [], frame: XY, profiles: [holed], distance: 6, direction: 'normal', operation: 'new-body' });

  it('restores a snapshot with the same solid and names', async () => {
    const bodies = ok(await holedPlate());
    const snapshot = await engine.snapshot(bodies);
    const fresh = createShapeAccess();
    const restored = await createModelingEngine(fresh).restore(snapshot, 'result:doc');
    expect(restored).toEqual([{ id: 'plate', key: 'result:doc:plate' }]);
    expect(measureVolume((fresh.get('result:doc:plate') as NamedShape).shape)).toBeCloseTo(80 * 40 * 6 - Math.PI * 25 * 6, 6);
    const [before] = await engine.tessellate(bodies);
    const [after] = await createModelingEngine(fresh).tessellate(restored);
    expect(after?.faces.map((f) => f.name).sort()).toEqual(before?.faces.map((f) => f.name).sort());
    expect(after?.edges.map((e) => e.name).sort()).toEqual(before?.edges.map((e) => e.name).sort());
  });

  it('puts joint frames on face centres, hole axes and circular edges', async () => {
    const bodies = ok(await holedPlate());
    const top = await engine.frameOf(bodies, { kind: 'face', body: 'plate', name: 'f:plate:end' });
    // The centroid of the face, which the hole pulls to the right.
    const area = 80 * 40 - Math.PI * 25;
    expect(top.ok && top.value.origin[0]).toBeCloseTo((80 * 40 * 40 - Math.PI * 25 * 20) / area, 6);
    expect(top.ok && round(top.value.origin.slice(1))).toEqual([20, 6]);
    const hole = await engine.frameOf(bodies, { kind: 'face', body: 'plate', name: 'f:plate:side:hole' });
    expect(hole.ok && round(hole.value.origin)).toEqual([20, 20, 3]);
    expect(hole.ok && round(normal(hole.value))).toEqual([0, 0, 1]); // holes point up, whatever the kernel says
    const rim = await engine.frameOf(bodies, { kind: 'edge', body: 'plate', name: 'e:f:plate:end|f:plate:side:hole' });
    expect(rim.ok && round(rim.value.origin)).toEqual([20, 20, 6]);
  });
});

const normal = (f: { u: readonly number[]; v: readonly number[] }) => [
  (f.u[1] as number) * (f.v[2] as number) - (f.u[2] as number) * (f.v[1] as number),
  (f.u[2] as number) * (f.v[0] as number) - (f.u[0] as number) * (f.v[2] as number),
  (f.u[0] as number) * (f.v[1] as number) - (f.u[1] as number) * (f.v[0] as number),
];
