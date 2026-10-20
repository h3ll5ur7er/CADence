import { adopt, find, type NamedShape, place, type ShapeAccess } from '@core/access/shape';
import { compose, invertRigid, transformPoint } from '@core/utilities/math';
import {
  type BodyMesh,
  type BodyProperties,
  type BodyState,
  type Check,
  fail,
  type Interference,
  type ManufacturingProfile,
  type Material,
  type Matrix4,
  type Measurement,
  ok,
  type RefShape,
  type Result,
  type SimulationResult,
  type SimulationSetup,
  type TopologyRef,
  type Vec3,
} from '@core/contracts';
import { type Edge, type Face, getOC, measureShapeSurfaceProperties, measureShapeVolumeProperties, measureVolume, type Shape3D, Vertex } from 'replicad';
import type { AnalysisEngine, PlacedPart, ValidationSubject } from './index';
import { laserChecks } from './laser';
import { measureElements, shapeOf } from './measure';
import { type LoadedBody, printChecks, triangles, type Triangles } from './printing';
import { RayCaster } from './ray-caster';
import { simulate } from './simulation';

const meshCacheSize = 8;

export class OcctAnalysisEngine implements AnalysisEngine {
  /** Fine meshes by shape key: meshing is most of a check's time (ADR-18), and unchanged bodies keep their keys. */
  private readonly meshes = new Map<string, Triangles>();
  private readonly volumes = new Map<string, number>();
  private readonly trees = new Map<string, RayCaster>();
  private readonly boxes = new Map<string, readonly [Vec3, Vec3]>();

  constructor(private readonly shapes: ShapeAccess) {}

  async measure(bodies: readonly BodyState[], refs: readonly TopologyRef[]): Promise<Result<Measurement>> {
    await this.shapes.ready();
    if (refs.length === 0) return fail({ code: 'nothing-picked', message: 'Pick faces, edges or vertices to measure.' });
    const elements: (Face | Edge | Vertex)[] = [];
    for (const ref of refs) {
      const body = bodies.find((b) => b.id === ref.body);
      const named = body && this.shapes.get(body.key);
      const element = named && find(named, ref);
      if (!element) return fail({ code: 'missing-reference', message: `The ${ref.kind} ${ref.name} no longer exists.` });
      elements.push(element);
    }
    return ok(measureElements(elements));
  }

  async shapesOf(bodies: readonly BodyState[], refs: readonly TopologyRef[]): Promise<(RefShape | undefined)[]> {
    await this.shapes.ready();
    return refs.map((ref) => {
      if (ref.kind === 'vertex') return undefined;
      const body = bodies.find((b) => b.id === ref.body);
      const named = body && this.shapes.get(body.key);
      try {
        const element = named && find(named, ref);
        return element && !(element instanceof Vertex) ? shapeOf(element) : undefined;
      } catch {
        return undefined;
      }
    });
  }

  async measurePlaced(parts: readonly PlacedPart[], refs: readonly (TopologyRef & { readonly instance: string })[]): Promise<Result<Measurement>> {
    await this.shapes.ready();
    if (refs.length === 0) return fail({ code: 'nothing-picked', message: 'Pick faces, edges or vertices to measure.' });
    const elements: (Face | Edge | Vertex)[] = [];
    try {
      for (const ref of refs) {
        const part = parts.find((p) => p.instance === ref.instance);
        const body = part?.bodies.find((b) => b.id === ref.body);
        const named = body && this.shapes.get(body.key);
        const element = named && find(named, ref);
        if (!part || !element) return fail({ code: 'missing-reference', message: `The ${ref.kind} ${ref.name} no longer exists.` });
        // Where the assembly puts it (the element itself belongs to the stored shape).
        elements.push(place(element as unknown as Shape3D, part.transform) as unknown as Face | Edge | Vertex);
      }
      return ok(measureElements(elements));
    } finally {
      for (const element of elements) element.delete();
    }
  }

