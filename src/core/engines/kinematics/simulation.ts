import type { LimitHold, Matrix4, MotionFrame, MotionKey, MotionStudy, MotionTarget, ReachTarget } from '@core/contracts';
import { compose, invertRigid } from '@core/utilities/math';
import type { KinematicModel, KinematicSimulation, KinematicSolution } from './index';

/** Starts and ends slowly (smoothstep). */
const eased = (t: number) => t * t * (3 - 2 * t);

/** A joint's values at `time` from its keys (sorted by time): even (or eased) between keys, held outside them. */
export function valuesAt(keys: readonly MotionKey[], time: number): readonly number[] | undefined {
  const [first] = keys;
  if (!first) return undefined;
  if (time <= first.time) return first.values;
  for (let i = 1; i < keys.length; i++) {
    const before = keys[i - 1] as MotionKey;
    const after = keys[i] as MotionKey;
    if (time > after.time) continue;
    const linear = after.time === before.time ? 1 : (time - before.time) / (after.time - before.time);
    const t = after.ease ? eased(linear) : linear;
    return after.values.map((v, k) => (before.values[k] ?? v) + (v - (before.values[k] ?? v)) * t);
  }
  return (keys[keys.length - 1] as MotionKey).values;
}

/** Each instance's target at `time`: on a straight line between its targets (eased into one that asks), held outside them. */
export function targetsAt(targets: readonly MotionTarget[], time: number): ReachTarget[] {
  const byInstance = new Map<string, MotionTarget[]>();
  for (const target of [...targets].sort((a, b) => a.time - b.time)) byInstance.set(target.instance, [...(byInstance.get(target.instance) ?? []), target]);
  const mix = (a: readonly number[], b: readonly number[], t: number) => a.map((v, i) => v + ((b[i] ?? v) - v) * t) as unknown as readonly [number, number, number];
  return [...byInstance.values()].map((list) => {
    const first = list[0] as MotionTarget;
    if (time <= first.time) return first;
    for (let i = 1; i < list.length; i++) {
      const [before, after] = [list[i - 1] as MotionTarget, list[i] as MotionTarget];
      if (time > after.time) continue;
      const linear = after.time === before.time ? 1 : (time - before.time) / (after.time - before.time);
      const t = after.ease ? eased(linear) : linear;
      const pair = (a: ReachTarget['axis'], b: ReachTarget['axis']) => (a && b ? { local: b.local, along: mix(a.along, b.along, t) } : b);
      return { instance: after.instance, ...(after.point ? { point: after.point } : {}), at: mix(before.at, after.at, t), ...(after.axis ? { axis: pair(before.axis, after.axis) } : {}), ...(after.xAxis ? { xAxis: pair(before.xAxis, after.xAxis) } : {}) } as ReachTarget;
    }
    return list[list.length - 1] as MotionTarget;
  });
}

export function simulate(
  model: KinematicModel,
  study: MotionStudy,
  fps: number,
  solve: (model: KinematicModel, driven: ReadonlySet<string>, targets?: readonly ReachTarget[]) => KinematicSolution,
): KinematicSimulation {
  const keys = new Map<string, MotionKey[]>();
  for (const key of [...study.keys].sort((a, b) => a.time - b.time)) keys.set(key.joint, [...(keys.get(key.joint) ?? []), key]);
  const drives = study.drives ?? [];
  const driven = new Set([...keys.keys(), ...drives.map((d) => d.joint)]);
  const start = new Map(model.joints.map((j) => [j.id, j.values]));
  const count = Math.max(1, Math.round(study.duration * fps));
  const frames: MotionFrame[] = [];
  const holds = new Map<string, LimitHold & { time: number }>();
  // Carried instances (CAD-187): where each sits on its carrier while carried, and where it was let go.
  const carries = study.carries ?? [];
  const riding = new Map<number, Matrix4>();
  const left = new Map<string, Matrix4>();
  const last = new Map<number, Matrix4>();
  const result = () => (holds.size ? { holds: [...holds.values()] } : {});
  // Each frame starts from the previous one, so loops follow the motion instead of jumping between solutions.
  let joints = model.joints;
  for (let frame = 0; frame <= count; frame++) {
    const time = (study.duration * frame) / count;
    joints = joints.map((joint) => {
      const keyed = valuesAt(keys.get(joint.id) ?? [], time) ?? joint.values;
      // Drives move a freedom from its value at the start, at their speed.
      const own = drives.filter((d) => d.joint === joint.id);
      const values = own.length ? keyed.map((v, i) => { const drive = own.find((d) => d.dof === i); return drive ? (start.get(joint.id)?.[i] ?? 0) + drive.speed * time : v; }) : keyed;
      return { ...joint, values };
    });
    const solution = solve({ ...model, joints }, driven, study.targets?.length ? targetsAt(study.targets, time) : undefined);
    for (const hold of solution.holds ?? []) {
      const key = `${hold.joint}/${hold.dof}/${hold.at}`;
      if (!holds.has(key)) holds.set(key, { ...hold, time });
    }
    if (solution.error) return { frames, error: { time, ...solution.error }, ...result() };
    joints = joints.map((joint) => ({ ...joint, values: solution.values.get(joint.id) ?? joint.values }));
    const poses = new Map(solution.poses);
    for (const [k, carry] of carries.entries()) {
      const carrier = poses.get(carry.by);
      const own = left.get(carry.instance) ?? poses.get(carry.instance);
      if (!carrier || !own) continue;
      const carried = time >= carry.from - 1e-9 && (carry.until === undefined || time < carry.until - 1e-9);
      if (carried) {
        if (!riding.has(k)) riding.set(k, compose(invertRigid(carrier), own));
        const pose = compose(carrier, riding.get(k) as Matrix4);
        last.set(k, pose);
        poses.set(carry.instance, pose);
        left.delete(carry.instance);
      } else if (riding.has(k)) {
        // Let go where it was last carried; it stays there.
        riding.delete(k);
        left.set(carry.instance, last.get(k) as Matrix4);
      }
    }
    for (const [instance, pose] of left) poses.set(instance, pose);
    frames.push({ time, poses: Object.fromEntries(poses) as Record<string, Matrix4>, values: Object.fromEntries(solution.values) as Record<string, readonly number[]> });
  }
  return { frames, ...result() };
}
