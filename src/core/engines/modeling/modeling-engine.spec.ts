import { createShapeAccess, type NamedShape } from '@core/access/shape';
import { measureVolume } from 'replicad';
import { originFrames, type PlaneFrame, type TopologyRef } from '@core/contracts';
import { curveArea, curveAt, splineBeziers } from '@core/utilities/math';
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

  it('joins pads whose end touches a revolved body, alone and patterned (CAD-103)', async () => {
    const outline: [number, number][] = [[24, 60], [45, 60], [45, 36], [105, 36], [105, -36], [45, -36], [45, -60], [24, -60], [24, -30], [78, -30], [78, 30], [24, 30]];
    const drum = profile(polygonLoop(outline, 'drum'));
    const zAxis = { origin: [0, 0, 0] as const, direction: [0, 0, 1] as const };
    const base = ok(await engine.apply({ type: 'revolve', feature: 'drum', key: 'drum', bodies: [], frame: originFrames.XZ, profiles: [drum], axis: zAxis, angle: 2 * Math.PI, operation: 'new-body' }));
    const seat = { ...originFrames.YZ, origin: [105, 0, 0] as const };
    for (const d of [58, 61, 65]) {
      const pad = await engine.apply({ type: 'extrude', feature: 'pad', key: `pad-${d}`, bodies: base, frame: seat, profiles: [profile(circleLoop(0, 0, d / 2, 'pad'))], distance: 15, direction: 'reverse', operation: 'join' });
      const padded = ok(pad);
      const tools = [{ feature: 'pad', toolKey: pad.toolKey as string, operation: 'join' as const }];
      const patterned = ok(await engine.apply({ type: 'circular-pattern', feature: 'pads', key: `pads-${d}`, bodies: padded, tools, axis: zAxis, count: 9, angle: (320 * Math.PI) / 180 }));
      expect((await volume(patterned)) - (await volume(base))).toBeGreaterThan(9 * ((Math.PI * d * d) / 4) * 1);
    }
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

  it('names each bevel and round after its own edge, without hints (CAD-101)', async () => {
    const base = ok(await plate());
    const edges = ['left', 'right', 'top'].map((side): TopologyRef => ({ kind: 'edge', body: 'plate', name: `e:f:plate:end|f:plate:side:plate-${side}` }));
    for (const type of ['chamfer', 'fillet'] as const) {
      const treated = ok(await engine.apply({ type, feature: 'x', key: `${type}-no-hints`, bodies: base, edges, size: 1 }));
      const made = (await names(treated)).faces.filter((f) => f.startsWith('f:x:'));
      const role = type === 'chamfer' ? 'bevel' : 'round';
      expect(made).toEqual(edges.map((e) => `f:x:${role}:${e.name}`).sort());
    }
  });

  describe('names on shared surfaces (CAD-104)', () => {
    it('names faces of one revolve after their own outline, though they share a surface', async () => {
      const outlines = [profile(rectangleLoop(0, 25, 15, 35, 'front'), [], 'p1'), profile(rectangleLoop(0, -60, 15, 35, 'rear'), [], 'p2')];
      const shaft = ok(await engine.apply({ type: 'revolve', feature: 'shaft', key: 'two-outlines', bodies: [], frame: originFrames.XZ, profiles: outlines, axis: { origin: [0, 0, 0], direction: [0, 0, 1] }, angle: 2 * Math.PI, operation: 'new-body' }));
      const [mesh] = await engine.tessellate(shaft);
      const journal = (name: string) => mesh?.faces.find((f) => f.name === name)?.center[2] as number;
      expect(journal('f:shaft:side:front-right')).toBeGreaterThan(0);
      expect(journal('f:shaft:side:rear-right')).toBeLessThan(0);
    });

    it('keeps the number of a split face that a later feature leaves alone', async () => {
      const slot = (bodies: readonly BodyState[], x: number) =>
        engine.apply({ type: 'extrude', feature: `slot${x}`, key: `keep-slot-${x}-${bodies[0]?.key}`, bodies, frame: { ...XY, origin: [0, 0, 5] }, profiles: [profile(rectangleLoop(x, -1, 4, 42, `slot${x}`))], distance: 2, direction: 'reverse', operation: 'cut' });
      const once = ok(await slot(ok(await plate()), 38));
      const right = async (bodies: readonly BodyState[]) => (await engine.tessellate(bodies))[0]?.faces.find((f) => f.name.startsWith('f:plate:end') && f.center[0] > 42)?.name;
      expect(await right(once)).toBe('f:plate:end~2');
      // A second slot splits the left piece in two; the right piece keeps its name.
      const twice = ok(await slot(once, 18));
      expect(await right(twice)).toBe('f:plate:end~2');
      expect((await names(twice)).faces.filter((f) => f.startsWith('f:plate:end'))).toEqual(['f:plate:end~1', 'f:plate:end~2', 'f:plate:end~3']);
    });

    it('numbers patterned bodies without gaps', async () => {
      const pin = await engine.apply({ type: 'extrude', feature: 'pin', key: 'pin', bodies: [], frame: XY, profiles: [profile(circleLoop(20, 0, 2, 'pin'))], distance: 5, direction: 'normal', operation: 'new-body' });
      const tools = [{ feature: 'pin', toolKey: pin.toolKey as string, operation: 'new-body' as const }];
      const pins = ok(await engine.apply({ type: 'circular-pattern', feature: 'pins', key: 'pins', bodies: ok(pin), tools, axis: { origin: [0, 0, 0], direction: [0, 0, 1] }, count: 4, angle: 2 * Math.PI }));
      expect(pins.map((b) => b.id)).toEqual(['pin', 'pins', 'pins:2', 'pins:3']);
    });
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

  describe('body operations', () => {
    /** The 80 × 40 × 5 plate and a 10 × 10 × 20 post standing through it at (10, 10). */
    async function plateAndPost(): Promise<readonly BodyState[]> {
      const bodies = ok(await plate());
      const post = profile(rectangleLoop(5, 5, 10, 10, 'post'));
      return ok(await engine.apply({ type: 'extrude', feature: 'post', key: 'post', bodies, frame: XY, profiles: [post], distance: 20, direction: 'normal', operation: 'new-body' }));
    }

    it('combines bodies: joins, cuts or intersects, and uses the tools up unless kept', async () => {
      const bodies = await plateAndPost();
      const joined = ok(await engine.apply({ type: 'combine', feature: 'c', key: 'c-join', bodies, target: 'plate', tools: ['post'], operation: 'join', keepTools: false }));
      expect(joined.map((b) => b.id)).toEqual(['plate']);
      expect(await volume(joined)).toBeCloseTo(80 * 40 * 5 + 10 * 10 * 15);
      const cut = ok(await engine.apply({ type: 'combine', feature: 'c', key: 'c-cut', bodies, target: 'plate', tools: ['post'], operation: 'cut', keepTools: true }));
      expect(cut.map((b) => b.id)).toEqual(['plate', 'post']);
      expect(await volume(cut.slice(0, 1))).toBeCloseTo(80 * 40 * 5 - 10 * 10 * 5);
      expect((await names(cut.slice(0, 1))).faces).toContain('f:post:side:post-left');
      const both = ok(await engine.apply({ type: 'combine', feature: 'c', key: 'c-int', bodies, target: 'plate', tools: ['post'], operation: 'intersect', keepTools: false }));
      expect(await volume(both)).toBeCloseTo(10 * 10 * 5);
    });

    it('splits a body by a plane into two named pieces', async () => {
      const bodies = ok(await plate());
      const frame = { origin: [30, 0, 0] as const, u: [0, 1, 0] as const, v: [0, 0, 1] as const }; // normal +X
      const split = ok(await engine.apply({ type: 'split', feature: 's', key: 'split', bodies, body: 'plate', plane: frame }));
      expect(split.map((b) => b.id)).toEqual(['plate', 's']);
      expect(await volume(split.slice(0, 1))).toBeCloseTo(50 * 40 * 5);
      expect(await volume(split.slice(1))).toBeCloseTo(30 * 40 * 5);
      expect((await names(split.slice(0, 1))).faces).toContain('f:s:split');
      const miss = await engine.apply({ type: 'split', feature: 's', key: 'split-miss', bodies, body: 'plate', plane: { ...frame, origin: [200, 0, 0] } });
      expect(miss.error).toBe('The plane does not cut through the body.');
    });

    it('moves, turns, copies and scales bodies, keeping their face names', async () => {
      const bodies = ok(await plate());
      const moved = ok(await engine.apply({ type: 'move', feature: 'm', key: 'move', bodies, bodyIds: ['plate'], translation: [0, 0, 10], rotation: { axis: { origin: [0, 0, 0], direction: [0, 0, 1] }, angle: Math.PI / 2 }, copy: false }));
      expect(moved.map((b) => b.id)).toEqual(['plate']);
      const box = (shapes.get(moved[0]?.key as string) as NamedShape).shape.boundingBox.bounds;
      expect(box[0].map((v) => Math.round(v))).toEqual([-40, 0, 10]);
      expect((await names(moved)).faces).toContain('f:plate:end');
      const copied = ok(await engine.apply({ type: 'move', feature: 'm', key: 'copy', bodies, bodyIds: ['plate'], translation: [0, 50, 0], copy: true }));
      expect(copied.map((b) => b.id)).toEqual(['plate', 'm']);
      expect(await volume(copied)).toBeCloseTo(2 * 80 * 40 * 5);
      const scaled = ok(await engine.apply({ type: 'scale', feature: 'z', key: 'scale', bodies, bodyIds: ['plate'], factor: 2 }));
      expect(await volume(scaled)).toBeCloseTo(8 * 80 * 40 * 5);
    });
  });

  describe('lofts and sweeps', () => {
    const square = profile(rectangleLoop(-10, -10, 20, 20, 'sq'));
    const top = { ...XY, origin: [0, 0, 30] as const };

    async function squareToCircle(): Promise<readonly BodyState[]> {
      return ok(await engine.apply({ type: 'loft', feature: 'loft', key: 'loft', bodies: [], sections: [{ frame: XY, profile: square }, { frame: top, profile: profile(circleLoop(0, 0, 8, 'round')) }], ruled: false, operation: 'new-body' }));
    }

    it('lofts between sections, naming caps and the sides after the first section', async () => {
      const bodies = await squareToCircle();
      const v = await volume(bodies);
      expect(v).toBeGreaterThan(Math.PI * 64 * 30);
      expect(v).toBeLessThan(400 * 30);
      // The circle is split where the square has its corners (CAD-106): one side face per square side.
      const faces = (await names(bodies)).faces;
      expect(faces.filter((f) => !f.startsWith('f:loft:side:'))).toEqual(['f:loft:end', 'f:loft:start']);
      expect(faces.filter((f) => f.startsWith('f:loft:side:'))).toEqual(['f:loft:side:sq-bottom', 'f:loft:side:sq-left', 'f:loft:side:sq-right', 'f:loft:side:sq-top']);
    });

    it('lofts from a round shank into twisted blade sections without twisting (CAD-106)', async () => {
      const half = (x: number) => 0.6 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4);
      /** A closed spline through 14 points of a blade section, counter-clockwise from its leading edge, turned by `angle` degrees. */
      const blade = (chord: number, angle: number, source: string) => {
        const xs = [0.05, 0.15, 0.3, 0.5, 0.7, 0.9];
        const outline = [[0, 0], ...xs.map((x) => [x, -half(x)]), [1, 0], ...[...xs].reverse().map((x) => [x, half(x)])] as [number, number][];
        const a = (angle * Math.PI) / 180;
        const points = outline.map(([x, y]): [number, number] => [(x - 0.3) * chord * Math.cos(a) - y * chord * Math.sin(a), (x - 0.3) * chord * Math.sin(a) + y * chord * Math.cos(a)]);
        const edges = splineBeziers(points, true).map(([start, c1, c2, end]) => ({ kind: 'bezier' as const, source, start, c1, c2, end }));
        return profile({ edges, polygon: points });
      };
      const at = (x: number) => ({ ...originFrames.YZ, origin: [x, 0, 0] as const });
      const sections = [
        { frame: at(35), profile: profile(circleLoop(0, 0, 15, 'shank')) },
        ...([[80, 70, 50], [160, 58, 35], [250, 46, 25], [330, 36, 18], [380, 30, 14]] as const).map(([x, chord, angle]) => ({ frame: at(x), profile: blade(chord, angle, `s${x}`) })),
      ];
      const lofted = ok(await engine.apply({ type: 'loft', feature: 'blade', key: 'blade', bodies: [], sections, ruled: false, operation: 'new-body' }));
      // Twisted, the blade pinched between the shank (707 mm²) and the first section (about 400 mm²).
      const areas: number[] = [];
      for (const x of [45, 57, 70]) {
        const slab = ok(await engine.apply({ type: 'extrude', feature: 'slab', key: `slab-${x}`, bodies: lofted, frame: at(x), profiles: [profile(rectangleLoop(-60, -60, 120, 120, 'slab'))], distance: 1, direction: 'normal', operation: 'intersect' }));
        areas.push(await volume(slab));
      }
      expect(areas[0]).toBeLessThan(1.1 * 707);
      expect(areas[1]).toBeLessThan(areas[0] as number);
      expect(areas[2]).toBeLessThan(areas[1] as number);
      expect(areas[2]).toBeGreaterThan(360);
    });

    it('keeps the names of freeform faces cut by later features', async () => {
      const bodies = await squareToCircle();
      // A hole through the loft's -Y side, from the XZ plane outwards.
      const side = { origin: [0, 0, 0] as const, u: [1, 0, 0] as const, v: [0, 0, 1] as const };
      const cut = ok(await engine.apply({ type: 'extrude', feature: 'hole', key: 'loft-hole', bodies, frame: side, profiles: [profile(circleLoop(0, 12, 2, 'h'))], distance: 20, direction: 'normal', operation: 'cut' }));
      const faces = (await names(cut)).faces;
      expect(faces).toContain('f:loft:side:sq-bottom');
      expect(faces.filter((f) => f.startsWith('f:loft:side:'))).toHaveLength(4);
      expect(faces.some((f) => f.includes(':new:'))).toBe(false);
    });

    it('names loft and sweep faces the same when their profiles change size', async () => {
      const loftOf = async (size: number) => {
        const sq = profile(rectangleLoop(-size / 2, -size / 2, size, size, 'sq'));
        const lofted = ok(await engine.apply({ type: 'loft', feature: 'loft', key: `loft-${size}`, bodies: [], sections: [{ frame: XY, profile: sq }, { frame: top, profile: profile(rectangleLoop(-5, -5, 10, 10, 'up')) }], ruled: false, operation: 'new-body' }));
        return (await names(lofted)).faces;
      };
      expect(await loftOf(24)).toEqual(await loftOf(20));
      const sweepOf = async (radius: number) => {
        const across = { origin: [0, 0, 0] as const, u: [0, 1, 0] as const, v: [0, 0, 1] as const };
        const path = [{ kind: 'arc' as const, start: [0, 0, 0] as const, mid: [10 * Math.SQRT1_2, 10 - 10 * Math.SQRT1_2, 0] as const, end: [10, 10, 0] as const }];
        const swept = ok(await engine.apply({ type: 'sweep', feature: 'tube', key: `sweep-${radius}`, bodies: [], frame: across, profiles: [profile(circleLoop(0, 0, radius, 'ring'))], path, closed: false, operation: 'new-body' }));
        return (await names(swept)).faces;
      };
      expect(await sweepOf(3)).toEqual(await sweepOf(2));
    });

    it('sweeps a profile along a path of a line and an arc', async () => {
      const ring = profile(circleLoop(0, 0, 2, 'ring'));
      const across = { origin: [0, 0, 0] as const, u: [0, 1, 0] as const, v: [0, 0, 1] as const }; // facing +X
      const path = [
        { kind: 'line' as const, start: [0, 0, 0] as const, end: [30, 0, 0] as const },
        { kind: 'arc' as const, start: [30, 0, 0] as const, mid: [30 + 10 * Math.SQRT1_2, 10 - 10 * Math.SQRT1_2, 0] as const, end: [40, 10, 0] as const },
      ];
      const bodies = ok(await engine.apply({ type: 'sweep', feature: 'tube', key: 'sweep', bodies: [], frame: across, profiles: [ring], path, closed: false, operation: 'new-body' }));
      expect(await volume(bodies)).toBeCloseTo(Math.PI * 4 * (30 + (Math.PI / 2) * 10), 0);
      const faces = (await names(bodies)).faces;
      expect(faces).toContain('f:tube:start');
      expect(faces).toContain('f:tube:end');
      expect(faces.filter((f) => f.includes(':new:'))).toEqual([]);
    });
  });

  describe('holes and threads', () => {
    const onTop: PlaneFrame = { ...XY, origin: [0, 0, 5] };
    const spec = { diameter: 5, teardrop: false, bridge: 0 };
    const hole = (bodies: readonly BodyState[], key: string, points: { id: string; at: readonly [number, number] }[], holeSpec: object, frame = onTop) =>
      engine.apply({ type: 'hole', feature: 'h', key, bodies, frame, points, spec: { ...spec, ...holeSpec } });
    const plain = 80 * 40 * 5;

    it('drills holes through, to a depth, counterbored and countersunk, naming their faces by point', async () => {
      const bodies = ok(await plate());
      const through = ok(await hole(bodies, 'h-through', [{ id: 'p1', at: [10, 10] }, { id: 'p2', at: [30, 10] }], {}));
      expect(await volume(through)).toBeCloseTo(plain - 2 * Math.PI * 6.25 * 5, 2);
      expect((await names(through)).faces).toEqual(expect.arrayContaining(['f:h:wall:p1', 'f:h:wall:p2']));
      const blind = ok(await hole(bodies, 'h-blind', [{ id: 'p1', at: [10, 10] }], { depth: 3 }));
      expect(await volume(blind)).toBeCloseTo(plain - Math.PI * 6.25 * 3, 2);
      expect((await names(blind)).faces).toContain('f:h:floor:p1');
      const bored = ok(await hole(bodies, 'h-bore', [{ id: 'p1', at: [10, 10] }], { diameter: 4, bore: { diameter: 8, depth: 2 } }));
      expect(await volume(bored)).toBeCloseTo(plain - Math.PI * 16 * 2 - Math.PI * 4 * 3, 2);
      expect((await names(bored)).faces).toEqual(expect.arrayContaining(['f:h:bore:p1', 'f:h:wall:p1']));
      // A layer left at the bottom of the counterbore, over the hole.
      const bridged = ok(await hole(bodies, 'h-bridge', [{ id: 'p1', at: [10, 10] }], { diameter: 4, bore: { diameter: 8, depth: 2 }, bridge: 0.2 }));
      expect(await volume(bridged)).toBeCloseTo(plain - Math.PI * 16 * 2 - Math.PI * 4 * 2.8, 2);
      const sunk = ok(await hole(bodies, 'h-sink', [{ id: 'p1', at: [10, 10] }], { diameter: 4, sink: { diameter: 8, angle: Math.PI / 2 } }));
      const cone = (Math.PI * 2 * (16 + 8 + 4)) / 3; // 2 mm deep from radius 4 to 2
      expect(await volume(sunk)).toBeCloseTo(plain - cone - Math.PI * 4 * 3, 2);
      expect((await names(sunk)).faces).toContain('f:h:sink:p1');
    });

    it('drills teardrop holes on their side, pointing up', async () => {
      const bodies = ok(await plate());
      const front = { origin: [0, 0, 0] as const, u: [1, 0, 0] as const, v: [0, 0, 1] as const }; // facing -Y: into the plate is +Y
      const round = ok(await hole(bodies, 'h-side', [{ id: 'p1', at: [40, 2.5] }], { diameter: 3, depth: 20 }, front));
      const drop = ok(await hole(bodies, 'h-drop', [{ id: 'p1', at: [40, 2.5] }], { diameter: 3, depth: 20, teardrop: true }, front));
      const circle = Math.PI * 2.25 * 20;
      expect(plain - (await volume(round))).toBeCloseTo(circle, 2);
      expect(plain - (await volume(drop))).toBeCloseTo(circle + (1.5 * 1.5 * (1 - Math.PI / 4)) * 20, 1);
      const top = (shapes.get(drop[0]?.key as string) as NamedShape).shape;
      expect(top.faces.length).toBeGreaterThan(6);
    });

    it('places threads from the open end of a hole, and models them on request', async () => {
      const bodies = ok(await hole(ok(await plate()), 'h-tap', [{ id: 'p1', at: [10, 10] }], {}));
      const face = { kind: 'face' as const, body: 'plate', name: 'f:h:wall:p1' };
      const marker = await engine.apply({ type: 'thread', feature: 't', key: 't-marker', bodies, face, size: 'M6', diameter: 6, pitch: 1, modelled: false, flip: false });
      expect(marker.error ?? '').toBe('');
      expect(marker.bodies).toEqual(bodies);
      expect(marker.thread).toMatchObject({ internal: true, radius: expect.closeTo(2.5, 6), length: expect.closeTo(5, 6), origin: [expect.closeTo(10, 6), expect.closeTo(10, 6), expect.closeTo(5, 6)], direction: [expect.closeTo(0, 9), expect.closeTo(0, 9), -1] });
      const wrong = await engine.apply({ type: 'thread', feature: 't', key: 't-wrong', bodies, face, size: 'M3', diameter: 3, pitch: 0.5, modelled: false, flip: false });
      expect(wrong.error).toContain('An M3 thread needs a hole of');
      const modelled = ok(await engine.apply({ type: 'thread', feature: 't', key: 't-model', bodies, face, size: 'M6', diameter: 6, pitch: 1, length: 3, modelled: true, flip: false }));
      const removed = (await volume(bodies)) - (await volume(modelled));
      expect(removed).toBeGreaterThan(5);
      expect(removed).toBeLessThan(Math.PI * (9 - 6.25) * 3);
    });
  });

  describe('threads that end at a shoulder (CAD-105)', () => {
    async function bolt(): Promise<readonly BodyState[]> {
      const below = { ...XY, origin: [0, 0, -10] as const };
      const shank = ok(await engine.apply({ type: 'extrude', feature: 'shank', key: 'bolt-shank', bodies: [], frame: below, profiles: [profile(circleLoop(0, 0, 5, 'shank'))], distance: 10, direction: 'normal', operation: 'new-body' }));
      return ok(await engine.apply({ type: 'extrude', feature: 'head', key: 'bolt-head', bodies: shank, frame: XY, profiles: [profile(circleLoop(0, 0, 8, 'head'))], distance: 6, direction: 'normal', operation: 'join' }));
    }

    it('cuts the thread from either end', async () => {
      const bodies = await bolt();
      const walls = (await names(bodies)).faces.filter((f) => f.startsWith('f:shank:side:'));
      const face = { kind: 'face' as const, body: 'shank', name: walls[0] as string, hint: [5, 0, -5] as const };
      for (const flip of [false, true]) {
        const threaded = ok(await engine.apply({ type: 'thread', feature: 't', key: `bolt-thread-${flip}`, bodies, face, size: 'M10', diameter: 10, pitch: 1.5, modelled: true, flip }));
        const removed = (await volume(bodies)) - (await volume(threaded));
        expect(removed).toBeGreaterThan(50);
        expect((await names(threaded)).faces.some((f) => f.startsWith('f:t:flank'))).toBe(true);
      }
    });

    it('refuses a name split into pieces unless a hint picks one', async () => {
      const bodies = ok(await plate());
      const split = ok(await engine.apply({ type: 'extrude', feature: 'slot', key: 'slot', bodies, frame: { ...XY, origin: [0, 0, 5] }, profiles: [profile(rectangleLoop(38, -1, 4, 42, 'slot'))], distance: 2, direction: 'reverse', operation: 'cut' }));
      const top = (await names(split)).faces.filter((f) => f.startsWith('f:plate:end'));
      expect(top).toEqual(['f:plate:end~1', 'f:plate:end~2']);
      const base = { kind: 'face' as const, body: 'plate', name: 'f:plate:end' };
      const refused = await engine.apply({ type: 'shell', feature: 's', key: 'shell-ambiguous', bodies: split, faces: [base], thickness: 1 });
      expect(refused.error).toContain('is split into 2 pieces (f:plate:end~1, f:plate:end~2)');
      const hinted = await engine.apply({ type: 'shell', feature: 's', key: 'shell-hinted', bodies: split, faces: [{ ...base, hint: [10, 20, 5] }], thickness: 1 });
      expect(hinted.error).toBeUndefined();
    });
  });

  describe('drafts, ribs and variable fillets', () => {
    it('rounds an edge with a radius that changes along it', async () => {
      const bodies = ok(await plate());
      const edge = (await names(bodies)).edges.find((e) => e.includes('f:plate:end') && e.includes('side:plate-bottom')) as string;
      const refs = [{ kind: 'edge' as const, body: 'plate', name: edge }];
      const round = async (size: number, endSize?: number) =>
        volume(ok(await engine.apply({ type: 'fillet', feature: 'r', key: `fillet-${size}-${endSize}`, bodies, edges: refs, size, ...(endSize === undefined ? {} : { endSize }) })));
      const [small, varying, large] = [await round(1), await round(1, 4), await round(4)];
      expect(varying).toBeLessThan(small);
      expect(varying).toBeGreaterThan(large);
    });

    it('drafts side faces about a neutral plane, keeping their names', async () => {
      const bodies = ok(await plate(10, 'plate-10'));
      const sides = ['plate-left', 'plate-right'].map((s) => ({ kind: 'face' as const, body: 'plate', name: `f:plate:side:${s}` }));
      const drafted = ok(await engine.apply({ type: 'draft', feature: 'd', key: 'draft', bodies, faces: sides, plane: XY, angle: (5 * Math.PI) / 180 }));
      // Each side leans in by tan 5° × height over the height: the plate loses two triangular prisms.
      const lean = Math.tan((5 * Math.PI) / 180) * 10;
      expect(await volume(drafted)).toBeCloseTo(80 * 40 * 10 - 2 * ((lean * 10) / 2) * 40, 1);
      expect((await names(drafted)).faces).toEqual(expect.arrayContaining(['f:plate:side:plate-left', 'f:plate:side:plate-right']));
    });

    it('thickens an open line into a rib and joins it', async () => {
      const bodies = ok(await plate());
      const path = [{ kind: 'line' as const, start: [10, 10, 0] as const, end: [50, 10, 0] as const }];
      const ribbed = ok(await engine.apply({ type: 'rib', feature: 'rib', key: 'rib', bodies, frame: XY, path, thickness: 2, depth: 15, direction: 'normal' }));
      expect(ribbed.map((b) => b.id)).toEqual(['plate']);
      const added = (await volume(ribbed)) - 80 * 40 * 5;
      expect(added).toBeGreaterThan(40 * 2 * 10 - 1e-6);
      expect(added).toBeLessThan((40 + 2) * 2 * 10 + 1e-6);
    });
  });

  describe('sheet metal', () => {
    it('bends a flange up from an edge of a sheet', async () => {
      const sheet = ok(await plate(2, 'sheet-2'));
      const edge = (await names(sheet)).edges.find((e) => e.includes('f:plate:end') && e.includes('side:plate-right')) as string;
      const flanged = await engine.apply({ type: 'edge-flange', feature: 'fl', key: 'flange', bodies: sheet, edges: [{ kind: 'edge', body: 'plate', name: edge, hint: [80, 20, 2] }], length: 20, angle: Math.PI / 2, thickness: 2, bendRadius: 2 });
      const bodies = ok(flanged);
      // A quarter ring of the sheet's thickness, then 20 mm of flange, all along the 40 mm edge.
      const bend = (Math.PI / 4) * (4 * 4 - 2 * 2) * 40;
      expect((await volume(bodies)) - 80 * 40 * 2).toBeCloseTo(bend + 20 * 2 * 40, 1);
      expect(flanged.flanges?.[0]).toMatchObject({ away: [expect.closeTo(1, 9), expect.closeTo(0, 9), expect.closeTo(0, 9)], up: [expect.closeTo(0, 9), expect.closeTo(0, 9), 1] });
      const faces = (await names(bodies)).faces;
      expect(faces.some((f) => f.startsWith('f:fl:bend:'))).toBe(true);
      expect(faces.some((f) => f.startsWith('f:fl:flange:'))).toBe(true);
    });
  });
});

/** A closed outline of straight lines through the points; sides are `${prefix}-l1`, `-l2`, … */
function polygonLoop(points: readonly [number, number][], prefix: string) {
  const edges = points.map((start, i) => ({ kind: 'line' as const, start, end: points[(i + 1) % points.length] as [number, number], source: `${prefix}-l${i + 1}` }));
  return { edges, polygon: [...points] };
}

const normal = (f: { u: readonly number[]; v: readonly number[] }) => [
  (f.u[1] as number) * (f.v[2] as number) - (f.u[2] as number) * (f.v[1] as number),
  (f.u[2] as number) * (f.v[0] as number) - (f.u[0] as number) * (f.v[2] as number),
  (f.u[0] as number) * (f.v[1] as number) - (f.u[1] as number) * (f.v[0] as number),
];
