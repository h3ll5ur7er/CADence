import type { JointType, Matrix4, PlaneFrame, Vec3 } from '@core/contracts';
import { identity, transformPoint, translation } from '@core/utilities/math';
import { describe, expect, it } from 'vitest';
import { createKinematicsEngine, type KinematicJoint, type KinematicModel } from './index';

const engine = createKinematicsEngine();

/** A frame at `origin` whose joint axis (normal) is world Z. */
const at = (origin: Vec3): PlaneFrame => ({ origin, u: [1, 0, 0], v: [0, 1, 0] });

function joint(id: string, type: JointType, a: [string, Vec3], b: [string, Vec3], values: number[] = [], extra: Partial<KinematicJoint> = {}): KinematicJoint {
  return { id, type, a: { instance: a[0], frame: at(a[1]) }, b: { instance: b[0], frame: at(b[1]) }, flip: false, values, limits: [], ...extra };
}

const instance = (id: string, grounded = false, transform: Matrix4 = identity()) => ({ id, grounded, transform });
const where = (poses: ReadonlyMap<string, Matrix4>, id: string, local: Vec3) => transformPoint(poses.get(id) as Matrix4, local).map((v) => Math.round(v * 1e6) / 1e6 + 0);

describe('KinematicsEngine', () => {
  it('turns an arm on a revolute joint around the base', () => {
    const model: KinematicModel = {
      instances: [instance('base', true), instance('arm')],
      joints: [joint('hinge', 'revolute', ['base', [10, 0, 5]], ['arm', [0, 0, 0]], [90])],
    };
    const { poses, placed } = engine.solve(model);
    expect(where(poses, 'arm', [20, 0, 0])).toEqual([10, 20, 5]);
    expect([...placed]).toEqual(['arm']);
  });

  it('places the parent side when the joint is written the other way round', () => {
    const model: KinematicModel = {
      instances: [instance('arm'), instance('base', true)],
      joints: [joint('hinge', 'revolute', ['arm', [0, 0, 0]], ['base', [10, 0, 5]], [90])],
    };
    const { poses, placed } = engine.solve(model);
    // The grounded base stays; the arm is placed against it, turned the other way (B relative to A is +90°).
    expect(where(poses, 'base', [10, 0, 5])).toEqual([10, 0, 5]);
    expect(where(poses, 'arm', [0, 0, 0])).toEqual([10, 0, 5]);
    expect(where(poses, 'arm', [20, 0, 0])).toEqual([10, -20, 5]);
    expect([...placed]).toEqual(['arm']);
  });

  it('slides within limits and turns the other side over when flipped', () => {
    const model: KinematicModel = {
      instances: [instance('rail', true), instance('carriage')],
      joints: [joint('slide', 'slider', ['rail', [0, 0, 0]], ['carriage', [0, 0, 0]], [80], { limits: [{ min: 0, max: 50 }], flip: true })],
    };
    const { poses, values } = engine.solve(model);
    expect(values.get('slide')).toEqual([50]);
    expect(where(poses, 'carriage', [0, 0, 0])).toEqual([0, 0, 50]);
    expect(where(poses, 'carriage', [0, 0, 1])).toEqual([0, 0, 49]); // z turned over
  });

  it('keeps instances no joint places where they were put', () => {
    const model: KinematicModel = { instances: [instance('loose', false, translation([5, 6, 7]))], joints: [] };
    const { poses, placed } = engine.solve(model);
    expect(where(poses, 'loose', [0, 0, 0])).toEqual([5, 6, 7]);
    expect(placed.size).toBe(0);
  });

  it('closes a four-bar linkage around the driven crank', () => {
    // Ground pivots at x = 0 and x = 40; crank 10, coupler 40, rocker 20 long, all turning about Z.
    const model: KinematicModel = {
      instances: [instance('ground', true), instance('crank'), instance('coupler'), instance('rocker')],
      joints: [
        joint('j1', 'revolute', ['ground', [0, 0, 0]], ['crank', [0, 0, 0]], [60]),
        joint('j2', 'revolute', ['crank', [10, 0, 0]], ['coupler', [0, 0, 0]], [30]),
        joint('j3', 'revolute', ['coupler', [40, 0, 0]], ['rocker', [20, 0, 0]], [0]),
        joint('j4', 'revolute', ['ground', [40, 0, 0]], ['rocker', [0, 0, 0]], [80]),
      ],
    };
    const solution = engine.solve(model, new Set(['j1']));
    expect(solution.error).toBeUndefined();
    expect(solution.values.get('j1')).toEqual([60]);
    const crankTip = where(solution.poses, 'crank', [10, 0, 0]);
    const couplerEnd = where(solution.poses, 'coupler', [40, 0, 0]);
    const rockerTip = where(solution.poses, 'rocker', [20, 0, 0]);
    expect(crankTip).toEqual([5, 8.660254, 0]);
    couplerEnd.forEach((v, i) => expect(v).toBeCloseTo(rockerTip[i] as number, 5));
    expect(Math.hypot((rockerTip[0] as number) - 40, rockerTip[1] as number)).toBeCloseTo(20, 5);
  });

  it('reports a loop that cannot close', () => {
    // The coupler is too short to reach the rocker.
    const model: KinematicModel = {
      instances: [instance('ground', true), instance('crank'), instance('coupler'), instance('rocker')],
      joints: [
        joint('j1', 'revolute', ['ground', [0, 0, 0]], ['crank', [0, 0, 0]], [0]),
        joint('j2', 'revolute', ['crank', [10, 0, 0]], ['coupler', [0, 0, 0]], [0]),
        joint('j3', 'revolute', ['coupler', [5, 0, 0]], ['rocker', [5, 0, 0]], [0]),
        joint('j4', 'revolute', ['ground', [100, 0, 0]], ['rocker', [0, 0, 0]], [0]),
      ],
    };
    expect(engine.solve(model, new Set(['j1'])).error).toMatchObject({ message: expect.stringContaining('does not close') });
  });

  it('holds a rigid joint and refuses a joint on one instance', () => {
    const rigid = engine.solve({
      instances: [instance('a', true, translation([1, 2, 3])), instance('b')],
      joints: [joint('weld', 'rigid', ['a', [10, 0, 0]], ['b', [0, 0, 0]])],
    });
    expect(where(rigid.poses, 'b', [0, 0, 0])).toEqual([11, 2, 3]);
    const self = engine.solve({ instances: [instance('a', true)], joints: [joint('loop', 'revolute', ['a', [0, 0, 0]], ['a', [1, 0, 0]], [0])] });
    expect(self.error?.joint).toBe('loop');
  });
});

