/**
 * Sketch design intent (persisted). Lengths in millimetres in the sketch plane's (u, v) coordinates.
 * Points are entities of their own; curves reference them, so a shared corner is one point.
 */

import type { PlaneRef } from './feature';

/** Origin planes, planar faces or construction planes. */
export type SketchPlane = PlaneRef;

/** The fixed sketch origin every sketch has; constraints and curves may reference it. */
export const sketchOriginId = 'origin';

export interface SketchPoint {
  readonly id: string;
  readonly kind: 'point';
  readonly x: number;
  readonly y: number;
}

export interface SketchLine {
  readonly id: string;
  readonly kind: 'line';
  readonly start: string;
  readonly end: string;
  readonly construction: boolean;
}

export interface SketchCircle {
  readonly id: string;
  readonly kind: 'circle';
  readonly center: string;
  readonly radius: number;
  readonly construction: boolean;
}

/** Counter-clockwise from `start` to `end` around `center`. */
export interface SketchArc {
  readonly id: string;
  readonly kind: 'arc';
  readonly center: string;
  readonly start: string;
  readonly end: string;
  readonly construction: boolean;
}

/** An ellipse: its major axis runs from `center` to the point `major`; `minorRadius` is the half axis across it. */
export interface SketchEllipse {
  readonly id: string;
  readonly kind: 'ellipse';
  readonly center: string;
  readonly major: string;
  readonly minorRadius: number;
  readonly construction: boolean;
}

/**
 * A smooth curve through its points in order (cubic Béziers, tangent continuous; see
 * `splineBeziers`). A closed spline also runs from the last point back to the first.
 */
export interface SketchSpline {
  readonly id: string;
  readonly kind: 'spline';
  readonly points: readonly string[];
  readonly closed: boolean;
  readonly construction: boolean;
}

export type SketchCurve = SketchLine | SketchCircle | SketchArc | SketchEllipse | SketchSpline;
export type SketchEntity = SketchPoint | SketchCurve;

/** Geometric constraints: relations without a value. */
export type GeometricConstraint =
  | { readonly id: string; readonly kind: 'coincident'; readonly points: readonly [string, string] }
  | { readonly id: string; readonly kind: 'horizontal'; readonly line: string }
  | { readonly id: string; readonly kind: 'vertical'; readonly line: string }
  | { readonly id: string; readonly kind: 'parallel'; readonly lines: readonly [string, string] }
  | { readonly id: string; readonly kind: 'perpendicular'; readonly lines: readonly [string, string] }
  /** Equal length (two lines) or equal radius (two circles/arcs). */
  | { readonly id: string; readonly kind: 'equal'; readonly curves: readonly [string, string] }
  /** A line and a circle/arc, or two circles/arcs. */
  | { readonly id: string; readonly kind: 'tangent'; readonly curves: readonly [string, string] }
  /** The point lies on the curve (line, circle or arc). */
  | { readonly id: string; readonly kind: 'point-on'; readonly point: string; readonly curve: string }
  | { readonly id: string; readonly kind: 'midpoint'; readonly point: string; readonly line: string }
  /** Two points level with each other, or one above the other. */
  | { readonly id: string; readonly kind: 'horizontal-points'; readonly points: readonly [string, string] }
  | { readonly id: string; readonly kind: 'vertical-points'; readonly points: readonly [string, string] }
  /** Two points mirror each other across a line. */
  | { readonly id: string; readonly kind: 'symmetric'; readonly points: readonly [string, string]; readonly line: string }
  /** Circles, arcs or ellipses around the same centre. */
  | { readonly id: string; readonly kind: 'concentric'; readonly curves: readonly [string, string] }
  /** Two lines on one straight line. */
  | { readonly id: string; readonly kind: 'collinear'; readonly lines: readonly [string, string] }
  | { readonly id: string; readonly kind: 'fix'; readonly point: string; readonly x: number; readonly y: number };

/** Dimensions: constraints with a value given as an expression ("25", "2 * 10 mm", "45 deg"). */
export type Dimension =
  | { readonly id: string; readonly kind: 'distance'; readonly points: readonly [string, string]; readonly expression: string }
  | { readonly id: string; readonly kind: 'horizontal-distance'; readonly points: readonly [string, string]; readonly expression: string }
  | { readonly id: string; readonly kind: 'vertical-distance'; readonly points: readonly [string, string]; readonly expression: string }
  | { readonly id: string; readonly kind: 'point-line-distance'; readonly point: string; readonly line: string; readonly expression: string }
  /** Of a circle or arc; of an ellipse, its minor radius. */
  | { readonly id: string; readonly kind: 'radius'; readonly curve: string; readonly expression: string }
  | { readonly id: string; readonly kind: 'diameter'; readonly curve: string; readonly expression: string }
  /** Angle between two lines, measured from the first to the second. */
  | { readonly id: string; readonly kind: 'angle'; readonly lines: readonly [string, string]; readonly expression: string };

export type SketchConstraint = GeometricConstraint | Dimension;
export type DimensionKind = Dimension['kind'];

export const isDimension = (c: SketchConstraint): c is Dimension => 'expression' in c;
export const isCurve = (e: SketchEntity): e is SketchCurve => e.kind !== 'point';

/** A sketch as stored in a component's timeline. Points hold the last solved positions. */
export interface Sketch {
  readonly id: string;
  readonly type: 'sketch';
  readonly name: string;
  readonly suppressed: boolean;
  readonly plane: SketchPlane;
  readonly entities: readonly SketchEntity[];
  readonly constraints: readonly SketchConstraint[];
}

export type SketchStatus = 'under-constrained' | 'fully-constrained' | 'over-constrained' | 'failed';

/** Closed boundary made of curve pieces; arcs are counter-clockwise from start to end. */
export type ProfileEdge =
  | { readonly kind: 'line'; readonly start: Vec2; readonly end: Vec2; readonly source: string }
  | {
      readonly kind: 'arc';
      /** The sketch curve this piece belongs to. */
      readonly source: string;
      readonly start: Vec2;
      readonly end: Vec2;
      readonly center: Vec2;
      readonly radius: number;
      /** True when the boundary runs counter-clockwise along the arc. */
      readonly ccw: boolean;
    }
  /** A cubic Bézier from `start` through the controls to `end` (a piece of a spline). */
  | { readonly kind: 'bezier'; readonly source: string; readonly start: Vec2; readonly end: Vec2; readonly c1: Vec2; readonly c2: Vec2 }
  | {
      /** A piece of an ellipse with semi-axes `a` (along `rotation`, radians) and `b`. */
      readonly kind: 'ellipse';
      readonly source: string;
      readonly start: Vec2;
      readonly end: Vec2;
      readonly center: Vec2;
      readonly a: number;
      readonly b: number;
      readonly rotation: number;
      readonly ccw: boolean;
    };

export interface ProfileLoop {
  readonly edges: readonly ProfileEdge[];
  /** The loop flattened to a polygon, counter-clockwise for outer loops and clockwise for holes. */
  readonly polygon: readonly Vec2[];
}

/** A closed region of a sketch, usable by features such as extrude. */
export interface Profile {
  readonly id: string;
  readonly outer: ProfileLoop;
  readonly holes: readonly ProfileLoop[];
  readonly area: number;
}

export type Vec2 = readonly [number, number];
