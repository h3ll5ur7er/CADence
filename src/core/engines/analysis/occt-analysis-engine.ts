import { find, place, type ShapeAccess } from '@core/access/shape';
import {
  type BodyProperties,
  type BodyState,
  type Check,
  fail,
  type Interference,
  type ManufacturingProfile,
  type Measurement,
  ok,
  type Result,
  type TopologyRef,
  type Vec3,
} from '@core/contracts';
import { type Edge, type Face, measureShapeSurfaceProperties, measureShapeVolumeProperties, measureVolume, type Shape3D, type Vertex } from 'replicad';
import type { AnalysisEngine, PlacedPart, ValidationSubject } from './index';
import { laserChecks } from './laser';
import { measureElements } from './measure';
import { type LoadedBody, printChecks, triangles, type Triangles } from './printing';

const meshCacheSize = 8;

export class OcctAnalysisEngine implements AnalysisEngine {
  /** Fine meshes by shape key: meshing is most of a check's time (ADR-18), and unchanged bodies keep their keys. */
  private readonly meshes = new Map<string, Triangles>();

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

  async properties(bodies: readonly BodyState[], density: number): Promise<BodyProperties[]> {
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
        mass: (solid.volume * density) / 1000, // mm³ × g/cm³ = 1/1000 g
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

  async interference(parts: readonly PlacedPart[]): Promise<Interference[]> {
    await this.shapes.ready();
    const placed = parts.map((part) => ({
      instance: part.instance,
      shapes: part.bodies.flatMap((b) => {
        const named = this.shapes.get(b.key);
        return named ? [place(named.shape, part.transform)] : [];
      }),
    }));
    const found: Interference[] = [];
    try {
      for (let i = 0; i < placed.length; i++)
        for (let j = i + 1; j < placed.length; j++) {
          const a = placed[i] as (typeof placed)[number];
          const b = placed[j] as (typeof placed)[number];
          let volume = 0;
          let center: Vec3 = [0, 0, 0];
          for (const sa of a.shapes)
            for (const sb of b.shapes) {
              if (!overlaps(sa, sb)) continue;
              const common = sa.clone().intersect(sb.clone()) as Shape3D;
              const v = measureVolume(common);
              if (v > volume) center = common.boundingBox.center as Vec3;
              volume += v;
              common.delete();
            }
          // Touching faces leave slivers of numerical noise, not volume.
          if (volume > 1e-3) found.push({ a: a.instance, b: b.instance, volume, center });
        }
    } finally {
      for (const part of placed) for (const shape of part.shapes) shape.delete();
    }
    return found;
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

/** Bounding boxes overlap (with no slack: touching boxes cannot hold overlapping volume). */
function overlaps(a: Shape3D, b: Shape3D): boolean {
  const [amin, amax] = a.boundingBox.bounds;
  const [bmin, bmax] = b.boundingBox.bounds;
  return [0, 1, 2].every((k) => (amin[k] as number) < (bmax[k] as number) && (bmin[k] as number) < (amax[k] as number));
}
