import { place, type ShapeAccess } from '@core/access/shape';
import type { Matrix4, Sketch } from '@core/contracts';
import { exportSTEP } from 'replicad';
import { compensatedCurves, type DrawingCurve, drawingCurves, type KerfCompensation } from './drawing';
import { writeDxf } from './dxf';
import { type TriangleMesh, write3mf, writeObj, writeStl } from './solids';
import { writeSvg } from './svg';

export type DrawingFormat = 'dxf' | 'svg';
export type SolidFormat = 'step' | 'stl' | 'obj' | '3mf';
export type { KerfCompensation } from './drawing';

/** A body to export: its display name, the key of its shape in Shape Access, and where it goes (assemblies). */
export interface BodySource {
  readonly name: string;
  readonly key: string;
  readonly transform?: Matrix4;
}

/**
 * Translates CADence geometry to exchange formats (docs/Architecture/Components.md#engines).
 * Runs where the shapes live (the geometry worker).
 */
export interface InterchangeEngine {
  /**
   * A solved sketch as a 2D drawing; construction geometry is left out. With `kerf`, the profile
   * outlines are compensated for the laser's cut width (throws when a detail is too small for it).
   */
  exportDrawing(sketch: Sketch, format: DrawingFormat, kerf?: KerfCompensation): Promise<Uint8Array>;
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

  async exportDrawing(sketch: Sketch, format: DrawingFormat, kerf?: KerfCompensation): Promise<Uint8Array> {
    const curves = kerf ? compensatedCurves(sketch, kerf) : drawingCurves(sketch);
    return new TextEncoder().encode(drawingWriters[format](curves));
  }

  async exportBodies(bodies: readonly BodySource[], format: SolidFormat): Promise<Uint8Array> {
    const shapes = this.shapes;
    if (!shapes) throw new Error('Exporting solids needs the geometry kernel.');
    await shapes.ready();
    const loaded = bodies.map((b) => {
      const named = shapes.get(b.key);
      if (!named) throw new Error(`Body ${b.name} has to be rebuilt first.`);
      return { name: b.name, shape: b.transform ? place(named.shape, b.transform) : named.shape, placed: Boolean(b.transform) };
    });
    try {
      if (loaded.length === 0) throw new Error('There are no bodies to export.');
      if (format === 'step') {
        // One named solid per body (per instance in assemblies), as separate products in the STEP file.
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
    } finally {
      for (const body of loaded) if (body.placed) body.shape.delete();
    }
  }
}

/** Drawings need no kernel; solids need the Shape Access of the geometry worker. */
export function createInterchangeEngine(shapes?: ShapeAccess): InterchangeEngine {
  return new DefaultInterchangeEngine(shapes);
}
