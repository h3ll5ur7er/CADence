import type { ShapeAccess } from '@core/access/shape';
import type { ModelingEngine } from './modeling-engine';
import { OcctModelingEngine } from './occt-modeling-engine';

export type {
  HoleSpec,
  PathPiece,
  Placement,
  AxisInput,
  BodyState,
  ModelingEngine,
  ModelingOutcome,
  ModelingRequest,
  ToolInput,
} from './modeling-engine';
export type { PartSolid } from './parts';
export type { ViewGeometry, ViewRequest } from './drawing-view';
export type { ProjectedCurve } from './modeling-engine';

/** The OpenCascade engine; call it where the shapes live (the geometry worker, or in-process in tests). */
export function createModelingEngine(shapes: ShapeAccess): ModelingEngine {
  return new OcctModelingEngine(shapes);
}
