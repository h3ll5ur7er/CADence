import { type DrawingAnnotation, type DrawingDocument, type DrawingView, sectionPieces, sheetSizes, type Tolerance, type Vec2, type Vec3, type ViewAnchor, type ViewDirection } from '@core/contracts';
import type { ProjectedCurve, ViewGeometry } from '@core/engines/modeling';
import type { LineStyle, SheetAnchor, SheetLayout } from './drawing-manager';
import { fitOf } from './fits';

/** A parts list: rows, and the item number of each instance. */
export interface PartsList {
  readonly rows: readonly { readonly item: number; readonly name: string; readonly count: number; readonly material: string }[];
  readonly items: ReadonlyMap<string, number>;
}

export interface LayoutInput {
  readonly document: DrawingDocument;
  /** The geometry of each view that is not a detail, or why it cannot be drawn. */
  readonly geometry: ReadonlyMap<string, ViewGeometry | { readonly error: string }>;
  /** The lines of each callout, by annotation id. */
  readonly callouts: ReadonlyMap<string, readonly string[]>;
  /** The parts list of each assembly view, by view id. */
  readonly parts: ReadonlyMap<string, PartsList>;
  /** The drawn component's material, which the title block shows when it names none (CAD-127). */
  readonly material?: string;
  /** Views drawn from the triangles whose exact projection goes on in the background (CAD-168). */
  readonly finishing?: ReadonlySet<string>;
}

/** A view's right and up: the viewer is on the side of right × up (third-angle names). */
const s2 = Math.SQRT1_2;
const s6 = 1 / Math.sqrt(6);
export const viewAxes: Readonly<Record<ViewDirection, { readonly u: Vec3; readonly v: Vec3 }>> = {
  front: { u: [1, 0, 0], v: [0, 0, 1] },
  back: { u: [-1, 0, 0], v: [0, 0, 1] },
  top: { u: [1, 0, 0], v: [0, 1, 0] },
  bottom: { u: [1, 0, 0], v: [0, -1, 0] },
  right: { u: [0, 1, 0], v: [0, 0, 1] },
  left: { u: [0, -1, 0], v: [0, 0, 1] },
  iso: { u: [s2, s2, 0], v: [-s6, s6, 2 * s6] },
};
const towardsViewer = (direction: ViewDirection): Vec3 => {
  const { u, v } = viewAxes[direction];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** What an anchor carries over from the view's geometry: its model point, and whether the view shows it. */
const extra = (a: { readonly model?: Vec3; readonly hidden?: true }) => ({ ...(a.model ? { model: a.model } : {}), ...(a.hidden ? { hidden: true as const } : {}) });

type Path = SheetLayout['paths'][number];
type Text = SheetLayout['texts'][number];
type Arrow = SheetLayout['arrows'][number];

const margin = 10;
const textSize = 3.5;
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
const length = (a: Vec2) => Math.hypot(a[0], a[1]);
const unit = (a: Vec2): Vec2 => mul(a, 1 / (length(a) || 1));
const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
/** Up to two decimals, no trailing zeros. */
export const formatValue = (v: number) => String(Math.round(v * 100) / 100);

/** A curve as points along it (circles and arcs in 48 steps a turn). */
function pointsOf(curve: ProjectedCurve): Vec2[] {
  if (curve.kind === 'line') return [curve.start, curve.end];
  const radius = curve.kind === 'circle' ? curve.radius : length(sub(curve.start, curve.center));
  const from = curve.kind === 'circle' ? 0 : Math.atan2(curve.start[1] - curve.center[1], curve.start[0] - curve.center[0]);
  const to = curve.kind === 'circle' ? from + 2 * Math.PI : Math.atan2(curve.end[1] - curve.center[1], curve.end[0] - curve.center[0]);
  const sweep = curve.kind === 'circle' ? 2 * Math.PI : (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
  const steps = Math.max(2, Math.ceil((sweep / (2 * Math.PI)) * 48));
  return Array.from({ length: steps + 1 }, (_, k) => [curve.center[0] + radius * Math.cos(from + (sweep * k) / steps), curve.center[1] + radius * Math.sin(from + (sweep * k) / steps)] as Vec2);
}

/** Curves as paths: lines that go on where the one before ends are one path (CAD-130), circles and arcs each their own. */
function joined(curves: readonly ProjectedCurve[]): Vec2[][] {
  const paths: Vec2[][] = [];
  let open: Vec2[] | undefined;
  for (const curve of curves) {
    if (curve.kind !== 'line') {
      paths.push(pointsOf(curve));
      open = undefined;
      continue;
    }
    const last = open?.at(-1);
    if (open && last && Math.abs(last[0] - curve.start[0]) < 1e-9 && Math.abs(last[1] - curve.start[1]) < 1e-9) open.push(curve.end);
    else paths.push((open = [curve.start, curve.end]));
  }
  return paths;
}

/** The part of segment ab inside the circle (centre c, radius r), or none. */
function clipToCircle(a: Vec2, b: Vec2, c: Vec2, r: number): [Vec2, Vec2] | undefined {
  const d = sub(b, a);
  const f = sub(a, c);
  const [qa, qb, qc] = [d[0] * d[0] + d[1] * d[1], 2 * (f[0] * d[0] + f[1] * d[1]), f[0] * f[0] + f[1] * f[1] - r * r];
  if (qa < 1e-18) return qc <= 0 ? [a, b] : undefined;
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return undefined;
  const [t0, t1] = [Math.max(0, (-qb - Math.sqrt(disc)) / (2 * qa)), Math.min(1, (-qb + Math.sqrt(disc)) / (2 * qa))];
  return t0 < t1 ? [add(a, mul(d, t0)), add(a, mul(d, t1))] : undefined;
}

/** Hatch lines at 45° inside the outlines given as segments (even-odd crossings), `spacing` apart. */
export function hatch(segments: readonly (readonly [Vec2, Vec2])[], spacing: number): [Vec2, Vec2][] {
  if (!segments.length || !(spacing > 0)) return [];
  // Turned by −45°, the hatch lines are horizontal.
  const c = Math.SQRT1_2;
  const turn = (p: Vec2): Vec2 => [c * p[0] + c * p[1], -c * p[0] + c * p[1]];
  const back = (p: Vec2): Vec2 => [c * p[0] - c * p[1], c * p[0] + c * p[1]];
  const turned = segments.map(([a, b]) => [turn(a), turn(b)] as const);
  const ys = turned.flatMap(([a, b]) => [a[1], b[1]]);
  const out: [Vec2, Vec2][] = [];
  for (let y = Math.min(...ys) + spacing / 2; y < Math.max(...ys); y += spacing) {
    const xs = turned.flatMap(([a, b]) => ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y) ? [a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0])] : [])).sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([back([xs[i] as number, y]), back([xs[i + 1] as number, y])]);
  }
  return out;
}

