import type { SketchEntity } from '@core/contracts';
import { angleOf, type Bezier, ccwSweep, fitArcs, sampleCurve, type Vec2 } from '@core/utilities/math';
import type { TextWeight } from '@core/contracts';
import { type DrawingCurve, paramCurveOf, samplePoints } from './drawing';
import { parseXml, type XmlElement } from './xml';

/** How closely samples follow a curve before lines and arcs are fitted to them (mm). */
const flatness = 0.002;

type Matrix = readonly [number, number, number, number, number, number]; // a b c d e f, as in SVG

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, [x, y]: Vec2): Vec2 => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];


// ---- DXF -------------------------------------------------------------------------------------

const dxfUnits: Readonly<Record<number, number>> = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0000254, 9: 0.0254, 10: 914.4 };

/** A text of a drawing: where its baseline starts (or its middle or end, by `align`), capital height (mm) and direction. */
export interface DrawingText {
  readonly text: string;
  readonly at: Vec2;
  readonly height: number;
  readonly angle: number;
  readonly align: 'start' | 'middle' | 'end';
  readonly weight: TextWeight;
  /** `height` is the font size (SVG), not the capital height (DXF). */
  readonly em?: boolean;
}

/** What a drawing file holds: curves, and texts (laid out with the bundled font later). */
export interface ReadDrawing {
  readonly curves: DrawingCurve[];
  readonly texts: DrawingText[];
}

/**
 * ASCII DXF: LINE, CIRCLE, ARC, ELLIPSE, LWPOLYLINE and POLYLINE (bulges as exact arcs), SPLINE (fitted
 * with lines and arcs), TEXT and MTEXT, HATCH boundaries, and blocks placed by INSERT (moved, turned,
 * scaled, arrayed, nested). `$INSUNITS` scales to millimetres.
 */
export function readDxf(bytes: Uint8Array): ReadDrawing {
  const rows = new TextDecoder().decode(bytes).split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < rows.length; i += 2) pairs.push([Number((rows[i] as string).trim()), (rows[i + 1] as string).trim()]);
  const unitsAt = pairs.findIndex(([code, value]) => code === 9 && value === '$INSUNITS');
  const scale = unitsAt >= 0 ? (dxfUnits[Number(pairs[unitsAt + 1]?.[1])] ?? 1) : 1;
  const entities = section(pairs, 'ENTITIES');
  if (!entities) throw new Error('The DXF file has no ENTITIES section.');
  // Blocks: a BLOCK entity (name 2, base point 10/20) opens one, ENDBLK closes it.
  const blocks = new Map<string, { base: Vec2; entities: DxfEntity[] }>();
  let open: { base: Vec2; entities: DxfEntity[] } | undefined;
  for (const e of section(pairs, 'BLOCKS') ?? []) {
    if (e.type === 'BLOCK') {
      open = { base: [code(e, 10), code(e, 20)], entities: [] };
      blocks.set(text(e, 2), open);
    } else if (e.type === 'ENDBLK') open = undefined;
    else open?.entities.push(e);
  }
  const drawing: ReadDrawing = { curves: [], texts: [] };
  emit(entities, [scale, 0, 0, scale, 0, 0], blocks, drawing, 0);
  if (drawing.curves.length === 0 && drawing.texts.length === 0) throw new Error('The DXF file has no lines, arcs, circles, polylines, splines or text.');
  return drawing;
}

interface DxfEntity {
  readonly type: string;
  readonly codes: [number, string][];
}

/** A section's entities: a type, then its group codes up to the next 0 code. */
function section(pairs: readonly [number, string][], name: string): DxfEntity[] | undefined {
  const start = pairs.findIndex(([c, value], i) => c === 0 && value === 'SECTION' && pairs[i + 1]?.[1] === name);
  if (start < 0) return undefined;
  const entities: { type: string; codes: [number, string][] }[] = [];
  for (let i = start + 2; i < pairs.length; i++) {
    const [c, value] = pairs[i] as [number, string];
    if (c === 0) {
      if (value === 'ENDSEC') break;
      entities.push({ type: value, codes: [] });
    } else entities[entities.length - 1]?.codes.push([c, value]);
  }
  return entities;
}

const code = (e: DxfEntity, c: number, fallback = 0) => Number(e.codes.find(([k]) => k === c)?.[1] ?? fallback);
const codes = (e: DxfEntity, c: number) => e.codes.filter(([k]) => k === c).map(([, v]) => Number(v));
const text = (e: DxfEntity, c: number) => e.codes.find(([k]) => k === c)?.[1] ?? '';

