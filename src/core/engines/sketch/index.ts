import type { Profile, Sketch } from '@core/contracts';
import { type DragTarget, PlanegcsSolver, type SolveOutcome } from './planegcs-solver';
import { findProfiles } from './profiles';

export type { DragTarget } from './planegcs-solver';

export interface SketchSolution extends SolveOutcome {
  /** Closed regions of the solved sketch, for features such as extrude. */
  readonly profiles: readonly Profile[];
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
}

class DefaultSketchEngine implements SketchEngine {
  private readonly solver: PlanegcsSolver;

  constructor(options: SketchEngineOptions) {
    this.solver = new PlanegcsSolver(options.wasmUrl);
  }

  async solve(sketch: Sketch, values: ReadonlyMap<string, number>, drag?: DragTarget): Promise<SketchSolution> {
    const outcome = await this.solver.solve(sketch, values, drag);
    return { ...outcome, profiles: findProfiles(outcome.sketch) };
  }
}

export function createSketchEngine(options: SketchEngineOptions = {}): SketchEngine {
  return new DefaultSketchEngine(options);
}