/** Lays out the sheet: frame, title block, views and annotations, in sheet millimetres. */
export function layoutSheet(input: LayoutInput): SheetLayout {
  const { document } = input;
  const [long, short] = sheetSizes[document.sheet.size];
  const [width, height] = document.sheet.orientation === 'landscape' ? [long, short] : [short, long];
  const paths: Path[] = [];
  const texts: Text[] = [];
  const arrows: Arrow[] = [];
  const anchors: SheetAnchor[] = [];
  const views: { id: string; min: Vec2; max: Vec2; center?: Vec2; scale?: number; error?: string; note?: string }[] = [];
  const instances: { view: string; instance: string; at: Vec2 }[] = [];
  const lost: string[] = [];
  const line = (points: readonly Vec2[], style: LineStyle, owner?: string, closed?: boolean) => paths.push({ points, style, ...(owner ? { owner } : {}), ...(closed ? { closed } : {}) });
  const text = (at: Vec2, value: string, size = textSize, align: Text['align'] = 'center', owner?: string, bold?: boolean) => texts.push({ at, text: value, size, align, ...(owner ? { owner } : {}), ...(bold ? { bold } : {}) });

  // The frame and the title block, in the bottom right corner.
  line([[margin, margin], [width - margin, margin], [width - margin, height - margin], [margin, height - margin]], 'frame', undefined, true);
  frameTitle(document, width, line, text, input.material);

  // Views: each maps its model millimetres to the sheet.
  const scaleOf = (view: DrawingView) => view.scale ?? document.sheet.scale;
  const placements = new Map<string, { toSheet: (p: Vec2) => Vec2; scale: number }>();
  for (const view of document.views.filter((v) => !v.detail)) {
    const geometry = input.geometry.get(view.id);
    const scale = scaleOf(view);
    if (!geometry || 'error' in geometry) {
      views.push({ id: view.id, min: sub(view.at, [20, 10]), max: add(view.at, [20, 10]), error: geometry && 'error' in geometry ? geometry.error : 'Loading…' });
      text(view.at, geometry && 'error' in geometry ? geometry.error : 'Loading…', textSize, 'center', view.id);
      continue;
    }
    const center = mid(geometry.box.min, geometry.box.max);
    const toSheet = (p: Vec2): Vec2 => add(view.at, mul(sub(p, center), scale));
    placements.set(view.id, { toSheet, scale });
    for (const points of joined(geometry.visible)) line(points.map(toSheet), 'visible', view.id);
    for (const points of joined(geometry.thin ?? [])) line(points.map(toSheet), 'thin', view.id);
    if (view.hidden) for (const points of joined(geometry.hidden)) line(points.map(toSheet), 'hidden', view.id);
    for (const [a, b] of hatch(geometry.cut.map(([a, b]) => [toSheet(a), toSheet(b)] as const), 3)) line([a, b], 'hatch', view.id);
    for (const p of geometry.points) anchors.push({ view: view.id, kind: 'point', name: p.name, at: toSheet(p.at), ...extra(p) });
    for (const c of geometry.circles) anchors.push({ view: view.id, kind: 'circle', name: c.name, at: toSheet(c.center), radius: c.radius * scale, ...extra(c) });
    for (const l of geometry.lines) anchors.push({ view: view.id, kind: 'line', name: l.name, at: toSheet(mid(l.start, l.end)), start: toSheet(l.start), end: toSheet(l.end), ...extra(l) });
    for (const body of geometry.bodies) instances.push({ view: view.id, instance: body.id.split('#')[0] as string, at: toSheet(body.at) });
    const [min, max] = [toSheet(geometry.box.min), toSheet(geometry.box.max)];
    // A half section's two halves meet at a centre line through the model's middle (CAD-164).
    if (view.section?.half && geometry.cutAt) {
      const { u, v } = viewAxes[view.direction];
      const n = towardsViewer(view.direction);
      const middle = geometry.cutAt.map((c, i) => c - (n[i] as number) * (view.section?.offset ?? 0)) as unknown as Vec3;
      const at = toSheet([dot(middle, u), dot(middle, v)]);
      if (view.section.along === 'v') line([[min[0] - 3, at[1]], [max[0] + 3, at[1]]], 'center', view.id);
      else line([[at[0], min[1] - 3], [at[0], max[1] + 3]], 'center', view.id);
    }
    const note = input.finishing?.has(view.id) ? 'Drawn from the triangles for now: the exact projection takes long and is still being drawn.' : 'Drawn from the triangles: the exact projection took too long.';
    views.push({ id: view.id, min, max, center, scale, ...(geometry.approximate ? { note } : {}) });

    if (view.label) text([view.at[0], min[1] - 7], view.label, 4, 'center', view.id);
  }

  // Details: a circle of their view, larger, and the circle marked on that view.
  for (const view of document.views.filter((v) => v.detail)) {
    const detail = view.detail as NonNullable<DrawingView['detail']>;
    const parent = document.views.find((v) => v.id === detail.of);
    const geometry = input.geometry.get(detail.of);
    const placement = placements.get(detail.of);
    if (!parent || !geometry || 'error' in geometry || !placement) {
      views.push({ id: view.id, min: sub(view.at, [20, 10]), max: add(view.at, [20, 10]), error: 'Its view cannot be drawn.' });
      continue;
    }
    const scale = scaleOf(view);
    const toSheet = (p: Vec2): Vec2 => add(view.at, mul(sub(p, detail.center), scale));
    const curves = [...geometry.visible.map((c) => ['visible', c] as const), ...(geometry.thin ?? []).map((c) => ['thin', c] as const), ...(parent.hidden ? geometry.hidden.map((c) => ['hidden', c] as const) : [])];
    for (const [style, curve] of curves) {
      const points = pointsOf(curve);
      for (let i = 1; i < points.length; i++) {
        const piece = clipToCircle(points[i - 1] as Vec2, points[i] as Vec2, detail.center, detail.radius);
        if (piece) line(piece.map(toSheet), style, view.id);
      }
    }
    const ring = (center: Vec2, radius: number) => Array.from({ length: 65 }, (_, k) => add(center, [radius * Math.cos((k * Math.PI) / 32), radius * Math.sin((k * Math.PI) / 32)]) as Vec2);
    line(ring(view.at, detail.radius * scale), 'thin', view.id);
    const onParent = placement.toSheet(detail.center);
    line(ring(onParent, detail.radius * placement.scale), 'thin', parent.id);
    if (view.label) {
      text([view.at[0], view.at[1] - detail.radius * scale - 7], view.label, 4, 'center', view.id);
      text(add(onParent, [detail.radius * placement.scale + 2, detail.radius * placement.scale]), view.label.replace(/^Detail\s*/i, ''), 4, 'left', parent.id);
    }
    for (const p of geometry.points) if (length(sub(p.at, detail.center)) <= detail.radius) anchors.push({ view: view.id, kind: 'point', name: p.name, at: toSheet(p.at), ...extra(p) });
    for (const c of geometry.circles) if (length(sub(c.center, detail.center)) <= detail.radius) anchors.push({ view: view.id, kind: 'circle', name: c.name, at: toSheet(c.center), radius: c.radius * scale, ...extra(c) });
    placements.set(view.id, { toSheet, scale });
    views.push({ id: view.id, min: sub(view.at, [detail.radius * scale, detail.radius * scale]), max: add(view.at, [detail.radius * scale, detail.radius * scale]), center: detail.center, scale });
  }

  sectionLines(document, input.geometry, placements, views, line, text, arrows);

  const anchorOf = (ref: ViewAnchor) => anchors.find((a) => a.view === ref.view && a.kind === ref.kind && a.name === ref.name);
  const scaleOfView = (id: string) => placements.get(id)?.scale ?? 1;
  const directionOf = (id: string) => document.views.find((v) => v.id === id)?.direction;
  // Where texts may go: inside the frame, off the title block.
  const free = (p: Vec2) => p[0] >= margin && p[0] <= width - margin && p[1] >= margin && p[1] <= height - margin && !(p[0] >= width - margin - 180 && p[1] <= margin + 30);
  for (const annotation of document.annotations) {
    const drawn = annotate(annotation, { anchorOf, scaleOfView, directionOf, free, line, text, arrows, instances, callouts: input.callouts, parts: input.parts });
    if (!drawn) lost.push(annotation.id);
  }
  return { width, height, paths, texts, arrows, anchors, views, instances, lost };
}

