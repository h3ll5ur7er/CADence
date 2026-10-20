import { createShapeAccess, type NamedShape } from '@core/access/shape';
import { originFrames, type PlaneFrame, type Profile, type TopologyRef, type Vec3 } from '@core/contracts';
import { circleLoop, profile, rectangleLoop } from '@core/contracts/testing/profiles';
import { makeBox, measureVolume, type Shape3D } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { type BodyState, createModelingEngine, type ModelingEngine, type ModelingOutcome } from './index';

let engine: ModelingEngine;
const shapes = createShapeAccess();
beforeAll(() => {
  engine = createModelingEngine(shapes);
});

function ok(outcome: ModelingOutcome): readonly BodyState[] {
  if (outcome.error) throw new Error(outcome.error);
  return outcome.bodies;
}

const shapeOf = (bodies: readonly BodyState[]) => (shapes.get((bodies[0] as BodyState).key) as NamedShape).shape;
const volume = (bodies: readonly BodyState[]) => measureVolume(shapeOf(bodies));

/** Whether a point lies inside the body's material: a small cube about it is (mostly) material. */
function inside(shape: Shape3D, p: Vec3): boolean {
  const size = 0.05;
  const cube = makeBox([p[0] - size / 2, p[1] - size / 2, p[2] - size / 2], [p[0] + size / 2, p[1] + size / 2, p[2] + size / 2]);
  const common = shape.clone().intersect(cube);
  try {
    return measureVolume(common) > 0.5 * size ** 3;
  } finally {
    common.delete();
    cube.delete();
  }
}

/** A cylinder of radius 10 along Z from 0 to 30, its round face `f:cyl:side:rim`. */
async function cylinder(): Promise<readonly BodyState[]> {
  return ok(
    await engine.apply({ type: 'extrude', feature: 'cyl', key: 'wrap-cyl', bodies: [], frame: originFrames.XY, profiles: [profile(circleLoop(0, 0, 10, 'rim'))], distance: 30, direction: 'normal', operation: 'new-body' }),
  );
}

const side: TopologyRef = { kind: 'face', body: 'cyl', name: 'f:cyl:side:rim' };

/** Tick marks of a scale: `count` bars 0.6 wide, every 5 mm, the long ones 6 mm and the others 4 mm. */
function scaleTicks(count: number): Profile[] {
  return Array.from({ length: count }, (_, i) => profile(rectangleLoop(i * 5 - 0.3, 10, 0.6, i % 5 === 0 ? 6 : 4, `tick${i}`), [], `tick${i}`));
}

describe('Wrap (CAD-155)', () => {
  it('engraves a scale around a cylinder, keeping lengths along the surface', async () => {
    const bodies = await cylinder();
    const before = volume(bodies);
    // The XZ plane runs along the axis; its normal (−Y) says where the sketch touches: at y = −10.
    const ticks = scaleTicks(10);
    const after = ok(await engine.apply({ type: 'wrap', feature: 'scale', key: 'wrap-scale', bodies, frame: originFrames.XZ, profiles: ticks, face: side, method: 'wrap', depth: 0.5, operation: 'engrave' }));
    // Each tick is cut 0.5 deep: its area times the depth, a little less as the radius shrinks inward.
    const area = ticks.reduce((sum, _, i) => sum + 0.6 * (i % 5 === 0 ? 6 : 4), 0);
    expect(before - volume(after)).toBeCloseTo(area * 0.5 * (1 - 0.25 / 10), 1);
    const shape = shapeOf(after);
    // The sketch's x runs round the cylinder: 5 mm along the surface is 5 / 10 rad.
    const at = (s: number, z: number, r: number): Vec3 => {
      const angle = s / 10;
      // Seen from the sketch's side (−Y), x points along +X: round from −Y toward +X.
      return [r * Math.sin(angle), -r * Math.cos(angle), z];
    };
    expect(inside(shape, at(15, 12, 9.8))).toBe(false); // the fourth tick, cut away
    expect(inside(shape, at(15, 12, 9.4))).toBe(true); // below its floor
    expect(inside(shape, at(17.5, 12, 9.8))).toBe(true); // between ticks
    expect(inside(shape, at(45, 13, 9.8))).toBe(false); // the tenth tick, past the far side
  });

  it('embosses onto a cone, and names the new faces', async () => {
    // A cone of radius 10 at z = 0 to 5 at z = 20, revolved about Z.
    const cone = ok(
      await engine.apply({
        type: 'revolve',
        feature: 'cone',
        key: 'wrap-cone',
        bodies: [],
        frame: originFrames.XZ,
        profiles: [
          profile({
            edges: [
              { kind: 'line', start: [0, 0], end: [10, 0], source: 'base' },
              { kind: 'line', start: [10, 0], end: [5, 20], source: 'slant' },
              { kind: 'line', start: [5, 20], end: [0, 20], source: 'top' },
              { kind: 'line', start: [0, 20], end: [0, 0], source: 'axis' },
            ],
            polygon: [[0, 0], [10, 0], [5, 20], [0, 20]],
          }),
        ],
        axis: { origin: [0, 0, 0], direction: [0, 0, 1] },
        angle: 2 * Math.PI,
        operation: 'new-body',
      }),
    );
    const before = volume(cone);
    const face: TopologyRef = { kind: 'face', body: 'cone', name: 'f:cone:side:slant' };
    const frame: PlaneFrame = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] };
    const after = ok(await engine.apply({ type: 'wrap', feature: 'label', key: 'wrap-label', bodies: cone, frame, profiles: [profile(rectangleLoop(-3, 6, 6, 4, 'label'))], face, method: 'wrap', depth: 1, operation: 'emboss' }));
    expect(volume(after) - before).toBeGreaterThan(6 * 4 * 1 * 0.8);
    expect(volume(after) - before).toBeLessThan(6 * 4 * 1 * 1.2);
    const [mesh] = await engine.tessellate(after);
    expect(mesh?.faces.map((f) => f.name)).toContain('f:label:top');
  });

  it('projects onto any face along the sketch normal, on the near side only', async () => {
    const bodies = await cylinder();
    const before = volume(bodies);
    // A 4 x 4 square seen head-on from −Y: cast onto the cylinder's near side, not its far one.
    const after = ok(await engine.apply({ type: 'wrap', feature: 'mark', key: 'wrap-mark', bodies, frame: originFrames.XZ, profiles: [profile(rectangleLoop(-2, 13, 4, 4, 'mark'))], face: side, method: 'project', depth: 0.5, operation: 'engrave' }));
    const shape = shapeOf(after);
    expect(before - volume(after)).toBeGreaterThan(4 * 4 * 0.5 * 0.9);
    expect(before - volume(after)).toBeLessThan(4 * 4 * 0.5 * 1.15);
    expect(inside(shape, [0, -9.8, 15])).toBe(false);
    expect(inside(shape, [0, 9.8, 15])).toBe(true);
  });

  it('says what it cannot wrap onto', async () => {
    const bodies = await cylinder();
    const across = await engine.apply({ type: 'wrap', feature: 'w', key: 'wrap-across', bodies, frame: originFrames.XY, profiles: [profile(rectangleLoop(0, 0, 2, 2))], face: side, method: 'wrap', depth: 0.5, operation: 'engrave' });
    expect(across.error).toContain('along its axis');
    const tooLong = await engine.apply({ type: 'wrap', feature: 'w', key: 'wrap-long', bodies, frame: originFrames.XZ, profiles: [profile(rectangleLoop(-40, 5, 80, 2))], face: side, method: 'wrap', depth: 0.5, operation: 'engrave' });
    expect(tooLong.error).toContain('once round');
  });
});