  async properties(bodies: readonly BodyState[], density: number, densities?: Readonly<Record<string, number>>): Promise<BodyProperties[]> {
    await this.shapes.ready();
    return bodies.flatMap((body) => {
      const named = this.shapes.get(body.key);
      if (!named) return [];
      const solid = measureShapeVolumeProperties(named.shape);
      const surface = measureShapeSurfaceProperties(named.shape);
      const [min, max] = named.shape.boundingBox.bounds as [Vec3, Vec3];
      const properties: BodyProperties = {
        body: body.id,
        volume: solid.volume,
        area: surface.area,
        mass: (solid.volume * (densities?.[body.id] ?? density)) / 1000, // mm³ × g/cm³ = 1/1000 g
        centerOfMass: solid.centerOfMass,
        box: { min, max },
      };
      solid.delete();
      surface.delete();
      return [properties];
    });
  }

  async validate(subject: ValidationSubject, profile: ManufacturingProfile): Promise<Check[]> {
    await this.shapes.ready();
    const bodies: LoadedBody[] = subject.bodies.flatMap((body) => {
      const named = this.shapes.get(body.key);
      return named ? [{ body, named }] : [];
    });
    return profile.kind === 'print' ? printChecks(bodies, profile, (b) => this.meshOf(b)) : laserChecks(bodies, subject.sketches, profile);
  }

