import type { SketchEntity } from '@core/contracts';
import { angleOf, ccwSweep, type Vec2 } from '@core/utilities/math';
import type { TextWeight } from '@core/contracts';
import { type DrawingCurve, samplePoints } from './drawing';
import { parseXml, type XmlElement } from './xml';

/** Largest distance between a curve and the lines that stand in for it (splines, ellipses, Béziers), mm. */
const flatness = 0.05;

// ---- DXF -------------------------------------------------------------------------------------

const dxfUnits: Readonly<Record<number, number>> = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0000254, 9: 0.0254, 10: 914.4 };

/**
 * ASCII DXF: LINE, CIRCLE, ARC, LWPOLYLINE and POLYLINE (with bulges, as exact arcs), ELLIPSE and
 * SPLINE (as lines). Only the ENTITIES section is read; `$INSUNITS` scales to millimetres.
 */
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

export function readDxf(bytes: Uint8Array): ReadDrawing {
  const rows = new TextDecoder().decode(bytes).split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < rows.length; i += 2) pairs.push([Number((rows[i] as string).trim()), (rows[i + 1] as string).trim()]);
  const unitsAt = pairs.findIndex(([code, value]) => code === 9 && value === '$INSUNITS');
  const scale = unitsAt >= 0 ? (dxfUnits[Number(pairs[unitsAt + 1]?.[1])] ?? 1) : 1;
  const start = pairs.findIndex(([code, value], i) => code === 0 && value === 'SECTION' && pairs[i + 1]?.[1] === 'ENTITIES');
  if (start < 0) throw new Error('The DXF file has no ENTITIES section.');

  // Entities: a type, then its group codes up to the next 0 code.
  const entities: { type: string; codes: [number, string][] }[] = [];
  for (let i = start + 2; i < pairs.length; i++) {
    const [code, value] = pairs[i] as [number, string];
    if (code === 0) {
      if (value === 'ENDSEC') break;
      entities.push({ type: value, codes: [] });
    } else entities[entities.length - 1]?.codes.push([code, value]);
  }

  const curves: DrawingCurve[] = [];
  const texts: DrawingText[] = [];
  const s = (v: Vec2): Vec2 => [v[0] * scale, v[1] * scale];
  for (let k = 0; k < entities.length; k++) {
    const { type, codes } = entities[k] as (typeof entities)[number];
    const get = (code: number, fallback = 0) => Number(codes.find(([c]) => c === code)?.[1] ?? fallback);
    const all = (code: number) => codes.filter(([c]) => c === code).map(([, v]) => Number(v));
    switch (type) {
      case 'LINE':
        curves.push({ kind: 'line', start: s([get(10), get(20)]), end: s([get(11), get(21)]) });
        break;
      case 'TEXT': {
        // Aligned texts (72: 1 centre, 2 right) are placed by their second point.
        const align = get(72) === 1 || get(72) === 4 ? 'middle' : get(72) === 2 ? 'end' : 'start';
        const at = align === 'start' ? s([get(10), get(20)]) : s([get(11), get(21)]);
        const text = codes.find(([c]) => c === 1)?.[1] ?? '';
        if (text.trim()) texts.push({ text, at, height: get(40, 2.5) * scale, angle: (get(50) * Math.PI) / 180, align, weight: 'regular' });
        break;
      }
      case 'MTEXT': {
        // The text comes in 3 chunks then a 1; \P breaks lines; other formatting codes are dropped.
        const raw = [...codes.filter(([c]) => c === 3), ...codes.filter(([c]) => c === 1)].map(([, v]) => v).join('');
        const lines = raw.replace(/\\P/g, '\n').replace(/\\[A-Za-z][^;\\]*;/g, '').replace(/[{}]/g, '').split('\n');
        const height = get(40, 2.5) * scale;
        const angle = codes.some(([c]) => c === 50) ? (get(50) * Math.PI) / 180 : Math.atan2(get(21), get(11, 1));
        const attach = get(71, 1);
        const align = [2, 5, 8].includes(attach) ? 'middle' : [3, 6, 9].includes(attach) ? 'end' : 'start';
        const origin = s([get(10), get(20)]);
        // Lines 5/3 of the height apart, the first one's capitals hanging from the attachment point.
        lines.forEach((line, i) => {
          const drop = height * (1 + (5 / 3) * i);
          const at: Vec2 = [origin[0] + Math.sin(angle) * drop, origin[1] - Math.cos(angle) * drop];
          if (line.trim()) texts.push({ text: line, at, height, angle, align, weight: 'regular' });
        });
        break;
      }
      case 'CIRCLE':
        curves.push({ kind: 'circle', center: s([get(10), get(20)]), radius: get(40) * scale });
        break;
      case 'ARC': {
        const startAngle = (get(50) * Math.PI) / 180;
        curves.push({ kind: 'arc', center: s([get(10), get(20)]), radius: get(40) * scale, startAngle, sweep: ccwSweep(startAngle, (get(51) * Math.PI) / 180) });
        break;
      }
      case 'LWPOLYLINE': {
        // Each vertex starts at a 10 code; a 42 code after it is that vertex's bulge.
        const vertices: { at: Vec2; bulge: number }[] = [];
        for (const [code, value] of codes) {
          if (code === 10) vertices.push({ at: [Number(value), 0], bulge: 0 });
          const last = vertices[vertices.length - 1];
          if (last && code === 20) last.at = [last.at[0], Number(value)];
          if (last && code === 42) last.bulge = Number(value);
        }
        curves.push(...polyline(vertices.map((v) => ({ at: s(v.at), bulge: v.bulge })), (get(70) & 1) === 1));
        break;
      }
      case 'POLYLINE': {
        const vertices: { at: Vec2; bulge: number }[] = [];
        while (entities[k + 1]?.type === 'VERTEX') {
          const vertex = (entities[++k] as (typeof entities)[number]).codes;
          const v = (code: number) => Number(vertex.find(([c]) => c === code)?.[1] ?? 0);
          vertices.push({ at: s([v(10), v(20)]), bulge: v(42) });
        }
        curves.push(...polyline(vertices, (get(70) & 1) === 1));
        break;
      }
      case 'ELLIPSE': {
        const center = s([get(10), get(20)]);
        const major = s([get(11), get(21)]);
        const ratio = get(40, 1);
        const minor: Vec2 = [-major[1] * ratio, major[0] * ratio];
        const from = get(41, 0);
        const to = get(42, 2 * Math.PI);
        const sweep = ccwSweep(from, to);
        const at = (t: number): Vec2 => [center[0] + major[0] * Math.cos(t) + minor[0] * Math.sin(t), center[1] + major[1] * Math.cos(t) + minor[1] * Math.sin(t)];
        curves.push(...lines(sample(at, from, from + sweep, Math.hypot(...major), 'angle')));
        break;
      }
      case 'SPLINE': {
        const degree = get(71, 3);
        const knots = all(40);
        const xs = all(10);
        const ys = all(20);
        const control = xs.map((x, i): Vec2 => s([x, ys[i] ?? 0]));
        if (control.length > degree && knots.length === control.length + degree + 1) {
          const lo = knots[degree] as number;
          const hi = knots[control.length] as number;
          const size = control.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - (control[i] as Vec2)[0], p[1] - (control[i] as Vec2)[1]), 0);
          // The parameter runs lo…hi; sampling is scaled to it.
          const points = sample((u) => deBoor(degree, knots, control, Math.min(lo + u * (hi - lo), hi - 1e-12)), 0, 1, size, 'parameter');
          points[points.length - 1] = deBoor(degree, knots, control, hi - 1e-12);
          curves.push(...lines(points));
        } else {
          // Fit points only: connect them.
          const fit = all(11).map((x, i): Vec2 => s([x, all(21)[i] ?? 0]));
          curves.push(...lines(fit.length ? fit : control));
        }
        break;
      }
      default:
        break; // DIMENSION, INSERT, HATCH, … are not geometry to cut.
    }
  }
  if (curves.length === 0 && texts.length === 0) throw new Error('The DXF file has no lines, arcs, circles, polylines, splines or text.');
  return { curves, texts };
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

