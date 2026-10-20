import type { DocumentId } from './ids';
import type { Vec2 } from './sketch';

/**
 * Technical drawings (docs/Architecture/Document-model.md#drawings): a sheet with a title block,
 * views of components and assemblies, and annotations. Sheet coordinates are millimetres from the
 * sheet's bottom left; view geometry is in the model's millimetres, from the view's centre.
 */

export type SheetSize = 'A4' | 'A3' | 'A2' | 'A1';
export const sheetSizes: Readonly<Record<SheetSize, readonly [number, number]>> = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594] };

export interface Sheet {
  readonly size: SheetSize;
  readonly orientation: 'landscape' | 'portrait';
  /** The drawing's scale: sheet millimetres per model millimetre (0.5 is 1:2). */
  readonly scale: number;
}

export interface TitleBlock {
  readonly title: string;
  readonly number: string;
  readonly drawnBy: string;
  readonly material: string;
  readonly revision: string;
}

/** Where a view looks from. `iso` is the isometric view from the front, right and above. */
export type ViewDirection = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'iso';

export interface DrawingView {
  readonly id: string;
  /** A component or an assembly of the project. */
  readonly source: DocumentId;
  /** A configuration of the component (absent: its parameters' own values), as on assembly instances (CAD-126). */
  readonly configuration?: string;
  readonly direction: ViewDirection;
  /** Where the view's centre is on the sheet. */
  readonly at: Vec2;
  /** Sheet millimetres per model millimetre (absent: the sheet's). */
  readonly scale?: number;
  /** Hidden edges drawn dashed. */
  readonly hidden: boolean;
  /**
   * A full section: the model cut by a plane across the viewing direction, `offset` mm from the
   * middle of the model towards the viewer; the part in front is taken away and cut faces are hatched.
   */
  readonly section?: { readonly offset: number };
  /** A detail: a circle of another view (centre in that view's model millimetres, radius) drawn larger. */
  readonly detail?: { readonly of: string; readonly center: Vec2; readonly radius: number };
  /** Shown under the view ("Section A-A", "Detail B"). */
  readonly label?: string;
}

/**
 * Model geometry a drawing annotation is attached to: a vertex, a circular edge or a straight edge
 * of the view's source, by its persistent name (see `TopologyRef`). Views also offer the outlines
 * of cylinders seen from the side (lines `s:<face>:1` and `:2`, with points at their ends `:a`, `:b`)
 * and their outermost points seen (`extreme:left`, `right`, `top`, `bottom`), CAD-127.
 */
export interface ViewAnchor {
  readonly view: string;
  readonly kind: 'point' | 'circle' | 'line';
  readonly name: string;
}

export type DimensionType = 'linear' | 'horizontal' | 'vertical' | 'radius' | 'diameter' | 'angle';

/**
 * The anchors each dimension type takes, in order (CAD-127): lengths between two points or circle
 * centres; a radius of a circle; a diameter of a circle or between two parallel lines (the outlines
 * of a cylinder seen from its side); an angle between two lines.
 */
export const dimensionAnchors: Readonly<Record<DimensionType, readonly (readonly (readonly ViewAnchor['kind'][])[])[]>> = {
  linear: [[['point', 'circle'], ['point', 'circle']]],
  horizontal: [[['point', 'circle'], ['point', 'circle']]],
  vertical: [[['point', 'circle'], ['point', 'circle']]],
  radius: [[['circle']]],
  diameter: [[['circle']], [['line'], ['line']]],
  angle: [[['line'], ['line']]],
};

/** Whether anchors of these kinds make a dimension of the type. */
export const fitsDimension = (type: DimensionType, kinds: readonly ViewAnchor['kind'][]): boolean =>
  dimensionAnchors[type].some((form) => form.length === kinds.length && form.every((allowed, i) => allowed.includes(kinds[i] as ViewAnchor['kind'])));

/** The kinds the next anchor of a dimension may be after those picked, or none when it is complete. */
export const nextDimensionAnchor = (type: DimensionType, picked: readonly ViewAnchor['kind'][]): readonly ViewAnchor['kind'][] =>
  fitsDimension(type, picked)
    ? []
    : [...new Set(dimensionAnchors[type].flatMap((form) => (form.length > picked.length && picked.every((kind, i) => form[i]?.includes(kind)) ? (form[picked.length] ?? []) : [])))];

export type DrawingAnnotation =
  /**
   * Between two points or circle centres (linear, horizontal, vertical), of a circle (radius,
   * diameter), between two parallel lines (diameter) or two lines (angle); see `dimensionAnchors`.
   * `offset`: how far the dimension line stands off (sheet mm). `angle`: which way a radius or
   * diameter leaves its circle (degrees counter-clockwise from the right; absent: the first of 45°,
   * 135°, 315° and 225° that keeps the text on the sheet).
   */
  | { readonly kind: 'dimension'; readonly id: string; readonly type: DimensionType; readonly anchors: readonly ViewAnchor[]; readonly offset: number; readonly angle?: number; readonly text?: string }
  | { readonly kind: 'note'; readonly id: string; readonly at: Vec2; readonly text: string; readonly leader?: Vec2 }
  | { readonly kind: 'center-mark'; readonly id: string; readonly circle: ViewAnchor }
  | { readonly kind: 'center-line'; readonly id: string; readonly a: ViewAnchor; readonly b: ViewAnchor }
  /** The hole (or thread) a circle belongs to, described from its feature. */
  | { readonly kind: 'callout'; readonly id: string; readonly circle: ViewAnchor; readonly at: Vec2 }
  /** The parts-list item number of an assembly instance, pointing at it in a view. */
  | { readonly kind: 'balloon'; readonly id: string; readonly view: string; readonly instance: string; readonly at: Vec2 }
  /** The assembly's parts, as a table with its top right corner at `at`. */
  | { readonly kind: 'parts-list'; readonly id: string; readonly view: string; readonly at: Vec2 };

export type AnnotationKind = DrawingAnnotation['kind'];