  async interference(parts: readonly PlacedPart[], pairs?: readonly (readonly [string, string])[]): Promise<Interference[]> {
    await this.shapes.ready();
    const wanted = pairs && new Set(pairs.map(([a, b]) => `${a}|${b}`));
    const used = pairs && new Set(pairs.flat());
    // Bodies with their boxes where the parts are (from boxes measured once); solids are placed only for pairs that may meet.
    const items = parts.flatMap((part) => {
      if (used && !used.has(part.instance)) return [];
      const bodies = part.bodies.flatMap((b) => {
        const named = this.shapes.get(b.key);
        return named ? [{ key: b.key, named, transform: part.transform, box: movedBox(this.boxOf(b.key, named), part.transform), placed: undefined as Shape3D | undefined }] : [];
      });
      return [{ instance: part.instance, bodies, volume: part.bodies.reduce((sum, b) => sum + this.volumeOf(b.key), 0) }];
    });
    type Item = (typeof items)[number]['bodies'][number];
    const solid = (item: Item) => (item.placed ??= place(item.named.shape, item.transform));
    const found: Interference[] = [];
    try {
      for (let i = 0; i < items.length; i++)
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i] as (typeof items)[number];
          const b = items[j] as (typeof items)[number];
          if (wanted && !wanted.has(`${a.instance}|${b.instance}`) && !wanted.has(`${b.instance}|${a.instance}`)) continue;
          let volume = 0;
          let center: Vec3 = [0, 0, 0];
          for (const sa of a.bodies)
            for (const sb of b.bodies) {
              // Boxes first, then the meshes: only solids whose surfaces come close, or one inside the other, go to the kernel (CAD-114).
              if (!boxesMeet(sa.box, sb.box) || !this.meshesMeet(sa, sb, least(a.volume, b.volume))) continue;
              const common = intersection(solid(sa), solid(sb));
              const v = measureVolume(common);
              if (v > volume) center = common.boundingBox.center as Vec3;
              volume += v;
              common.delete();
            }
          // Touching faces leave slivers of numerical noise, not volume.
          if (volume > least(a.volume, b.volume)) found.push({ a: a.instance, b: b.instance, volume, center });
        }
    } finally {
      for (const item of items) for (const body of item.bodies) body.placed?.delete();
    }
    return found;
  }

  /**
   * Whether two placed bodies may overlap by more than `least` mm³, by their meshes. Far apart: no.
   * Surfaces within the meshes' tolerance of each other: by how much they pass into each other, from
   * rays through the overlap of their boxes along each axis (each ray's overlap less the tolerance;
   * the least of the three totals), so surfaces that only touch (a piston in its bore) count as touching
   * and are left out of the kernel's boolean, which grows the kernel's memory on every call (CAD-114).
   * Nowhere near: only if one lies inside the other.
   */
  private meshesMeet(a: Placed, b: Placed, least: number): boolean {
    const [meshA, meshB] = [this.meshOf({ body: { id: a.key, key: a.key, name: a.key }, named: a.named }), this.meshOf({ body: { id: b.key, key: b.key, name: b.key }, named: b.named })];
    const [treeA, treeB] = [this.treeOf(a.key, meshA), this.treeOf(b.key, meshB)];
    const slack = meshTolerance(a.named) + meshTolerance(b.named) + 1e-3;
    // B's triangles in A's coordinates.
    const relative = compose(invertRigid(a.transform), b.transform);
    const moved = new Float64Array(meshB.positions.length);
    for (let i = 0; i < meshB.positions.length; i += 3) {
      const p = transformPoint(relative, [meshB.positions[i] as number, meshB.positions[i + 1] as number, meshB.positions[i + 2] as number]);
      moved.set(p, i);
    }
    const triangle = new Float64Array(9);
    let near = false;
    for (let t = 0; t < meshB.indices.length && !near; t += 3) {
      for (let c = 0; c < 3; c++) triangle.set(moved.subarray((meshB.indices[t + c] as number) * 3, (meshB.indices[t + c] as number) * 3 + 3), c * 3);
      near = treeA.meets(triangle, slack) !== 0;
    }
    if (near) return depthVolume(a, b, treeA, treeB, slack) > least;
    // No surfaces near each other: they overlap only if one is inside the other.
    const skew: Vec3 = [0.5773, 0.5774, 0.5774];
    if (moved.length >= 3 && treeA.crossings([moved[0] as number, moved[1] as number, moved[2] as number], skew) % 2 === 1) return true;
    if (meshA.positions.length >= 3) {
      const back = transformPoint(invertRigid(relative), [meshA.positions[0] as number, meshA.positions[1] as number, meshA.positions[2] as number]);
      if (treeB.crossings(back, skew) % 2 === 1) return true;
    }
    return false;
  }

  /** A body's ray caster (its mesh's bounding volume hierarchy), built once. */
  private treeOf(key: string, mesh: Triangles): RayCaster {
    let tree = this.trees.get(key);
    if (!tree) {
      tree = new RayCaster(mesh.positions, mesh.indices);
      this.trees.set(key, tree);
      if (this.trees.size > meshCacheSize) this.trees.delete(this.trees.keys().next().value as string);
    }
    return tree;
  }

  /** A body's bounding box in its own coordinates, measured once. */
  private boxOf(key: string, named: NamedShape): readonly [Vec3, Vec3] {
    let box = this.boxes.get(key);
    if (!box) {
      box = named.shape.boundingBox.bounds as [Vec3, Vec3];
      this.boxes.set(key, box);
      if (this.boxes.size > 2000) this.boxes.delete(this.boxes.keys().next().value as string);
    }
    return box;
  }

  async simulate(meshes: readonly BodyMesh[], setup: SimulationSetup, material: Material, byBody?: Readonly<Record<string, Material>>): Promise<Result<SimulationResult>> {
    return simulate(meshes, setup, material, byBody);
  }

  /** A stored body's volume, measured once. */
  private volumeOf(key: string): number {
    let volume = this.volumes.get(key);
    if (volume === undefined) {
      const named = this.shapes.get(key);
      volume = named ? measureVolume(named.shape) : 0;
      this.volumes.set(key, volume);
      if (this.volumes.size > 2000) this.volumes.delete(this.volumes.keys().next().value as string);
    }
    return volume;
  }

  private meshOf({ body, named }: LoadedBody): Triangles {
    const cached = this.meshes.get(body.key);
    if (cached) return cached;
    const mesh = triangles(named);
    this.meshes.set(body.key, mesh);
    const oldest = this.meshes.keys().next().value;
    if (this.meshes.size > meshCacheSize && oldest !== undefined) this.meshes.delete(oldest);
    return mesh;
  }
}

/**
 * The common part of two solids, its builder freed at once. replicad's `intersect` leaves the builder,
 * with all the boolean's working data, to the garbage collector, and a study's collision check filled
 * the kernel's memory with them before it ran (CAD-114).
 */
function intersection(a: Shape3D, b: Shape3D): Shape3D {
  const builder = new (getOC().BRepAlgoAPI_Common)(a.wrapped, b.wrapped);
  try {
    return adopt(builder.Shape()) as Shape3D;
  } finally {
    builder.delete();
  }
}

/** A body placed for the interference check. */
interface Placed {
  readonly key: string;
  readonly named: NamedShape;
  readonly transform: Matrix4;
  readonly box: readonly [Vec3, Vec3];
}

