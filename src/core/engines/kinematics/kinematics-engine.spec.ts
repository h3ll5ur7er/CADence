import { camLift, type JointType, type Matrix4, type PlaneFrame, type Vec3 } from '@core/contracts';
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

  it('drives one joint from another: gears turn the other way, a rack slides with its pinion', () => {
    // Two gears on the base, 20 and 10 teeth; a rack on the second gear's pinion (⌀10: π·10/360 mm per degree).
    const model: KinematicModel = {
      instances: [instance('base', true), instance('big'), instance('small'), instance('rack')],
      joints: [
        joint('g1', 'revolute', ['base', [0, 0, 0]], ['big', [0, 0, 0]], [90]),
        joint('g2', 'revolute', ['base', [30, 0, 0]], ['small', [0, 0, 0]], [0]),
        joint('r', 'slider', ['base', [30, 20, 0]], ['rack', [0, 0, 0]], [0]),
      ],
      links: [
        { id: 'l1', name: '', kind: 'gear', driver: { joint: 'g1', dof: 0 }, driven: { joint: 'g2', dof: 0 }, ratio: -2, offset: 0 },
        { id: 'l2', name: '', kind: 'rack', driver: { joint: 'g2', dof: 0 }, driven: { joint: 'r', dof: 0 }, ratio: (Math.PI * 10) / 360, offset: 5 },
      ],
    };
    const { values } = engine.solve(model);
    expect(values.get('g2')?.[0]).toBeCloseTo(-180);
    expect(values.get('r')?.[0]).toBeCloseTo(5 - Math.PI * 5);
  });

  it('moves a follower by a cam profile as the cam turns, in studies too (CAD-99)', () => {
    // A cam with one lobe: 6 mm of lift at 90°, none from 180° round to 360°; a tappet slides on the base.
    const profile = [[0, 0], [90, 6], [180, 0], [270, 0]] as const;
    expect(camLift(profile, 90)).toBeCloseTo(6);
    expect(camLift(profile, 450)).toBeCloseTo(6); // a turn later
    expect(camLift(profile, 270)).toBeCloseTo(0);
    expect(camLift(profile, 45)).toBeGreaterThan(0);
    expect(camLift(profile, 45)).toBeLessThan(6);
    const model: KinematicModel = {
      instances: [instance('base', true), instance('cam'), instance('tappet')],
      joints: [joint('shaft', 'revolute', ['base', [0, 0, 0]], ['cam', [0, 0, 0]], [0]), joint('guide', 'slider', ['base', [0, 20, 0]], ['tappet', [0, 0, 0]], [0])],
      links: [{ id: 'c', name: '', kind: 'cam', driver: { joint: 'shaft', dof: 0 }, driven: { joint: 'guide', dof: 0 }, ratio: 1, offset: 2, profile }],
    };
    expect(engine.solve(model).values.get('guide')?.[0]).toBeCloseTo(2);
    // Driven at 90° a second, the tappet is at the top after a second.
    const { frames } = engine.simulate(model, { id: 's', name: '', duration: 2, keys: [], drives: [{ joint: 'shaft', dof: 0, speed: 90 }] }, 2);
    const lift = (time: number) => (frames.find((f) => Math.abs(f.time - time) < 1e-9)?.poses['tappet'] as number[])[14] as number;
    expect(lift(1)).toBeCloseTo(8);
    expect(lift(2)).toBeCloseTo(2);
  });

  it('eases between keys and turns drives at their speed', () => {
    const model: KinematicModel = {
      instances: [instance('base', true), instance('arm'), instance('wheel')],
      joints: [joint('hinge', 'revolute', ['base', [0, 0, 0]], ['arm', [0, 0, 0]], [0]), joint('axle', 'revolute', ['base', [50, 0, 0]], ['wheel', [0, 0, 0]], [10])],
    };
    const study = {
      id: 's',
      name: '',
      duration: 1,
      keys: [
        { time: 0, joint: 'hinge', values: [0] },
        { time: 1, joint: 'hinge', values: [100], ease: true },
      ],
      // 60 rpm: 360° a second.
      drives: [{ joint: 'axle', dof: 0, speed: 360 }],
    };
    const { frames } = engine.simulate(model, study, 4);
    const angle = (frame: number, id: string, pivot: Vec3) => {
      const p = transformPoint(frames[frame]?.poses[id] as Matrix4, [10, 0, 0]);
      return (Math.atan2(p[1] - pivot[1], p[0] - pivot[0]) * 180) / Math.PI;
    };
    // A quarter of the way, eased: 15.6 % instead of 25 %.
    expect(angle(1, 'arm', [0, 0, 0])).toBeCloseTo(15.625, 3);
    expect(angle(2, 'arm', [0, 0, 0])).toBeCloseTo(50, 3);
    expect(angle(1, 'wheel', [50, 0, 0])).toBeCloseTo(100, 3);
  });
});
