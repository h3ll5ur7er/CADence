import type { AssemblyManager } from './assembly-manager';
import { type AssemblyManagerDependencies, DefaultAssemblyManager } from './default-assembly-manager';

export type { AssemblyManagerDependencies } from './default-assembly-manager';
export type {
  AssemblyCommand,
  AssemblyFormat,
  BomLine,
  Collision,
  InstructionPicture,
  AssemblyProperties,
  PlacedRef,
  AssemblyManager,
  AssemblySession,
  AssemblyState,
  ComponentView,
} from './assembly-manager';

export function createAssemblyManager(dependencies: AssemblyManagerDependencies): AssemblyManager {
  return new DefaultAssemblyManager(dependencies);
}
