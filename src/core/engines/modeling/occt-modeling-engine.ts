import type { NamedShape, ShapeAccess } from '@core/access/shape';
import { type BodyMesh, fail, ok, type PlaneFrame, type Result, type TopologyRef, type Vec3 } from '@core/contracts';
import { type Edge, type Face, measureVolume, type Shape3D } from 'replicad';
import { combine, type LoadedBody, renameCopy } from './bodies';
import { cross3, dot3, normalize3, scale3, sub3, toPlane } from './geometry';
import type { AxisInput, BodyState, ModelingEngine, ModelingOutcome, ModelingRequest, ToolInput } from './modeling-engine';
import { nameShape, namedSurfaces, resolve } from './naming';
import { tessellate } from './tessellation';
import { extrudeTool, revolveTool } from './tools';

/** A failure the user can act on, as opposed to a defect. */
class FeatureError extends Error {}

const outcomeCacheSize = 500;

export class OcctModelingEngine implements ModelingEngine {
  private readonly outcomes = new Map<string, ModelingOutcome>();

  constructor(private readonly shapes: ShapeAccess) {}

  async apply(request: ModelingRequest): Promise<ModelingOutcome> {
    await this.shapes.ready();
    const cached = this.outcomes.get(request.key);
    if (cached && this.available(cached)) return cached;
    let outcome: ModelingOutcome;
    try {
      outcome = this.compute(request);
    } catch (error) {
      const message = error instanceof FeatureError ? error.message : `The geometry kernel could not build this feature (${describe(error)}).`;
      outcome = { bodies: request.bodies, error: message };
    }
    this.remember(request.key, outcome);
    return outcome;
  }

