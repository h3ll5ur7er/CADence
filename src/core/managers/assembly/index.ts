import type { AssemblyManager } from './assembly-manager';
import { type AssemblyManagerDependencies, DefaultAssemblyManager } from './default-assembly-manager';

export type { AssemblyManagerDependencies } from './default-assembly-manager';
export type {
  AssemblyCommand,
  CableHit,
  CableReport,
  CableState,
  AssemblyFormat,
  BomLine,
  Collision,
  CollisionOptions,
  CollisionReport,
  InstructionPicture,
  LoadLine,
  LoadOptions,
  LoadReport,
  Reached,
  StudyMoment,
  AssemblyProperties,
  PlacedRef,
  AssemblyManager,
  AssemblySession,
  AssemblyState,
  ComponentView,
} from './assembly-manager';

export { cableMesh, cableRoute } from './cables';

export function createAssemblyManager(dependencies: AssemblyManagerDependencies): AssemblyManager {
  return new DefaultAssemblyManager(dependencies);
}
