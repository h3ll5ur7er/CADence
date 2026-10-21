import type { Vec2 } from '@core/contracts';

/**
 * KiCad circuit boards (`.kicad_pcb`, KiCad 6 and newer; CAD-170): the board outline from the
 * Edge.Cuts layer, its drilled holes, and its parts' courtyards, heights and 3D models. KiCad keeps Y
 * pointing down; what is read here has Y up, in millimetres, with the board where KiCad puts it.
 */

/** An S-expression: an atom or a list. Quoted atoms lose their quotes. */
export type Sexp = string | Sexp[];

/** Lists that hold nothing a board's shape needs (tracks, zones, nets): skipped while reading. */
const skipped = new Set(['segment', 'arc', 'via', 'zone', 'net', 'group', 'generated', 'embedded_files', 'dimension', 'target', 'image', 'table']);

/** Reads S-expressions; top-level lists of the board named in `skipped` are passed over unread. */
export function parseSexp(text: string): Sexp {
  let at = 0;
  const length = text.length;
  const stack: Sexp[][] = [];
  let root: Sexp | undefined;
  const add = (value: Sexp) => {
    const top = stack[stack.length - 1];
    if (top) top.push(value);
    else root ??= value;
  };
  while (at < length) {
    const c = text.charCodeAt(at);
    if (c === 40 /* ( */) {
      if (stack.length === 1) {
        // A top-level item: skip it whole when it is one of those not needed.
        const head = /^\(\s*([^\s()"]+)/.exec(text.slice(at, at + 40));
        if (head && skipped.has(head[1] as string)) {
          at = closing(text, at);
          continue;
        }
      }
      const list: Sexp[] = [];
      add(list);
      stack.push(list);
      at++;
    } else if (c === 41 /* ) */) {
      stack.pop();
      at++;
    } else if (c === 34 /* " */) {
      let value = '';
      at++;
      while (at < length && text.charCodeAt(at) !== 34) {
        if (text.charCodeAt(at) === 92 /* \ */) at++;
        value += text[at++];
      }
      at++;
      add(value);
    } else if (c <= 32) at++;
    else {
      const start = at;
      while (at < length) {
        const d = text.charCodeAt(at);
        if (d <= 32 || d === 40 || d === 41) break;
        at++;
      }
      add(text.slice(start, at));
    }
  }
  if (!Array.isArray(root)) throw new Error('The file holds no S-expression.');
  return root;
}

/** The index after the list that opens at `start`. */
function closing(text: string, start: number): number {
  let depth = 0;
  for (let at = start; at < text.length; at++) {
    const c = text.charCodeAt(at);
    if (c === 34) {
      for (at++; at < text.length && text.charCodeAt(at) !== 34; at++) if (text.charCodeAt(at) === 92) at++;
    } else if (c === 40) depth++;
    else if (c === 41 && --depth === 0) return at + 1;
  }
  return text.length;
}

const isList = (e: Sexp): e is Sexp[] => Array.isArray(e);
const children = (e: Sexp[], name: string) => e.filter((c): c is Sexp[] => isList(c) && c[0] === name);
const child = (e: Sexp[], name: string) => e.find((c): c is Sexp[] => isList(c) && c[0] === name);
const num = (e: Sexp | undefined) => (typeof e === 'string' ? Number(e) : NaN);
const xy = (e: Sexp[] | undefined): Vec2 | undefined => (e ? [num(e[1]), num(e[2])] : undefined);

/** A piece of an outline: lines and arcs (through a middle point) chain into loops; circles are loops of their own. */
export type BoardSegment =
  | { readonly kind: 'line'; readonly start: Vec2; readonly end: Vec2 }
  | { readonly kind: 'arc'; readonly start: Vec2; readonly mid: Vec2; readonly end: Vec2 }
  | { readonly kind: 'circle'; readonly center: Vec2; readonly radius: number };

/** A closed outline, its segments in order (a circle on its own). */
export type BoardLoop = readonly BoardSegment[];

export interface BoardHole {
  /** `hole:<reference>` when the part has one hole, else `hole:<reference>:<pad>`. */
  readonly name: string;
  readonly center: Vec2;
  readonly diameter: number;
  /** An oval drill: its length (over the round ends) and the direction it runs, in radians. */
  readonly slot?: { readonly length: number; readonly angle: number };
}

export interface BoardModel {
  /** The model's file name without folder and extension, lower case: what a STEP file in the project must be called. */
  readonly name: string;
  readonly offset: readonly [number, number, number];
  readonly rotate: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

export interface BoardPart {
  readonly reference: string;
  readonly side: 'top' | 'bottom';
  /** Where the part sits and how it is turned (radians, counter-clockwise). */
  readonly at: Vec2;
  readonly angle: number;
  /** Its courtyard (or fabrication outline, or the box around its pads) on its side, counter-clockwise. */
  readonly outline: readonly Vec2[];
  /** From the part's `Height` field, in millimetres. */
  readonly height?: number;
  readonly models: readonly BoardModel[];
}

export interface Board {
  readonly thickness: number;
  /** The outline of the board, counter-clockwise. */
  readonly outline: BoardLoop;
  /** Cut-outs inside the outline (Edge.Cuts loops), as they are. */
  readonly cutouts: readonly BoardLoop[];
  readonly holes: readonly BoardHole[];
  readonly parts: readonly BoardPart[];
  /** Holes of parts that have nothing but one hole: mounting holes. */
  readonly mountingHoles: readonly string[];
}

const degrees = Math.PI / 180;

/** A footprint's placement: local KiCad coordinates (Y down) to board coordinates (Y up). */
function placement(at: Vec2, angle: number) {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return ([x, y]: Vec2): Vec2 => [at[0] + x * c + y * s, -at[1] + x * s - y * c];
}

/** Board coordinates of a top-level item (Y flipped). */
const flipY = ([x, y]: Vec2): Vec2 => [x, -y];

/** The segments of a graphic item (gr_* or fp_*), placed. */
function segmentsOf(item: Sexp[], place: (p: Vec2) => Vec2): BoardSegment[] {
  const kind = String(item[0]).slice(3);
  const start = xy(child(item, 'start'));
  const end = xy(child(item, 'end'));
  switch (kind) {
    case 'line':
      return start && end ? [{ kind: 'line', start: place(start), end: place(end) }] : [];
    case 'arc': {
      const mid = xy(child(item, 'mid'));
      return start && mid && end ? [{ kind: 'arc', start: place(start), mid: place(mid), end: place(end) }] : [];
    }
    case 'circle': {
      const center = xy(child(item, 'center'));
      return center && end ? [{ kind: 'circle', center: place(center), radius: Math.hypot(end[0] - center[0], end[1] - center[1]) }] : [];
    }
    case 'rect': {
      if (!start || !end) return [];
      const corners: Vec2[] = ([start, [end[0], start[1]], end, [start[0], end[1]]] as Vec2[]).map(place);
      return corners.map((p, i) => ({ kind: 'line', start: p, end: corners[(i + 1) % 4] as Vec2 }));
    }
    case 'poly': {
      const points = child(item, 'pts');
      if (!points) return [];
      const segments: BoardSegment[] = [];
      let previous: Vec2 | undefined;
      let first: Vec2 | undefined;
      for (const p of points.slice(1)) {
        if (!isList(p)) continue;
        if (p[0] === 'xy') {
          const point = place(xy(p) as Vec2);
          if (previous) segments.push({ kind: 'line', start: previous, end: point });
          first ??= point;
          previous = point;
        } else if (p[0] === 'arc') {
          const [s, m, e] = [xy(child(p, 'start')), xy(child(p, 'mid')), xy(child(p, 'end'))];
          if (!s || !m || !e) continue;
          const [ps, pm, pe] = [place(s), place(m), place(e)];
          if (previous) segments.push({ kind: 'line', start: previous, end: ps });
          segments.push({ kind: 'arc', start: ps, mid: pm, end: pe });
          first ??= ps;
          previous = pe;
        }
      }
      if (previous && first && (previous[0] !== first[0] || previous[1] !== first[1])) segments.push({ kind: 'line', start: previous, end: first });
      return segments;
    }
    case 'curve': {
      const points = (child(item, 'pts')?.slice(1) ?? []).filter(isList).map((p) => place(xy(p) as Vec2));
      if (points.length !== 4) return [];
      // A cubic Bézier, as 16 lines.
      const [a, b, c, d] = points as [Vec2, Vec2, Vec2, Vec2];
      const at = (t: number): Vec2 => [0, 1].map((k) => (1 - t) ** 3 * (a[k] as number) + 3 * (1 - t) ** 2 * t * (b[k] as number) + 3 * (1 - t) * t ** 2 * (c[k] as number) + t ** 3 * (d[k] as number)) as unknown as Vec2;
      return Array.from({ length: 16 }, (_, i) => ({ kind: 'line', start: at(i / 16), end: at((i + 1) / 16) }));
    }
    default:
      return [];
  }
}

const layerOf = (item: Sexp[]) => {
  const layer = child(item, 'layer');
  return layer ? String(layer[1]) : undefined;
};

const near = (a: Vec2, b: Vec2, tolerance: number) => Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;

const reversed = (s: BoardSegment): BoardSegment => (s.kind === 'line' ? { kind: 'line', start: s.end, end: s.start } : s.kind === 'arc' ? { kind: 'arc', start: s.end, mid: s.mid, end: s.start } : s);

/** Chains segments whose ends meet (within `tolerance`) into closed loops; open chains are dropped. */
export function chainLoops(segments: readonly BoardSegment[], tolerance = 1e-3): BoardLoop[] {
  const loops: BoardLoop[] = segments.filter((s) => s.kind === 'circle').map((s) => [s]);
  const open = segments.filter((s): s is Exclude<BoardSegment, { kind: 'circle' }> => s.kind !== 'circle');
  const used = new Uint8Array(open.length);
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const first = open[i] as Exclude<BoardSegment, { kind: 'circle' }>;
    const loop: Exclude<BoardSegment, { kind: 'circle' }>[] = [first];
    let end = first.end;
    while (!near(end, first.start, tolerance)) {
      let next = -1;
      let flip = false;
      for (let j = 0; j < open.length && next < 0; j++) {
        if (used[j]) continue;
        const s = open[j] as Exclude<BoardSegment, { kind: 'circle' }>;
        if (near(s.start, end, tolerance)) next = j;
        else if (near(s.end, end, tolerance)) [next, flip] = [j, true];
      }
      if (next < 0) break;
      used[next] = 1;
      const s = open[next] as Exclude<BoardSegment, { kind: 'circle' }>;
      const placed = (flip ? reversed(s) : s) as Exclude<BoardSegment, { kind: 'circle' }>;
      loop.push(placed);
      end = placed.end;
    }
    if (near(end, first.start, tolerance) && loop.length > 1) {
      // Ends that nearly meet are made to meet exactly.
      const closed = loop.map((s, k) => ({ ...s, end: k === loop.length - 1 ? first.start : (loop[k + 1] as typeof s).start }));
      loops.push(closed);
    }
  }
  return loops;
}

/** Points along a loop: line ends, and arcs and circles in steps of at most 10°. */
export function loopPoints(loop: BoardLoop): Vec2[] {
  const points: Vec2[] = [];
  for (const s of loop) {
    if (s.kind === 'line') points.push(s.start);
    else if (s.kind === 'circle') {
      for (let i = 0; i < 36; i++) points.push([s.center[0] + s.radius * Math.cos((i * Math.PI) / 18), s.center[1] + s.radius * Math.sin((i * Math.PI) / 18)]);
    } else {
      const { center, radius, from, sweep } = arcGeometry(s);
      const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (10 * degrees)));
      for (let i = 0; i < steps; i++) points.push([center[0] + radius * Math.cos(from + (sweep * i) / steps), center[1] + radius * Math.sin(from + (sweep * i) / steps)]);
    }
  }
  return points;
}

/** An arc through three points: its centre, radius, start angle and signed sweep (counter-clockwise positive). */
export function arcGeometry(s: { start: Vec2; mid: Vec2; end: Vec2 }) {
  const [[ax, ay], [bx, by], [cx, cy]] = [s.start, s.mid, s.end];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const angle = (x: number, y: number) => Math.atan2(y - uy, x - ux);
  const [from, through, to] = [angle(ax, ay), angle(bx, by), angle(cx, cy)];
  const ccw = (a: number, b: number) => (((b - a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Counter-clockwise when the middle comes before the end going counter-clockwise from the start.
  const sweep = ccw(from, through) <= ccw(from, to) ? ccw(from, to) : ccw(from, to) - 2 * Math.PI;
  return { center: [ux, uy] as Vec2, radius: Math.hypot(ax - ux, ay - uy), from, sweep };
}

/** Twice the signed area of a polygon (positive counter-clockwise). */
export function signedArea(points: readonly Vec2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [a, b] = [points[i] as Vec2, points[(i + 1) % points.length] as Vec2];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area;
}

/** A loop turned the other way round. */
export const reverseLoop = (loop: BoardLoop): BoardLoop => [...loop].reverse().map(reversed);

const inside = (point: Vec2, polygon: readonly Vec2[]) => {
  let crossings = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = [polygon[i] as Vec2, polygon[j] as Vec2];
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) crossings = !crossings;
  }
  return crossings;
};

/** A length from a field: `11.6`, `11.6 mm`, `0.4 in`, `450 mil`. */
function length(text: string): number | undefined {
  const match = /^\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(mm|in|inch|mil)?\s*$/i.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  return unit === 'in' || unit === 'inch' ? value * 25.4 : unit === 'mil' ? value * 0.0254 : value;
}

const triple = (list: Sexp[] | undefined, fallback: number): [number, number, number] => {
  const values = child(list ?? [], 'xyz');
  return values ? [num(values[1]), num(values[2]), num(values[3])] : [fallback, fallback, fallback];
};

/** The base names of the 3D models a board's parts refer to (lower case, without folder or extension). */
export function modelNames(text: string): string[] {
  return [...new Set([...text.matchAll(/\(model\s+(?:"([^"]+)"|([^\s)]+))/g)].map((m) => baseName((m[1] ?? m[2]) as string)))];
}

const baseName = (path: string) => (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]*$/, '').toLowerCase();

/** A KiCad board: its outline, holes and parts. */
export function readKicadBoard(bytes: Uint8Array): Board {
  const root = parseSexp(new TextDecoder().decode(bytes));
  if (!isList(root) || root[0] !== 'kicad_pcb') throw new Error('This is not a KiCad board (.kicad_pcb).');
  const thickness = num(child(child(root, 'general') ?? [], 'thickness')?.[1]);
  const edges: BoardSegment[] = [];
  const holes: BoardHole[] = [];
  const parts: BoardPart[] = [];
  const mountingHoles: string[] = [];

  for (const item of root) {
    if (!isList(item)) continue;
    if (String(item[0]).startsWith('gr_') && layerOf(item) === 'Edge.Cuts') edges.push(...segmentsOf(item, flipY));
  }

  for (const footprint of root.filter((e): e is Sexp[] => isList(e) && (e[0] === 'footprint' || e[0] === 'module'))) {
    const where = child(footprint, 'at');
    const at: Vec2 = [num(where?.[1]) || 0, num(where?.[2]) || 0];
    const angle = (num(where?.[3]) || 0) * degrees;
    const place = placement(at, angle);
    const side = layerOf(footprint) === 'B.Cu' ? 'bottom' : 'top';
    const properties = new Map(children(footprint, 'property').map((p) => [String(p[1]).toLowerCase(), String(p[2] ?? '')]));
    const reference = properties.get('reference') ?? String(children(footprint, 'fp_text').find((t) => t[1] === 'reference')?.[2] ?? '');
    const graphics = footprint.filter((e): e is Sexp[] => isList(e) && String(e[0]).startsWith('fp_'));
    for (const g of graphics) if (layerOf(g) === 'Edge.Cuts') edges.push(...segmentsOf(g, place));

    // Drilled pads become holes.
    const pads = children(footprint, 'pad');
    const drilled = pads.filter((p) => child(p, 'drill') && (p[2] === 'thru_hole' || p[2] === 'np_thru_hole'));
    const numbers = drilled.map((p) => String(p[1] ?? ''));
    const byNumber = numbers.every((n, i) => n !== '' && numbers.indexOf(n) === i);
    drilled.forEach((pad, i) => {
      const drill = child(pad, 'drill') as Sexp[];
      const oval = drill[1] === 'oval';
      const [w, h] = oval ? [num(drill[2]), num(drill[3])] : [num(drill[1]), num(drill[1])];
      if (!(w > 0)) return;
      const position = child(pad, 'at');
      const local: Vec2 = [num(position?.[1]) || 0, num(position?.[2]) || 0];
      const offset = xy(child(drill, 'offset')) ?? [0, 0];
      // A pad's angle in the file includes the footprint's.
      const padAngle = (num(position?.[3]) || 0) * degrees;
      const center = place([local[0] + offset[0], local[1] + offset[1]]);
      const name = drilled.length === 1 ? `hole:${reference}` : `hole:${reference}:${byNumber ? numbers[i] : i + 1}`;
      const longAlongX = !(h > w);
      holes.push({
        name,
        center,
        diameter: Math.min(w, h || w),
        ...(oval && h > 0 && w !== h ? { slot: { length: Math.max(w, h), angle: padAngle + (longAlongX ? 0 : Math.PI / 2) } } : {}),
      });
    });
    const mounting = drilled.length === 1 && pads.length === 1;
    if (mounting) mountingHoles.push(`hole:${reference}`);

    // Mounting holes and what is only on the board (logos, test marks) are no parts.
    const attributes = child(footprint, 'attr')?.slice(1).map(String) ?? [];
    if (mounting || attributes.includes('board_only')) continue;
    const height = properties.has('height') ? length(properties.get('height') as string) : undefined;
    const models = children(footprint, 'model')
      .filter((m) => !m.includes('hide') && child(m, 'hide')?.[1] !== 'yes')
      .map((m): BoardModel => {
        const old = child(m, 'at');
        const offset = child(m, 'offset') ? triple(child(m, 'offset'), 0) : old ? (triple(old, 0).map((v) => v * 25.4) as [number, number, number]) : ([0, 0, 0] as [number, number, number]);
        return { name: baseName(String(m[1])), offset, rotate: triple(child(m, 'rotate'), 0), scale: triple(child(m, 'scale'), 1) };
      });
    const outline = partOutline(graphics, pads, place, side);
    if (outline) parts.push({ reference, side, at: place([0, 0]), angle, outline, ...(height && height > 0 ? { height } : {}), models });
  }

  const loops = chainLoops(edges);
  if (!loops.length) throw new Error('The board has no closed outline on its Edge.Cuts layer.');
  const shapes = loops.map((loop) => ({ loop, points: loopPoints(loop) }));
  shapes.sort((a, b) => Math.abs(signedArea(b.points)) - Math.abs(signedArea(a.points)));
  const [outer, ...rest] = shapes as [(typeof shapes)[number], ...typeof shapes];
  const outline = signedArea(outer.points) < 0 ? reverseLoop(outer.loop) : outer.loop;
  const cutouts = rest.filter((s) => inside(s.points[0] as Vec2, outer.points)).map((s) => s.loop);
  return {
    thickness: thickness > 0 ? thickness : 1.6,
    outline,
    cutouts,
    holes: holes.filter((h) => inside(h.center, outer.points)),
    parts,
    mountingHoles,
  };
}

/**
 * A part's outline on its side: its courtyard as a polygon when it closes, else the box around the
 * courtyard; without a courtyard, its fabrication outline; without that, the box around its pads.
 */
function partOutline(graphics: readonly Sexp[][], pads: readonly Sexp[][], place: (p: Vec2) => Vec2, side: 'top' | 'bottom'): Vec2[] | undefined {
  const prefix = side === 'top' ? 'F.' : 'B.';
  for (const layer of [`${prefix}CrtYd`, `${prefix}Fab`]) {
    const segments = graphics.filter((g) => layerOf(g) === layer).flatMap((g) => segmentsOf(g, place));
    if (!segments.length) continue;
    const loops = chainLoops(segments, 0.01).map(loopPoints);
    const largest = loops.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];
    if (largest && Math.abs(signedArea(largest)) > 1e-6) return signedArea(largest) < 0 ? largest.reverse() : largest;
    const points = segments.flatMap((s) => (s.kind === 'circle' ? [[s.center[0] - s.radius, s.center[1] - s.radius] as Vec2, [s.center[0] + s.radius, s.center[1] + s.radius] as Vec2] : s.kind === 'arc' ? [s.start, s.mid, s.end] : [s.start, s.end]));
    return box(points);
  }
  const corners = pads.flatMap((pad) => {
    const position = child(pad, 'at');
    const size = xy(child(pad, 'size'));
    if (!size) return [];
    const [x, y] = [num(position?.[1]) || 0, num(position?.[2]) || 0];
    const r = Math.hypot(size[0], size[1]) / 2;
    return [place([x - r, y - r]), place([x + r, y + r]), place([x - r, y + r]), place([x + r, y - r])];
  });
  return corners.length ? box(corners) : undefined;
}

function box(points: readonly Vec2[]): Vec2[] | undefined {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return x1 - x0 > 1e-6 && y1 - y0 > 1e-6 ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] : undefined;
}
