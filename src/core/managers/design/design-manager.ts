import type {
  ComponentDocument,
  DocumentId,
  Profile,
  Result,
  Sketch,
  SketchConstraint,
  SketchEntity,
  SketchPlane,
  SketchStatus,
} from '@core/contracts';

/** Every change to a component is one of these commands (docs/Architecture/Decisions.md#adr-10). Ids come from the caller. */
export type DesignCommand =
  | { readonly type: 'create-sketch'; readonly id: string; readonly plane: SketchPlane }
  | { readonly type: 'add-sketch-geometry'; readonly sketchId: string; readonly entities: readonly SketchEntity[]; readonly constraints: readonly SketchConstraint[] }
  | { readonly type: 'add-constraint'; readonly sketchId: string; readonly constraint: SketchConstraint }
  | { readonly type: 'set-dimension'; readonly sketchId: string; readonly constraintId: string; readonly expression: string }
  | { readonly type: 'move-point'; readonly sketchId: string; readonly pointId: string; readonly x: number; readonly y: number }
  | { readonly type: 'toggle-construction'; readonly sketchId: string; readonly ids: readonly string[] }
  | { readonly type: 'delete-sketch-elements'; readonly sketchId: string; readonly ids: readonly string[] }
  | { readonly type: 'rename-item'; readonly itemId: string; readonly name: string }
  | { readonly type: 'delete-item'; readonly itemId: string };

/** A solved sketch as the editor shows it. */
export interface SketchView {
  readonly sketch: Sketch;
  readonly status: SketchStatus;
  readonly degreesOfFreedom: number;
  readonly profiles: readonly Profile[];
  /** Evaluated dimension values (mm, radians) by constraint id. */
  readonly values: ReadonlyMap<string, number>;
}

export interface DesignState {
  readonly document: ComponentDocument;
  readonly sketches: ReadonlyMap<string, SketchView>;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export type DrawingFormat = 'dxf' | 'svg';

/** An editing session on one component document. */
export interface DesignSession {
  state(): DesignState;
  /** Called after every change; returns the unsubscribe function. */
  subscribe(listener: (state: DesignState) => void): () => void;
  execute(command: DesignCommand): Promise<Result<void>>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** Solves a sketch with a point pulled toward (x, y), without changing the document. */
  previewDrag(sketchId: string, pointId: string, x: number, y: number): Promise<SketchView | undefined>;
  exportSketch(sketchId: string, format: DrawingFormat): Promise<Result<void>>;
}

/** Part design workflow (docs/Architecture/Components.md#design-manager). */
export interface DesignManager {
  open(documentId: DocumentId): Promise<Result<DesignSession>>;
}