/**
 * Marks each section's cutting plane on a view it is taken from (CAD-127): a view of the same
 * source that sees the plane edge on. A chain line across that view, thick at its ends, with arrows
 * the way the section looks and its letter ("Section A-A": A) beside them. An offset section's line
 * steps where its cut does, thick at each turn; a half section's runs from the middle outwards
 * (CAD-164), where that view sees the steps.
 */
function sectionLines(
  document: DrawingDocument,
  geometry: LayoutInput['geometry'],
  placements: ReadonlyMap<string, { toSheet: (p: Vec2) => Vec2; scale: number }>,
  views: readonly { readonly id: string; readonly min: Vec2; readonly max: Vec2 }[],
  line: Tools['line'],
  text: Tools['text'],
  arrows: Arrow[],
): void {
  for (const section of document.views) {
    const drawn = geometry.get(section.id);
    if (!section.section || section.detail || !drawn || 'error' in drawn || !drawn.cutAt) continue;
    const cutAt = drawn.cutAt;
    const normal = towardsViewer(section.direction);
    const from = document.views.find(
      (v) => v.id !== section.id && !v.section && !v.detail && v.direction !== 'iso' && v.source === section.source && v.configuration === section.configuration && placements.has(v.id) && Math.abs(dot(towardsViewer(v.direction), normal)) < 1e-9,
    );
    const placed = from && views.find((v) => v.id === from.id);
    if (!from || !placed) continue;
    const { u, v } = viewAxes[from.direction];
    const { toSheet, scale } = placements.get(from.id) as { toSheet: (p: Vec2) => Vec2; scale: number };
    // The plane's normal seen in that view, and the plane's trace across it.
    const across = unit([dot(normal, u), dot(normal, v)]);
    const cut = section.section;
    const steps = viewAxes[section.direction][cut.along === 'v' ? 'v' : 'u'];
    // Where that view sees the steps, the line runs along them; else straight across.
    const stepping = Math.abs(dot(towardsViewer(from.direction), steps)) < 1e-9;
    const along: Vec2 = stepping ? unit([dot(steps, u), dot(steps, v)]) : [-across[1], across[0]];
    const at = toSheet([dot(cutAt, u), dot(cutAt, v)]);
    const corners: Vec2[] = [placed.min, placed.max, [placed.min[0], placed.max[1]], [placed.max[0], placed.min[1]]];
    const reach = Math.max(...corners.map((c) => Math.abs((c[0] - at[0]) * along[0] + (c[1] - at[1]) * along[1]))) + 4;
    // The line's corners: each piece of the cut at its depth, from the first offset's plane.
    const pieces = stepping ? sectionPieces(cut) : [{ from: -Infinity, to: Infinity, offset: cut.offset }];
    const point = (s: number, offset: number) => add(at, add(mul(along, Math.max(-reach, Math.min(reach, s * scale))), mul(across, (offset - cut.offset) * scale)));
    const path = pieces.flatMap((piece) => [point(piece.from, piece.offset), point(piece.to, piece.offset)]);
    line(path, 'center', section.id);
    // Thick where it turns.
    for (let i = 1; i < path.length - 1; i++) {
      const corner = path[i] as Vec2;
      for (const other of [path[i - 1], path[i + 1]] as Vec2[]) if (length(sub(other, corner)) > 1e-6) line([corner, add(corner, mul(unit(sub(other, corner)), 3))], 'visible', section.id);
    }
    const ends = (cut.half && stepping ? [path.at(-1)] : [path[0], path.at(-1)]) as Vec2[];
    const letter = /^section\s+([^\s-]+)/i.exec(section.label ?? '')?.[1];
    ends.forEach((end, k) => {
      const i = cut.half && stepping ? 1 : k;
      const outwards = mul(along, i ? 1 : -1);
      line([end, sub(end, mul(outwards, 6))], 'visible', section.id);
      // The arrow points the way the section looks: away from the viewer.
      const tip = sub(end, mul(across, 7));
      line([end, tip], 'thin', section.id);
      arrows.push({ tip, direction: mul(across, -1), owner: section.id });
      if (letter) text(add(tip, add(mul(outwards, 3), [0, -1.5])), letter, 5, 'center', section.id, true);
    });
  }
}

