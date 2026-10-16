import { appearanceProblem, type AssemblyDocument, type ExplodedView, fail, type Instance, type InstancePattern, isDefaultAppearance, type Joint, jointDofs, type JointType, type MotionLink, ok, type Result } from '@core/contracts';
import type { AssemblyCommand } from './assembly-manager';
import { copyId, patternTransforms } from './patterns';

/** The document a command produces, and the joint whose solution decides whether it is accepted. */
export interface Applied {
  readonly document: AssemblyDocument;
  /** The command is refused when this joint cannot hold. */
  readonly joint?: string;
}

const jointLabels: Readonly<Record<JointType, string>> = {
  rigid: 'Rigid',
  revolute: 'Revolute',
  slider: 'Slider',
  cylindrical: 'Cylindrical',
  'pin-slot': 'Pin-slot',
  planar: 'Planar',
  ball: 'Ball',
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

const linkLabels: Readonly<Record<MotionLink['kind'], string>> = { gear: 'Gear', rack: 'Rack and pinion', belt: 'Belt', carrier: 'Planet carrier', planet: 'Planet', cam: 'Cam' };

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

function checkJoint(document: AssemblyDocument, joint: Joint): string | undefined {
  const ids = new Set(document.instances.map((i) => i.id));
  if (!ids.has(joint.a.instance) || !ids.has(joint.b.instance)) return 'A joint connects two instances of this assembly.';
  if (joint.a.instance === joint.b.instance) return 'A joint needs two different instances.';
  const dofs = jointDofs[joint.type].length;
  if (joint.values.length !== dofs) return `A ${jointLabels[joint.type].toLowerCase()} joint has ${dofs} value${dofs === 1 ? '' : 's'}.`;
  if (joint.limits.some((l) => l && !(l.min <= l.max))) return 'A limit’s minimum must not exceed its maximum.';
  return undefined;
}

/** Pure: applies a command to an assembly document. Component lookups are the manager's job. */
export function applyCommand(document: AssemblyDocument, command: AssemblyCommand, componentName?: string): Result<Applied> {
  const instance = (id: string) => document.instances.find((i) => i.id === id);
  switch (command.type) {
    case 'insert-instance': {
      if (instance(command.instance.id)) return invalid(`Id ${command.instance.id} is already in use.`);
      const name = command.instance.name.trim() || nextName(document.instances.map((i) => i.name), componentName ?? 'Instance');
      return ok({ document: { ...document, instances: [...document.instances, { ...command.instance, name }] } });
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
      return ok({ document: { ...document, motionStudies } });
    }
    case 'remove-study':
      return ok({ document: { ...document, motionStudies: document.motionStudies.filter((s) => s.id !== command.studyId) } });
  }
}
