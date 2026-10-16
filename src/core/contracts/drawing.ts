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
 * of the view's source, by its persistent name (see `TopologyRef`).
 */
export interface ViewAnchor {
  readonly view: string;
  readonly kind: 'point' | 'circle' | 'line';
  readonly name: string;
}

export type DimensionType = 'linear' | 'horizontal' | 'vertical' | 'radius' | 'diameter' | 'angle';

export type DrawingAnnotation =
  /** Between two points (linear, horizontal, vertical), of a circle (radius, diameter) or between two lines (angle). `offset`: how far the dimension line stands off (sheet mm). */
  | { readonly kind: 'dimension'; readonly id: string; readonly type: DimensionType; readonly anchors: readonly ViewAnchor[]; readonly offset: number; readonly text?: string }
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