interface Tools {
  readonly anchorOf: (ref: ViewAnchor) => SheetAnchor | undefined;
  readonly scaleOfView: (view: string) => number;
  /** Where a view looks from: lengths on isometric views are measured in the model (CAD-165). */
  readonly directionOf: (view: string) => ViewDirection | undefined;
  /** Whether a sheet point is free for text: inside the frame, off the title block. */
  readonly free: (p: Vec2) => boolean;
  readonly line: (points: readonly Vec2[], style: LineStyle, owner?: string, closed?: boolean) => void;
  readonly text: (at: Vec2, value: string, size?: number, align?: Text['align'], owner?: string, bold?: boolean) => void;
  readonly arrows: Arrow[];
  readonly instances: readonly { readonly view: string; readonly instance: string; readonly at: Vec2 }[];
  readonly callouts: ReadonlyMap<string, readonly string[]>;
  readonly parts: ReadonlyMap<string, PartsList>;
}

/** The point an anchor stands for: a point, a circle's centre, a line's middle. */
const pointOf = (anchor: SheetAnchor): Vec2 => anchor.at;

/** Draws one annotation; false when what it is attached to is gone. */
function annotate(a: DrawingAnnotation, t: Tools): boolean {
  const { line, text, arrows } = t;
  const arrow = (tip: Vec2, direction: Vec2) => arrows.push({ tip, direction: unit(direction), owner: a.id });
  switch (a.kind) {
    case 'dimension': {
      const found = a.anchors.map(t.anchorOf);
      if (found.some((f) => !f)) return false;
      const [p, q] = found as SheetAnchor[];
      const scale = t.scaleOfView(a.anchors[0]?.view ?? '');
      const label = (value: string) => a.text ?? value;
      if (a.type === 'diameter' && p?.kind === 'line' && q?.kind === 'line') return diameterBetween(a, p, q, scale, t);
      if (a.type === 'radius' || a.type === 'diameter') {
        const circle = p as SheetAnchor;
        const r = circle.radius ?? 0;
        const nominal = a.type === 'radius' ? r / scale : (2 * r) / scale;
        const value = valueOf(a, label(a.type === 'radius' ? `R${formatValue(nominal)}` : `⌀${formatValue(nominal)}`), nominal);
        const reach = Math.max(6, a.offset);
        // The leader leaves the circle at the angle asked for, else at the first of four that keeps its text on the sheet (CAD-127).
        const leader = (degrees: number) => {
          const dir: Vec2 = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
          const elbow = add(circle.at, mul(dir, r + reach));
          const side = dir[0] < -1e-9 ? -1 : 1;
          const shelf = Math.max(6, widthOf(value) + 2);
          return { dir, elbow, side, shelf };
        };
        const fits = ({ elbow, side, shelf }: ReturnType<typeof leader>) => [elbow, add(elbow, [side * shelf, 0]), add(elbow, [side * shelf, textSize + 1.5]), add(elbow, [0, textSize + 1.5])].every(t.free);
        const { dir, elbow, side, shelf } = a.angle !== undefined ? leader(a.angle) : ([45, 135, 315, 225].map(leader).find(fits) ?? leader(45));
        const to = add(circle.at, mul(dir, r));
        line([a.type === 'radius' ? to : add(circle.at, mul(dir, -r)), elbow, add(elbow, [side * shelf, 0])], 'thin', a.id);
        if (a.type === 'diameter') arrow(add(circle.at, mul(dir, -r)), mul(dir, -1));
        arrow(to, a.type === 'radius' ? mul(dir, -1) : dir);
        writeValue(t, value, add(elbow, [side, 1.2]), side > 0 ? 'left' : 'right', a.id);
        return true;
      }
      if (a.type === 'angle') {
        const [l1, l2] = [p, q] as [SheetAnchor, SheetAnchor];
        const [a1, b1, a2, b2] = [l1.start, l1.end, l2.start, l2.end] as Vec2[];
        const d1 = sub(b1 as Vec2, a1 as Vec2);
        const d2 = sub(b2 as Vec2, a2 as Vec2);
        const denominator = d1[0] * d2[1] - d1[1] * d2[0];
        if (Math.abs(denominator) < 1e-9) return false;
        const s = (((a2 as Vec2)[0] - (a1 as Vec2)[0]) * d2[1] - ((a2 as Vec2)[1] - (a1 as Vec2)[1]) * d2[0]) / denominator;
        const corner = add(a1 as Vec2, mul(d1, s));
        // Each line from the corner towards its far end.
        const away = (x: Vec2, y: Vec2) => unit(length(sub(x, corner)) > length(sub(y, corner)) ? sub(x, corner) : sub(y, corner));
        const [u1, u2] = [away(a1 as Vec2, b1 as Vec2), away(a2 as Vec2, b2 as Vec2)];
        const angle = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
        const radius = Math.max(8, a.offset);
        const start = Math.atan2(u1[1], u1[0]);
        const cross = u1[0] * u2[1] - u1[1] * u2[0];
        const turn = cross >= 0 ? angle : -angle;
        const arc = Array.from({ length: 25 }, (_, k) => add(corner, mul([Math.cos(start + (turn * k) / 24), Math.sin(start + (turn * k) / 24)], radius)) as Vec2);
        line(arc, 'thin', a.id);
        const end = start + turn;
        arrow(arc[0] as Vec2, [Math.sin(start) * Math.sign(turn), -Math.cos(start) * Math.sign(turn)]);
        arrow(arc[24] as Vec2, [-Math.sin(end) * Math.sign(turn), Math.cos(end) * Math.sign(turn)]);
        const middle = start + turn / 2;
        const degrees = (angle * 180) / Math.PI;
        writeValue(t, valueOf(a, label(`${formatValue(degrees)}°`), degrees), add(corner, mul([Math.cos(middle), Math.sin(middle)], radius + 4)), 'center', a.id);
        return true;
      }
      if (a.axis) return alongAxis(a, p as SheetAnchor, q as SheetAnchor, scale, t);
      const [from, to] = [pointOf(p as SheetAnchor), pointOf(q as SheetAnchor)];
      // Where the dimension line runs, and the direction it measures along.
      let [q1, q2]: [Vec2, Vec2] = [from, to];
      let value: number;
      if (a.type === 'horizontal') {
        const y = (a.offset >= 0 ? Math.max(from[1], to[1]) : Math.min(from[1], to[1])) + a.offset;
        [q1, q2] = [[from[0], y], [to[0], y]];
        value = Math.abs(to[0] - from[0]);
      } else if (a.type === 'vertical') {
        const x = (a.offset >= 0 ? Math.max(from[0], to[0]) : Math.min(from[0], to[0])) + a.offset;
        [q1, q2] = [[x, from[1]], [x, to[1]]];
        value = Math.abs(to[1] - from[1]);
      } else {
        const d = unit(sub(to, from));
        const normal: Vec2 = [-d[1], d[0]];
        [q1, q2] = [add(from, mul(normal, a.offset)), add(to, mul(normal, a.offset))];
        value = length(sub(to, from));
        // On an isometric view the length on the sheet is not the length in the model: the model's (CAD-165).
        if (t.directionOf(a.anchors[0]?.view ?? '') === 'iso' && p?.model && q?.model) value = Math.hypot(p.model[0] - q.model[0], p.model[1] - q.model[1], p.model[2] - q.model[2]) * scale;
      }
      // Extension lines from the geometry (a small gap) past the dimension line.
      for (const [base, end] of [[from, q1], [to, q2]] as const) {
        const out = sub(end, base);
        if (length(out) > 1) line([add(base, mul(unit(out), 1)), add(end, mul(unit(out), 2))], 'thin', a.id);
      }
      line([q1, q2], 'thin', a.id);
      arrow(q1, sub(q1, q2));
      arrow(q2, sub(q2, q1));
      const along = unit(sub(q2, q1));
      const side: Vec2 = a.type === 'vertical' ? [-2, 0] : [-along[1] * 1.5, Math.abs(along[0]) * 1.5];
      writeValue(t, valueOf(a, label(formatValue(value / scale)), value / scale), add(mid(q1, q2), side), a.type === 'vertical' ? 'right' : 'center', a.id);
      return true;
    }
    case 'surface-finish':
      return surfaceFinish(a, t);
    case 'note': {
      const lines = a.text.split('\n');
      lines.forEach((value, i) => text([a.at[0], a.at[1] - i * 5], value, textSize, 'left', a.id));
      if (a.leader) {
        line([[a.at[0] - 1, a.at[1] + 1], a.leader], 'thin', a.id);
        arrow(a.leader, sub(a.leader, a.at));
      }
      return true;
    }
    case 'center-mark': {
      const circle = t.anchorOf(a.circle);
      if (!circle) return false;
      const r = (circle.radius ?? 0) + 2;
      line([add(circle.at, [-r, 0]), add(circle.at, [r, 0])], 'center', a.id);
      line([add(circle.at, [0, -r]), add(circle.at, [0, r])], 'center', a.id);
      return true;
    }
    case 'center-line': {
      const [p, q] = [t.anchorOf(a.a), t.anchorOf(a.b)];
      if (!p || !q) return false;
      const d = unit(sub(q.at, p.at));
      line([sub(p.at, mul(d, 3)), add(q.at, mul(d, 3))], 'center', a.id);
      return true;
    }
    case 'callout': {
      const circle = t.anchorOf(a.circle);
      if (!circle) return false;
      const toward = unit(sub(a.at, circle.at));
      const on = add(circle.at, mul(toward, circle.radius ?? 0));
      line([on, a.at], 'thin', a.id);
      arrow(on, mul(toward, -1));
      (t.callouts.get(a.id) ?? ['?']).forEach((value, i) => text([a.at[0] + 1, a.at[1] + 1 - i * 5], value, textSize, 'left', a.id));
      return true;
    }
    case 'balloon': {
      const where = t.instances.find((i) => i.view === a.view && i.instance === a.instance);
      const item = t.parts.get(a.view)?.items.get(a.instance);
      if (!where || item === undefined) return false;
      const radius = 4;
      const ring = Array.from({ length: 33 }, (_, k) => add(a.at, [radius * Math.cos((k * Math.PI) / 16), radius * Math.sin((k * Math.PI) / 16)]) as Vec2);
      line(ring, 'thin', a.id);
      line([add(a.at, mul(unit(sub(where.at, a.at)), radius)), where.at], 'thin', a.id);
      text([a.at[0], a.at[1] - 1.3], String(item), textSize, 'center', a.id);
      return true;
    }
    case 'parts-list': {
      const list = t.parts.get(a.view);
      if (!list) return false;
      const widths = [12, 70, 16, 32];
      const total = widths.reduce((s, w) => s + w, 0);
      const left = a.at[0] - total;
      const rowHeight = 7;
      const rows = [{ item: 'Item', name: 'Part', count: 'Count', material: 'Material' }, ...list.rows.map((r) => ({ item: String(r.item), name: r.name, count: String(r.count), material: r.material }))];
      rows.forEach((row, i) => {
        const top = a.at[1] - i * rowHeight;
        line([[left, top - rowHeight], [a.at[0], top - rowHeight]], 'thin', a.id);
        let x = left;
        [row.item, row.name, row.count, row.material].forEach((value, k) => {
          text([x + 1.5, top - rowHeight + 2], value, 3, 'left', a.id, i === 0);
          x += widths[k] as number;
        });
      });
      const bottom = a.at[1] - rows.length * rowHeight;
      line([[left, a.at[1]], [a.at[0], a.at[1]]], 'thin', a.id);
      let x = left;
      for (const w of [0, ...widths]) {
        x += w;
        line([[x, a.at[1]], [x, bottom]], 'thin', a.id);
      }
      return true;
    }
  }
}

