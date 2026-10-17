/**
 * A small 2D renderer for line drawings (sheets of technical drawings): strokes and filled outlines
 * in grey on white, smoothed by drawing at twice the size. Pure TypeScript: RGBA pixels out.
 */

export type Point = readonly [number, number];

export interface VectorPicture {
  /** Pixels; coordinates run right and down from the top left. */
  readonly width: number;
  readonly height: number;
  /** Lines `width` pixels wide; dashes and gaps in pixels, repeated along the line. */
  readonly strokes: readonly { readonly points: readonly Point[]; readonly width: number; readonly dash?: readonly number[]; readonly closed?: boolean; readonly gray?: number }[];
  /** Filled shapes (glyphs, arrowheads): closed outlines, filled even-odd so holes stay open. */
  readonly fills: readonly { readonly outlines: readonly (readonly Point[])[]; readonly gray?: number }[];
}

/** The picture as RGBA pixels (`width × height × 4`) on white. */
export function rasterizeVector(picture: VectorPicture): Uint8Array {
  const factor = 2;
  const [w, h] = [picture.width * factor, picture.height * factor];
  // How dark each fine pixel is, 0 (white) … 255 (black).
  const ink = new Uint8Array(w * h);
  const scaled = (p: Point): Point => [p[0] * factor, p[1] * factor];
  const fill = (outlines: readonly (readonly Point[])[], gray: number) => {
    const edges = outlines.flatMap((outline) => outline.map((p, i) => [scaled(p), scaled(outline[(i + 1) % outline.length] as Point)] as const));
    if (!edges.length) return;
    let [top, bottom] = [Infinity, -Infinity];
    for (const [a, b] of edges) [top, bottom] = [Math.min(top, a[1], b[1]), Math.max(bottom, a[1], b[1])];
    for (let y = Math.max(0, Math.floor(top)); y <= Math.min(h - 1, Math.ceil(bottom)); y++) {
      const row = y + 0.5;
      const xs: number[] = [];
      for (const [a, b] of edges) if ((a[1] <= row && b[1] > row) || (b[1] <= row && a[1] > row)) xs.push(a[0] + ((row - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.max(0, Math.round(xs[i] as number)); x < Math.min(w, Math.round(xs[i + 1] as number)); x++) ink[y * w + x] = Math.max(ink[y * w + x] as number, gray);
      }
    }
  };
  /** A segment as a quad of its width (at least a pixel of the final picture). */
  const segment = (a: Point, b: Point, width: number, gray: number) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const length = Math.hypot(dx, dy) || 1;
    const half = Math.max(width, 1) / 2;
    const [nx, ny] = [(-dy / length) * half, (dx / length) * half];
    // Ends stretched by half the width, so corners of polylines close.
    const [ex, ey] = [(dx / length) * half, (dy / length) * half];
    fill([[[a[0] - ex + nx, a[1] - ey + ny], [b[0] + ex + nx, b[1] + ey + ny], [b[0] + ex - nx, b[1] + ey - ny], [a[0] - ex - nx, a[1] - ey - ny]]], gray);
  };
  for (const stroke of picture.strokes) {
    const gray = stroke.gray ?? 255;
    const points = stroke.closed && stroke.points.length > 2 ? [...stroke.points, stroke.points[0] as Point] : stroke.points;
    const dash = stroke.dash?.length && stroke.dash.every((d) => d > 0) ? stroke.dash : undefined;
    // Where in the dash pattern the line is: dashes carry on across corners.
    let [phase, remaining] = [0, dash?.[0] ?? 0];
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1] as Point, points[i] as Point];
      if (!dash) {
        segment(a, b, stroke.width, gray);
        continue;
      }
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const at = (t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      for (let done = 0; done < length - 1e-9; ) {
        const step = Math.min(remaining, length - done);
        if (phase % 2 === 0) segment(at(done / length), at((done + step) / length), stroke.width, gray);
        done += step;
        remaining -= step;
        if (remaining <= 1e-9) {
          phase = (phase + 1) % dash.length;
          remaining = dash[phase] as number;
        }
      }
    }
  }
  for (const shape of picture.fills) fill(shape.outlines, shape.gray ?? 255);
  // Down to the final size: each pixel the mean of its fine ones.
  const pixels = new Uint8Array(picture.width * picture.height * 4);
  for (let y = 0; y < picture.height; y++)
    for (let x = 0; x < picture.width; x++) {
      let sum = 0;
      for (let j = 0; j < factor; j++) for (let i = 0; i < factor; i++) sum += ink[(y * factor + j) * w + x * factor + i] as number;
      const value = 255 - Math.round(sum / (factor * factor));
      pixels.set([value, value, value, 255], (y * picture.width + x) * 4);
    }
  return pixels;
}