/** Curves and texts of DXF entities, placed by `m` (units, and the inserts they sit in). */
function emit(entities: readonly DxfEntity[], m: Matrix, blocks: ReadonlyMap<string, { base: Vec2; entities: DxfEntity[] }>, out: ReadDrawing, depth: number): void {
  const place = (curves: readonly DrawingCurve[]) => out.curves.push(...placeCurves(curves, m));
  for (let k = 0; k < entities.length; k++) {
    const e = entities[k] as DxfEntity;
    const get = (c: number, fallback = 0) => code(e, c, fallback);
    switch (e.type) {
      case 'LINE':
        place([{ kind: 'line', start: [get(10), get(20)], end: [get(11), get(21)] }]);
        break;
      case 'CIRCLE':
        place([{ kind: 'circle', center: [get(10), get(20)], radius: get(40) }]);
        break;
      case 'ARC': {
        const startAngle = (get(50) * Math.PI) / 180;
        place([{ kind: 'arc', center: [get(10), get(20)], radius: get(40), startAngle, sweep: ccwSweep(startAngle, (get(51) * Math.PI) / 180) }]);
        break;
      }
      case 'ELLIPSE': {
        const major: Vec2 = [get(11), get(21)];
        const a = Math.hypot(...major);
        const from = get(41, 0);
        place([{ kind: 'ellipse', ellipse: { center: [get(10), get(20)], a, b: a * get(40, 1), rotation: angleOf(major) }, start: from, sweep: ccwSweep(from, get(42, 2 * Math.PI)) }]);
        break;
      }
      case 'LWPOLYLINE': {
        // Each vertex starts at a 10 code; a 42 code after it is that vertex's bulge.
        const vertices: { at: Vec2; bulge: number }[] = [];
        for (const [c, value] of e.codes) {
          if (c === 10) vertices.push({ at: [Number(value), 0], bulge: 0 });
          const last = vertices[vertices.length - 1];
          if (last && c === 20) last.at = [last.at[0], Number(value)];
          if (last && c === 42) last.bulge = Number(value);
        }
        place(polyline(vertices, (get(70) & 1) === 1));
        break;
      }
      case 'POLYLINE': {
        const vertices: { at: Vec2; bulge: number }[] = [];
        while (entities[k + 1]?.type === 'VERTEX') {
          const vertex = entities[++k] as DxfEntity;
          vertices.push({ at: [code(vertex, 10), code(vertex, 20)], bulge: code(vertex, 42) });
        }
        place(polyline(vertices, (get(70) & 1) === 1));
        break;
      }
      case 'SPLINE': {
        const degree = get(71, 3);
        const knots = codes(e, 40);
        const xs = codes(e, 10);
        const ys = codes(e, 20);
        const control = xs.map((x, i): Vec2 => [x, ys[i] ?? 0]);
        if (control.length > degree && knots.length === control.length + degree + 1) {
          const lo = knots[degree] as number;
          const hi = knots[control.length] as number;
          const size = control.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - (control[i] as Vec2)[0], p[1] - (control[i] as Vec2)[1]), 0);
          // The parameter runs lo…hi; sampling is scaled to it. The samples are then fitted with lines and arcs.
          const points = sample((u) => apply(m, deBoor(degree, knots, control, Math.min(lo + u * (hi - lo), hi - 1e-12))), 0, 1, size * scaleOf(m), 'parameter');
          points[points.length - 1] = apply(m, deBoor(degree, knots, control, hi - 1e-12));
          out.curves.push(...fitted(points));
        } else {
          // Fit points only: connect them.
          const fit = codes(e, 11).map((x, i): Vec2 => [x, codes(e, 21)[i] ?? 0]);
          place(lines(fit.length ? fit : control));
        }
        break;
      }
      case 'HATCH':
        place(hatchBoundaries(e));
        break;
      case 'TEXT': {
        // Aligned texts (72: 1 centre, 2 right) are placed by their second point.
        const align = get(72) === 1 || get(72) === 4 ? 'middle' : get(72) === 2 ? 'end' : 'start';
        const at: Vec2 = align === 'start' ? [get(10), get(20)] : [get(11), get(21)];
        const words = text(e, 1);
        if (words.trim()) out.texts.push(placeText({ text: words, at, height: get(40, 2.5), angle: (get(50) * Math.PI) / 180, align, weight: 'regular' }, m));
        break;
      }
      case 'MTEXT': {
        // The text comes in 3 chunks then a 1; \P breaks lines; other formatting codes are dropped.
        const raw = [...e.codes.filter(([c]) => c === 3), ...e.codes.filter(([c]) => c === 1)].map(([, v]) => v).join('');
        const rows = raw.replace(/\\P/g, '\n').replace(/\\[A-Za-z][^;\\]*;/g, '').replace(/[{}]/g, '').split('\n');
        const height = get(40, 2.5);
        const angle = e.codes.some(([c]) => c === 50) ? (get(50) * Math.PI) / 180 : Math.atan2(get(21), get(11, 1));
        const attach = get(71, 1);
        const align = [2, 5, 8].includes(attach) ? 'middle' : [3, 6, 9].includes(attach) ? 'end' : 'start';
        const origin: Vec2 = [get(10), get(20)];
        // Lines 5/3 of the height apart, the first one's capitals hanging from the attachment point.
        rows.forEach((row, i) => {
          const drop = height * (1 + (5 / 3) * i);
          const at: Vec2 = [origin[0] + Math.sin(angle) * drop, origin[1] - Math.cos(angle) * drop];
          if (row.trim()) out.texts.push(placeText({ text: row, at, height, angle, align, weight: 'regular' }, m));
        });
        break;
      }
      case 'INSERT': {
        const block = blocks.get(text(e, 2));
        if (!block || depth > 8) break;
        const [sx, sy, turn] = [get(41, 1), get(42, 1), (get(50) * Math.PI) / 180];
        const [columns, rows, dx, dy] = [Math.max(1, get(70, 1)), Math.max(1, get(71, 1)), get(44), get(45)];
        for (let col = 0; col < columns; col++)
          for (let row = 0; row < rows; row++) {
            // Block coordinates: from the base point, scaled, turned, moved to the insertion point (and the array cell).
            const local = multiply(
              multiply([1, 0, 0, 1, get(10), get(20)], [Math.cos(turn), Math.sin(turn), -Math.sin(turn), Math.cos(turn), 0, 0]),
              multiply([1, 0, 0, 1, col * dx, row * dy], multiply([sx, 0, 0, sy, 0, 0], [1, 0, 0, 1, -block.base[0], -block.base[1]])),
            );
            emit(block.entities, multiply(m, local), blocks, out, depth + 1);
          }
        break;
      }
      default:
        break; // DIMENSION, POINT, … are not geometry to cut.
    }
  }
}

