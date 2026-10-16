import type { Matrix4, MotionFrame, MotionKey, MotionStudy } from '@core/contracts';
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

export function simulate(
  model: KinematicModel,
  study: MotionStudy,
  fps: number,
  solve: (model: KinematicModel, driven: ReadonlySet<string>) => KinematicSolution,
): KinematicSimulation {
  const keys = new Map<string, MotionKey[]>();
  for (const key of [...study.keys].sort((a, b) => a.time - b.time)) keys.set(key.joint, [...(keys.get(key.joint) ?? []), key]);
  const drives = study.drives ?? [];
  const driven = new Set([...keys.keys(), ...drives.map((d) => d.joint)]);
  const start = new Map(model.joints.map((j) => [j.id, j.values]));
  const count = Math.max(1, Math.round(study.duration * fps));
  const frames: MotionFrame[] = [];
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
    const solution = solve({ ...model, joints }, driven);
    if (solution.error) return { frames, error: { time, ...solution.error } };
    joints = joints.map((joint) => ({ ...joint, values: solution.values.get(joint.id) ?? joint.values }));
    frames.push({ time, poses: Object.fromEntries(solution.poses) as Record<string, Matrix4> });
  }
  return { frames };
}
