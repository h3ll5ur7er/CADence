import {
  type Dimension,
  isDimension,
  type Profile,
  type ProfileEdge,
  type Sketch,
  type SketchConstraint,
  type SketchEntity,
  sketchOriginId,
  type TextOutlines,
  type Vec2,
} from '@core/contracts';
import { closestParameter, splineBeziers } from '@core/utilities/math';
import { freeformPieces, pointsOf, textPolylines } from '../../viewport/sketch-display';
import { type Affine, applyAffine } from '../../viewport/sketch-planes';

/** Pure view-model helpers for the sketch overlay: SVG paths and screen-space annotations. */

const n = (v: number) => Math.round(v * 1e4) / 1e4;

/** An SVG path in sketch coordinates; arcs are counter-clockwise (sweep flag 1 before the Y flip). */
export function curvePath(entity: SketchEntity, points: ReadonlyMap<string, Vec2>): string {
  const at = (id: string): Vec2 => points.get(id) ?? [0, 0];
  switch (entity.kind) {
    case 'point':
    case 'projection':
    case 'drawing':
    case 'text':
      return '';
    case 'line': {
      const [s, e] = [at(entity.start), at(entity.end)];
      return `M ${n(s[0])} ${n(s[1])} L ${n(e[0])} ${n(e[1])}`;
    }
    case 'circle': {
      const [cx, cy] = at(entity.center);
      const r = n(entity.radius);
      return `M ${n(cx + r)} ${n(cy)} A ${r} ${r} 0 1 1 ${n(cx - r)} ${n(cy)} A ${r} ${r} 0 1 1 ${n(cx + r)} ${n(cy)}`;
    }
    case 'arc': {
      const [c, s, e] = [at(entity.center), at(entity.start), at(entity.end)];
      const r = Math.hypot(s[0] - c[0], s[1] - c[1]);
      let sweep = Math.atan2(e[1] - c[1], e[0] - c[0]) - Math.atan2(s[1] - c[1], s[0] - c[0]);
      while (sweep <= 0) sweep += 2 * Math.PI;
      return `M ${n(s[0])} ${n(s[1])} A ${n(r)} ${n(r)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${n(e[0])} ${n(e[1])}`;
    }
    case 'ellipse': {
      const [c, m] = [at(entity.center), at(entity.major)];
      const a = Math.hypot(m[0] - c[0], m[1] - c[1]);
      const b = n(entity.minorRadius);
      const turn = n((Math.atan2(m[1] - c[1], m[0] - c[0]) * 180) / Math.PI);
      const o: Vec2 = [2 * c[0] - m[0], 2 * c[1] - m[1]];
      return `M ${n(m[0])} ${n(m[1])} A ${n(a)} ${b} ${turn} 1 1 ${n(o[0])} ${n(o[1])} A ${n(a)} ${b} ${turn} 1 1 ${n(m[0])} ${n(m[1])}`;
    }
    case 'spline': {
      const pieces = splineBeziers(entity.points.map(at), entity.closed);
      const first = pieces[0]?.[0];
      if (!first) return '';
      return `M ${n(first[0])} ${n(first[1])} ${pieces.map(([, c1, c2, e]) => `C ${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(e[0])} ${n(e[1])}`).join(' ')}`;
    }
  }
}

/** Closed outlines (of text) as an SVG path in sketch coordinates. */
export function outlinePath(contours: readonly (readonly ProfileEdge[])[]): string {
  return contours
    .map((contour) => {
      const first = contour[0];
      if (!first) return '';
      const pieces = contour.map((e) =>
        e.kind === 'bezier' ? `C ${n(e.c1[0])} ${n(e.c1[1])} ${n(e.c2[0])} ${n(e.c2[1])} ${n(e.end[0])} ${n(e.end[1])}` : `L ${n(e.end[0])} ${n(e.end[1])}`,
      );
      return `M ${n(first.start[0])} ${n(first.start[1])} ${pieces.join(' ')} Z`;
    })
    .join(' ');
}

export function profilePath(profile: Profile): string {
  return [profile.outer, ...profile.holes]
    .map((loop) => `M ${loop.polygon.map(([x, y]) => `${n(x)} ${n(y)}`).join(' L ')} Z`)
    .join(' ');
}

export interface ScreenLabel {
  readonly id: string;
  readonly text: string;
  readonly title: string;
  readonly x: number;
  readonly y: number;
  /** Optional leader line from the measured geometry, in pixels. */
  readonly line?: readonly [Vec2, Vec2];
}

const degrees = (radians: number) => (radians * 180) / Math.PI;
const formatLength = (v: number) => String(Math.round(v * 100) / 100);