/**
 * The boundary loops of a HATCH: polyline loops (with bulges) and edge loops of lines, arcs and
 * ellipses (code 72 1, 2, 3; splines by their control points).
 */
function hatchBoundaries(e: DxfEntity): DrawingCurve[] {
  const c = e.codes;
  const curves: DrawingCurve[] = [];
  let i = c.findIndex(([k]) => k === 91);
  const loops = i >= 0 ? Number(c[i]?.[1]) : 0;
  const read = (k: number): number => {
    while (i < c.length && c[i]?.[0] !== k) i++;
    return Number(c[i++]?.[1] ?? 0);
  };
  for (let loop = 0; loop < loops && i < c.length; loop++) {
    const flags = read(92);
    if (flags & 2) {
      const bulges = read(72) !== 0;
      const closed = read(73) !== 0;
      const count = read(93);
      const vertices: { at: Vec2; bulge: number }[] = [];
      for (let v = 0; v < count; v++) vertices.push({ at: [read(10), read(20)], bulge: bulges ? read(42) : 0 });
      curves.push(...polyline(vertices, closed || true));
      continue;
    }
    const edges = read(93);
    for (let k = 0; k < edges; k++) {
      const kind = read(72);
      if (kind === 1) curves.push({ kind: 'line', start: [read(10), read(20)], end: [read(11), read(21)] });
      else if (kind === 2) {
        const center: Vec2 = [read(10), read(20)];
        const radius = read(40);
        const [from, to] = [(read(50) * Math.PI) / 180, (read(51) * Math.PI) / 180];
        // Clockwise arcs (73 = 0) give their angles mirrored.
        const ccw = read(73) !== 0;
        const [a0, a1] = ccw ? [from, to] : [-to, -from];
        curves.push({ kind: 'arc', center, radius, startAngle: a0, sweep: ccwSweep(a0, a1) });
      } else if (kind === 3) {
        const center: Vec2 = [read(10), read(20)];
        const major: Vec2 = [read(11), read(21)];
        const ratio = read(40);
        const [from, to] = [(read(50) * Math.PI) / 180, (read(51) * Math.PI) / 180];
        const ccw = read(73) !== 0;
        const a = Math.hypot(...major);
        const [t0, t1] = ccw ? [from, to] : [-to, -from];
        curves.push({ kind: 'ellipse', ellipse: { center, a, b: a * ratio, rotation: angleOf(major) }, start: t0, sweep: ccwSweep(t0, t1) });
      } else if (kind === 4) {
        const degree = read(94);
        void degree;
        const knotCount = read(95);
        const controlCount = read(96);
        for (let n = 0; n < knotCount; n++) read(40);
        const control = Array.from({ length: controlCount }, (): Vec2 => [read(10), read(20)]);
        curves.push(...lines(control));
      }
    }
  }
  return curves;
}

