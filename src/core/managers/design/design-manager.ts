import type {
  Appearance,
  BodyDifference,
  BodyMesh,
  BodyProperties,
  ComponentDocument,
  Configuration,
  DocumentId,
  Feature,
  LengthUnit,
  ManufacturingProfile,
  Material,
  TimelineFolder,
  Measurement,
  MeshQuality,
  Parameter,
  PlaneFrame,
  PlaneRef,
  Profile,
  Result,
  SimulationResult,
  SimulationSetup,
  Sketch,
  SketchConstraint,
  SketchEntity,
  SketchFreedom,
  SketchStatus,
  TextOutlines,
  TextPath,
  TextWeight,
  ThreadMarker,
  TraceSettings,
  TopologyRef,
  ValidationReport,
  Vec2,
} from '@core/contracts';

import type { ConfigurationImport } from './configurations';
import type { BrokenReference } from './references';

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
  /**
   * Changes what a sketch text says, how tall and bold it is, its direction (radians), its font (an
   * imported font document; absent: the bundled one) and the curve it follows (absent: none).
   */
  | {
      readonly type: 'set-sketch-text';
      readonly sketchId: string;
      readonly textId: string;
      readonly text: string;
      readonly height: number;
      readonly weight: TextWeight;
      readonly angle: number;
      readonly font?: string;
      readonly along?: TextPath;
    }
  /** How a picture behind a sketch shows: its opacity (0.05 … 1), or not at all. */
  | { readonly type: 'set-sketch-picture'; readonly sketchId: string; readonly pictureId: string; readonly opacity: number; readonly hidden: boolean }
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
  /** Makes an item refer to `to` wherever it referred to `from` (a lost face, edge or vertex); accepted even while the item still fails. */
  | { readonly type: 'replace-reference'; readonly itemId: string; readonly from: TopologyRef; readonly to: TopologyRef }
  /** A note on a timeline item (empty: none). */
  | { readonly type: 'set-note'; readonly itemId: string; readonly note: string }
  /** Groups the items from `first` to `last` in a new folder (an empty name gets "Folder 2" and so on), or changes a folder; folders may not overlap. */
  | { readonly type: 'set-folder'; readonly folder: TimelineFolder }
  /** Removes a folder; its items stay. */
  | { readonly type: 'delete-folder'; readonly folderId: string }
  /** Suppresses or unsuppresses every item of a folder. */
  | { readonly type: 'suppress-folder'; readonly folderId: string; readonly suppressed: boolean }
  /** Puts the rollback marker after the first `position` items (0 … timeline length). */
  | { readonly type: 'roll-to'; readonly position: number }
  | { readonly type: 'add-parameter'; readonly parameter: Parameter }
  | { readonly type: 'set-parameter'; readonly parameter: Parameter }
  | { readonly type: 'delete-parameter'; readonly id: string }
  | { readonly type: 'set-material'; readonly material: Material }
  /** Replaces the configuration table; the configuration being edited must stay in it. */
  | { readonly type: 'set-configurations'; readonly configurations: readonly Configuration[] }
  /** Edits and shows a configuration (absent: the parameters' own values). */
  | { readonly type: 'activate-configuration'; readonly configuration?: string }
  /** The unit lengths are shown and typed in; nothing stored changes. */
  | { readonly type: 'set-units'; readonly units: LengthUnit }
  /** The machine the component is made on (print or laser profile), for validation and kerf compensation. */
  | { readonly type: 'set-process'; readonly process: ManufacturingProfile }
  /** How a body is shown; an appearance of defaults only removes the entry. */
  | { readonly type: 'set-appearance'; readonly body: string; readonly appearance: Appearance }
  /** The strength check's fixed faces and loads; an empty setup removes it. */
  | { readonly type: 'set-simulation'; readonly setup: SimulationSetup };

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
  /** When relations and dimensions contradict each other: the ones involved. */
  readonly conflicting?: readonly string[];
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
  /** A project parameter (edited in the project, used here). */
  readonly project?: boolean;
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
  /** Whether the component is a sheet metal part (it has a base flange), which can be laid flat. */
  readonly sheetMetal: boolean;
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
  /** A configuration to export (`''`: the parameters' own values); the shown one by default. */
  readonly configuration?: string;
}