  async planeOf(bodies: readonly BodyState[], ref: TopologyRef): Promise<Result<PlaneFrame>> {
    await this.shapes.ready();
    try {
      const face = this.face(this.load(bodies), ref);
      if (face.geomType !== 'PLANE') return fail({ code: 'not-planar', message: 'Sketches and planes need a flat face.' });
      const origin = face.center.toTuple() as Vec3;
      const normal = normalize3(face.normalAt(face.center).toTuple() as Vec3);
      // In-plane axes: the world axis least aligned with the normal, made perpendicular.
      const seed: Vec3 = Math.abs(normal[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
      const v = normalize3(sub3(seed, scale3(normal, dot3(seed, normal))));
      const u = normalize3(cross3(v, normal));
      return ok({ origin, u, v });
    } catch (error) {
      return fail({ code: 'lost-reference', message: describe(error) });
    }
  }

  async tessellate(bodies: readonly BodyState[]): Promise<BodyMesh[]> {
    await this.shapes.ready();
    return this.load(bodies).map((b) => tessellate(b.state, b.named));
  }

  async volumes(bodies: readonly BodyState[]): Promise<Record<string, number>> {
    await this.shapes.ready();
    return Object.fromEntries(this.load(bodies).map((b) => [b.state.id, measureVolume(b.named.shape)]));
  }

  private compute(request: ModelingRequest): ModelingOutcome {
    const bodies = this.load(request.bodies);
    switch (request.type) {
      case 'extrude':
      case 'revolve': {
        if (request.profiles.length === 0) throw new FeatureError('Select at least one profile.');
        const tool =
          request.type === 'extrude'
            ? extrudeTool(request.feature, request.frame, request.profiles, positive(request.distance, 'distance'), request.direction)
            : revolveTool(request.feature, request.frame, request.profiles, this.axis(bodies, request.axis), positive(request.angle, 'angle'));
        const toolKey = `${request.key}:tool`;
        this.shapes.put(toolKey, tool);
        return { ...this.store(combine(bodies, tool, request.operation, request.feature, request.key)), toolKey };
      }
      case 'fillet':
      case 'chamfer':
        return this.treatEdges(request.feature, request.key, bodies, request.edges, positive(request.size, request.type === 'fillet' ? 'radius' : 'distance'), request.type);
      case 'shell':
        return this.shell(request.feature, request.key, bodies, request.faces, positive(request.thickness, 'thickness'));
      case 'linear-pattern': {
        const { direction } = this.axis(bodies, request.direction);
        const step = scale3(normalize3(direction), request.spacing);
        return this.repeat(request.feature, request.key, bodies, request.tools, count(request.count), (shape, i) =>
          shape.translate([...scale3(step, i)]),
        );
      }
      case 'circular-pattern': {
        const axis = this.axis(bodies, request.axis);
        const copies = count(request.count);
        const full = Math.abs(request.angle - 2 * Math.PI) < 1e-9;
        const stepDegrees = ((request.angle / (full ? copies : copies - 1)) * 180) / Math.PI;
        return this.repeat(request.feature, request.key, bodies, request.tools, copies, (shape, i) =>
          shape.rotate(stepDegrees * i, [...axis.origin], [...axis.direction]),
        );
      }
      case 'mirror': {
        const plane = toPlane(request.plane);
        return this.repeat(request.feature, request.key, bodies, request.tools, 2, (shape) => shape.mirror(plane));
      }
    }
  }

  /** Applies each tool's transformed copies (i = 1 … count-1) with the tool's own operation. */
  private repeat(
    feature: string,
    key: string,
    bodies: LoadedBody[],
    tools: readonly ToolInput[],
    copies: number,
    transform: (shape: Shape3D, i: number) => Shape3D,
  ): ModelingOutcome {
    if (tools.length === 0) throw new FeatureError('Select at least one extrude or revolve to repeat.');
    let current = bodies;
    let step = 0;
    for (const input of tools) {
      const tool = this.shapes.get(input.toolKey);
      if (!tool) throw new FeatureError(`The feature ${input.feature} has to be rebuilt first.`);
      for (let i = 1; i < copies; i++) {
        const copy = renameCopy(tool, transform(tool.shape.clone(), i), `@${feature}.${i}`);
        const combined = this.store(combine(current, copy, input.operation, feature, `${key}:${++step}`));
        current = this.load(combined.bodies);
      }
    }
    return { bodies: current.map((b) => b.state) };
  }

  private treatEdges(feature: string, key: string, bodies: LoadedBody[], refs: readonly TopologyRef[], size: number, kind: 'fillet' | 'chamfer'): ModelingOutcome {
    if (refs.length === 0) throw new FeatureError('Select at least one edge.');
    const role = kind === 'fillet' ? 'round' : 'bevel';
    const stored: [string, NamedShape][] = [];
    const result = bodies.map((body) => {
      const mine = refs.filter((r) => r.body === body.state.id);
      if (!mine.length) return body.state;
      const edges = mine.map((ref) => this.element(body, ref) as Edge);
      const filter = (finder: { inList(list: Edge[]): typeof finder }) => finder.inList(edges);
      const shape = kind === 'fillet' ? body.named.shape.fillet(size, filter as never) : body.named.shape.chamfer(size, filter as never);
      // New faces are named after the edge they replace (nearest picked edge).
      const named = nameShape(shape, namedSurfaces(body.named), (face) => `f:${feature}:${role}:${nearestRef(face, mine)}`, feature);
      const state = { id: body.state.id, key: `${key}:${body.state.id}` };
      stored.push([state.key, named]);
      return state;
    });
    if (stored.length === 0) throw new FeatureError('The selected edges belong to no body.');
    return this.store({ bodies: result, stored });
  }

  private shell(feature: string, key: string, bodies: LoadedBody[], refs: readonly TopologyRef[], thickness: number): ModelingOutcome {
    if (refs.length === 0) throw new FeatureError('Select at least one face to open.');
    const bodyId = (refs[0] as TopologyRef).body;
    const body = bodies.find((b) => b.state.id === bodyId);
    if (!body || refs.some((r) => r.body !== bodyId)) throw new FeatureError('Select faces of one body.');
    const faces = refs.map((ref) => this.element(body, ref) as Face);
    const shape = body.named.shape.shell(thickness, (finder) => finder.inList(faces)); // positive: inward
    const named = nameShape(shape, namedSurfaces(body.named), () => `f:${feature}:inner`, feature);
    const state = { id: body.state.id, key: `${key}:${body.state.id}` };
    return this.store({ bodies: bodies.map((b) => (b === body ? state : b.state)), stored: [[state.key, named]] });
  }

  private axis(bodies: LoadedBody[], input: AxisInput): { origin: Vec3; direction: Vec3 } {
    if (!('edge' in input)) return { origin: input.origin, direction: normalize3(input.direction) };
    const body = bodies.find((b) => b.state.id === input.edge.body);
    const edge = body && (this.element(body, input.edge) as Edge);
    if (!edge || edge.geomType !== 'LINE') throw new FeatureError('Pick a straight edge as the axis.');
    const start = edge.startPoint.toTuple() as Vec3;
    return { origin: start, direction: normalize3(sub3(edge.endPoint.toTuple() as Vec3, start)) };
  }

  private face(bodies: LoadedBody[], ref: TopologyRef): Face {
    const body = bodies.find((b) => b.state.id === ref.body);
    if (!body) throw new FeatureError(`The body of ${ref.name} no longer exists.`);
    return this.element(body, ref) as Face;
  }

  private element(body: LoadedBody, ref: TopologyRef): Face | Edge {
    const found = resolve(body.named, ref);
    if (!found) throw new FeatureError(`The ${ref.kind} ${ref.name} no longer exists. Pick it again.`);
    return found;
  }

  private load(states: readonly BodyState[]): LoadedBody[] {
    return states.map((state) => {
      const named = this.shapes.get(state.key);
      if (!named) throw new FeatureError(`Body ${state.id} has to be rebuilt first.`);
      return { state, named };
    });
  }

  private store(combined: { bodies: BodyState[]; stored: [string, NamedShape][] }): ModelingOutcome {
    for (const [key, named] of combined.stored) this.shapes.put(key, named);
    return { bodies: combined.bodies };
  }

  private available(outcome: ModelingOutcome): boolean {
    return outcome.bodies.every((b) => this.shapes.has(b.key)) && (!outcome.toolKey || this.shapes.has(outcome.toolKey));
  }

  private remember(key: string, outcome: ModelingOutcome): void {
    this.outcomes.delete(key);
    this.outcomes.set(key, outcome);
    if (this.outcomes.size > outcomeCacheSize) this.outcomes.delete(this.outcomes.keys().next().value as string);
  }
}

function positive(value: number, what: string): number {
  if (!(value > 0)) throw new FeatureError(`The ${what} must be greater than zero.`);
  return value;
}

function count(value: number): number {
  if (!Number.isInteger(value) || value < 2) throw new FeatureError('A pattern needs a whole number of at least 2 copies.');
  return value;
}

function nearestRef(face: Face, refs: readonly TopologyRef[]): string {
  const center = face.center.toTuple() as Vec3;
  const distance = (ref: TopologyRef) => (ref.hint ? Math.hypot(...sub3(ref.hint, center)) : Infinity);
  return [...refs].sort((a, b) => distance(a) - distance(b))[0]?.name ?? 'edge';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