/** A text placed by `m`: its anchor moved, its height scaled, its baseline turned. */
function placeText(t: DrawingText, m: Matrix): DrawingText {
  const at = apply(m, t.at);
  const along = apply(m, [t.at[0] + Math.cos(t.angle), t.at[1] + Math.sin(t.angle)]);
  return { ...t, at, height: t.height * scaleOf(m), angle: Math.atan2(along[1] - at[1], along[0] - at[0]) };
}

/** How much `m` scales lengths (the square root of its area factor). */
const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

/**
 * Drawing curves placed by an affine matrix: lines and Béziers exactly, circles, arcs and ellipses
 * exactly where `m` keeps shapes similar (a mirror turns arcs round), otherwise fitted with lines and arcs.
 */
function placeCurves(curves: readonly DrawingCurve[], m: Matrix): DrawingCurve[] {
  const scale = scaleOf(m);
  const similar = Math.abs(Math.hypot(m[0], m[1]) - Math.hypot(m[2], m[3])) < 1e-9 * Math.max(scale, 1) && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-9 * Math.max(scale * scale, 1);
  const mirrored = m[0] * m[3] - m[1] * m[2] < 0;
  const turn = Math.atan2(m[1], m[0]);
  return curves.flatMap((c): DrawingCurve[] => {
    if (c.kind === 'line') return [{ kind: 'line', start: apply(m, c.start), end: apply(m, c.end) }];
    if (c.kind === 'bezier') return [{ kind: 'bezier', points: c.points.map((p) => apply(m, p)) as unknown as Bezier }];
    if (!similar) {
      const { curve, t0, t1 } = c.kind === 'circle'
        ? { curve: { kind: 'ellipse' as const, ellipse: { center: c.center, a: c.radius, b: c.radius, rotation: 0 } }, t0: 0, t1: 2 * Math.PI }
        : c.kind === 'arc'
          ? { curve: { kind: 'ellipse' as const, ellipse: { center: c.center, a: c.radius, b: c.radius, rotation: 0 } }, t0: c.startAngle, t1: c.startAngle + c.sweep }
          : paramCurveOf(c);
      return fitted(sampleCurve(curve, t0, t1, flatness).map((p) => apply(m, p)));
    }
    // Angles turn with m; a mirror reflects them (and runs arcs the other way round).
    const angle = (a: number) => (mirrored ? turn - a : turn + a);
    if (c.kind === 'circle') return [{ kind: 'circle', center: apply(m, c.center), radius: c.radius * scale }];
    if (c.kind === 'arc') {
      const start = mirrored ? angle(c.startAngle + c.sweep) : angle(c.startAngle);
      return [{ kind: 'arc', center: apply(m, c.center), radius: c.radius * scale, startAngle: start, sweep: c.sweep }];
    }
    const e = c.ellipse;
    const start = mirrored ? -(c.start + c.sweep) : c.start;
    return [{ kind: 'ellipse', ellipse: { center: apply(m, e.center), a: e.a * scale, b: e.b * scale, rotation: angle(e.rotation) }, start, sweep: c.sweep }];
  });
}

/** Lines and arcs within 0.01 mm of the curve sampled (0.008 mm of its samples, which lie within 0.002 mm of it). */
function fitted(points: readonly Vec2[]): DrawingCurve[] {
  return fitArcs(points, 0.01 - flatness).map((piece): DrawingCurve => {
    if (piece.kind === 'line') return { kind: 'line', start: piece.start, end: piece.end };
    const [from, to] = piece.ccw ? [piece.start, piece.end] : [piece.end, piece.start];
    const startAngle = angleOf([from[0] - piece.center[0], from[1] - piece.center[1]]);
    return { kind: 'arc', center: piece.center, radius: piece.radius, startAngle, sweep: ccwSweep(startAngle, angleOf([to[0] - piece.center[0], to[1] - piece.center[1]])) };
  });
}

/** Polyline vertices with bulges (tan of a quarter of the arc angle, positive counter-clockwise). */
function polyline(vertices: readonly { at: Vec2; bulge: number }[], closed: boolean): DrawingCurve[] {
  const curves: DrawingCurve[] = [];
  const count = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < count; i++) {
    const { at: a, bulge } = vertices[i] as { at: Vec2; bulge: number };
    const b = (vertices[(i + 1) % vertices.length] as { at: Vec2 }).at;
    if (Math.abs(bulge) < 1e-12) {
      curves.push({ kind: 'line', start: a, end: b });
      continue;
    }
    const theta = 4 * Math.atan(bulge);
    const chord: Vec2 = [b[0] - a[0], b[1] - a[1]];
    const length = Math.hypot(...chord);
    const radius = length / (2 * Math.sin(theta / 2)); // signed like the bulge
    const h = radius * Math.cos(theta / 2);
    const center: Vec2 = [(a[0] + b[0]) / 2 - (chord[1] / length) * h, (a[1] + b[1]) / 2 + (chord[0] / length) * h];
    const from = theta > 0 ? a : b;
    const startAngle = angleOf([from[0] - center[0], from[1] - center[1]]);
    curves.push({ kind: 'arc', center, radius: Math.abs(radius), startAngle, sweep: Math.abs(theta) });
  }
  return curves;
}

