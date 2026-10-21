import { appearanceProblem, type AssemblyDocument, coneJoints, type ExplodedView, fail, type Instance, type InstancePattern, isDefaultAppearance, type Joint, jointDofs, type JointOffset, type JointType, type MotionLink, type MotionStudy, offsetFields, ok, type Result } from '@core/contracts';
import type { AssemblyCommand } from './assembly-manager';
import { copyId, patternTransforms } from './patterns';

/** The document a command produces, and the joint whose solution decides whether it is accepted. */
export interface Applied {
  readonly document: AssemblyDocument;
  /** The command is refused when this joint cannot hold. */
  readonly joint?: string;
  /** Joints set together and held while the others follow (CAD-195); refused when they cannot all hold. */
  readonly joints?: readonly string[];
  /** What the change does that was not asked for: keys and drives past a joint's limits (CAD-186). */
  readonly notes?: readonly string[];
}

const jointLabels: Readonly<Record<JointType, string>> = {
  rigid: 'Rigid',
  revolute: 'Revolute',
  slider: 'Slider',
  cylindrical: 'Cylindrical',
  'pin-slot': 'Pin-slot',
  planar: 'Planar',
  ball: 'Ball',
  universal: 'Universal',
};

const invalid = (message: string) => fail({ code: 'invalid-command', message });