/**
 * A diameter between two outlines of a cylinder seen from its side (CAD-127): the distance between
 * the two parallel lines, measured across them past the end of the first by `offset`.
 */
function diameterBetween(a: Extract<DrawingAnnotation, { kind: 'dimension' }>, p: SheetAnchor, q: SheetAnchor, scale: number, t: Tools): boolean {
  const [a1, b1, a2, b2] = [p.start, p.end, q.start, q.end];
  if (!a1 || !b1 || !a2 || !b2) return false;
  const along = unit(sub(b1, a1));
  const other = unit(sub(b2, a2));
  if (Math.abs(along[0] * other[1] - along[1] * other[0]) > 0.01) return false;
  const normal: Vec2 = [-along[1], along[0]];
  const gap = (a2[0] - a1[0]) * normal[0] + (a2[1] - a1[1]) * normal[1];
  // Across both lines, beyond the end of the first that reaches further.
  const end = (b1[0] - a1[0]) * along[0] + (b1[1] - a1[1]) * along[1] > 0 ? b1 : a1;
  const q1 = add(end, mul(along, a.offset));
  const q2 = add(q1, mul(normal, gap));
  const foot = add(end, mul(normal, gap));
  for (const [base, tip] of [[end, q1], [foot, q2]] as const) if (length(sub(tip, base)) > 1) t.line([add(base, mul(unit(sub(tip, base)), 1)), add(tip, mul(unit(sub(tip, base)), 2))], 'thin', a.id);
  t.line([q1, q2], 'thin', a.id);
  t.arrows.push({ tip: q1, direction: unit(sub(q1, q2)), owner: a.id }, { tip: q2, direction: unit(sub(q2, q1)), owner: a.id });
  const nominal = Math.abs(gap) / scale;
  writeValue(t, valueOf(a, a.text ?? `⌀${formatValue(nominal)}`, nominal), add(mid(q1, q2), mul(along, 2)), 'center', a.id);
  return true;
}

