import { place, type ShapeAccess } from '@core/access/shape';
import { fail, type ImportFormat, type Matrix4, ok, type Result, type Sketch, type SketchEntity, type TextOutlines } from '@core/contracts';
import { exportSTEP, type Shape3D } from 'replicad';
import { compensatedCurves, type DrawingCurve, drawingCurves, type KerfCompensation } from './drawing';
import { readDxf, readSvg, sketchEntities } from './drawing-readers';
import { writeDxf } from './dxf';
import { displayMeshes, type MeshImport, meshSolid, readMeshes, solidTriangleLimit, stepSolids, store } from './solid-readers';
import { type TriangleMesh, write3mf, writeObj, writeStl } from './solids';
import { writeSvg } from './svg';

export type DrawingFormat = 'dxf' | 'svg';
export type SolidFormat = 'step' | 'stl' | 'obj' | '3mf';
export type { KerfCompensation } from './drawing';
export type { MeshImport } from './solid-readers';
export { solidTriangleLimit } from './solid-readers';

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
  /** `texts`: the outlines of the sketch's texts, as solving produced them. */
  exportDrawing(sketch: Sketch, format: DrawingFormat, kerf?: KerfCompensation, texts?: TextOutlines): Promise<Uint8Array>;
  /** Solid bodies: STEP keeps exact geometry; STL, OBJ and 3MF are fine triangle meshes. */
  exportBodies(bodies: readonly BodySource[], format: SolidFormat): Promise<Uint8Array>;
  /**
   * Reads a 3D file into solids in Shape Access, as `<key>:<n>` and without names (the Modeling
   * Engine names them when a feature inserts them). Meshes become faceted solids, up to
   * `solidTriangleLimit` triangles. Reading the same key again re-uses the solids.
   */
  readSolids(bytes: Uint8Array, format: SolidFormat, key: string): Promise<Result<readonly string[]>>;
  /**
   * A 3D file for display: flat-shaded meshes with fold edges, triangle count, volume and extent.
   * Meshes of any size; STEP solids are tessellated.
   */
  readMesh(bytes: Uint8Array, format: SolidFormat, key: string): Promise<Result<MeshImport>>;
  /** A DXF or SVG drawing as sketch entities (ids start with `idPrefix`); meeting ends share points. */
  readDrawing(bytes: Uint8Array, format: DrawingFormat, idPrefix: string): Promise<Result<SketchEntity[]>>;
  /** A file in another format: drawings to drawings, 3D files to 3D files (meshes to STEP within the solid limit). */
  convert(bytes: Uint8Array, from: ImportFormat, to: ImportFormat): Promise<Result<Uint8Array>>;
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

const isDrawing = (format: ImportFormat): format is DrawingFormat => format === 'dxf' || format === 'svg';
const drawingReaders: Readonly<Record<DrawingFormat, (bytes: Uint8Array) => DrawingCurve[]>> = { dxf: readDxf, svg: readSvg };

/** Expected failures (unreadable files, unsupported combinations) as results with the reader's message. */
async function attempt<T>(work: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return ok(await work());
  } catch (error) {
    return fail({ code: 'unreadable', message: error instanceof Error ? error.message : String(error) });
  }
}

class DefaultInterchangeEngine implements InterchangeEngine {
  private readonly solidKeys = new Map<string, readonly string[]>();

  constructor(private readonly shapes?: ShapeAccess) {}

  readSolids(bytes: Uint8Array, format: SolidFormat, key: string): Promise<Result<readonly string[]>> {
    return attempt(async () => {
      const shapes = this.kernel();
      await shapes.ready();
      const known = this.solidKeys.get(key);
      if (known?.every((k) => shapes.has(k))) return known;
      const keys = store(shapes, key, await this.solids(bytes, format));
      this.solidKeys.set(key, keys);
      return keys;
    });
  }

  readMesh(bytes: Uint8Array, format: SolidFormat, key: string): Promise<Result<MeshImport>> {
    return attempt(async () => {
      if (format !== 'step') return displayMeshes(await readMeshes(bytes, format), key);
      await this.kernel().ready();
      const solids = await stepSolids(bytes);
      try {
        return { ...displayMeshes(solids.map((shape, i) => readable(fineMesh(`Solid ${i + 1}`, shape))), key), usableAsSolid: true };
      } finally {
        for (const solid of solids) solid.delete();
      }
    });
  }

  readDrawing(bytes: Uint8Array, format: DrawingFormat, idPrefix: string): Promise<Result<SketchEntity[]>> {
    return attempt(() => sketchEntities(drawingReaders[format](bytes), idPrefix));
  }

  convert(bytes: Uint8Array, from: ImportFormat, to: ImportFormat): Promise<Result<Uint8Array>> {
    return attempt(async () => {
      if (from === to) return bytes;
      if (isDrawing(from) || isDrawing(to)) {
        if (!isDrawing(from) || !isDrawing(to)) throw new Error('Drawings convert to drawings, and 3D files to 3D files.');
        return new TextEncoder().encode(drawingWriters[to](drawingReaders[from](bytes)));
      }
      if (from !== 'step' && to !== 'step') return meshWriters[to](await readMeshes(bytes, from));
      const shapes = this.kernel();
      await shapes.ready();
      const solids = await this.solids(bytes, from);
      try {
        const named = solids.map((shape, i) => ({ name: `Solid ${i + 1}`, shape }));
        if (to === 'step') return new Uint8Array(await exportSTEP(named, { unit: 'MM', modelUnit: 'MM' }).arrayBuffer());
        return meshWriters[to](named.map(({ name, shape }) => fineMesh(name, shape)));
      } finally {
        for (const solid of solids) solid.delete();
      }
    });
  }

  private async solids(bytes: Uint8Array, format: SolidFormat): Promise<Shape3D[]> {
    if (format === 'step') return stepSolids(bytes);
    const meshes = await readMeshes(bytes, format);
    const triangles = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
    if (triangles > solidTriangleLimit) {
      throw new Error(`This mesh has ${triangles.toLocaleString('en-US')} triangles; up to ${solidTriangleLimit.toLocaleString('en-US')} can become a solid. Simplify it first.`);
    }
    return meshes.map(meshSolid);
  }

  private kernel(): ShapeAccess {
    if (!this.shapes) throw new Error('Reading solids needs the geometry kernel.');
    return this.shapes;
  }

  async exportDrawing(sketch: Sketch, format: DrawingFormat, kerf?: KerfCompensation, texts?: TextOutlines): Promise<Uint8Array> {
    const curves = kerf ? compensatedCurves(sketch, kerf, texts) : drawingCurves(sketch, texts);
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
      const meshes = loaded.map(({ name, shape }) => fineMesh(name, shape));
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

/** A fine triangle mesh of a solid, for mesh formats. */
function fineMesh(name: string, shape: Shape3D): TriangleMesh {
  const box = shape.boundingBox;
  const tolerance = Math.max(0.005, Math.hypot(box.width, box.height, box.depth) / 5000);
  const mesh = shape.mesh({ tolerance, angularTolerance: 0.1 });
  return { name, positions: mesh.vertices, indices: mesh.triangles };
}

const readable = (mesh: TriangleMesh) => ({ name: mesh.name, positions: Array.from(mesh.positions), indices: Array.from(mesh.indices) });
