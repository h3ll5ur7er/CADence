import type { DocumentAccess } from '@core/access/document';
import type { ExternalFileAccess } from '@core/access/external-file';
import {
  type ComponentDocument,
  type DocumentId,
  type DomainError,
  fail,
  isDimension,
  ok,
  type Result,
  type Sketch,
} from '@core/contracts';
import type { InterchangeEngine } from '@core/engines/interchange';
import type { ParameterEngine } from '@core/engines/parameter';
import type { DragTarget, SketchEngine } from '@core/engines/sketch';
import type { Clock } from '@core/utilities/clock';
import { applyCommand } from './commands';
import type {
  DesignCommand,
  DesignManager,
  DesignSession,
  DesignState,
  DrawingFormat,
  SketchView,
} from './design-manager';

export interface DesignManagerDependencies {
  readonly documents: DocumentAccess;
  readonly externalFiles: ExternalFileAccess;
  readonly sketches: SketchEngine;
  readonly parameters: ParameterEngine;
  readonly interchange: InterchangeEngine;
  readonly clock: Clock;
}

interface Snapshot {
  readonly document: ComponentDocument;
  readonly sketches: ReadonlyMap<string, SketchView>;
}

const historyLimit = 200;
const mediaTypes: Readonly<Record<DrawingFormat, string>> = { svg: 'image/svg+xml', dxf: 'image/vnd.dxf' };

/** Readable names for conflict messages. */
const constraintLabels: Readonly<Record<string, string>> = {
  coincident: 'coincident',
  horizontal: 'horizontal',
  vertical: 'vertical',
  parallel: 'parallel',
  perpendicular: 'perpendicular',
  equal: 'equal',
  tangent: 'tangent',
  'point-on': 'point on curve',
  midpoint: 'midpoint',
  fix: 'fixed point',
  distance: 'distance',
  'horizontal-distance': 'horizontal distance',
  'vertical-distance': 'vertical distance',
  'point-line-distance': 'distance to line',
  radius: 'radius',
  diameter: 'diameter',
  angle: 'angle',
};

class Session implements DesignSession {
  private current: Snapshot;
  private readonly undoStack: Snapshot[] = [];
  private readonly redoStack: Snapshot[] = [];
  private readonly listeners = new Set<(state: DesignState) => void>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly deps: DesignManagerDependencies,
    initial: Snapshot,
  ) {
    this.current = initial;
  }

  state(): DesignState {
    return { ...this.current, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 };
  }

  subscribe(listener: (state: DesignState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Commands run one after another, so fast input (drags, typing) can never interleave. */
  execute(command: DesignCommand): Promise<Result<void>> {
    return this.serialized(() => this.apply(command));
  }

  undo(): Promise<void> {
    return this.serialized(() => this.travel(this.undoStack, this.redoStack));
  }

  redo(): Promise<void> {
    return this.serialized(() => this.travel(this.redoStack, this.undoStack));
  }

  async previewDrag(sketchId: string, pointId: string, x: number, y: number): Promise<SketchView | undefined> {
    const sketch = this.current.document.timeline.find((item) => item.id === sketchId);
    if (!sketch) return undefined;
    const solved = await solveSketch(this.deps, sketch, { point: pointId, x, y });
    return solved.ok ? solved.value : undefined;
  }

  async exportSketch(sketchId: string, format: DrawingFormat): Promise<Result<void>> {
    const view = this.current.sketches.get(sketchId);
    if (!view) return fail({ code: 'invalid-command', message: `Sketch ${sketchId} does not exist.` });
    const bytes = await this.deps.interchange.exportDrawing(view.sketch, format);
    await this.deps.externalFiles.deliver({
      name: `${this.current.document.name} - ${view.sketch.name}.${format}`,
      mediaType: mediaTypes[format],
      bytes,
    });
    return ok(undefined);
  }

  private async apply(command: DesignCommand): Promise<Result<void>> {
    const applied = applyCommand(this.current.document, command);
    if (!applied.ok) return applied;
    const { document, sketchId, drag } = applied.value;
    const sketches = new Map([...this.current.sketches].filter(([id]) => document.timeline.some((item) => item.id === id)));
    let timeline = document.timeline;
    if (sketchId) {
      const sketch = document.timeline.find((item) => item.id === sketchId) as Sketch;
      const solved = await solveSketch(this.deps, sketch, drag);
      if (!solved.ok) return solved;
      sketches.set(sketchId, solved.value);
      timeline = timeline.map((item) => (item.id === sketchId ? solved.value.sketch : item));
    }
    this.undoStack.push(this.current);
    if (this.undoStack.length > historyLimit) this.undoStack.shift();
    this.redoStack.length = 0;
    await this.commit({ document: { ...document, timeline, modifiedAt: this.deps.clock().toISOString() }, sketches });
    return ok(undefined);
  }

  private async travel(from: Snapshot[], to: Snapshot[]): Promise<void> {
    const target = from.pop();
    if (!target) return;
    to.push(this.current);
    await this.commit(target);
  }

  private async commit(snapshot: Snapshot): Promise<void> {
    this.current = snapshot;
    await this.deps.documents.store(snapshot.document);
    const state = this.state();
    for (const listener of this.listeners) listener(state);
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/** Evaluates a sketch's dimensions, then solves it; conflicts and unsolvable sketches are errors. */
async function solveSketch(deps: DesignManagerDependencies, sketch: Sketch, drag?: DragTarget): Promise<Result<SketchView>> {
  const values = new Map<string, number>();
  for (const dimension of sketch.constraints.filter(isDimension)) {
    const value = deps.parameters.evaluate(dimension.expression, dimension.kind === 'angle' ? 'angle' : 'length');
    if (!value.ok) {
      return fail({ code: 'invalid-expression', message: `${constraintLabels[dimension.kind]} "${dimension.expression}": ${value.error.message}` });
    }
    if (value.value < 0 && dimension.kind !== 'horizontal-distance' && dimension.kind !== 'vertical-distance') {
      return fail({ code: 'invalid-expression', message: `${constraintLabels[dimension.kind]} cannot be negative.` });
    }
    values.set(dimension.id, value.value);
  }
  const solution = await deps.sketches.solve(sketch, values, drag);
  if (solution.status === 'over-constrained') {
    const kinds = sketch.constraints.filter((c) => solution.conflicting.includes(c.id)).map((c) => constraintLabels[c.kind]);
    const error: DomainError = {
      code: 'over-constrained',
      message: `This conflicts with existing constraints (${[...new Set(kinds)].join(', ')}). Remove one of them first.`,
    };
    return fail(error);
  }
  if (solution.status === 'failed') {
    return fail({ code: 'unsolvable', message: 'The sketch cannot satisfy these constraints. Check the dimension values.' });
  }
  return ok({ ...solution, values });
}

export class DefaultDesignManager implements DesignManager {
  constructor(private readonly deps: DesignManagerDependencies) {}

  async open(documentId: DocumentId): Promise<Result<DesignSession>> {
    const document = await this.deps.documents.load(documentId);
    if (document?.kind !== 'component') {
      return fail({ code: 'unknown-document', message: `Component ${documentId} does not exist.` });
    }
    const sketches = new Map<string, SketchView>();
    for (const sketch of document.timeline) {
      const solved = await solveSketch(this.deps, sketch);
      // A stored sketch that no longer solves (e.g. after an app update) still opens, as last saved.
      const fallback: SketchView = { sketch, status: 'failed', degreesOfFreedom: 0, profiles: [], values: new Map() };
      sketches.set(sketch.id, solved.ok ? solved.value : fallback);
    }
    return ok(new Session(this.deps, { document, sketches }));
  }
}