/** "Bracket 3": one more than the highest number already used with that label. */
export function nextName(names: readonly string[], label: string): string {
  const used = names.flatMap((name) => {
    const match = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`).exec(name);
    return match ? [Number(match[1])] : [];
  });
  return `${label} ${Math.max(0, ...used) + 1}`;
}

const patternLabels: Readonly<Record<InstancePattern['kind'], string>> = { linear: 'Linear pattern', circular: 'Circular pattern', mirror: 'Mirror' };

function checkPattern(document: AssemblyDocument, pattern: InstancePattern): string | undefined {
  const ids = new Set(document.instances.map((i) => i.id));
  if (!pattern.instances.length || pattern.instances.some((id) => !ids.has(id))) return 'A pattern repeats instances of this assembly; choose at least one.';
  if (!(Math.hypot(...pattern.direction) > 1e-9)) return pattern.kind === 'mirror' ? 'A mirror needs a plane.' : 'A pattern needs a direction.';
  if (pattern.kind !== 'mirror' && !(Number.isInteger(pattern.count) && pattern.count >= 2 && pattern.count <= 100)) return 'A pattern has 2 to 100 copies, the originals included.';
  if (pattern.kind !== 'mirror' && !Number.isFinite(pattern.spacing)) return 'The spacing needs a number.';
  return undefined;
}

const linkLabels: Readonly<Record<MotionLink['kind'], string>> = { gear: 'Gear', bevel: 'Bevel gear', worm: 'Worm', rack: 'Rack and pinion', belt: 'Belt', carrier: 'Planet carrier', planet: 'Planet', cam: 'Cam' };

function checkLink(document: AssemblyDocument, link: MotionLink): string | undefined {
  const freedom = (f: MotionLink['driver']) => {
    const joint = document.joints.find((j) => j.id === f.joint);
    return joint && Number.isInteger(f.dof) && f.dof >= 0 && f.dof < jointDofs[joint.type].length;
  };
  if (!freedom(link.driver) || !freedom(link.driven)) return 'A link connects freedoms of two joints of this assembly.';
  if (link.driver.joint === link.driven.joint) return 'A link needs two different joints.';
  if (!Number.isFinite(link.ratio) || link.ratio === 0 || !Number.isFinite(link.offset)) return 'A link needs a ratio other than zero.';
  if (link.kind === 'cam') {
    const profile = link.profile ?? [];
    if (profile.length < 2 || profile.some(([a, lift]) => !Number.isFinite(a) || !Number.isFinite(lift) || a < 0 || a >= 360)) return 'A cam needs a profile of at least two points: angles from 0 to 360° and their lifts.';
    if (profile.some(([a], i) => i > 0 && !(a > (profile[i - 1] as readonly [number, number])[0]))) return 'A cam profile’s angles must increase.';
  }
  // A joint follows one driver, and chains may not close into a circle.
  const others = (document.links ?? []).filter((l) => l.id !== link.id);
  if (others.some((l) => l.driven.joint === link.driven.joint)) return 'That joint already follows another link.';
  const drivers = new Map([...others, link].map((l) => [l.driven.joint, l.driver.joint]));
  for (let at: string | undefined = link.driver.joint, steps = 0; at; at = drivers.get(at), steps++) {
    if (at === link.driven.joint || steps > drivers.size) return 'Links may not drive in a circle.';
  }
  return undefined;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const vector = (value: unknown): boolean => Array.isArray(value) && value.length === 3 && value.every(finite);

/** What is wrong with an offset's numbers (CAD-184): each one a finite number, an axis not of zero length. */
function offsetProblem(offset: JointOffset | undefined, side: string): string | undefined {
  if (offset === undefined) return undefined;
  if (!vector(offset.translate)) return `The ${side} offset's translate needs three numbers (mm); use expressions for parameters.`;
  for (const field of ['angle', 'lean', 'tilt'] as const) {
    const value = offset[field];
    if ((field === 'angle' || value !== undefined) && !finite(value)) return `The ${side} offset's ${field} needs a number (degrees); use expressions for parameters.`;
  }
  if (offset.axis !== undefined && (!vector(offset.axis) || !(Math.hypot(...offset.axis) > 1e-9))) return `The ${side} offset's axis needs a direction of three numbers.`;
  if (offset.xAxis !== undefined && !vector(offset.xAxis)) return `The ${side} offset's x axis needs a direction of three numbers.`;
  const fields = new Set<string>(offsetFields);
  for (const [field, expression] of Object.entries(offset.expressions ?? {})) {
    if (!fields.has(field)) return `Offset expressions are for ${offsetFields.join(', ')}; ${field} is none of them.`;
    if (typeof expression !== 'string' || !expression.trim()) return `The ${side} offset's ${field} expression needs text.`;
  }
  return undefined;
}

function checkJoint(document: AssemblyDocument, joint: Joint): string | undefined {
  const ids = new Set(document.instances.map((i) => i.id));
  if (!ids.has(joint.a.instance) || !ids.has(joint.b.instance)) return 'A joint connects two instances of this assembly.';
  if (joint.a.instance === joint.b.instance) return 'A joint needs two different instances.';
  if (!jointDofs[joint.type]) return `There is no ${String(joint.type)} joint; joints are ${Object.keys(jointDofs).join(', ')}.`;
  const dofs = jointDofs[joint.type].length;
  if (!Array.isArray(joint.values) || joint.values.length !== dofs) return `A ${jointLabels[joint.type].toLowerCase()} joint has ${dofs} value${dofs === 1 ? '' : 's'}.`;
  if (!joint.values.every(finite)) return 'Each degree of freedom needs a number.';
  if (!Array.isArray(joint.limits) || joint.limits.length > dofs) return `A ${jointLabels[joint.type].toLowerCase()} joint has up to ${dofs} limit${dofs === 1 ? '' : 's'}, one per value (null for none).`;
  if (joint.limits.some((l) => l !== null && (!finite(l?.min) || !finite(l?.max)))) return 'A limit needs a minimum and a maximum number (null for none).';
  if (joint.limits.some((l) => l && !(l.min <= l.max))) return 'A limit’s minimum must not exceed its maximum.';
  const problem = offsetProblem(joint.a.offset, 'first') ?? offsetProblem(joint.b.offset, 'second');
  if (problem) return problem;
  if (joint.cone !== undefined) {
    if (!coneJoints.has(joint.type)) return 'Only ball and universal joints have a cone limit.';
    if (!finite(joint.cone) || joint.cone <= 0 || joint.cone > 180) return 'A cone limit is an angle above 0° and up to 180°.';
  }
  if (joint.driven !== undefined && typeof joint.driven !== 'boolean') return 'Driven is true or false.';
  return undefined;
}

/** Keys and drives of a study that ask more of a joint than its limits allow (CAD-186). */
function studyNotes(document: AssemblyDocument, study: MotionStudy): string[] {
  const notes: string[] = [];
  const named = (id: string) => document.joints.find((j) => j.id === id);
  for (const key of study.keys) {
    const joint = named(key.joint);
    if (!joint) continue;
    key.values.forEach((value, i) => {
      const limit = joint.limits[i];
      const dof = jointDofs[joint.type][i];
      if (!limit || !dof || (value >= limit.min && value <= limit.max)) return;
      const held = value < limit.min ? limit.min : limit.max;
      notes.push(`The key at ${key.time} s asks ${round(value)} of ${joint.name} (${dof.label}); its limit holds it at ${round(held)}.`);
    });
  }
  for (const drive of study.drives ?? []) {
    const joint = named(drive.joint);
    const limit = joint?.limits[drive.dof];
    const dof = joint && jointDofs[joint.type][drive.dof];
    if (!joint || !limit || !dof || drive.speed === 0) continue;
    const start = joint.values[drive.dof] ?? 0;
    const end = start + drive.speed * study.duration;
    const bound = drive.speed > 0 ? limit.max : limit.min;
    if ((drive.speed > 0 && end <= bound) || (drive.speed < 0 && end >= bound)) continue;
    notes.push(`The drive of ${joint.name} (${dof.label}) reaches its limit of ${round(bound)} at ${round((bound - start) / drive.speed)} s and is held there.`);
  }
  return notes;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Pure: applies a command to an assembly document. Component lookups are the manager's job. */
export function applyCommand(document: AssemblyDocument, command: AssemblyCommand, componentName?: string): Result<Applied> {
  const instance = (id: string) => document.instances.find((i) => i.id === id);
  switch (command.type) {
    case 'insert-instance': {
      if (instance(command.instance.id)) return invalid(`Id ${command.instance.id} is already in use.`);
      if (!Array.isArray(command.instance.transform) || command.instance.transform.length !== 16 || !command.instance.transform.every(finite)) return invalid('A transform is 16 numbers (4 × 4, column-major).');
      const name = command.instance.name.trim() || nextName(document.instances.map((i) => i.name), componentName ?? 'Instance');
      const inserted = { ...document, instances: [...document.instances, { ...command.instance, name }] };
      // Inserted and joined in one change, as a standard part into a hole (CAD-152).
      return command.joint ? applyCommand(inserted, { type: 'add-joint', joint: command.joint }) : ok({ document: inserted });
    }
    case 'remove-instance': {
      if (!instance(command.instanceId)) return invalid(`Instance ${command.instanceId} does not exist.`);
      const joints = document.joints.filter((j) => j.a.instance !== command.instanceId && j.b.instance !== command.instanceId);
      const kept = new Set(joints.map((j) => j.id));
      // Patterns lose the instance; one left with nothing to repeat goes. Links of its joints go too.
      const patterns = document.patterns?.map((p) => ({ ...p, instances: p.instances.filter((id) => id !== command.instanceId) })).filter((p) => p.instances.length);
      const links = document.links?.filter((l) => kept.has(l.driver.joint) && kept.has(l.driven.joint));
      const explodedViews = document.explodedViews?.map((v) => ({ ...v, steps: v.steps.map((s) => ({ ...s, instances: s.instances.filter((id) => id !== command.instanceId) })).filter((s) => s.instances.length) }));
      return ok({
        document: {
          ...document,
          instances: document.instances.filter((i) => i.id !== command.instanceId),
          ...(patterns ? { patterns } : {}),
          ...(links ? { links } : {}),
          ...(explodedViews ? { explodedViews } : {}),
          joints,
          motionStudies: document.motionStudies.map((s) => ({ ...s, keys: s.keys.filter((k) => kept.has(k.joint)), ...(s.drives ? { drives: s.drives.filter((d) => kept.has(d.joint)) } : {}) })),
        },
      });
    }
    case 'rename-instance':
    case 'move-instance':
    case 'ground-instance': {
      if (!instance(command.instanceId)) return invalid(`Instance ${command.instanceId} does not exist.`);
      if (command.type === 'move-instance' && (!Array.isArray(command.transform) || command.transform.length !== 16 || !command.transform.every(finite))) return invalid('A transform is 16 numbers (4 × 4, column-major).');
      if (command.type === 'rename-instance' && !command.name.trim()) return invalid('A name cannot be empty.');
      const change =
        command.type === 'rename-instance' ? { name: command.name.trim() } : command.type === 'move-instance' ? { transform: command.transform } : { grounded: command.grounded };
      return ok({ document: { ...document, instances: document.instances.map((i) => (i.id === command.instanceId ? { ...i, ...change } : i)) } });
    }
    case 'set-instance-configuration': {
      if (!instance(command.instanceId)) return invalid(`Instance ${command.instanceId} does not exist.`);
      const instances = document.instances.map((i): Instance => {
        if (i.id !== command.instanceId) return i;
        if (command.configuration) return { ...i, configuration: command.configuration };
        return Object.fromEntries(Object.entries(i).filter(([key]) => key !== 'configuration')) as unknown as Instance;
      });
      return ok({ document: { ...document, instances } });
    }
    case 'set-instance-appearance': {
      if (!instance(command.instanceId)) return invalid(`Instance ${command.instanceId} does not exist.`);
      const problem = appearanceProblem(command.appearance);
      if (problem) return invalid(problem);
      const instances = document.instances.map((i): Instance => {
        if (i.id !== command.instanceId) return i;
        if (!isDefaultAppearance(command.appearance)) return { ...i, appearance: command.appearance };
        return Object.fromEntries(Object.entries(i).filter(([key]) => key !== 'appearance')) as unknown as Instance;
      });
      return ok({ document: { ...document, instances } });
    }
    case 'add-joint': {
      if (document.joints.some((j) => j.id === command.joint.id)) return invalid(`Id ${command.joint.id} is already in use.`);
      const problem = checkJoint(document, command.joint);
      if (problem) return invalid(problem);
      const name = command.joint.name.trim() || nextName(document.joints.map((j) => j.name), jointLabels[command.joint.type]);
      return ok({ document: { ...document, joints: [...document.joints, { ...command.joint, name }] }, joint: command.joint.id });
    }
    case 'edit-joint': {
      if (!document.joints.some((j) => j.id === command.joint.id)) return invalid(`Joint ${command.joint.id} does not exist.`);
      const problem = checkJoint(document, command.joint);
      if (problem) return invalid(problem);
      // An empty name keeps the joint's own, or gets the next default as when it was added.
      const existing = document.joints.find((j) => j.id === command.joint.id) as Joint;
      const others = document.joints.filter((j) => j.id !== command.joint.id).map((j) => j.name);
      const name = command.joint.name.trim() || existing.name.trim() || nextName(others, jointLabels[command.joint.type]);
      return ok({ document: { ...document, joints: document.joints.map((j) => (j.id === command.joint.id ? { ...command.joint, name } : j)) }, joint: command.joint.id });
    }
    case 'remove-joint':
      return ok({
        document: {
          ...document,
          ...(document.links ? { links: document.links.filter((l) => l.driver.joint !== command.jointId && l.driven.joint !== command.jointId) } : {}),
          joints: document.joints.filter((j) => j.id !== command.jointId),
          motionStudies: document.motionStudies.map((s) => ({ ...s, keys: s.keys.filter((k) => k.joint !== command.jointId), ...(s.drives ? { drives: s.drives.filter((d) => d.joint !== command.jointId) } : {}) })),
        },
      });
    case 'set-joint-values': {
      const joint = document.joints.find((j) => j.id === command.jointId);
      if (!joint) return invalid(`Joint ${command.jointId} does not exist.`);
      if (command.values.length !== joint.values.length || command.values.some((v) => !Number.isFinite(v))) return invalid('Each degree of freedom needs a number.');
      return ok({ document: { ...document, joints: document.joints.map((j) => (j.id === joint.id ? { ...j, values: command.values } : j)) }, joint: joint.id });
    }
    case 'set-joints': {
      if (!command.joints.length) return invalid('Set at least one joint.');
      const values = new Map<string, readonly number[]>();
      for (const { jointId, values: given } of command.joints) {
        const joint = document.joints.find((j) => j.id === jointId);
        if (!joint) return invalid(`Joint ${jointId} does not exist.`);
        if (values.has(jointId)) return invalid(`Joint ${jointId} is set twice.`);
        if (!Array.isArray(given) || given.length !== joint.values.length || !given.every(finite)) return invalid(`Each degree of freedom of ${joint.name} needs a number.`);
        values.set(jointId, given);
      }
      return ok({ document: { ...document, joints: document.joints.map((j) => ({ ...j, values: values.get(j.id) ?? j.values })) }, joints: [...values.keys()] });
    }
    case 'set-pattern': {
      const problem = checkPattern(document, command.pattern);
      if (problem) return invalid(problem);
      const existing = document.patterns?.find((p) => p.id === command.pattern.id);
      const name = command.pattern.name.trim() || existing?.name || nextName((document.patterns ?? []).map((p) => p.name), patternLabels[command.pattern.kind]);
      const pattern = { ...command.pattern, name };
      const patterns = existing ? (document.patterns ?? []).map((p) => (p.id === pattern.id ? pattern : p)) : [...(document.patterns ?? []), pattern];
      return ok({ document: { ...document, patterns } });
    }
    case 'set-link': {
      const problem = checkLink(document, command.link);
      if (problem) return invalid(problem);
      const existing = document.links?.find((l) => l.id === command.link.id);
      const link = { ...command.link, name: command.link.name.trim() || existing?.name || nextName((document.links ?? []).map((l) => l.name), linkLabels[command.link.kind]) };
      const links = existing ? (document.links ?? []).map((l) => (l.id === link.id ? link : l)) : [...(document.links ?? []), link];
      return ok({ document: { ...document, links }, joint: link.driven.joint });
    }
    case 'remove-link':
      if (!document.links?.some((l) => l.id === command.linkId)) return invalid('That link does not exist.');
      return ok({ document: { ...document, links: document.links.filter((l) => l.id !== command.linkId) } });
    case 'set-exploded-view': {
      const view: ExplodedView = command.view;
      // Instances and the copies their patterns make (CAD-110).
      const ids = new Set([...document.instances.map((i) => i.id), ...(document.patterns ?? []).flatMap((p) => p.instances.flatMap((instance) => patternTransforms(p).map((_, k) => copyId(p.id, instance, k + 1))))]);
      const unknown = view.steps.flatMap((s) => s.instances).find((id) => !ids.has(id));
      if (unknown !== undefined) return invalid(`"${unknown}" is not an instance or a pattern copy of this assembly.`);
      if (view.steps.some((s) => !s.instances.length || !(Math.hypot(...s.direction) > 1e-9) || !Number.isFinite(s.distance) || (s.origin && !s.origin.every(Number.isFinite)))) {
        return invalid('Each step moves instances of this assembly along a direction by a distance.');
      }
      const existing = document.explodedViews?.find((v) => v.id === view.id);
      const named = { ...view, name: view.name.trim() || existing?.name || nextName((document.explodedViews ?? []).map((v) => v.name), 'Exploded view') };
      const explodedViews = existing ? (document.explodedViews ?? []).map((v) => (v.id === named.id ? named : v)) : [...(document.explodedViews ?? []), named];
      return ok({ document: { ...document, explodedViews } });
    }
    case 'remove-exploded-view':
      if (!document.explodedViews?.some((v) => v.id === command.viewId)) return invalid('That exploded view does not exist.');
      return ok({ document: { ...document, explodedViews: document.explodedViews.filter((v) => v.id !== command.viewId) } });
    case 'remove-pattern':
      if (!document.patterns?.some((p) => p.id === command.patternId)) return invalid('That pattern does not exist.');
      return ok({ document: { ...document, patterns: document.patterns.filter((p) => p.id !== command.patternId) } });
    case 'add-study':
    case 'edit-study': {
      const exists = document.motionStudies.some((s) => s.id === command.study.id);
      if (exists !== (command.type === 'edit-study')) return invalid(exists ? `Id ${command.study.id} is already in use.` : `Study ${command.study.id} does not exist.`);
      if (!(command.study.duration > 0)) return invalid('A motion study needs a duration above zero.');
      const joints = new Set(document.joints.map((j) => j.id));
      if (command.study.keys.some((k) => !joints.has(k.joint) || k.time < 0 || k.time > command.study.duration)) {
        return invalid('Keys need a joint of this assembly and a time within the study.');
      }
      if ((command.study.drives ?? []).some((d) => !joints.has(d.joint) || !Number.isFinite(d.speed))) return invalid('Drives need a joint of this assembly and a speed.');
      const study = { ...command.study, name: command.study.name.trim() || nextName(document.motionStudies.map((s) => s.name), 'Motion study') };
      const motionStudies = exists ? document.motionStudies.map((s) => (s.id === study.id ? study : s)) : [...document.motionStudies, study];
      const notes = studyNotes(document, study);
      return ok({ document: { ...document, motionStudies }, ...(notes.length ? { notes } : {}) });
    }
    case 'remove-study':
      return ok({ document: { ...document, motionStudies: document.motionStudies.filter((s) => s.id !== command.studyId) } });
  }
}
