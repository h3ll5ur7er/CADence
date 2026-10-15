import { find, type NamedShape, type ShapeAccess } from '@core/access/shape';
import { type BodyMesh, fail, ok, type PlaneFrame, type Result, type TopologyRef, type Vec3 } from '@core/contracts';
import { type Edge, type Face, getOC, measureVolume, type Shape3D, Vertex } from 'replicad';
import { combine, type LoadedBody, renameCopy } from './bodies';
import { add3, cross3, dot3, normalize3, scale3, sub3, toPlane } from './geometry';
import type { AxisInput, BodyState, ModelingEngine, ModelingOutcome, ModelingRequest, ToolInput } from './modeling-engine';
import { nameShape, namedSurfaces } from './naming';
import { readSnapshot, snapshotOf } from './results';
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
      return ok(frameAround(face.center.toTuple() as Vec3, normalize3(face.normalAt(face.center).toTuple() as Vec3)));
    } catch (error) {
      return fail({ code: 'lost-reference', message: describe(error) });
    }
  }

  async frameOf(bodies: readonly BodyState[], ref: TopologyRef): Promise<Result<PlaneFrame>> {
    await this.shapes.ready();
    try {
      const body = this.load(bodies).find((b) => b.state.id === ref.body);
      if (!body) throw new FeatureError(`The body of ${ref.name} no longer exists.`);
      const element = this.element(body, ref);
      const axis = axisOf(element);
      if (!axis) return fail({ code: 'no-axis', message: 'Joints attach to flat or round faces and to straight or circular edges.' });
      // A flat face keeps its outward normal; other axes have no inside, so they point along their largest positive world axis.
      const flat = 'normalAt' in element && element.geomType === 'PLANE';
      return ok(frameAround(axis.origin, flat ? axis.direction : positive3(axis.direction)));
    } catch (error) {
      return fail({ code: 'lost-reference', message: describe(error) });
    }
  }

  async snapshot(bodies: readonly BodyState[]): Promise<Uint8Array> {
    await this.shapes.ready();
    return snapshotOf(this.load(bodies).map((b) => ({ id: b.state.id, named: b.named })));
  }

  async restore(snapshot: Uint8Array, prefix: string): Promise<BodyState[]> {
    await this.shapes.ready();
    return readSnapshot(snapshot).map(({ id, named }) => {
      const key = `${prefix}:${id}`;
      if (!this.shapes.has(key)) this.shapes.put(key, named());
      return { id, key };
    });
  }

  async tessellate(bodies: readonly BodyState[]): Promise<BodyMesh[]> {
    await this.shapes.ready();
    return this.load(bodies).map((b) => tessellate(b.state, b.named));
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
      case 'insert':
        return this.insert(request.feature, request.key, request.bodies, request.sources);
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
    // OpenCascade returns the solid unchanged when the walls cannot fit.
    if (measureVolume(shape) >= measureVolume(body.named.shape) * (1 - 1e-9)) {
      throw new FeatureError('The walls are too thick for this body. Try a thinner shell.');
    }
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
    const found = find(body.named, ref);
    if (!found) throw new FeatureError(`The ${ref.kind} ${ref.name} no longer exists. Pick it again.`);
    if (found instanceof Vertex) throw new FeatureError('Pick a face or an edge, not a vertex.');
    return found;
  }

  /** New bodies from imported solids: `<feature>`, `<feature>:2`, …, with fresh face names. */
  private insert(feature: string, key: string, bodies: readonly BodyState[], sources: readonly string[]): ModelingOutcome {
    if (sources.length === 0) throw new FeatureError('The imported file holds no solids.');
    const stored: [string, NamedShape][] = sources.map((source, i) => {
      const imported = this.shapes.get(source);
      if (!imported) throw new FeatureError('The imported file has to be read again.');
      const id = i === 0 ? feature : `${feature}:${i + 1}`;
      return [`${key}:${id}`, nameShape(imported.shape.clone(), [], () => undefined, feature)];
    });
    const added = stored.map(([storedKey], i) => ({ id: i === 0 ? feature : `${feature}:${i + 1}`, key: storedKey }));
    return this.store({ bodies: [...bodies, ...added], stored });
  }

  private load(states: readonly BodyState[]): LoadedBody[] {
    return states.map((state) => {
      const named = this.shapes.get(state.key);
      if (!named) throw new FeatureError(`Body ${state.id} has to be rebuilt first.`);
      return { state, named };
    });
  }

  private store(combined: { bodies: BodyState[]; stored: [string, NamedShape][] }): ModelingOutcome {
    for (const [, named] of combined.stored) {
      if (!valid(named.shape)) throw new FeatureError('The result is not a valid solid. Try other values or references.');
    }
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

/** A frame with the given normal; in-plane axes like the origin planes': u follows world X on horizontal planes, else v points up. */
function frameAround(origin: Vec3, normal: Vec3): PlaneFrame {
  const flat = (axis: Vec3) => normalize3(sub3(axis, scale3(normal, dot3(axis, normal))));
  if (Math.abs(normal[2]) > 0.9) {
    const u = flat([1, 0, 0]);
    return { origin, u, v: normalize3(cross3(normal, u)) };
  }
  const v = flat([0, 0, 1]);
  return { origin, u: normalize3(cross3(v, normal)), v };
}

/** The direction or its opposite, whichever has its largest component positive. */
function positive3(direction: Vec3): Vec3 {
  const largest = direction.reduce((best, v) => (Math.abs(v) > Math.abs(best) + 1e-9 ? v : best), 0);
  return largest < 0 ? scale3(direction, -1) : direction;
}

/** Where a joint axis runs through a face or edge, if it has one. */
function axisOf(element: Face | Edge): { origin: Vec3; direction: Vec3 } | undefined {
  const oc = getOC();
  interface Xyz { X(): number; Y(): number; Z(): number }
  interface Axis { Location(): Xyz; Direction(): Xyz }
  const tuple = (p: Xyz): Vec3 => [p.X(), p.Y(), p.Z()];
  /** The point of the axis nearest the element's centre, so the joint sits in the middle of a hole. */
  const onAxis = (point: Vec3, direction: Vec3, center: Vec3): Vec3 => add3(point, scale3(direction, dot3(sub3(center, point), direction)));
  const center = element.boundingBox.center as Vec3;
  if ('normalAt' in element) {
    if (element.geomType === 'PLANE') return { origin: element.center.toTuple() as Vec3, direction: normalize3(element.normalAt(element.center).toTuple() as Vec3) };
    if (element.geomType !== 'CYLINDRE' && element.geomType !== 'CONE') return undefined;
    const surface = new oc.BRepAdaptor_Surface(element.wrapped, false);
    try {
      const axis = ((element.geomType === 'CYLINDRE' ? surface.Cylinder() : surface.Cone()) as unknown as { Axis(): Axis }).Axis();
      const direction = normalize3(tuple(axis.Direction()));
      return { origin: onAxis(tuple(axis.Location()), direction, center), direction };
    } finally {
      surface.delete();
    }
  }
  if (element.geomType === 'LINE') return { origin: center, direction: normalize3(element.tangentAt(0).toTuple() as Vec3) };
  if (element.geomType !== 'CIRCLE') return undefined;
  const curve = new oc.BRepAdaptor_Curve(element.wrapped);
  try {
    const circle = curve.Circle().Position() as unknown as Axis;
    return { origin: tuple(circle.Location()), direction: normalize3(tuple(circle.Direction())) };
  } finally {
    curve.delete();
  }
}

/** OpenCascade's topology and geometry check. */
function valid(shape: Shape3D): boolean {
  const analyzer = new (getOC().BRepCheck_Analyzer)(shape.wrapped, true, false);
  try {
    return analyzer.IsValid();
  } finally {
    analyzer.delete();
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

