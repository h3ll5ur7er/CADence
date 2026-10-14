import type { Sketch } from '@core/contracts';
import { type DrawingCurve, drawingCurves } from './drawing';
import { writeDxf } from './dxf';
import { writeSvg } from './svg';

export type DrawingFormat = 'dxf' | 'svg';

/** Translates CADence geometry to and from exchange formats. Solids (STEP, STL, ...) arrive in phase 3. */
export interface InterchangeEngine {
  /** A solved sketch as a 2D drawing; construction geometry is left out. */
  exportDrawing(sketch: Sketch, format: DrawingFormat): Promise<Uint8Array>;
}

/** One writer per format: adding a format is a local change. */
const drawingWriters: Readonly<Record<DrawingFormat, (curves: readonly DrawingCurve[]) => string>> = {
  dxf: writeDxf,
  svg: writeSvg,
};

class DefaultInterchangeEngine implements InterchangeEngine {
  async exportDrawing(sketch: Sketch, format: DrawingFormat): Promise<Uint8Array> {
    return new TextEncoder().encode(drawingWriters[format](drawingCurves(sketch)));
  }
}

export function createInterchangeEngine(): InterchangeEngine {
  return new DefaultInterchangeEngine();
}
