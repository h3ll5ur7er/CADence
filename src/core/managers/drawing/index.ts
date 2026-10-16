import { DefaultDrawingManager, type DrawingManagerDependencies } from './default-drawing-manager';
import type { DrawingManager } from './drawing-manager';

export type { DrawingManagerDependencies } from './default-drawing-manager';
export type { DrawingCommand, DrawingManager, DrawingSession, DrawingState, LineStyle, SheetAnchor, SheetLayout } from './drawing-manager';

export function createDrawingManager(dependencies: DrawingManagerDependencies): DrawingManager {
  return new DefaultDrawingManager(dependencies);
}