type Dimension = Extract<DrawingAnnotation, { kind: 'dimension' }>;

/** A dimension's text: its value with the tolerance inline (±, a fit), or stacked deviations after it, or the limits of size stacked in its place (CAD-165). */
type ValueText = { readonly inline: string } | { readonly main: string; readonly upper: string; readonly lower: string; readonly size: number };

/** A deviation with its sign (none on zero), to a thousandth of a millimetre. */
const deviation = (v: number, signed = true) => (Math.abs(v) < 5e-7 ? '0' : `${signed ? (v > 0 ? '+' : '-') : ''}${String(Math.round(Math.abs(v) * 1000) / 1000)}`);

function valueOf(a: Dimension, main: string, nominal: number): ValueText {
  const tolerance: Tolerance | undefined = a.tolerance;
  if (!tolerance) return { inline: main };
  switch (tolerance.kind) {
    case 'symmetric':
      return { inline: `${main} ±${deviation(tolerance.value, false)}` };
    case 'fit': {
      const fit = fitOf(tolerance.fit, nominal);
      if ('error' in fit) return { inline: `${main} ${tolerance.fit}` };
      const values = tolerance.deviations ? ` (${fit.deviations.map((d) => `${deviation(d.upper)}/${deviation(d.lower)}`).join(', ')})` : '';
      return { inline: `${main} ${fit.text}${values}` };
    }
    case 'deviations':
      return { main, upper: deviation(tolerance.upper), lower: deviation(tolerance.lower), size: textSize * 0.7 };
    case 'limits': {
      // The largest and smallest size, with the value's sign (⌀, R) before each.
      const sign = /^[⌀R]/.exec(main)?.[0] ?? '';
      const size = (v: number) => `${sign}${String(Math.round(v * 1000) / 1000)}`;
      return { main: '', upper: size(nominal + tolerance.upper), lower: size(nominal + tolerance.lower), size: textSize * 0.8 };
    }
  }
}

