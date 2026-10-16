/**
 * Pictures (PNG, JPEG): their size from the file's header, their pixels, and their dark shapes as
 * outlines, for tracing logos and drawings into sketch curves.
 */

export interface PictureSize {
  readonly width: number;
  readonly height: number;
  readonly mediaType: 'image/png' | 'image/jpeg';
}

/** Pixels, 4 bytes (RGBA) each, rows from the top. */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

export type Vec2 = readonly [number, number];

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

/** The size of a PNG or JPEG picture, read from its header; undefined for other files. */
export function pictureSize(bytes: Uint8Array): PictureSize | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (isPng(bytes) && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20), mediaType: 'image/png' };
  if (!isJpeg(bytes)) return undefined;
  // JPEG: walk the markers to a start-of-frame one.
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1] as number;
    const length = view.getUint16(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: view.getUint16(at + 7), height: view.getUint16(at + 5), mediaType: 'image/jpeg' };
    }
    at += 2 + length;
  }
  return undefined;
}

/** A picture's pixels: decoded by the platform where it can (browsers, workers), else PNGs in TypeScript (Node). */
export async function decodePicture(bytes: Uint8Array): Promise<Pixels> {
  const size = pictureSize(bytes);
  if (!size) throw new Error('This is not a PNG or JPEG picture.');
  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function') {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: size.mediaType }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
  }
  if (size.mediaType !== 'image/png') throw new Error('JPEG pictures can only be read in the app.');
  return decodePng(bytes);
}

const inflate = async (data: Uint8Array) => new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());

/** 8-bit PNGs (grey, grey with alpha, RGB, RGBA, palette), not interlaced. */
async function decodePng(bytes: Uint8Array): Promise<Pixels> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlaced = 0;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  while (at < bytes.length) {
    const length = view.getUint32(at);
    const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (name === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      depth = bytes[at + 16] as number;
      type = bytes[at + 17] as number;
      interlaced = bytes[at + 20] as number;
    } else if (name === 'PLTE') palette = data;
    else if (name === 'tRNS') transparency = data;
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || interlaced) throw new Error('Only 8-bit, non-interlaced PNG pictures can be read here.');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels) throw new Error(`PNG colour type ${type} is not supported.`);
  const joined = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  idat.reduce((offset, d) => (joined.set(d, offset), offset + d.length), 0);
  const raw = await inflate(joined);
  const stride = width * channels;
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (rows[y * stride + x - channels] as number) : 0;
      const up = y > 0 ? (rows[(y - 1) * stride + x] as number) : 0;
      const upLeft = y > 0 && x >= channels ? (rows[(y - 1) * stride + x - channels] as number) : 0;
      const value = line[x] as number;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      rows[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = rows.subarray(i * channels, i * channels + channels);
    let rgba: [number, number, number, number];
    if (type === 0) rgba = [s[0] as number, s[0] as number, s[0] as number, 255];
    else if (type === 4) rgba = [s[0] as number, s[0] as number, s[0] as number, s[1] as number];
    else if (type === 2) rgba = [s[0] as number, s[1] as number, s[2] as number, 255];
    else if (type === 6) rgba = [s[0] as number, s[1] as number, s[2] as number, s[3] as number];
    else {
      const index = s[0] as number;
      rgba = [palette?.[index * 3] ?? 0, palette?.[index * 3 + 1] ?? 0, palette?.[index * 3 + 2] ?? 0, transparency?.[index] ?? 255];
    }
    data.set(rgba, i * 4);
  }
  return { width, height, data };
}

export interface TraceOptions {
  /** Pixels darker than this (0 black … 1 white) are traced; transparent ones count as light. */
  readonly threshold: number;
  /** Outlines enclosing fewer square pixels are left out (specks). */
  readonly minimumArea: number;
  /** How far simplified outlines may stray from the pixel edges, in pixels. */
  readonly tolerance: number;
}

/**
 * The outlines of a picture's dark shapes (and the holes in them), as closed polygons in pixel
 * coordinates (y down): pixel edges between dark and light, chained and simplified.
 */