/** Point of a B-spline at `t` (de Boor's algorithm). */
function deBoor(degree: number, knots: readonly number[], control: readonly Vec2[], t: number): Vec2 {
  let span = degree;
  while (span < control.length - 1 && t >= (knots[span + 1] as number)) span++;
  const d = Array.from({ length: degree + 1 }, (_, j) => [...(control[j + span - degree] as Vec2)] as [number, number]);
  for (let r = 1; r <= degree; r++)
    for (let j = degree; j >= r; j--) {
      const i = j + span - degree;
      const left = knots[i] as number;
      const denominator = (knots[i + degree - r + 1] as number) - left;
      const alpha = denominator === 0 ? 0 : (t - left) / denominator;
      const p = d[j] as [number, number];
      const q = d[j - 1] as [number, number];
      d[j] = [(1 - alpha) * q[0] + alpha * p[0], (1 - alpha) * q[1] + alpha * p[1]];
    }
  return d[degree] as Vec2;
}

// ---- SVG -------------------------------------------------------------------------------------

const lengthUnits: Readonly<Record<string, number>> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };

function length(text: string | undefined): { value: number; unit: string } | undefined {
  const match = /^\s*([-+]?[\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(text ?? '');
  return match ? { value: Number(match[1]), unit: (match[2] ?? '').toLowerCase() } : undefined;
}

function parseTransform(text: string | undefined): Matrix {
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  for (const [, name, args] of (text ?? '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = (args ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
    const [a = 0, b, c, d = 0, e = 0, f = 0] = v;
    let n: Matrix = [1, 0, 0, 1, 0, 0];
    if (name === 'matrix') n = [a, b ?? 0, c ?? 0, d, e, f];
    else if (name === 'translate') n = [1, 0, 0, 1, a, b ?? 0];
    else if (name === 'scale') n = [a, 0, 0, b ?? a, 0, 0];
    else if (name === 'rotate') {
      const r = (a * Math.PI) / 180;
      const [cx, cy] = [b ?? 0, c ?? 0];
      n = multiply(multiply([1, 0, 0, 1, cx, cy], [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (name === 'skewX') n = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
    else if (name === 'skewY') n = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
    m = multiply(m, n);
  }
  return m;
}

/**
 * SVG: paths (lines, arcs, Béziers), lines, polylines, polygons, rectangles, circles and ellipses,
 * with transforms. Sizes follow the root's width and viewBox (otherwise 96 px per inch); Y points up
 * and the bottom left of the view box is the origin.
 */
export function readSvg(bytes: Uint8Array): ReadDrawing {
  const svg = parseXml(new TextDecoder().decode(bytes)).children.find((e) => e.name === 'svg');
  if (!svg) throw new Error('This is not an SVG drawing.');
  const box = svg.attributes['viewBox']?.trim().split(/[\s,]+/).map(Number);
  const width = length(svg.attributes['width']);
  const height = length(svg.attributes['height']);
  const mm = (l: { value: number; unit: string } | undefined) => (l && l.unit !== '%' ? l.value * (lengthUnits[l.unit] ?? lengthUnits['px'] as number) : undefined);
  const sx = box?.length === 4 && mm(width) !== undefined ? (mm(width) as number) / (box[2] as number) : (lengthUnits['px'] as number);
  const sy = box?.length === 4 && mm(height) !== undefined ? (mm(height) as number) / (box[3] as number) : sx;
  // User units to millimetres, Y flipped so the drawing reads the same way up as on screen, with the
  // bottom of the view box (or of the page) on the X axis.
  const bottom = box?.length === 4 ? (box[1] as number) + (box[3] as number) : (mm(height) ?? 0) / sy;
  const root: Matrix = [sx, 0, 0, -sy, -(box?.[0] ?? 0) * sx, bottom * sy];
  const drawing: ReadDrawing = { curves: [], texts: [] };
  walk(svg, root, drawing);
  if (drawing.curves.length === 0 && drawing.texts.length === 0) throw new Error('The SVG drawing has no paths, shapes or text.');
  return drawing;
}

const skipped = new Set(['defs', 'clipPath', 'mask', 'symbol', 'marker', 'pattern', 'style', 'title', 'desc', 'metadata']);

/** A style property from the style attribute or the attribute of the same name. */
const styleOf = (element: XmlElement, name: string): string | undefined =>
  new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(element.attributes['style'] ?? '')?.[1]?.trim() ?? element.attributes[name];

/** The texts of a text element and its tspans, each where its own x and y (or the element's) place it. */
function svgTexts(element: XmlElement, m: Matrix, inherited: { size: number; weight: TextWeight; align: DrawingText['align'] }): DrawingText[] {
  const size = Number.parseFloat(styleOf(element, 'font-size') ?? '') || inherited.size;
  const weightValue = styleOf(element, 'font-weight') ?? '';
  const weight: TextWeight = /bold|[6-9]00/.test(weightValue) ? 'bold' : weightValue ? 'regular' : inherited.weight;
  const anchor = styleOf(element, 'text-anchor');
  const align = anchor === 'middle' ? 'middle' : anchor === 'end' ? 'end' : anchor === 'start' ? 'start' : inherited.align;
  const own = element.text.replace(/\s+/g, ' ').trim();
  const x = Number.parseFloat(element.attributes['x'] ?? '0') || 0;
  const y = Number.parseFloat(element.attributes['y'] ?? '0') || 0;
  const at = apply(m, [x, y]);
  // The baseline's direction and the drawing's scale, from the matrix.
  const along = apply(m, [x + 1, y]);
  const scale = Math.hypot(along[0] - at[0], along[1] - at[1]);
  const angle = Math.atan2(along[1] - at[1], along[0] - at[0]);
  const texts: DrawingText[] = own ? [{ text: own, at, height: size * scale, angle, align, weight, em: true }] : [];
  for (const span of element.children.filter((c) => c.name === 'tspan')) {
    texts.push(...svgTexts({ ...span, attributes: { x: span.attributes['x'] ?? element.attributes['x'] ?? '0', y: span.attributes['y'] ?? element.attributes['y'] ?? '0', ...span.attributes } }, m, { size, weight, align }));
  }
  return texts;
}

function walk(element: XmlElement, parent: Matrix, drawing: ReadDrawing): void {
  const curves = drawing.curves;
  for (const child of element.children) {
    if (skipped.has(child.name) || child.attributes['display'] === 'none' || /display\s*:\s*none/.test(child.attributes['style'] ?? '')) continue;
    const m = multiply(parent, parseTransform(child.attributes['transform']));
    const n = (name: string) => Number(child.attributes[name] ?? 0);
    switch (child.name) {
      case 'path':
        curves.push(...pathCurves(child.attributes['d'] ?? '', m));
        break;
      case 'text':
        // Font sizes are em sizes; the engine turns them into capital heights with the font.
        drawing.texts.push(...svgTexts(child, m, { size: 16, weight: 'regular', align: 'start' }));
        break;
      case 'line':
        curves.push(...placeSegments([{ kind: 'line', from: [n('x1'), n('y1')], to: [n('x2'), n('y2')] }], m));
        break;
      case 'polyline':
      case 'polygon': {
        const v = (child.attributes['points'] ?? '').trim().split(/[\s,]+/).map(Number);
        const points = Array.from({ length: Math.floor(v.length / 2) }, (_, i): Vec2 => [v[2 * i] as number, v[2 * i + 1] as number]);
        if (child.name === 'polygon' && points.length > 2) points.push(points[0] as Vec2);
        curves.push(...placeSegments(points.slice(1).map((to, i) => ({ kind: 'line' as const, from: points[i] as Vec2, to })), m));
        break;
      }
      case 'rect': {
        const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')];
        const rx = Math.min(w / 2, Number(child.attributes['rx'] ?? child.attributes['ry'] ?? 0));
        const ry = Math.min(h / 2, Number(child.attributes['ry'] ?? child.attributes['rx'] ?? 0));
        const d = rx > 0 && ry > 0
          ? `M ${x + rx} ${y} H ${x + w - rx} A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V ${y + h - ry} A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H ${x + rx} A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V ${y + ry} A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`
          : `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
        curves.push(...pathCurves(d, m));
        break;
      }
      case 'circle':
      case 'ellipse': {
        const [cx, cy] = [n('cx'), n('cy')];
        const rx = child.name === 'circle' ? n('r') : n('rx');
        const ry = child.name === 'circle' ? n('r') : n('ry');
        curves.push(...pathCurves(`M ${cx + rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx - rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx + rx} ${cy} Z`, m, true));
        break;
      }
      case 'g':
      case 'svg':
      case 'a':
        walk(child, m, drawing);
        break;
      default:
        break;
    }
  }
}

/** Path pieces in the element's own coordinates. */
type Segment =
  | { readonly kind: 'line'; readonly from: Vec2; readonly to: Vec2 }
  | { readonly kind: 'cubic'; readonly from: Vec2; readonly c1: Vec2; readonly c2: Vec2; readonly to: Vec2 }
  | { readonly kind: 'arc'; readonly center: Vec2; readonly rx: number; readonly ry: number; readonly rotation: number; readonly start: number; readonly sweep: number };

function pathSegments(d: string): Segment[] {
  const tokens = d.match(/[a-df-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const segments: Segment[] = [];
  let i = 0;
  let command = '';
  let at: Vec2 = [0, 0];
  let start: Vec2 = [0, 0];
  let control: Vec2 | undefined; // last cubic or quadratic control point, for S and T
  const number = () => Number(tokens[i++]);
  const flag = () => {
    // Flags may be written without separators ("a10 10 0 0110 10").
    const token = tokens[i] as string;
    if (token.length > 1 && (token[0] === '0' || token[0] === '1')) {
      tokens[i] = token.slice(1);
      return token[0] === '1';
    }
    i++;
    return token === '1';
  };
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i] as string)) command = tokens[i++] as string;
    const relative = command === command.toLowerCase();
    const point = (): Vec2 => {
      const p: Vec2 = [number(), number()];
      return relative ? [at[0] + p[0], at[1] + p[1]] : p;
    };
    const upper = command.toUpperCase();
    let nextControl: Vec2 | undefined;
    switch (upper) {
      case 'M':
        at = point();
        start = at;
        command = relative ? 'l' : 'L'; // later pairs are lines
        break;
      case 'L': {
        const to = point();
        segments.push({ kind: 'line', from: at, to });
        at = to;
        break;
      }
      case 'H':
      case 'V': {
        const v = number();
        const to: Vec2 = upper === 'H' ? [relative ? at[0] + v : v, at[1]] : [at[0], relative ? at[1] + v : v];
        segments.push({ kind: 'line', from: at, to });
        at = to;
        break;
      }
      case 'C':
      case 'S': {
        const c1: Vec2 = upper === 'C' ? point() : control ? [2 * at[0] - control[0], 2 * at[1] - control[1]] : at;
        const c2 = point();
        const to = point();
        segments.push({ kind: 'cubic', from: at, c1, c2, to });
        nextControl = c2;
        at = to;
        break;
      }
      case 'Q':
      case 'T': {
        const q: Vec2 = upper === 'Q' ? point() : control ? [2 * at[0] - control[0], 2 * at[1] - control[1]] : at;
        const to = point();
        // A quadratic is the cubic with controls two thirds of the way to its one control point.
        segments.push({ kind: 'cubic', from: at, c1: [at[0] + (2 / 3) * (q[0] - at[0]), at[1] + (2 / 3) * (q[1] - at[1])], c2: [to[0] + (2 / 3) * (q[0] - to[0]), to[1] + (2 / 3) * (q[1] - to[1])], to });
        nextControl = q;
        at = to;
        break;
      }
      case 'A': {
        const [rx, ry, rotation] = [Math.abs(number()), Math.abs(number()), number()];
        const large = flag();
        const sweep = flag();
        const to = point();
        const arc = endpointArc(at, to, rx, ry, (rotation * Math.PI) / 180, large, sweep);
        segments.push(arc ?? { kind: 'line', from: at, to });
        at = to;
        break;
      }
      case 'Z':
        if (Math.hypot(at[0] - start[0], at[1] - start[1]) > 1e-9) segments.push({ kind: 'line', from: at, to: start });
        at = start;
        break;
      default:
        i++; // unknown token: skip it
    }
    control = nextControl;
  }
  return segments;
}

/** SVG's endpoint arc parameters to centre form (SVG 1.1, appendix F.6.5). */
function endpointArc(from: Vec2, to: Vec2, rx: number, ry: number, phi: number, large: boolean, sweep: boolean): Segment | undefined {
  if (rx === 0 || ry === 0 || (from[0] === to[0] && from[1] === to[1])) return undefined;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = large === sweep ? -1 : 1;
  const factor = sign * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = (factor * rx * y1) / ry;
  const cy1 = (-factor * ry * x1) / rx;
  const center: Vec2 = [cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2, sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2];
  const start = Math.atan2((y1 - cy1) / ry, (x1 - cx1) / rx);
  const end = Math.atan2((-y1 - cy1) / ry, (-x1 - cx1) / rx);
  let delta = end - start;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  return { kind: 'arc', center, rx, ry, rotation: phi, start, sweep: delta };
}

function pathCurves(d: string, m: Matrix, closedShape = false): DrawingCurve[] {
  const curves = placeSegments(pathSegments(d), m);
  // A circle element made of two half arcs is one circle.
  const [first, second] = curves;
  if (closedShape && curves.length === 2 && first?.kind === 'arc' && second?.kind === 'arc' && Math.abs(first.radius - second.radius) < 1e-9) {
    return [{ kind: 'circle', center: first.center, radius: first.radius }];
  }
  return curves;
}

/** Segments to drawing curves in millimetres: Béziers exactly; arcs exactly where the transform keeps shapes similar, otherwise fitted. */
function placeSegments(segments: readonly Segment[], m: Matrix): DrawingCurve[] {
  return segments.flatMap((segment): DrawingCurve[] => {
    if (segment.kind === 'line') return [{ kind: 'line', start: apply(m, segment.from), end: apply(m, segment.to) }];
    if (segment.kind === 'cubic') return [{ kind: 'bezier', points: [segment.from, segment.c1, segment.c2, segment.to].map((p) => apply(m, p)) as unknown as Bezier }];
    // Counter-clockwise from the earlier parameter, in the path's own coordinates; placeCurves maps it.
    const [start, sweep] = segment.sweep >= 0 ? [segment.start, segment.sweep] : [segment.start + segment.sweep, -segment.sweep];
    const local: DrawingCurve =
      Math.abs(segment.rx - segment.ry) < 1e-9 * segment.rx
        ? { kind: 'arc', center: segment.center, radius: segment.rx, startAngle: start + segment.rotation, sweep }
        : { kind: 'ellipse', ellipse: { center: segment.center, a: segment.rx, b: segment.ry, rotation: segment.rotation }, start, sweep };
    return placeCurves([local], m);
  });
}

/**
 * Points along a curve, close enough that the lines between them stay within `flatness`. `angle`
 * curves (arcs, ellipses) are parametrised by angle with radius `size`: a chord across dθ strays
 * size·dθ²/8. Other curves (splines, Béziers) by 0…1, with `size` their control polygon's length.
 */
function sample(at: (t: number) => Vec2, from: number, to: number, size: number, kind: 'angle' | 'parameter'): Vec2[] {
  const step = kind === 'angle' ? Math.sqrt((8 * flatness) / Math.max(size, flatness)) : 1 / (4 * Math.sqrt(Math.max(size, flatness) / flatness));
  const count = Math.min(2000, Math.max(8, Math.ceil(Math.abs(to - from) / step)));
  return Array.from({ length: count + 1 }, (_, k) => at(from + ((to - from) * k) / count));
}

const lines = (points: readonly Vec2[]): DrawingCurve[] =>
  points.slice(1).flatMap((p, i) => {
    const q = points[i] as Vec2;
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9 ? [{ kind: 'line' as const, start: q, end: p }] : [];
  });

// ---- to sketch entities ------------------------------------------------------------------------

/**
 * Sketch entities for drawing curves: ends that meet share one point (to 1 µm), so imported outlines
 * form closed profiles. Ids start with `prefix`.
 */
export function sketchEntities(curves: readonly DrawingCurve[], prefix: string): SketchEntity[] {
  const entities: SketchEntity[] = [];
  const points = new Map<string, string>();
  let next = 0;
  const id = () => `${prefix}${++next}`;
  const pointAt = (p: Vec2): string => {
    const key = `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
    let existing = points.get(key);
    if (!existing) {
      existing = id();
      points.set(key, existing);
      entities.push({ id: existing, kind: 'point', x: p[0], y: p[1] });
    }
    return existing;
  };
  const add = (curve: DrawingCurve): void => {
    if (curve.kind === 'line') {
      const [start, end] = [pointAt(curve.start), pointAt(curve.end)];
      if (start !== end) entities.push({ id: id(), kind: 'line', start, end, construction: false });
    } else if (curve.kind === 'circle') {
      if (curve.radius > 1e-6) entities.push({ id: id(), kind: 'circle', center: pointAt(curve.center), radius: curve.radius, construction: false });
    } else if (curve.kind === 'ellipse' && curve.sweep >= 2 * Math.PI - 1e-9) {
      const { center, a, b, rotation } = curve.ellipse;
      const major: Vec2 = [center[0] + a * Math.cos(rotation), center[1] + a * Math.sin(rotation)];
      entities.push({ id: id(), kind: 'ellipse', center: pointAt(center), major: pointAt(major), minorRadius: b, construction: false });
    } else if (curve.kind === 'bezier' || curve.kind === 'ellipse') {
      // A lone Bézier or a piece of an ellipse has no sketch entity of its own: lines and arcs within 0.01 mm.
      for (const piece of fitted(samplePoints(curve, flatness))) add(piece);
    } else {
      if (curve.radius <= 1e-6) return;
      const polar = (a: number): Vec2 => [curve.center[0] + curve.radius * Math.cos(a), curve.center[1] + curve.radius * Math.sin(a)];
      if (curve.sweep >= 2 * Math.PI - 1e-9) {
        entities.push({ id: id(), kind: 'circle', center: pointAt(curve.center), radius: curve.radius, construction: false });
        return;
      }
      entities.push({ id: id(), kind: 'arc', center: pointAt(curve.center), start: pointAt(polar(curve.startAngle)), end: pointAt(polar(curve.startAngle + curve.sweep)), construction: false });
    }
  };
  for (const curve of curves) add(curve);
  return entities;
}
