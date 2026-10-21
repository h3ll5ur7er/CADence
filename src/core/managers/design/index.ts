import { DefaultDesignManager, type DesignManagerDependencies } from './default-design-manager';
import type { DesignManager } from './design-manager';

export type { ConfigurationImport } from './configurations';
export type { BrokenReference } from './references';
export type { LiveState, LiveTarget } from './live';
export type { DesignManagerDependencies } from './default-design-manager';
export type {
  BodyComparison,
  DesignCommand,
  DesignManager,
  DesignSession,
  DesignState,
  DrawingFormat,
  ExportOptions,
  InsertDrawingOptions,
  ItemStatus,
  ParameterView,
  SketchView,
  SolidFormat,
} from './design-manager';

export function createDesignManager(dependencies: DesignManagerDependencies): DesignManager {
  return new DefaultDesignManager(dependencies);
}