/** The overlap that counts as interference: more than a ten-thousandth of the smaller part (and 0.001 mm³). */
const least = (a: number, b: number) => Math.max(1e-3, 1e-4 * Math.min(a, b));

/**
 * How much two placed meshes pass into each other (mm³), estimated by rays through the overlap of
 * their boxes along each world axis: each ray adds its overlap less twice the tolerance, times its
 * share of the area; the least of the three axes counts (touching surfaces give none along some axis).
 */
function depthVolume(a: Placed, b: Placed, treeA: RayCaster, treeB: RayCaster, slack: number): number {
  const low = [0, 1, 2].map((k) => Math.max(a.box[0][k] as number, b.box[0][k] as number));
  const high = [0, 1, 2].map((k) => Math.min(a.box[1][k] as number, b.box[1][k] as number));
  if (low.some((v, k) => v >= (high[k] as number))) return 0;
  const cells = 20;
  const [toA, toB] = [invertRigid(a.transform), invertRigid(b.transform)];
  const local = (m: Matrix4, p: Vec3, d: Vec3): [Vec3, Vec3] => {
    const origin = transformPoint(m, p);
    const tip = transformPoint(m, [p[0] + d[0], p[1] + d[1], p[2] + d[2]]);
    return [origin, [tip[0] - origin[0], tip[1] - origin[1], tip[2] - origin[2]]];
  };
  /** The stretches a ray runs inside a closed mesh: between its crossings, in pairs. */
  const inside = (tree: RayCaster, [origin, direction]: [Vec3, Vec3]) => {
    const hits = tree.hits(origin, direction);
    const spans: [number, number][] = [];
    for (let i = 0; i + 1 < hits.length; i += 2) spans.push([hits[i] as number, hits[i + 1] as number]);
    return spans;
  };
  let smallest = Infinity;
  for (const axis of [0, 1, 2] as const) {
    const [u, v] = [((axis + 1) % 3) as 0 | 1 | 2, ((axis + 2) % 3) as 0 | 1 | 2];
    const [du, dv] = [((high[u] as number) - (low[u] as number)) / cells, ((high[v] as number) - (low[v] as number)) / cells];
    const direction: Vec3 = [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0];
    // From outside both boxes, so every ray starts outside both meshes.
    const start = Math.min(a.box[0][axis] as number, b.box[0][axis] as number) - 1;
    let total = 0;
    for (let i = 0; i < cells; i++)
      for (let j = 0; j < cells; j++) {
        const p: [number, number, number] = [0, 0, 0];
        p[axis] = start;
        p[u] = (low[u] as number) + (i + 0.5) * du;
        p[v] = (low[v] as number) + (j + 0.5) * dv;
        const [spansA, spansB] = [inside(treeA, local(toA, p, direction)), inside(treeB, local(toB, p, direction))];
        let overlap = 0;
        for (const [a0, a1] of spansA) for (const [b0, b1] of spansB) overlap += Math.max(0, Math.min(a1, b1) - Math.max(a0, b0) - 2 * slack);
        total += overlap * du * dv;
      }
    smallest = Math.min(smallest, total);
  }
  return smallest;
}

/** A box moved by a rigid transform: the box around its eight corners, moved. */
function movedBox([low, high]: readonly [Vec3, Vec3], transform: Matrix4): readonly [Vec3, Vec3] {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const p = transformPoint(transform, [i & 1 ? high[0] : low[0], i & 2 ? high[1] : low[1], i & 4 ? high[2] : low[2]]);
    for (const k of [0, 1, 2] as const) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  return [min, max];
}

/** Boxes overlap (with no slack: touching boxes cannot hold overlapping volume). */
const boxesMeet = (a: readonly [Vec3, Vec3], b: readonly [Vec3, Vec3]) => [0, 1, 2].every((k) => (a[0][k] as number) < (b[1][k] as number) && (b[0][k] as number) < (a[1][k] as number));

/** How far a body's mesh may lie from its surface (the tolerance `triangles` meshes with). */
function meshTolerance(named: NamedShape): number {
  const box = named.shape.boundingBox;
  return Math.max(0.01, Math.hypot(box.width, box.height, box.depth) / 2000);
}