export function traceOutlines(pixels: Pixels, options: TraceOptions): Vec2[][] {
  const { width, height, data } = pixels;
  const dark = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const i = (y * width + x) * 4;
    const alpha = (data[i + 3] as number) / 255;
    const luminance = (0.299 * (data[i] as number) + 0.587 * (data[i + 1] as number) + 0.114 * (data[i + 2] as number)) / 255;
    return alpha * luminance + (1 - alpha) < options.threshold;
  };
  // Directed edges along pixel borders, dark on the left (in y-down coordinates: clockwise around dark).
  const next = new Map<number, number[]>();
  const key = (x: number, y: number) => y * (width + 1) + x;
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const from = key(x0, y0);
    const list = next.get(from);
    if (list) list.push(key(x1, y1));
    else next.set(from, [key(x1, y1)]);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!dark(x, y)) continue;
      if (!dark(x, y - 1)) edge(x, y, x + 1, y);
      if (!dark(x + 1, y)) edge(x + 1, y, x + 1, y + 1);
      if (!dark(x, y + 1)) edge(x + 1, y + 1, x, y + 1);
      if (!dark(x - 1, y)) edge(x, y + 1, x, y);
    }
  }
  const pointOf = (k: number): Vec2 => [k % (width + 1), Math.floor(k / (width + 1))];
  const loops: Vec2[][] = [];
  for (const start of [...next.keys()]) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const loop: number[] = [start];
      let at = start;
      let previous: Vec2 | undefined;
      for (;;) {
        const choices = next.get(at) as number[];
        // Where two dark pixels touch at a corner, keep turning the same way so loops stay simple.
        let index = 0;
        if (choices.length > 1 && previous) {
          const here = pointOf(at);
          const incoming: Vec2 = [here[0] - previous[0], here[1] - previous[1]];
          index = choices.findIndex((c) => {
            const p = pointOf(c);
            const out: Vec2 = [p[0] - here[0], p[1] - here[1]];
            return incoming[0] * out[1] - incoming[1] * out[0] > 0;
          });
          if (index < 0) index = 0;
        }
        const to = choices.splice(index, 1)[0] as number;
        previous = pointOf(at);
        at = to;
        if (at === start) break;
        loop.push(at);
      }
      const polygon = loop.map(pointOf);
      if (Math.abs(area(polygon)) >= options.minimumArea) loops.push(simplify(polygon, options.tolerance));
    }
  }
  return loops.filter((loop) => loop.length >= 3);
}

/** Signed area (shoelace). */
export function area(polygon: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [a, b] = [polygon[i] as Vec2, polygon[(i + 1) % polygon.length] as Vec2];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/** Ramer–Douglas–Peucker on a closed polygon (split at its farthest pair of points). */
function simplify(polygon: readonly Vec2[], tolerance: number): Vec2[] {
  const distance = (p: Vec2, a: Vec2, b: Vec2) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const length = Math.hypot(dx, dy);
    return length === 0 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / length;
  };
  const open = (points: readonly Vec2[]): Vec2[] => {
    if (points.length < 3) return [...points];
    let [best, at] = [0, 0];
    for (let i = 1; i < points.length - 1; i++) {
      const d = distance(points[i] as Vec2, points[0] as Vec2, points[points.length - 1] as Vec2);
      if (d > best) [best, at] = [d, i];
    }
    if (best <= tolerance) return [points[0] as Vec2, points[points.length - 1] as Vec2];
    return [...open(points.slice(0, at + 1)).slice(0, -1), ...open(points.slice(at))];
  };
  const half = Math.floor(polygon.length / 2);
  const first = open([...polygon.slice(0, half + 1)]);
  const second = open([...polygon.slice(half), polygon[0] as Vec2]);
  // The two halves meet at points that may lie on a straight stretch: drop those too.
  const points = [...first.slice(0, -1), ...second.slice(0, -1)];
  for (let i = 0; i < points.length && points.length > 3; ) {
    const [before, after] = [points[(i + points.length - 1) % points.length] as Vec2, points[(i + 1) % points.length] as Vec2];
    if (distance(points[i] as Vec2, before, after) <= tolerance) points.splice(i, 1);
    else i++;
  }
  return points;
}
