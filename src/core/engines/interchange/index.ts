import { ellipseParameter, range } from '@core/utilities/math';
import { guarded, place, type ShapeAccess } from '@core/access/shape';
import {
  fail,
  type ImportFormat,
  isModelFormat,
  type Matrix4,
  type MeshQuality,
  type MeshRepair,
  type ModelFormat,
  ok,
  type ProfileEdge,
  type Result,
  type Sketch,
  type SketchEntity,
  type TextOutlines,
  type TextWeight,
  type TraceSettings,
  type Vec2,
} from '@core/contracts';
import { exportSTEP, type Shape3D } from 'replicad';
import { boardSolids } from './board';
import { modelNames, readKicadBoard } from './kicad';
import { compensatedCurves, type DrawingCurve, drawingCurves, type KerfCompensation } from './drawing';
import { type DrawingText, type ReadDrawing, readDxf, readSvg, sketchEntities } from './drawing-readers';
import { fontSource, type TextFont } from '@core/utilities/text';
import { writeDxf } from './dxf';
import { tracePicture } from './picture-trace';
import { simplifyMeshes, repairMesh } from './mesh-repair';
import { displayMeshes, type MeshFormat, type MeshImport, meshSolid, readMeshes, solidTriangleLimit, stepSolids, store } from './solid-readers';
import { type TriangleMesh, write3mf, writeObj, writeStl } from './solids';
import { writeSvg } from './svg';

export type DrawingFormat = 'dxf' | 'svg';
/** Pictures, which drawings can be traced from. */
export type PictureFormat = 'png' | 'jpg';
export type SolidFormat = 'step' | 'stl' | 'obj' | '3mf';
export type { KerfCompensation } from './drawing';
export type { MeshFormat, MeshImport } from './solid-readers';
export { solidTriangleLimit } from './solid-readers';

/** A mesh file simplified for use as a solid (CAD-169). */
export interface SimplifiedMesh {
  /** The simplified meshes, for display. */
  readonly preview: MeshImport;
  /** The simplified file, in the format of the original. */
  readonly file: Uint8Array;
  /** Triangles of the original. */
  readonly before: number;
  /** What the original needed to be a closed, outward mesh. */
  readonly repair: MeshRepair;
}

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
  /** Outlines to cut and lines to mark (bend lines, apart from the cut), as a drawing. */
  exportOutlines(cuts: readonly ProfileEdge[], marks: readonly ProfileEdge[], format: DrawingFormat): Promise<Uint8Array>;
  /** Solid bodies: STEP keeps exact geometry; STL, OBJ and 3MF are fine triangle meshes. */
  /** One file of the bodies; meshes for STL, 3MF and OBJ at the given quality (STEP stays exact). */
  exportBodies(bodies: readonly BodySource[], format: SolidFormat, quality?: MeshQuality): Promise<Uint8Array>;
  /**
   * Reads a 3D file into solids in Shape Access, as `<key>:<n>` and without names (the Modeling
   * Engine names them when a feature inserts them). Meshes become faceted solids, up to
   * `solidTriangleLimit` triangles. Reading the same key again re-uses the solids. A KiCad board
   * becomes the board, with its hole walls named (`hole:<reference>`), and its parts (CAD-170);
   * `parts` are STEP files for its parts' models, by their `partFiles` names.
   */
  readSolids(bytes: Uint8Array, format: ModelFormat, key: string, parts?: ReadonlyMap<string, Uint8Array>): Promise<Result<readonly string[]>>;
  /**
   * A 3D file for display: flat-shaded meshes with fold edges, triangle count, volume and extent.
   * Meshes of any size; STEP solids and boards are tessellated.
   */
  readMesh(bytes: Uint8Array, format: ModelFormat, key: string, parts?: ReadonlyMap<string, Uint8Array>): Promise<Result<MeshImport>>;
  /**
   * The 3D models a file refers to, by the names STEP files for them have (lower case, without folder
   * and extension): a KiCad board's parts. None for other files.
   */
  partFiles(bytes: Uint8Array, format: ModelFormat): Promise<readonly string[]>;
  /**
   * A mesh file repaired (corners merged, repeated triangles dropped, triangles turned outwards,
   * openings closed) and simplified by quadric error to about `triangles` triangles, as a new file in
   * its own format with a preview (CAD-169).
   */
  simplifyMesh(bytes: Uint8Array, format: MeshFormat, triangles: number, key: string): Promise<Result<SimplifiedMesh>>;
  /**
   * The curves and texts of a DXF or SVG drawing as sketch entities (ids start with `idPrefix`),
   * with the outlines of its texts; of a picture (PNG, JPEG), the outlines of its dark shapes.
   */
  readDrawing(bytes: Uint8Array, format: DrawingFormat | PictureFormat, idPrefix: string, trace?: TraceSettings): Promise<Result<DrawingEntities>>;
  /** A file in another format: drawings to drawings, 3D files to 3D files (meshes to STEP within the solid limit). */
  convert(bytes: Uint8Array, from: ImportFormat, to: ImportFormat, parts?: ReadonlyMap<string, Uint8Array>): Promise<Result<Uint8Array>>;
}