describe('KinematicsEngine motion studies', () => {
  const arm: KinematicModel = {
    instances: [instance('base', true), instance('arm')],
    joints: [joint('hinge', 'revolute', ['base', [0, 0, 0]], ['arm', [0, 0, 0]], [0])],
  };

  it('interpolates keys and holds them outside', () => {
    const study = { id: 's', name: 'Swing', duration: 2, keys: [{ time: 0.5, joint: 'hinge', values: [0] }, { time: 1.5, joint: 'hinge', values: [90] }] };
    const { frames, error } = engine.simulate(arm, study, 2);
    expect(error).toBeUndefined();
    expect(frames.map((f) => f.time)).toEqual([0, 0.5, 1, 1.5, 2]);
    const tip = frames.map((f) => transformPoint(f.poses['arm'] as Matrix4, [10, 0, 0]).map((v) => Math.round(v * 1e6) / 1e6 + 0));
    expect(tip).toEqual([
      [10, 0, 0],
      [10, 0, 0],
      [7.071068, 7.071068, 0],
      [0, 10, 0],
      [0, 10, 0],
    ]);
  });

  it('clamps keyed values to the joint limits', () => {
    const limited = { ...arm, joints: arm.joints.map((j) => ({ ...j, limits: [{ min: 0, max: 45 }] })) };
    const study = { id: 's', name: 'Too far', duration: 1, keys: [{ time: 0, joint: 'hinge', values: [0] }, { time: 1, joint: 'hinge', values: [90] }] };
    const { frames } = engine.simulate(limited, study, 1);
    expect(transformPoint(frames[1]?.poses['arm'] as Matrix4, [10, 0, 0])[0]).toBeCloseTo(7.071068, 5);
  });

  it('stops at the first frame the joints cannot hold', () => {
    const broken = { ...arm, joints: [...arm.joints, joint('self', 'revolute', ['arm', [0, 0, 0]], ['arm', [1, 0, 0]], [0])] };
    const { frames, error } = engine.simulate(broken, { id: 's', name: 'Broken', duration: 1, keys: [] }, 10);
    expect(frames).toHaveLength(0);
    expect(error).toMatchObject({ time: 0, joint: 'self' });
  });
});
