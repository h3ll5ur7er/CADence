import { isCurve, type Profile, type ProfileEdge, type Sketch, type SketchConstraint, type SketchFreedom, type SketchText, sketchOriginId, type TextOutlines, type TextWeight } from '@core/contracts';
import type { Vec2 } from '@core/utilities/math';
import { fontSource, loadFont, type TextFont } from '@core/utilities/text';
import { type DragTarget, PlanegcsSolver, type SolveOutcome } from './planegcs-solver';
import { sketchFreedom, suggestConstraints } from './diagnostics';
import { measured, sketchPath } from './path';
import { findProfiles } from './profiles';
import { referenceValues } from './measure';

export type { DragTarget } from './planegcs-solver';
export { chamfer, type EditResult, extend, fillet, offset, type SketchEdit, split, trim } from './editing';
export { type DrawingRelations, inferRelations } from './relations';
export { type PathPiece2, placesAlong, type SketchPath, sketchPath } from './path';
export { measureDimension, referenceValues } from './measure';

export interface SketchSolution extends SolveOutcome {
  /** Closed regions of the solved sketch, for features such as extrude. */
  readonly profiles: readonly Profile[];
  /** The outlines of its texts, by text id. */
  readonly texts: TextOutlines;
  /** What its reference dimensions measure (mm, radians), by constraint id. */
  readonly measured: ReadonlyMap<string, number>;
}

/**
 * Solves sketch constraints and finds closed profiles (docs/Architecture/Components.md#engines).
 * Dimension values are already evaluated (mm, radians) and keyed by constraint id.
 */
/** The files of imported fonts, by document id; `key` changes when the file does. */
export type FontFiles = (documentId: string) => Promise<{ readonly key: string; readonly bytes: Uint8Array } | undefined>;

export interface SketchEngine {
  /** With `fonts`, texts in imported fonts are laid out in them (others in the bundled Inter). */
  solve(sketch: Sketch, values: ReadonlyMap<string, number>, drag?: DragTarget, fonts?: FontFiles): Promise<SketchSolution>;
  /** The points (and circle sizes) that the sketch's relations and dimensions leave free. */
  freedom(sketch: Sketch, values: ReadonlyMap<string, number>): Promise<SketchFreedom>;
  /** Relations and dimensions (ids start with `idPrefix`) that would fully define the sketch as it is drawn. */
  suggest(sketch: Sketch, values: ReadonlyMap<string, number>, idPrefix: string): Promise<{ constraints: SketchConstraint[]; degreesOfFreedom: number }>;
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

  /** Imported fonts, parsed once per file. */
  private readonly documentFonts = new Map<string, Promise<TextFont>>();

  async solve(sketch: Sketch, values: ReadonlyMap<string, number>, drag?: DragTarget, fonts?: FontFiles): Promise<SketchSolution> {
    const outcome = await this.solver.solve(sketch, values, drag);
    const texts = await this.textsOf(outcome.sketch, fonts);
    return { ...outcome, profiles: findProfiles(outcome.sketch, texts), texts, measured: referenceValues(outcome.sketch) };
  }

  freedom(sketch: Sketch, values: ReadonlyMap<string, number>): Promise<SketchFreedom> {
    return sketchFreedom(this.solver, sketch, values);
  }

  suggest(sketch: Sketch, values: ReadonlyMap<string, number>, idPrefix: string): Promise<{ constraints: SketchConstraint[]; degreesOfFreedom: number }> {
    return suggestConstraints(this.solver, sketch, values, idPrefix);
  }

  /** A text's font: its imported font when it has one (and the file is there), else the bundled one. */
  private async fontOf(text: SketchText, fonts?: FontFiles): Promise<TextFont> {
    const file = text.font && fonts ? await fonts(text.font) : undefined;
    if (!file) return this.fonts(text.weight);
    let font = this.documentFonts.get(file.key);
    if (!font) {
      font = loadFont(file.bytes.slice().buffer);
      this.documentFonts.set(file.key, font);
    }
    return font.catch(() => this.fonts(text.weight));
  }

  /** How a text along a curve is placed at each distance; undefined when the curve is gone. */
  private placeAlong(sketch: Sketch, text: SketchText): ((distance: number) => { at: Vec2; angle: number }) | undefined {
    const along = text.along;
    const curve = along && sketch.entities.find((e) => e.id === along.curve);
    if (!along || !curve || !isCurve(curve)) return undefined;
    const path = sketchPath({ ...sketch, entities: [...sketch.entities.filter((e) => e.kind === 'point'), { ...curve, construction: false }] });
    if (!path.ok) return undefined;
    const measure = measured(path.value);
    return (distance) => {
      const { point, direction } = measure.at(along.reversed ? measure.length - along.offset - distance : along.offset + distance);
      const [dx, dy] = along.reversed ? [-direction[0], -direction[1]] : direction;
      return { at: point, angle: Math.atan2(dy, dx) };
    };
  }

  /** Lays out each text at its solved anchor, or along its curve; fonts load on the first text. */
  private async textsOf(sketch: Sketch, fonts?: FontFiles): Promise<TextOutlines> {
    const texts = new Map<string, readonly (readonly ProfileEdge[])[]>();
    for (const e of sketch.entities) {
      if (e.kind !== 'text' || !e.text.trim() || !(e.height > 0)) continue;
      const anchor = sketch.entities.find((p) => p.id === e.anchor);
      const at = anchor?.kind === 'point' ? ([anchor.x, anchor.y] as const) : e.anchor === sketchOriginId ? ([0, 0] as const) : undefined;
      if (!at) continue;
      const font = await this.fontOf(e, fonts);
      const along = this.placeAlong(sketch, e);
      const contours = along ? font.outlineAlong(e.text, e.height, along) : font.outline(e.text, { at, height: e.height, angle: e.angle });
      texts.set(e.id, contours.map((contour) => contour.map((edge): ProfileEdge => ({ ...edge, source: e.id }))));
    }
    return texts;
  }
}

export function createSketchEngine(options: SketchEngineOptions = {}): SketchEngine {
  return new DefaultSketchEngine(options);
}