/** How a drawing goes into a sketch: as one piece, or as separate curves held by the relations it shows, fixed, or free. */
export interface InsertDrawingOptions {
  readonly onePiece?: boolean;
  readonly relations?: 'none' | 'infer' | 'fix';
  /** For pictures (PNG, JPEG): how their dark shapes are traced into outlines. */
  readonly trace?: TraceSettings;
}

export interface DesignSession {
  state(): DesignState;
  /** Called after every change; returns the unsubscribe function. */
  subscribe(listener: (state: DesignState) => void): () => void;
  execute(command: DesignCommand): Promise<Result<void>>;
  /** Reads the project's parameters again where they changed unheard (another process or tool, CAD-146); commands do so first. */
  catchUp(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** The points (and circle sizes) of a sketch that its relations and dimensions leave free. */
  freedom(sketchId: string): Promise<SketchFreedom>;
  /** Relations and dimensions (ids start with `idPrefix`) that would fully define a sketch as drawn; add them with `add-sketch-geometry`. */
  suggestConstraints(sketchId: string, idPrefix: string): Promise<SketchConstraint[]>;
  /** Solves a sketch with a point pulled toward (x, y), without changing the document. */
  previewDrag(sketchId: string, pointId: string, x: number, y: number): Promise<SketchView | undefined>;
  /** With `compensateKerf`, outlines are offset for the laser profile's kerf (laser profiles only). */
  exportSketch(sketchId: string, format: DrawingFormat, options?: { readonly compensateKerf?: boolean }): Promise<Result<void>>;
  /**
   * Adds an imported DXF or SVG document, or the outlines traced from a picture, to a sketch (one undoable change); new ids start with `idPrefix`.
   * By default its curves and texts become separate sketch geometry, held by `relations`. As one piece,
   * the drawing keeps its proportions and moves, turns and scales by two handle points.
   */
  insertDrawing(sketchId: string, documentId: DocumentId, idPrefix: string, options?: InsertDrawingOptions): Promise<Result<void>>;
  /** The sheet metal part laid flat (cut outlines, bend lines apart), for laser cutting and bending. */
  exportFlatPattern(format: DrawingFormat): Promise<Result<void>>;
  /** All bodies, one file. */
  exportBodies(format: SolidFormat, options?: ExportOptions): Promise<Result<void>>;
  /** The faces, edges and vertices an item refers to that the bodies before it no longer have, with candidates to replace them. */
  brokenReferences(itemId: string): Promise<Result<readonly BrokenReference[]>>;
  /** The configuration table as a CSV file (a column per parameter). */
  exportConfigurations(): Promise<Result<void>>;
  /** Reads a configuration table from CSV and checks it; apply it with `set-configurations`. */
  readConfigurations(csv: string): Result<ConfigurationImport>;
  /** The shown bodies as one HTML file with a viewer (turn, measure, hide), for people without CADence. */
  exportViewer(): Promise<Result<void>>;
  /** Area, length, radius, distance and angle of picked faces and edges. */
  measure(refs: readonly TopologyRef[]): Promise<Result<Measurement>>;
  /** Volume, mass (from the material), centre of mass and bounding box per body. */
  properties(): Promise<BodyProperties[]>;
  /** Checks the bodies and sketches against the manufacturing profile. */
  validate(): Promise<ValidationReport>;
  /** The strength check of the stored setup, with the component's material (CAD-93). */
  simulate(): Promise<Result<SimulationResult>>;
}

/** Two versions of a component built: their bodies, and the material added and removed between them (CAD-175). */
export interface BodyComparison extends BodyDifference {
  readonly before: readonly BodyMesh[];
  readonly after: readonly BodyMesh[];
}

/** Part design workflow (docs/Architecture/Components.md#design-manager). */
export interface DesignManager {
  open(documentId: DocumentId): Promise<Result<DesignSession>>;
  /**
   * Builds two versions of a component (as the Project Manager's `compareVersions` gives them, with
   * the project parameters of each; the project's current ones when absent) and compares their bodies.
   */
  compareBodies(
    before: ComponentDocument,
    after: ComponentDocument,
    projectParameters?: { readonly before: readonly Parameter[]; readonly after: readonly Parameter[] },
  ): Promise<Result<BodyComparison>>;
}
