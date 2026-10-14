import type { ShapeAccess } from '@core/access/shape';
import type { Sketch } from '@core/contracts';
import { exportSTEP } from 'replicad';
import { type DrawingCurve, drawingCurves } from './drawing';
import { writeDxf } from './dxf';
import { type TriangleMesh, write3mf, writeObj, writeStl } from './solids';
import { writeSvg } from './svg';

export type DrawingFormat = 'dxf' | 'svg';
export type SolidFormat = 'step' | 'stl' | 'obj' | '3mf';

/** A body to export: its display name and the key of its shape in Shape Access. */
export interface BodySource {
  readonly name: string;
  readonly key: string;
}

/**
 * Translates CADence geometry to exchange formats (docs/Architecture/Components.md#engines).
 * Runs where the shapes live (the geometry worker).
 */
export interface InterchangeEngine {
  /** A solved sketch as a 2D drawing; construction geometry is left out. */
  exportDrawing(sketch: Sketch, format: DrawingFormat): Promise<Uint8Array>;
  /** Solid bodies: STEP keeps exact geometry; STL, OBJ and 3MF are fine triangle meshes. */
  exportBodies(bodies: readonly BodySource[], format: SolidFormat): Promise<Uint8Array>;
}

/** One writer per format: adding a format is a local change. */
const drawingWriters: Readonly<Record<DrawingFormat, (curves: readonly DrawingCurve[]) => string>> = {
  dxf: writeDxf,
  svg: writeSvg,
};

const meshWriters: Readonly<Record<Exclude<SolidFormat, 'step'>, (meshes: readonly TriangleMesh[]) => Uint8Array>> = {
  stl: writeStl,
  obj: writeObj,
  '3mf': write3mf,
};

class DefaultInterchangeEngine implements InterchangeEngine {
  constructor(private readonly shapes?: ShapeAccess) {}

  async exportDrawing(sketch: Sketch, format: DrawingFormat): Promise<Uint8Array> {
    return new TextEncoder().encode(drawingWriters[format](drawingCurves(sketch)));
  }

  async exportBodies(bodies: readonly BodySource[], format: SolidFormat): Promise<Uint8Array> {
    const shapes = this.shapes;
    if (!shapes) throw new Error('Exporting solids needs the geometry kernel.');
    await shapes.ready();
    const loaded = bodies.map((b) => {
      const named = shapes.get(b.key);
      if (!named) throw new Error(`Body ${b.name} has to be rebuilt first.`);
      return { name: b.name, shape: named.shape };
    });
    if (loaded.length === 0) throw new Error('There are no bodies to export.');
    if (format === 'step') {
      const blob = exportSTEP(loaded.map(({ name, shape }) => ({ shape, name })), { unit: 'MM', modelUnit: 'MM' });
      return new Uint8Array(await blob.arrayBuffer());
    }
    const meshes = loaded.map(({ name, shape }): TriangleMesh => {
      const box = shape.boundingBox;
      const tolerance = Math.max(0.005, Math.hypot(box.width, box.height, box.depth) / 5000);
      const mesh = shape.mesh({ tolerance, angularTolerance: 0.1 });
      return { name, positions: mesh.vertices, indices: mesh.triangles };
    });
    return meshWriters[format](meshes);
  }
}

/** Drawings need no kernel; solids need the Shape Access of the geometry worker. */
export function createInterchangeEngine(shapes?: ShapeAccess): InterchangeEngine {
  return new DefaultInterchangeEngine(shapes);
}
