import type { TraceSettings, Vec2 } from '@core/contracts';
import { decodePicture, type Pixels, traceOutlines } from '@core/utilities/picture';
import type { DrawingCurve } from './drawing';

/** Pictures are traced at most this many pixels wide or high; larger ones are averaged down first. */
const traceSize = 1000;
/** A picture's pixels are 1/96 in (CSS pixels), unless a sketch scales it. */
const millimetresPerPixel = 25.4 / 96;

export const defaultTrace: TraceSettings = { threshold: 0.5, smooth: true };

/** The pixels, averaged down by a whole factor so neither side exceeds `traceSize`. */
function reduced(pixels: Pixels): { pixels: Pixels; factor: number } {
  const factor = Math.ceil(Math.max(pixels.width, pixels.height) / traceSize);
  if (factor <= 1) return { pixels, factor: 1 };
  const [width, height] = [Math.floor(pixels.width / factor), Math.floor(pixels.height / factor)];
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sum = [0, 0, 0, 0];
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * pixels.width + x * factor + dx) * 4;
          for (let c = 0; c < 4; c++) sum[c] = (sum[c] as number) + (pixels.data[i + c] as number);
        }
      }
      data.set(sum.map((s) => s / (factor * factor)), (y * width + x) * 4);
    }
  }
  return { pixels: { width, height, data }, factor };
}

/** Béziers through the points of a closed polygon (Catmull–Rom), so the outline is smooth. */
function smoothLoop(points: readonly Vec2[]): DrawingCurve[] {
  const at = (i: number) => points[(i + points.length) % points.length] as Vec2;
  return points.map((p, i) => {
    const [before, next, after] = [at(i - 1), at(i + 1), at(i + 2)];
    const c1: Vec2 = [p[0] + (next[0] - before[0]) / 6, p[1] + (next[1] - before[1]) / 6];
    const c2: Vec2 = [next[0] - (after[0] - p[0]) / 6, next[1] - (after[1] - p[1]) / 6];
    return { kind: 'bezier', points: [p, c1, c2, next] };
  });
}

/**
 * The dark shapes of a picture (PNG, JPEG) as closed outlines in millimetres, y up, the picture's
 * bottom left at the origin: straight pieces, or smooth curves through them.
 */
export async function tracePicture(bytes: Uint8Array, settings: TraceSettings = defaultTrace): Promise<DrawingCurve[]> {
  const { pixels, factor } = reduced(await decodePicture(bytes));
  const loops = traceOutlines(pixels, { threshold: settings.threshold, minimumArea: 9, tolerance: settings.smooth ? 0.9 : 0.6 });
  const scale = millimetresPerPixel * factor;
  return loops.flatMap((loop) => {
    const points = loop.map(([x, y]): Vec2 => [x * scale, (pixels.height - y) * scale]);
    if (settings.smooth && points.length >= 4) return smoothLoop(points);
    return points.map((p, i): DrawingCurve => ({ kind: 'line', start: p, end: points[(i + 1) % points.length] as Vec2 }));
  });
}