/** Where to anchor a constraint's glyph: a quarter along a line (its middle holds dimensions), top of a circle, or its point. */
function anchorOf(sketch: Sketch, id: string, points: ReadonlyMap<string, Vec2>): Vec2 | undefined {
  const point = points.get(id);
  if (point) return point;
  const e = sketch.entities.find((x) => x.id === id);
  if (!e || e.kind === 'point' || e.kind === 'projection' || e.kind === 'drawing') return undefined;
  const at = (p: string): Vec2 => points.get(p) ?? [0, 0];
  if (e.kind === 'text') return at(e.anchor);
  if (e.kind === 'line') {
    const [s, t] = [at(e.start), at(e.end)];
    return [s[0] + (t[0] - s[0]) * 0.25, s[1] + (t[1] - s[1]) * 0.25];
  }
  if (e.kind === 'spline') return at(e.points[0] as string);
  const c = at(e.center);
  if (e.kind === 'ellipse') return at(e.major);
  const r = e.kind === 'circle' ? e.radius : Math.hypot(at(e.start)[0] - c[0], at(e.start)[1] - c[1]);
  return [c[0], c[1] + r];
}

const glyphText: Readonly<Record<string, string>> = {
  coincident: '●',
  horizontal: 'H',
  vertical: 'V',
  parallel: '∥',
  perpendicular: '⊥',
  equal: '=',
  tangent: 'T',
  'point-on': '◦',
  midpoint: 'M',
  fix: '⚲',
  'horizontal-points': 'H',
  'vertical-points': 'V',
  symmetric: '⇹',
  concentric: '◎',
  collinear: '⋯',
};

const glyphTitle: Readonly<Record<string, string>> = {
  coincident: 'Coincident',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  parallel: 'Parallel',
  perpendicular: 'Perpendicular',
  equal: 'Equal',
  tangent: 'Tangent',
  'point-on': 'Point on curve',
  midpoint: 'Midpoint',
  fix: 'Fixed',
  'horizontal-points': 'Level (horizontal)',
  'vertical-points': 'Above each other (vertical)',
  symmetric: 'Symmetric',
  concentric: 'Concentric',
  collinear: 'Collinear',
};

function firstReference(c: SketchConstraint): string {
  switch (c.kind) {
    case 'coincident':
    case 'horizontal-points':
    case 'vertical-points':
    case 'symmetric':
      return c.points[0];
    case 'concentric':
      return c.curves[1];
    case 'collinear':
      return c.lines[1];
    case 'horizontal':
    case 'vertical':
      return c.line;
    case 'parallel':
    case 'perpendicular':
      return c.lines[1];
    case 'equal':
    case 'tangent':
      return c.curves[1];
    case 'point-on':
    case 'midpoint':
    case 'fix':
      return c.point;
    default:
      return '';
  }
}

/** Small badges for geometric constraints, stacked beside their anchors. */
export function glyphs(sketch: Sketch, matrix: Affine): ScreenLabel[] {
  const points = pointsOf(sketch);
  const stacks = new Map<string, number>();
  return sketch.constraints.flatMap((c) => {
    if (isDimension(c)) return [];
    const ref = firstReference(c);
    if (c.kind === 'coincident' && c.points.includes(sketchOriginId)) return [];
    const anchor = anchorOf(sketch, ref, points);
    if (!anchor) return [];
    const [x, y] = applyAffine(matrix, anchor[0], anchor[1]);
    const index = stacks.get(ref) ?? 0;
    stacks.set(ref, index + 1);
    return [{ id: c.id, text: glyphText[c.kind] ?? '?', title: glyphTitle[c.kind] ?? c.kind, x: x + 12 + index * 16, y: y - 12 }];
  });
}