/** Segments to drawing curves in millimetres: exact where the transform keeps circles round, sampled otherwise. */
function placeSegments(segments: readonly Segment[], m: Matrix): DrawingCurve[] {
  const determinant = m[0] * m[3] - m[1] * m[2];
  const scale = Math.sqrt(Math.abs(determinant));
  // Rotation and uniform scale (possibly mirrored) keep circles circles.
  const similar = Math.abs(Math.hypot(m[0], m[1]) - Math.hypot(m[2], m[3])) < 1e-9 * scale && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-9 * scale * scale;
  const mirrored = determinant < 0;
  return segments.flatMap((segment): DrawingCurve[] => {
    if (segment.kind === 'line') return [{ kind: 'line', start: apply(m, segment.from), end: apply(m, segment.to) }];
    if (segment.kind === 'cubic') {
      const [p0, p1, p2, p3] = [segment.from, segment.c1, segment.c2, segment.to].map((p) => apply(m, p)) as [Vec2, Vec2, Vec2, Vec2];
      const at = (t: number): Vec2 => {
        const u = 1 - t;
        return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
      };
      const size = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
      return lines(sample(at, 0, 1, size, 'parameter'));
    }
    const local = (t: number): Vec2 => {
      const [c, s] = [Math.cos(segment.rotation), Math.sin(segment.rotation)];
      const x = segment.rx * Math.cos(t);
      const y = segment.ry * Math.sin(t);
      return [segment.center[0] + c * x - s * y, segment.center[1] + s * x + c * y];
    };
    if (similar && Math.abs(segment.rx - segment.ry) < 1e-9 * segment.rx) {
      const center = apply(m, segment.center);
      const from = apply(m, local(segment.start));
      // Drawing arcs run counter-clockwise; a mirror turns the direction around.
      const ccw = (segment.sweep > 0) !== mirrored;
      const startPoint = ccw ? from : apply(m, local(segment.start + segment.sweep));
      const startAngle = angleOf([startPoint[0] - center[0], startPoint[1] - center[1]]);
      return [{ kind: 'arc', center, radius: segment.rx * scale, startAngle, sweep: Math.abs(segment.sweep) }];
    }
    return lines(sample((t) => apply(m, local(t)), segment.start, segment.start + segment.sweep, Math.max(segment.rx, segment.ry) * scale, 'angle'));
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
  for (const curve of curves) {
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
      // A lone Bézier or a piece of an ellipse has no sketch entity of its own: short lines within 0.05 mm.
      const points = samplePoints(curve, 0.05).map(pointAt);
      for (let i = 1; i < points.length; i++) {
        if (points[i] !== points[i - 1]) entities.push({ id: id(), kind: 'line', start: points[i - 1] as string, end: points[i] as string, construction: false });
      }
    } else {
      if (curve.radius <= 1e-6) continue;
      const polar = (a: number): Vec2 => [curve.center[0] + curve.radius * Math.cos(a), curve.center[1] + curve.radius * Math.sin(a)];
      if (curve.sweep >= 2 * Math.PI - 1e-9) {
        entities.push({ id: id(), kind: 'circle', center: pointAt(curve.center), radius: curve.radius, construction: false });
        continue;
      }
      entities.push({ id: id(), kind: 'arc', center: pointAt(curve.center), start: pointAt(polar(curve.startAngle)), end: pointAt(polar(curve.startAngle + curve.sweep)), construction: false });
    }
  }
  return entities;
}
