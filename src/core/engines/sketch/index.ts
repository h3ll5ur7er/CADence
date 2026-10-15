import { type Profile, type ProfileEdge, type Sketch, sketchOriginId, type TextOutlines, type TextWeight } from '@core/contracts';
import { fontSource, type TextFont } from '@core/utilities/text';
import { type DragTarget, PlanegcsSolver, type SolveOutcome } from './planegcs-solver';
import { findProfiles } from './profiles';

export type { DragTarget } from './planegcs-solver';
export { chamfer, type EditResult, extend, fillet, offset, type SketchEdit, split, trim } from './editing';
export { type DrawingRelations, inferRelations } from './relations';
export { type PathPiece2, placesAlong, type SketchPath, sketchPath } from './path';

export interface SketchSolution extends SolveOutcome {
  /** Closed regions of the solved sketch, for features such as extrude. */
  readonly profiles: readonly Profile[];
  /** The outlines of its texts, by text id. */
  readonly texts: TextOutlines;
}

/**
 * Solves sketch constraints and finds closed profiles (docs/Architecture/Components.md#engines).
 * Dimension values are already evaluated (mm, radians) and keyed by constraint id.
 */
export interface SketchEngine {
  solve(sketch: Sketch, values: ReadonlyMap<string, number>, drag?: DragTarget): Promise<SketchSolution>;
}

export interface SketchEngineOptions {
  /** URL of planegcs.wasm in the browser; Node finds it next to the module. */
  readonly wasmUrl?: string;
  /** The bundled fonts for text; by default read from the font package (Node). */
  readonly fonts?: (weight: TextWeight) => Promise<TextFont>;
}

class DefaultSketchEngine implements SketchEngine {
  private readonly solver: PlanegcsSolver;
  private readonly fonts: (weight: TextWeight) => Promise<TextFont>;

  constructor(options: SketchEngineOptions) {
    this.solver = new PlanegcsSolver(options.wasmUrl);
    this.fonts = options.fonts ?? fontSource();
  }

  async solve(sketch: Sketch, values: ReadonlyMap<string, number>, drag?: DragTarget): Promise<SketchSolution> {
    const outcome = await this.solver.solve(sketch, values, drag);
    const texts = await this.textsOf(outcome.sketch);
    return { ...outcome, profiles: findProfiles(outcome.sketch, texts), texts };
  }

  /** Lays out each text at its solved anchor; fonts load on the first text. */
  private async textsOf(sketch: Sketch): Promise<TextOutlines> {
    const texts = new Map<string, readonly (readonly ProfileEdge[])[]>();
    for (const e of sketch.entities) {
      if (e.kind !== 'text' || !e.text.trim() || !(e.height > 0)) continue;
      const anchor = sketch.entities.find((p) => p.id === e.anchor);
      const at = anchor?.kind === 'point' ? ([anchor.x, anchor.y] as const) : e.anchor === sketchOriginId ? ([0, 0] as const) : undefined;
      if (!at) continue;
      const font = await this.fonts(e.weight);
      const contours = font.outline(e.text, { at, height: e.height, angle: e.angle });
      texts.set(e.id, contours.map((contour) => contour.map((edge): ProfileEdge => ({ ...edge, source: e.id }))));
    }
    return texts;
  }
}

export function createSketchEngine(options: SketchEngineOptions = {}): SketchEngine {
  return new DefaultSketchEngine(options);
}
