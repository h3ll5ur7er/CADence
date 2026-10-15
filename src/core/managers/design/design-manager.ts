import type {
  Appearance,
  BodyMesh,
  BodyProperties,
  ComponentDocument,
  DocumentId,
  Feature,
  LengthUnit,
  ManufacturingProfile,
  MeshQuality,
  Material,
  Measurement,
  Parameter,
  PlaneFrame,
  PlaneRef,
  Profile,
  Result,
  Sketch,
  SketchConstraint,
  SketchEntity,
  SketchStatus,
  TopologyRef,
  ValidationReport,
  Vec2,
  TextOutlines,
  TextWeight,
  ThreadMarker,
} from '@core/contracts';

/** Every change to a component is one of these commands (docs/Architecture/Decisions.md#adr-10). Ids come from the caller. */
export type DesignCommand =
  | { readonly type: 'create-sketch'; readonly id: string; readonly plane: PlaneRef }
  | { readonly type: 'add-sketch-geometry'; readonly sketchId: string; readonly entities: readonly SketchEntity[]; readonly constraints: readonly SketchConstraint[] }
  | { readonly type: 'add-constraint'; readonly sketchId: string; readonly constraint: SketchConstraint }
  | { readonly type: 'set-dimension'; readonly sketchId: string; readonly constraintId: string; readonly expression: string }
  | { readonly type: 'move-point'; readonly sketchId: string; readonly pointId: string; readonly x: number; readonly y: number }
  | { readonly type: 'toggle-construction'; readonly sketchId: string; readonly ids: readonly string[] }
  | { readonly type: 'delete-sketch-elements'; readonly sketchId: string; readonly ids: readonly string[] }
  /**
   * Moves sketch elements (and the points of curves among them), then turns them about `rotate.center`.
   * A turn drops their horizontal and vertical relations, which would undo it.
   */
  | {
      readonly type: 'transform-sketch-elements';
      readonly sketchId: string;
      readonly ids: readonly string[];
      readonly translate: Vec2;
      readonly rotate?: { readonly center: Vec2; readonly angle: number };
    }
  /** Changes what a sketch text says, how tall and bold it is, and its direction (radians). */
  | {
      readonly type: 'set-sketch-text';
      readonly sketchId: string;
      readonly textId: string;
      readonly text: string;
      readonly height: number;
      readonly weight: TextWeight;
      readonly angle: number;
    }
  /** Trim, extend, split, offset, fillet or chamfer sketch curves; new ids start with `idPrefix`. */
  | { readonly type: 'edit-sketch'; readonly sketchId: string; readonly operation: SketchOperation; readonly idPrefix: string }
  /** Adds a feature at the end of the timeline; an empty name gets the next default ("Extrude 2"). */
  | { readonly type: 'add-feature'; readonly feature: Feature }
  /** Replaces a feature's definition (same id). */
  | { readonly type: 'edit-feature'; readonly feature: Feature }
  | { readonly type: 'suppress-item'; readonly itemId: string; readonly suppressed: boolean }
  | { readonly type: 'rename-item'; readonly itemId: string; readonly name: string }
  | { readonly type: 'delete-item'; readonly itemId: string }
  /** Moves an item to `index` (in the timeline without it); refused when it would come before something it uses, or after something that uses it. */
  | { readonly type: 'reorder-item'; readonly itemId: string; readonly index: number }
  /** Puts the rollback marker after the first `position` items (0 … timeline length). */
  | { readonly type: 'roll-to'; readonly position: number }
  | { readonly type: 'add-parameter'; readonly parameter: Parameter }
  | { readonly type: 'set-parameter'; readonly parameter: Parameter }
  | { readonly type: 'delete-parameter'; readonly id: string }
  | { readonly type: 'set-material'; readonly material: Material }
  /** The unit lengths are shown and typed in; nothing stored changes. */
  | { readonly type: 'set-units'; readonly units: LengthUnit }
  /** The machine the component is made on (print or laser profile), for validation and kerf compensation. */
  | { readonly type: 'set-process'; readonly process: ManufacturingProfile }
  /** How a body is shown; an appearance of defaults only removes the entry. */
  | { readonly type: 'set-appearance'; readonly body: string; readonly appearance: Appearance };