/** About how wide a text is on the sheet (Helvetica averages 0.6 of its size). */
const textWidth = (value: string, size: number) => value.length * size * 0.62;

function widthOf(value: ValueText): number {
  if ('inline' in value) return textWidth(value.inline, textSize);
  const stack = Math.max(textWidth(value.upper, value.size), textWidth(value.lower, value.size));
  return value.main ? textWidth(value.main, textSize) + 1 + stack : stack;
}

/** Writes a dimension's text with its baseline at `at`, aligned as a single text would be. */
function writeValue(t: Tools, value: ValueText, at: Vec2, align: Text['align'], owner: string): void {
  if ('inline' in value) return t.text(at, value.inline, textSize, align, owner);
  const total = widthOf(value);
  const left = align === 'left' ? at[0] : align === 'right' ? at[0] - total : at[0] - total / 2;
  if (value.main) t.text([left, at[1]], value.main, textSize, 'left', owner);
  const x = value.main ? left + textWidth(value.main, textSize) + 1 : left;
  t.text([x, at[1] + value.size * 0.85], value.upper, value.size, 'left', owner);
  t.text([x, at[1] - value.size * 0.45], value.lower, value.size, 'left', owner);
}

const modelAxes: Readonly<Record<'x' | 'y' | 'z', Vec3>> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/**
 * A length along a model axis (CAD-165): its line runs along the axis as the view shows it (on an
 * isometric view, one of the isometric axes), its extension lines along the other axis that the view
 * shows most across it; the value is the distance along the axis in the model.
 */
