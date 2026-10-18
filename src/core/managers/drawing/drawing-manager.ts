import type { DocumentId, DrawingAnnotation, DrawingDocument, DrawingView, Result, Sheet, TitleBlock, Vec2, Vec3, ViewAnchor } from '@core/contracts';

/** Every change to a drawing is one of these commands; ids come from the caller. */
export type DrawingCommand =
  | { readonly type: 'set-sheet'; readonly sheet: Sheet }
  | { readonly type: 'set-title-block'; readonly titleBlock: TitleBlock }
  | { readonly type: 'add-view'; readonly view: DrawingView }
  | { readonly type: 'edit-view'; readonly view: DrawingView }
  /** Also removes what is attached to the view: its annotations and its details. */
  | { readonly type: 'remove-view'; readonly viewId: string }
  | { readonly type: 'add-annotation'; readonly annotation: DrawingAnnotation }
  | { readonly type: 'edit-annotation'; readonly annotation: DrawingAnnotation }
  | { readonly type: 'remove-annotation'; readonly annotationId: string };

/** How a line is drawn: model edges thick, hidden ones dashed, annotations thin, centre lines dash-dotted. */
export type LineStyle = 'visible' | 'hidden' | 'thin' | 'center' | 'frame' | 'hatch';

/**
 * The sheet as lines, texts and arrows in sheet millimetres (bottom left at 0, 0), the same for the
 * editor, PDF and DXF. `owner` is the view or annotation a piece belongs to.
 */
export interface SheetLayout {
  readonly width: number;
  readonly height: number;
  readonly paths: readonly { readonly points: readonly Vec2[]; readonly style: LineStyle; readonly closed?: boolean; readonly owner?: string }[];
  readonly texts: readonly { readonly at: Vec2; readonly text: string; readonly size: number; readonly align: 'left' | 'center' | 'right'; readonly bold?: boolean; readonly owner?: string }[];
  /** Filled arrowheads: the tip and the direction they point. */
  readonly arrows: readonly { readonly tip: Vec2; readonly direction: Vec2; readonly owner?: string }[];
  /** Model geometry that annotations can be attached to, where it is on the sheet. */
  readonly anchors: readonly SheetAnchor[];
  /**
   * Where each view is (its box on the sheet), and why one cannot be drawn; `center` and `scale` map
   * the sheet back to the view's model millimetres: model = center + (sheet − at) / scale. A `note`
   * says how a view was drawn when not exactly (CAD-125).
   */
  readonly views: readonly { readonly id: string; readonly min: Vec2; readonly max: Vec2; readonly center?: Vec2; readonly scale?: number; readonly error?: string; readonly note?: string }[];
  /** Assembly instances in views (for balloons), where they are on the sheet. */
  readonly instances: readonly { readonly view: string; readonly instance: string; readonly at: Vec2 }[];
  /** Annotations whose geometry is gone (the model changed). */
  readonly lost: readonly string[];
}

/**
 * An anchor where it is on the sheet; `model` is where it is in the model (a point, a circle's centre,
 * a line's middle), and `hidden` marks geometry the view does not show unless it draws hidden lines
 * (CAD-127, CAD-128).
 */
export type SheetAnchor = ViewAnchor & { readonly at: Vec2; readonly radius?: number; readonly start?: Vec2; readonly end?: Vec2; readonly model?: Vec3; readonly hidden?: true };

export interface DrawingState {
  readonly document: DrawingDocument;
  readonly layout: SheetLayout;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** The material of the first component the views show: the title block's unless it names its own (CAD-127). */
  readonly material?: string;
}

/** An editing session on one drawing. */
export interface DrawingSession {
  state(): DrawingState;
  subscribe(listener: (state: DrawingState) => void): () => void;
  execute(command: DrawingCommand): Promise<Result<void>>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** The sheet as a PDF of its size. */
  exportPdf(): Promise<Result<void>>;
  /** The sheet as DXF (mm), lines and texts on layers by style. */
  exportDxf(): Promise<Result<void>>;
  /**
   * The sheet as a PNG `width` pixels wide (1600 by default) as the PDF shows it, or only one view
   * of it, zoomed: for agents and scripts to look at (CAD-123).
   */
  picture(options?: { readonly width?: number; readonly view?: string }): Promise<Result<Uint8Array>>;
  /** Reads again the views' sources whose documents another process changed (CAD-116). */
  catchUp(): Promise<void>;
  /** The configurations of a component, which its views may show (CAD-126); none for other documents. */
  configurationsOf(source: DocumentId): Promise<readonly { readonly id: string; readonly name: string }[]>;
  /** Stops listening for changes of the views' sources. */
  close(): void;
}

/** Technical drawings workflow (docs/Architecture/Components.md#drawing-manager). */
export interface DrawingManager {
  open(documentId: DocumentId): Promise<Result<DrawingSession>>;
}