/** The editing tools of the sketcher (docs/User-guide/Sketching.md#edit). */
export type SketchOperation =
  | { readonly kind: 'trim' | 'extend' | 'split'; readonly curve: string; readonly at: Vec2 }
  /** Positive moves to the right of the chain's direction (outward around a counter-clockwise loop). */
  | { readonly kind: 'offset'; readonly curves: readonly string[]; readonly distance: number }
  | { readonly kind: 'fillet' | 'chamfer'; readonly point: string; readonly size: number };

/** A solved sketch as the editor shows it. */
export interface SketchView {
  readonly sketch: Sketch;
  /** Where the sketch lies in space. */
  readonly frame: PlaneFrame;
  readonly status: SketchStatus;
  readonly degreesOfFreedom: number;
  readonly profiles: readonly Profile[];
  /** Outlines of the sketch's texts, by text id. */
  readonly texts: TextOutlines;
  /** Evaluated dimension values (mm, radians) by constraint id. */
  readonly values: ReadonlyMap<string, number>;
  /** Why the sketch could not be placed or solved. */
  readonly error?: string;
}

/** How a timeline item came out in the last regeneration. */
export interface ItemStatus {
  readonly state: 'ok' | 'error' | 'suppressed' | 'rolled-back';
  readonly error?: string;
}

export interface ParameterView {
  readonly parameter: Parameter;
  /** Evaluated value with a unit label, e.g. "12 mm" or "30°". */
  readonly display?: string;
}

export interface DesignState {
  readonly document: ComponentDocument;
  readonly sketches: ReadonlyMap<string, SketchView>;
  readonly items: ReadonlyMap<string, ItemStatus>;
  /** Construction planes by feature id. */
  readonly planes: ReadonlyMap<string, PlaneFrame>;
  readonly bodies: readonly BodyMesh[];
  /** Threads, for showing on their faces. */
  readonly threads: readonly ThreadMarker[];
  readonly parameters: readonly ParameterView[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export type DrawingFormat = 'dxf' | 'svg';
export type SolidFormat = 'step' | 'stl' | 'obj' | '3mf';

/** An editing session on one component document. */
/** Which bodies to export (all by default), and how finely meshes are made. */
export interface ExportOptions {
  readonly bodies?: readonly string[];
  readonly quality?: MeshQuality;
}

/** How a drawing goes into a sketch: as one piece, or as separate curves held by the relations it shows, fixed, or free. */
export interface InsertDrawingOptions {
  readonly onePiece?: boolean;
  readonly relations?: 'none' | 'infer' | 'fix';
}

export interface DesignSession {
  state(): DesignState;
  /** Called after every change; returns the unsubscribe function. */
  subscribe(listener: (state: DesignState) => void): () => void;
  execute(command: DesignCommand): Promise<Result<void>>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** Solves a sketch with a point pulled toward (x, y), without changing the document. */
  previewDrag(sketchId: string, pointId: string, x: number, y: number): Promise<SketchView | undefined>;
  /** With `compensateKerf`, outlines are offset for the laser profile's kerf (laser profiles only). */
  exportSketch(sketchId: string, format: DrawingFormat, options?: { readonly compensateKerf?: boolean }): Promise<Result<void>>;
  /**
   * Adds an imported DXF or SVG document to a sketch (one undoable change); new ids start with `idPrefix`.
   * By default its curves and texts become separate sketch geometry, held by `relations`. As one piece,
   * the drawing keeps its proportions and moves, turns and scales by two handle points.
   */
  insertDrawing(sketchId: string, documentId: DocumentId, idPrefix: string, options?: InsertDrawingOptions): Promise<Result<void>>;
  /** All bodies, one file. */
  exportBodies(format: SolidFormat, options?: ExportOptions): Promise<Result<void>>;
  /** Area, length, radius, distance and angle of picked faces and edges. */
  measure(refs: readonly TopologyRef[]): Promise<Result<Measurement>>;
  /** Volume, mass (from the material), centre of mass and bounding box per body. */
  properties(): Promise<BodyProperties[]>;
  /** Checks the bodies and sketches against the manufacturing profile. */
  validate(): Promise<ValidationReport>;
}

/** Part design workflow (docs/Architecture/Components.md#design-manager). */
export interface DesignManager {
  open(documentId: DocumentId): Promise<Result<DesignSession>>;
}
