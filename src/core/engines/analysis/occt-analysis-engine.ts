import { find, type ShapeAccess } from '@core/access/shape';
import {
  type BodyProperties,
  type BodyState,
  type Check,
  fail,
  type ManufacturingProfile,
  type Measurement,
  ok,
  type Result,
  type TopologyRef,
  type Vec3,
} from '@core/contracts';
import { type Edge, type Face, measureShapeSurfaceProperties, measureShapeVolumeProperties } from 'replicad';
import type { AnalysisEngine, ValidationSubject } from './index';
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
    if (refs.length === 0) return fail({ code: 'nothing-picked', message: 'Pick faces or edges to measure.' });
    const elements: (Face | Edge)[] = [];
    for (const ref of refs) {
      const body = bodies.find((b) => b.id === ref.body);
      const named = body && this.shapes.get(body.key);
      const element = named && find(named, ref);
      if (!element) return fail({ code: 'missing-reference', message: `The ${ref.kind} ${ref.name} no longer exists.` });
      elements.push(element);
    }
    return ok(measureElements(elements));
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