/** Dimension labels with the evaluated value, placed beside what they measure. */
export function dimensionLabels(sketch: Sketch, values: ReadonlyMap<string, number>, matrix: Affine): ScreenLabel[] {
  const points = pointsOf(sketch);
  const at = (id: string): Vec2 => points.get(id) ?? [0, 0];
  const screen = (p: Vec2): Vec2 => applyAffine(matrix, p[0], p[1]);
  const besides = (a: Vec2, b: Vec2, offset = 16): Vec2 => {
    const [sa, sb] = [screen(a), screen(b)];
    const len = Math.hypot(sb[0] - sa[0], sb[1] - sa[1]) || 1;
    const normal: Vec2 = [-(sb[1] - sa[1]) / len, (sb[0] - sa[0]) / len];
    return [(sa[0] + sb[0]) / 2 + normal[0] * offset, (sa[1] + sb[1]) / 2 + normal[1] * offset];
  };
  return sketch.constraints.filter(isDimension).map((d: Dimension): ScreenLabel => {
    const value = values.get(d.id) ?? 0;
    const title = `${d.expression}`;
    switch (d.kind) {
      case 'distance':
      case 'horizontal-distance':
      case 'vertical-distance': {
        const [a, b] = [at(d.points[0]), at(d.points[1])];
        const [x, y] = besides(a, b);
        const prefix = d.kind === 'horizontal-distance' ? '↔ ' : d.kind === 'vertical-distance' ? '↕ ' : '';
        return { id: d.id, text: prefix + formatLength(value), title, x, y, line: [screen(a), screen(b)] };
      }
      case 'point-line-distance': {
        const line = sketch.entities.find((e) => e.id === d.line);
        const p = at(d.point);
        if (line?.kind !== 'line') return { id: d.id, text: formatLength(value), title, x: 0, y: 0 };
        const [s, e] = [at(line.start), at(line.end)];
        const dir: Vec2 = [e[0] - s[0], e[1] - s[1]];
        const t = ((p[0] - s[0]) * dir[0] + (p[1] - s[1]) * dir[1]) / (dir[0] ** 2 + dir[1] ** 2 || 1);
        const foot: Vec2 = [s[0] + t * dir[0], s[1] + t * dir[1]];
        const [x, y] = besides(p, foot, 0);
        return { id: d.id, text: formatLength(value), title, x: x + 12, y, line: [screen(p), screen(foot)] };
      }
      case 'radius':
      case 'diameter': {
        const curve = sketch.entities.find((e) => e.id === d.curve);
        const center = curve && (curve.kind === 'circle' || curve.kind === 'arc' || curve.kind === 'ellipse') ? at(curve.center) : ([0, 0] as Vec2);
        let rim: Vec2;
        if (curve?.kind === 'ellipse') {
          // An ellipse's radius dimension is its minor radius: shown across the major axis.
          const m = at(curve.major);
          const l = Math.hypot(m[0] - center[0], m[1] - center[1]) || 1;
          rim = [center[0] - ((m[1] - center[1]) / l) * curve.minorRadius, center[1] + ((m[0] - center[0]) / l) * curve.minorRadius];
        } else {
          const r = curve?.kind === 'circle' ? curve.radius : curve?.kind === 'arc' ? Math.hypot(at(curve.start)[0] - center[0], at(curve.start)[1] - center[1]) : 0;
          rim = [center[0] + r * Math.SQRT1_2, center[1] + r * Math.SQRT1_2];
        }
        const [x, y] = screen(rim);
        return { id: d.id, text: (d.kind === 'radius' ? 'R ' : '⌀ ') + formatLength(value), title, x: x + 14, y: y - 14, line: [screen(center), [x, y]] };
      }
      case 'angle': {
        const [l1, l2] = d.lines.map((id) => sketch.entities.find((e) => e.id === id));
        const corner = l1?.kind === 'line' && l2?.kind === 'line' ? at(l2.start) : ([0, 0] as Vec2);
        const [x, y] = screen(corner);
        return { id: d.id, text: `${formatLength(degrees(value))}°`, title, x: x + 24, y: y - 18 };
      }
    }
  });
}

export interface SketchHit {
  readonly id: string;
  readonly kind: 'point' | 'curve';
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * The point or curve nearest to `at` within `tolerance` (sketch units); points win over curves.
 * Geometric hit testing: SVG stroke hit areas are unreliable under the plane transform.
 */
export function hitTest(sketch: Sketch, at: Vec2, tolerance: number, texts: TextOutlines = new Map()): SketchHit | undefined {
  const points = pointsOf(sketch);
  let best: { hit: SketchHit; d: number } | undefined;
  for (const [id, p] of points) {
    const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
    if (d <= tolerance && (!best || d < best.d)) best = { hit: { id, kind: 'point' }, d };
  }
  if (best) return best.hit;
  const point = (id: string): Vec2 => points.get(id) ?? [0, 0];
  for (const e of sketch.entities) {
    let d: number;
    if (e.kind === 'point' || e.kind === 'projection' || e.kind === 'drawing') continue;
    if (e.kind === 'text') {
      // Text is hit on its outlines.
      const lines = textPolylines(texts.get(e.id) ?? []);
      d = Math.min(Infinity, ...lines.flatMap((line) => line.slice(1).map((p, i) => segmentDistance(at, line[i] as Vec2, p))));
    } else if (e.kind === 'line') {
      d = segmentDistance(at, point(e.start), point(e.end));
    } else if (e.kind === 'circle') {
      const c = point(e.center);
      d = Math.abs(Math.hypot(at[0] - c[0], at[1] - c[1]) - e.radius);
    } else if (e.kind === 'ellipse' || e.kind === 'spline') {
      d = Math.min(...freeformPieces(e, point).map(({ curve, t0, t1 }) => closestParameter(curve, at, t0, t1).distance));
    } else {
      const [c, s, t] = [point(e.center), point(e.start), point(e.end)];
      const r = Math.hypot(s[0] - c[0], s[1] - c[1]);
      const angle = (v: Vec2) => Math.atan2(v[1] - c[1], v[0] - c[0]);
      const sweep = (angle(t) - angle(s) + 4 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
      const offset = (angle(at) - angle(s) + 4 * Math.PI) % (2 * Math.PI);
      d = offset <= sweep ? Math.abs(Math.hypot(at[0] - c[0], at[1] - c[1]) - r) : Math.min(Math.hypot(at[0] - s[0], at[1] - s[1]), Math.hypot(at[0] - t[0], at[1] - t[1]));
    }
    if (d <= tolerance && (!best || d < best.d)) best = { hit: { id: e.id, kind: 'curve' }, d };
  }
  return best?.hit;
}