/** One writer per format: adding a format is a local change. */
const drawingWriters: Readonly<Record<DrawingFormat, (curves: readonly DrawingCurve[], marks?: readonly DrawingCurve[]) => string>> = {
  dxf: writeDxf,
  svg: writeSvg,
};

const meshWriters: Readonly<Record<MeshFormat, (meshes: readonly TriangleMesh[]) => Uint8Array>> = {
  stl: writeStl,
  obj: writeObj,
  '3mf': write3mf,
};

const isDrawing = (format: ImportFormat): format is DrawingFormat => format === 'dxf' || format === 'svg';
const isMesh = (format: ImportFormat): format is MeshFormat => format === 'stl' || format === 'obj' || format === '3mf';
const drawingReaders: Readonly<Record<DrawingFormat, (bytes: Uint8Array) => ReadDrawing>> = { dxf: readDxf, svg: readSvg };

/** A drawing read for a sketch: its entities, and the outlines of its texts by text id. */
export interface DrawingEntities {
  readonly entities: SketchEntity[];
  readonly texts: TextOutlines;
  /** The box around its points, circles and text outlines. */
  readonly extent: { readonly min: Vec2; readonly max: Vec2 };
}

function extentOf(entities: readonly SketchEntity[], texts: TextOutlines): DrawingEntities['extent'] {
  const points = new Map(entities.flatMap((e): [string, Vec2][] => (e.kind === 'point' ? [[e.id, [e.x, e.y]]] : [])));
  const corners: Vec2[] = [
    ...points.values(),
    ...entities.flatMap((e): Vec2[] => {
      const c = e.kind === 'circle' ? points.get(e.center) : undefined;
      return c && e.kind === 'circle' ? [[c[0] - e.radius, c[1] - e.radius], [c[0] + e.radius, c[1] + e.radius]] : [];
    }),
    ...[...texts.values()].flat(2).flatMap((edge) => [edge.start, edge.end]),
  ];
  const [xs, ys] = [range(corners.map((p) => p[0])), range(corners.map((p) => p[1]))];
  return { min: [xs[0], ys[0]], max: [xs[1], ys[1]] };
}

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

  constructor(
    private readonly shapes?: ShapeAccess,
    private readonly fonts: (weight: TextWeight) => Promise<TextFont> = fontSource(),
  ) {}

  /** A drawing's text laid out: capital height, and where its baseline starts once aligned. */
  private async placed(t: DrawingText): Promise<{ font: TextFont; at: Vec2; height: number }> {
    const font = await this.fonts(t.weight);
    const height = t.em ? t.height * font.capRatio : t.height;
    const back = t.align === 'start' ? 0 : t.align === 'middle' ? font.advance(t.text, height) / 2 : font.advance(t.text, height);
    return { font, height, at: [t.at[0] - Math.cos(t.angle) * back, t.at[1] - Math.sin(t.angle) * back] };
  }

  /** The texts of a drawing as curves (for conversion between formats). */
  private async outlines(texts: readonly DrawingText[]): Promise<DrawingCurve[]> {
    const curves: DrawingCurve[] = [];
    for (const t of texts) {
      const { font, at, height } = await this.placed(t);
      for (const edge of font.outline(t.text, { at, height, angle: t.angle }).flat()) {
        curves.push(edge.kind === 'line' ? { kind: 'line', start: edge.start, end: edge.end } : { kind: 'bezier', points: [edge.start, edge.c1, edge.c2, edge.end] });
      }
    }
    return curves;
  }

  readSolids(bytes: Uint8Array, format: ModelFormat, key: string, parts?: ReadonlyMap<string, Uint8Array>): Promise<Result<readonly string[]>> {
    return attempt(async () => {
      const shapes = this.kernel();
      await shapes.ready();
      const known = this.solidKeys.get(key);
      if (known?.every((k) => shapes.has(k))) return known;
      let keys: string[];
      if (format === 'kicad_pcb') {
        const { solids } = await this.board(bytes, parts);
        keys = store(shapes, key, [solids.board.shape, ...(solids.parts ? [solids.parts] : [])], [solids.board.faces]);
      } else keys = store(shapes, key, await this.solids(bytes, format));
      this.solidKeys.set(key, keys);
      return keys;
    });
  }

  readMesh(bytes: Uint8Array, format: ModelFormat, key: string, parts?: ReadonlyMap<string, Uint8Array>): Promise<Result<MeshImport>> {
    return attempt(async () => {
      if (isMesh(format)) return displayMeshes(await readMeshes(bytes, format), key);
      await this.kernel().ready();
      if (format === 'kicad_pcb') {
        const { board, solids } = await this.board(bytes, parts);
        try {
          const meshes = [readable(meshOf('Board', solids.board.shape, 'normal')), ...(solids.parts ? [readable(meshOf('Parts', solids.parts, 'normal'))] : [])];
          const summary = { thickness: board.thickness, holes: board.holes.length, mountingHoles: board.mountingHoles, parts: board.parts.length, models: solids.models };
          return { ...displayMeshes(meshes, key), usableAsSolid: true, board: summary };
        } finally {
          solids.board.shape.delete();
          solids.parts?.delete();
        }
      }
      const solids = await stepSolids(bytes);
      try {
        return { ...displayMeshes(solids.map((shape, i) => readable(meshOf(`Solid ${i + 1}`, shape, 'normal'))), key), usableAsSolid: true };
      } finally {
        for (const solid of solids) solid.delete();
      }
    });
  }

  simplifyMesh(bytes: Uint8Array, format: MeshFormat, triangles: number, key: string): Promise<Result<SimplifiedMesh>> {
    return attempt(async () => {
      if (!(triangles >= 4)) throw new Error('Simplify to at least 4 triangles.');
      const meshes = await readMeshes(bytes, format);
      const before = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
      const simplified = simplifyMeshes(meshes, Math.round(triangles));
      return { preview: displayMeshes(simplified.meshes, key), file: meshWriters[format](simplified.meshes), before, repair: simplified.repair };
    });
  }

  async partFiles(bytes: Uint8Array, format: ModelFormat): Promise<readonly string[]> {
    return format === 'kicad_pcb' ? modelNames(new TextDecoder().decode(bytes)) : [];
  }

  /** A KiCad board read and made into solids, with the STEP files of its parts' models. */
  private async board(bytes: Uint8Array, parts?: ReadonlyMap<string, Uint8Array>) {
    const board = readKicadBoard(bytes);
    const wanted = new Set(board.parts.flatMap((p) => p.models.map((m) => m.name)));
    const models = new Map<string, Shape3D[]>();
    for (const [name, step] of parts ?? []) if (wanted.has(name)) models.set(name, await stepSolids(step));
    try {
      return { board, solids: boardSolids(board, models) };
    } finally {
      for (const solids of models.values()) for (const solid of solids) solid.delete();
    }
  }

  readDrawing(bytes: Uint8Array, format: DrawingFormat | PictureFormat, idPrefix: string, trace?: TraceSettings): Promise<Result<DrawingEntities>> {
    return attempt(async () => {
      if (format === 'png' || format === 'jpg') {
        const entities = sketchEntities(await tracePicture(bytes, trace), idPrefix);
        if (!entities.length) throw new Error('No dark shapes were found in the picture. Try a lighter threshold.');
        return { entities, texts: new Map(), extent: extentOf(entities, new Map()) };
      }
      const drawing = drawingReaders[format](bytes);
      const entities = sketchEntities(drawing.curves, idPrefix);
      const texts = new Map<string, readonly (readonly ProfileEdge[])[]>();
      let n = 0;
      // Texts stay texts: editable, with the bundled font.
      for (const t of drawing.texts) {
        const { font, at, height } = await this.placed(t);
        const [anchor, id] = [`${idPrefix}t${++n}`, `${idPrefix}t${++n}`];
        entities.push({ id: anchor, kind: 'point', x: at[0], y: at[1] }, { id, kind: 'text', anchor, text: t.text, height, weight: t.weight, angle: t.angle, construction: false });
        texts.set(id, font.outline(t.text, { at, height, angle: t.angle }).map((contour) => contour.map((edge) => ({ ...edge, source: id }))));
      }
      return { entities, texts, extent: extentOf(entities, texts) };
    });
  }

  convert(bytes: Uint8Array, from: ImportFormat, to: ImportFormat, parts?: ReadonlyMap<string, Uint8Array>): Promise<Result<Uint8Array>> {
    return attempt(async () => {
      if (from === to) return bytes;
      if (!isModelFormat(from) && !isDrawing(from)) throw new Error('Pictures and fonts are not converted; trace a picture into a sketch, or use a font for sketch texts.');
      if (!isModelFormat(to) && !isDrawing(to)) throw new Error('Files convert to drawings and 3D files only.');
      if (isDrawing(from) || isDrawing(to)) {
        if (!isDrawing(from) || !isDrawing(to)) throw new Error('Drawings convert to drawings, and 3D files to 3D files.');
        const drawing = drawingReaders[from](bytes);
        return new TextEncoder().encode(drawingWriters[to]([...drawing.curves, ...(await this.outlines(drawing.texts))]));
      }
      if (to === 'kicad_pcb') throw new Error('3D files are not written as KiCad boards.');
      if (isMesh(from) && isMesh(to)) return meshWriters[to](await readMeshes(bytes, from));
      const shapes = this.kernel();
      await shapes.ready();
      const solids = from === 'kicad_pcb' ? await this.boardShapes(bytes, parts) : await this.solids(bytes, from);
      try {
        const named = solids.map((shape, i) => ({ name: `Solid ${i + 1}`, shape }));
        if (to === 'step') return new Uint8Array(await exportSTEP(named, { unit: 'MM', modelUnit: 'MM' }).arrayBuffer());
        return meshWriters[to](named.map(({ name, shape }) => meshOf(name, shape, 'normal')));
      } finally {
        for (const solid of solids) solid.delete();
      }
    });
  }

  private async boardShapes(bytes: Uint8Array, parts?: ReadonlyMap<string, Uint8Array>): Promise<Shape3D[]> {
    const { solids } = await this.board(bytes, parts);
    return [solids.board.shape, ...(solids.parts ? [solids.parts] : [])];
  }

  private async solids(bytes: Uint8Array, format: Exclude<ModelFormat, 'kicad_pcb'>): Promise<Shape3D[]> {
    if (format === 'step') return stepSolids(bytes);
    const meshes = await readMeshes(bytes, format);
    const triangles = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
    if (triangles > solidTriangleLimit) {
      throw new Error(`This mesh has ${triangles.toLocaleString('en-US')} triangles; up to ${solidTriangleLimit.toLocaleString('en-US')} can become a solid. Simplify it first (Simplify in the imported file's view).`);
    }
    // Open or broken meshes are repaired first; a sound mesh is left as it is (CAD-169).
    return meshes.map((mesh) => meshSolid(repairMesh(mesh).mesh));
  }

  private kernel(): ShapeAccess {
    if (!this.shapes) throw new Error('Reading solids needs the geometry kernel.');
    return this.shapes;
  }

  async exportDrawing(sketch: Sketch, format: DrawingFormat, kerf?: KerfCompensation, texts?: TextOutlines): Promise<Uint8Array> {
    const curves = kerf ? compensatedCurves(sketch, kerf, texts) : drawingCurves(sketch, texts);
    return new TextEncoder().encode(drawingWriters[format](curves));
  }

  async exportOutlines(cuts: readonly ProfileEdge[], marks: readonly ProfileEdge[], format: DrawingFormat): Promise<Uint8Array> {
    return new TextEncoder().encode(drawingWriters[format](cuts.map(edgeCurve), marks.map(edgeCurve)));
  }

  async exportBodies(bodies: readonly BodySource[], format: SolidFormat, quality: MeshQuality = 'normal'): Promise<Uint8Array> {
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
      const meshes = loaded.map(({ name, shape }) => meshOf(name, shape, quality));
      return meshWriters[format](meshes);
    } finally {
      for (const body of loaded) if (body.placed) body.shape.delete();
    }
  }
}