function alongAxis(a: Dimension, p: SheetAnchor, q: SheetAnchor, scale: number, t: Tools): boolean {
  const direction = t.directionOf(a.anchors[0]?.view ?? '');
  if (!direction || !a.axis) return false;
  const { u, v } = viewAxes[direction];
  const seen = (axis: Vec3): Vec2 => [dot(axis, u), dot(axis, v)];
  const along = seen(modelAxes[a.axis]);
  // An axis seen end on has no length to show.
  if (length(along) < 1e-6) return false;
  const others = (['x', 'y', 'z'] as const).filter((k) => k !== a.axis).map((k) => seen(modelAxes[k]));
  const cross = (m: Vec2, n: Vec2) => m[0] * n[1] - m[1] * n[0];
  const out = unit(others.reduce((best, o) => (Math.abs(cross(unit(along), o)) > Math.abs(cross(unit(along), best)) ? o : best)));
  const d = unit(along);
  // From p to q as so much along the axis and so much along the extension lines.
  const delta = sub(q.at, p.at);
  const det = cross(d, out);
  if (Math.abs(det) < 1e-9) return false;
  const [alpha, beta] = [cross(delta, out) / det, cross(d, delta) / det];
  const s1 = a.offset >= 0 ? a.offset + Math.max(0, beta) : a.offset + Math.min(0, beta);
  const [q1, q2] = [add(p.at, mul(out, s1)), add(q.at, mul(out, s1 - beta))];
  for (const [base, end] of [[p.at, q1], [q.at, q2]] as const) {
    const ext = sub(end, base);
    if (length(ext) > 1) t.line([add(base, mul(unit(ext), 1)), add(end, mul(unit(ext), 2))], 'thin', a.id);
  }
  t.line([q1, q2], 'thin', a.id);
  t.arrows.push({ tip: q1, direction: unit(sub(q1, q2)), owner: a.id }, { tip: q2, direction: unit(sub(q2, q1)), owner: a.id });
  const axis = modelAxes[a.axis];
  const value = p.model && q.model ? Math.abs(dot(sub3(q.model, p.model), axis)) : Math.abs(alpha) / (scale * length(along));
  const side = mul(out, s1 >= 0 ? 2.5 : -2.5);
  writeValue(t, valueOf(a, a.text ?? formatValue(value), value), add(add(mid(q1, q2), side), [0, -1.2]), 'center', a.id);
  return true;
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * A surface finish symbol (ISO 1302, CAD-165): a tick of two legs at 60° to the surface, the short
 * one 1.4 text heights high, the long one three, standing on its edge (at the point nearest `at`, on
 * `at`'s side) or at `at`, with a leader to `leader`. A bar closes it where material is removed, a
 * circle sits in it where none may be; the roughness goes under a bar on the long leg, the method
 * above it.
 */
function surfaceFinish(a: Extract<DrawingAnnotation, { kind: 'surface-finish' }>, t: Tools): boolean {
  let [tip, up]: [Vec2, Vec2] = [a.at, [0, 1]];
  if (a.edge) {
    const edge = t.anchorOf(a.edge);
    if (!edge?.start || !edge.end) return false;
    const along = sub(edge.end, edge.start);
    const share = Math.max(0, Math.min(1, ((a.at[0] - edge.start[0]) * along[0] + (a.at[1] - edge.start[1]) * along[1]) / (length(along) ** 2 || 1)));
    tip = add(edge.start, mul(along, share));
    const normal = unit([-along[1], along[0]]);
    up = (a.at[0] - tip[0]) * normal[0] + (a.at[1] - tip[1]) * normal[1] < 0 ? mul(normal, -1) : normal;
  }
  const right: Vec2 = [up[1], -up[0]];
  const at = (x: number, y: number) => add(tip, add(mul(right, x), mul(up, y)));
  const [short, tall] = [1.4 * textSize, 3 * textSize];
  const slope = Math.tan(Math.PI / 3);
  const words = [a.roughness, a.method].filter((w): w is string => !!w);
  const bar = words.length ? Math.max(8, ...words.map((w) => textWidth(w, textSize) + 2)) : 0;
  t.line([at(-short / slope, short), at(0, 0), at(tall / slope, tall), ...(bar ? [at(tall / slope + bar, tall)] : [])], 'thin', a.id);
  if (a.process === 'removal') t.line([at(-short / slope, short), at(short / slope, short)], 'thin', a.id);
  if (a.process === 'no-removal') {
    // A circle touching both legs: its centre 2r up, so r = height / 3 keeps it under the short leg's top.
    const r = short / 3;
    t.line(Array.from({ length: 33 }, (_, k) => at(r * Math.cos((k * Math.PI) / 16), 2 * r + r * Math.sin((k * Math.PI) / 16))), 'thin', a.id);
  }
  const x = tall / slope + 1;
  if (a.roughness) t.text(at(x, tall - textSize - 0.6), a.roughness, textSize, 'left', a.id);
  if (a.method) t.text(at(x, tall + 1), a.method, textSize, 'left', a.id);
  if (a.leader && !a.edge) {
    t.line([tip, a.leader], 'thin', a.id);
    t.arrows.push({ tip: a.leader, direction: unit(sub(a.leader, tip)), owner: a.id });
  }
  return true;
}


/** The title block: 180 × 30 mm in the frame's bottom right corner. */
function frameTitle(document: DrawingDocument, width: number, line: Tools['line'], text: Tools['text'], material = ''): void {
  const [right, bottom] = [width - margin, margin];
  const [left, top] = [right - 180, bottom + 30];
  line([[left, bottom], [left, top], [right, top]], 'frame');
  line([[left, bottom + 18], [right, bottom + 18]], 'thin');
  line([[left, bottom + 9], [right, bottom + 9]], 'thin');
  for (const x of [left + 60, left + 120]) line([[x, bottom], [x, bottom + 18]], 'thin');
  const block = document.titleBlock;
  text([left + 3, bottom + 22], block.title || document.name, 6, 'left', undefined, true);
  const scale = document.sheet.scale >= 1 ? `${formatValue(document.sheet.scale)}:1` : `1:${formatValue(1 / document.sheet.scale)}`;
  const cells: [string, string][] = [
    ['No.', block.number],
    ['Scale', scale],
    ['Material', block.material || material],
    ['Drawn', block.drawnBy],
    ['Revision', block.revision],
    ['Sheet', `${document.sheet.size}, ${document.modifiedAt.slice(0, 10)}`],
  ];
  cells.forEach(([label, value], i) => {
    const [x, y] = [left + (i % 3) * 60 + 2, bottom + (i < 3 ? 10.5 : 1.5)];
    text([x, y + 4], label, 2, 'left');
    text([x + 14, y + 1.5], value, 3.5, 'left');
  });
}
