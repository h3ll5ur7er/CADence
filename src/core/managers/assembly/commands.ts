import { appearanceProblem, type AssemblyDocument, fail, type Instance, isDefaultAppearance, type Joint, jointDofs, type JointType, ok, type Result } from '@core/contracts';
import type { AssemblyCommand } from './assembly-manager';

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
      return ok({
        document: {
          ...document,
          instances: document.instances.filter((i) => i.id !== command.instanceId),
          joints,
          motionStudies: document.motionStudies.map((s) => ({ ...s, keys: s.keys.filter((k) => kept.has(k.joint)) })),
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
      return ok({ document: { ...document, joints: document.joints.map((j) => (j.id === command.joint.id ? command.joint : j)) }, joint: command.joint.id });
    }
    case 'remove-joint':
      return ok({
        document: {
          ...document,
          joints: document.joints.filter((j) => j.id !== command.jointId),
          motionStudies: document.motionStudies.map((s) => ({ ...s, keys: s.keys.filter((k) => k.joint !== command.jointId) })),
        },
      });
    case 'set-joint-values': {
      const joint = document.joints.find((j) => j.id === command.jointId);
      if (!joint) return invalid(`Joint ${command.jointId} does not exist.`);
      if (command.values.length !== joint.values.length || command.values.some((v) => !Number.isFinite(v))) return invalid('Each degree of freedom needs a number.');
      return ok({ document: { ...document, joints: document.joints.map((j) => (j.id === joint.id ? { ...j, values: command.values } : j)) }, joint: joint.id });
    }
    case 'add-study':
    case 'edit-study': {
      const exists = document.motionStudies.some((s) => s.id === command.study.id);
      if (exists !== (command.type === 'edit-study')) return invalid(exists ? `Id ${command.study.id} is already in use.` : `Study ${command.study.id} does not exist.`);
      if (!(command.study.duration > 0)) return invalid('A motion study needs a duration above zero.');
      const joints = new Set(document.joints.map((j) => j.id));
      if (command.study.keys.some((k) => !joints.has(k.joint) || k.time < 0 || k.time > command.study.duration)) {
        return invalid('Keys need a joint of this assembly and a time within the study.');
      }
      const study = { ...command.study, name: command.study.name.trim() || nextName(document.motionStudies.map((s) => s.name), 'Motion study') };
      const motionStudies = exists ? document.motionStudies.map((s) => (s.id === study.id ? study : s)) : [...document.motionStudies, study];
      return ok({ document: { ...document, motionStudies } });
    }
    case 'remove-study':
      return ok({ document: { ...document, motionStudies: document.motionStudies.filter((s) => s.id !== command.studyId) } });
  }
}