/** Drawings need no kernel; solids need the Shape Access of the geometry worker. */
export function createInterchangeEngine(shapes?: ShapeAccess, fonts?: (weight: TextWeight) => Promise<TextFont>): InterchangeEngine {
  const engine = new DefaultInterchangeEngine(shapes, fonts);
  return shapes ? guarded(engine, shapes) : engine;
}

/** A fine triangle mesh of a solid, for mesh formats. */
/** A profile edge as a drawing curve (arcs counter-clockwise, as drawings keep them). */
function edgeCurve(edge: ProfileEdge): DrawingCurve {
  switch (edge.kind) {
    case 'line':
      return { kind: 'line', start: edge.start, end: edge.end };
    case 'bezier':
      return { kind: 'bezier', points: [edge.start, edge.c1, edge.c2, edge.end] };
    case 'arc': {
      const [from, to] = edge.ccw ? [edge.start, edge.end] : [edge.end, edge.start];
      const startAngle = Math.atan2(from[1] - edge.center[1], from[0] - edge.center[0]);
      const endAngle = Math.atan2(to[1] - edge.center[1], to[0] - edge.center[0]);
      const sweep = (((endAngle - startAngle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
      return { kind: 'arc', center: edge.center, radius: edge.radius, startAngle, sweep };
    }
    case 'ellipse': {
      const ellipse = { center: edge.center, a: edge.a, b: edge.b, rotation: edge.rotation };
      const [from, to] = edge.ccw ? [edge.start, edge.end] : [edge.end, edge.start];
      const start = ellipseParameter(ellipse, from);
      const end = ellipseParameter(ellipse, to);
      const sweep = (((end - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
      return { kind: 'ellipse', ellipse, start, sweep };
    }
  }
}

/** Chordal deviation as a share of the body's diagonal (with a floor in mm), and angular deviation, per quality. */
const meshTolerances: Readonly<Record<MeshQuality, { share: number; floor: number; angle: number }>> = {
  draft: { share: 1 / 1000, floor: 0.02, angle: 0.3 },
  normal: { share: 1 / 5000, floor: 0.005, angle: 0.1 },
  fine: { share: 1 / 20000, floor: 0.001, angle: 0.05 },
};

function meshOf(name: string, shape: Shape3D, quality: MeshQuality): TriangleMesh {
  const box = shape.boundingBox;
  const { share, floor, angle } = meshTolerances[quality];
  const tolerance = Math.max(floor, Math.hypot(box.width, box.height, box.depth) * share);
  const mesh = shape.mesh({ tolerance, angularTolerance: angle });
  return { name, positions: mesh.vertices, indices: mesh.triangles };
}

const readable = (mesh: TriangleMesh) => ({ name: mesh.name, positions: Array.from(mesh.positions), indices: Array.from(mesh.indices) });
