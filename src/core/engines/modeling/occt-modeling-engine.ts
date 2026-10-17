import { find, type NamedShape, piecesOf, place, type ShapeAccess } from '@core/access/shape';
import { type BodyMesh, fail, type Matrix4, ok, type PlaneFrame, type Result, type TopologyRef, type Vec2, type Vec3 } from '@core/contracts';
import { type Edge, type Face, getOC, makeCompound, makeVertex, measureVolume, type Shape3D, Vertex } from 'replicad';
import { combine, type LoadedBody, renameCopy } from './bodies';
import { BodyOperationError, combineBodies, splitBody, transformBodies } from './body-operations';
import { DraftRibError, draftFaces, ribTool } from './draft-rib';
import { drawingView, type ViewGeometry, type ViewRequest } from './drawing-view';
import { edgeFlanges, FlangeError } from './flanges';
import { HoleError, holeTool, threadGroove, threadPlacement } from './holes';
import { GearError } from './gears';
import { PartError, partTool } from './parts';
import { add3, cross3, dot3, normalize3, scale3, sub3, toPlane } from './geometry';
import type { AxisInput, BodyState, ModelingEngine, ModelingOutcome, ModelingRequest, ProjectedCurve, ToolInput } from './modeling-engine';
import { nameShape, namedSurfaces } from './naming';
import { readSnapshot, snapshotOf } from './results';
import { tessellate } from './tessellation';
import { extrudeTool, loftTool, RevolveError, revolveTool, sweepTool } from './tools';
import { BooleanError, cut, valid } from './booleans';

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
      const message = error instanceof FeatureError || error instanceof BooleanError || error instanceof GearError || error instanceof BodyOperationError || error instanceof HoleError || error instanceof PartError || error instanceof DraftRibError || error instanceof FlangeError || error instanceof RevolveError ? error.message : `The geometry kernel could not build this feature (${describe(error)}).`;
      outcome = { bodies: request.bodies, error: message };
    }
    this.remember(request.key, outcome);
    return outcome;
  }

  async project(bodies: readonly BodyState[], refs: readonly TopologyRef[], frame: PlaneFrame): Promise<Result<ProjectedCurve[]>> {
    await this.shapes.ready();
    try {
      const loaded = this.load(bodies);
      const n = normalize3(cross3(frame.u, frame.v));
      const flat = (p: Vec3): Vec2 => {
        const d = sub3(p, frame.origin);
        return [dot3(d, frame.u), dot3(d, frame.v)];
      };
      const curves: ProjectedCurve[] = [];
      for (const ref of refs) {
        const body = loaded.find((b) => b.state.id === ref.body);
        if (!body) throw new FeatureError(`The body of ${ref.name} no longer exists.`);
        const element = this.element(body, ref);
        const edges: Edge[] = 'normalAt' in element ? (element as Face).edges : [element as Edge];
        for (const edge of edges) curves.push(...projectEdge(edge, flat, n));
      }
      return ok(curves);
    } catch (error) {
      return fail({ code: 'lost-reference', message: describe(error) });
    }
  }

  async pointOf(bodies: readonly BodyState[], ref: TopologyRef): Promise<Result<Vec3>> {
    await this.shapes.ready();
    try {
      const body = this.load(bodies).find((b) => b.state.id === ref.body);
      if (!body) throw new FeatureError(`The body of ${ref.name} no longer exists.`);
      const found = find(body.named, ref);
      if (!found) throw new FeatureError(missing(body.named, ref));
      if (found instanceof Vertex) return ok(found.asTuple());
      return ok('normalAt' in found ? (found.center.toTuple() as Vec3) : (found.boundingBox.center as Vec3));
    } catch (error) {
      return fail({ code: 'lost-reference', message: describe(error) });
    }
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
      // A flat face keeps its outward normal; other axes have no inside, so they point along their largest positive world axis,
      // and a pattern copy's the same way round as its original's, turned with the pattern (CAD-112).
      const flat = 'normalAt' in element && element.geomType === 'PLANE';
      return ok(frameAround(axis.origin, flat ? axis.direction : (this.likeOriginal(body, ref, axis.direction) ?? positive3(axis.direction))));
    } catch (error) {
      return fail({ code: 'lost-reference', message: describe(error) });
    }
  }

  async drawView(bodies: readonly BodyState[], request: ViewRequest): Promise<Result<ViewGeometry>> {
    await this.shapes.ready();
    try {
      return ok(drawingView(this.load(bodies).map((b) => ({ id: b.state.id, named: b.named })), request, projectEdge));
    } catch (error) {
      return fail({ code: 'view-failed', message: describe(error) });
    }
  }

  async snapshot(bodies: readonly BodyState[]): Promise<Uint8Array> {
    await this.shapes.ready();
    return snapshotOf(this.load(bodies).map((b) => ({ id: b.state.id, named: b.named })));
  }

  async snapshotPlaced(parts: readonly { readonly id: string; readonly body: BodyState; readonly transform: Matrix4 }[]): Promise<Uint8Array> {
    await this.shapes.ready();
    const loaded = this.load(parts.map((p) => p.body));
    // Names stay with the stored shape: placed copies are for drawings, not references.
    const placed = parts.map(({ id, transform }, i) => ({ id, named: { shape: place((loaded[i] as LoadedBody).named.shape, transform), faces: new Map(), edges: new Map() } }));
    try {
      return snapshotOf(placed);
    } finally {
      for (const p of placed) p.named.shape.delete();
    }
  }

  async keep(bodies: readonly BodyState[], kept: boolean): Promise<void> {
    this.shapes.keep(bodies.map((b) => b.key), kept);
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
      case 'loft':
      case 'sweep': {
        const tool =
          request.type === 'loft'
            ? loftTool(request.feature, request.sections, request.ruled)
            : sweepTool(request.feature, request.frame, request.profiles, request.path, request.closed);
        const toolKey = `${request.key}:tool`;
        this.shapes.put(toolKey, tool);
        return { ...this.store(combine(bodies, tool, request.operation, request.feature, request.key)), toolKey };
      }
      case 'hole': {
        if (!bodies.length) throw new FeatureError('Holes go into a body: there is none yet.');
        // Through all: deeper than everything there is.
        const depth = request.spec.depth ?? 2 * reach(bodies.map((b) => b.named.shape), request.frame.origin) + 1;
        const tool = holeTool(request.feature, request.frame, request.points, request.spec, positive(depth, 'depth'));
        const toolKey = `${request.key}:tool`;
        this.shapes.put(toolKey, tool);
        return { ...this.store(combine(bodies, tool, 'cut', request.feature, request.key)), toolKey };
      }
      case 'part': {
        const tool = partTool(request.feature, request.frame, request.points, request.angle, request.flip, request.solid);
        if (request.operation === 'cut' && !bodies.length) throw new FeatureError('Cutting needs a body: there is none yet.');
        const toolKey = `${request.key}:tool`;
        this.shapes.put(toolKey, tool);
        return { ...this.store(combine(bodies, tool, request.operation, request.feature, request.key)), toolKey };
      }
      case 'thread':
        return this.thread(request, bodies);
      case 'path-pattern':
        return this.repeat(request.feature, request.key, bodies, request.tools, request.placements.length + 1, (shape, i) => {
          const place = request.placements[i - 1] as (typeof request.placements)[number];
          const turned = place.rotation ? shape.rotate((place.rotation.angle * 180) / Math.PI, [...place.rotation.origin], [...place.rotation.direction]) : shape;
          return turned.translate([...place.translation]);
        });
      case 'insert':
        return this.insert(request.feature, request.key, request.bodies, request.sources);
      case 'fillet':
      case 'chamfer':
        return this.treatEdges(
          request.feature,
          request.key,
          bodies,
          request.edges,
          positive(request.size, request.type === 'fillet' ? 'radius' : 'distance'),
          request.type,
          request.endSize === undefined ? undefined : positive(request.endSize, 'end radius'),
        );
      case 'edge-flange': {
        if (request.edges.length === 0) throw new FeatureError('Select the edges to put flanges on.');
        const bodyId = (request.edges[0] as TopologyRef).body;
        const body = bodies.find((b) => b.state.id === bodyId);
        if (!body || request.edges.some((r) => r.body !== bodyId)) throw new FeatureError('Select edges of one sheet.');
        const edges = request.edges.map((ref) => ({ ref, edge: this.element(body, ref) as Edge }));
        const rules = { thickness: positive(request.thickness, 'sheet thickness'), bendRadius: request.bendRadius };
        const { named, markers } = edgeFlanges(request.feature, body.named, edges, rules, positive(request.length, 'flange length'), request.angle);
        const state = { id: body.state.id, key: `${request.key}:${body.state.id}` };
        return { ...this.store({ bodies: bodies.map((b) => (b === body ? state : b.state)), stored: [[state.key, named]] }), flanges: markers };
      }
      case 'draft': {
        if (request.faces.length === 0) throw new FeatureError('Select the faces to draft.');
        const bodyId = (request.faces[0] as TopologyRef).body;
        const body = bodies.find((b) => b.state.id === bodyId);
        if (!body || request.faces.some((r) => r.body !== bodyId)) throw new FeatureError('Select faces of one body.');
        const faces = request.faces.map((ref) => this.element(body, ref) as Face);
        const named = draftFaces(body.named, faces, request.plane, request.angle, request.feature);
        const state = { id: body.state.id, key: `${request.key}:${body.state.id}` };
        return this.store({ bodies: bodies.map((b) => (b === body ? state : b.state)), stored: [[state.key, named]] });
      }
      case 'rib': {
        const tool = ribTool(request.feature, request.frame, request.path, positive(request.thickness, 'thickness'), positive(request.depth, 'depth'), request.direction);
        const toolKey = `${request.key}:tool`;
        this.shapes.put(toolKey, tool);
        return { ...this.store(combine(bodies, tool, 'join', request.feature, request.key)), toolKey };
      }
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
      case 'combine':
        return this.store(combineBodies(bodies, request.target, request.tools, request.operation, request.keepTools, request.feature, request.key));
      case 'split':
        return this.store(splitBody(bodies, request.body, request.plane, request.feature, request.key));
      case 'move': {
        const turn = request.rotation && Math.abs(request.rotation.angle) > 1e-12 ? { ...this.axis(bodies, request.rotation.axis), angle: request.rotation.angle } : undefined;
        const transform = (shape: Shape3D) => {
          const turned = turn ? shape.rotate((turn.angle * 180) / Math.PI, [...turn.origin], [...turn.direction]) : shape;
          return turned.translate([...request.translation]);
        };
        return this.store(transformBodies(bodies, request.bodyIds, transform, request.copy, request.feature, request.key));
      }
      case 'scale':
        return this.store(transformBodies(bodies, request.bodyIds, (shape) => shape.scale(positive(request.factor, 'scale factor'), [0, 0, 0]), false, request.feature, request.key));
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
    if (tools.length === 0) throw new FeatureError('Select at least one feature to repeat.');
    let current = bodies;
    let step = 0;
    for (const input of tools) {
      const tool = this.shapes.get(input.toolKey);
      if (!tool) throw new FeatureError(`The feature ${input.feature} has to be rebuilt first.`);
      const placed = Array.from({ length: copies - 1 }, (_, i) => renameCopy(tool, transform(tool.shape.clone(), i + 1), `@${feature}.${i + 1}`));
      // Joins and cuts take the copies that meet a body in one boolean: one after the other, each copy split the faces the next
      // one met (CAD-103). A joined copy that meets nothing still starts a body of its own.
      const meets = (copy: NamedShape) => current.some((b) => !b.named.shape.boundingBox.isOut(copy.shape.boundingBox));
      const grouped = input.operation === 'join' || input.operation === 'cut' ? placed.filter(meets) : [];
      const groups = [...(grouped.length ? [together(grouped)] : []), ...placed.filter((copy) => !grouped.includes(copy))];
      for (const copy of groups) {
        const combined = this.store(combine(current, copy, input.operation, feature, `${key}:${++step}`));
        current = this.load(combined.bodies);
      }
    }
    return { bodies: current.map((b) => b.state) };
  }

  /** A thread on a round face: placed from its open end; modelled threads cut their groove. */
  private thread(request: Extract<ModelingRequest, { type: 'thread' }>, bodies: LoadedBody[]): ModelingOutcome {
    const body = bodies.find((b) => b.state.id === request.face.body);
    if (!body) throw new FeatureError(`The body of ${request.face.name} no longer exists.`);
    const face = this.element(body, request.face);
    if (!('normalAt' in face) || face.geomType !== 'CYLINDRE') throw new FeatureError('Threads go on round faces: the wall of a hole or a shaft.');
    const axis = axisOf(face);
    if (!axis) throw new FeatureError('Threads go on round faces: the wall of a hole or a shaft.');
    const place = threadPlacement(face, axis, body.named.shape, request.flip);
    const length = Math.min(request.length ?? place.length, place.length);
    const [d, p] = [request.diameter, request.pitch];
    // A tapped hole is drilled between the thread's minor and major diameter; a shaft is about the major diameter.
    const [low, high] = place.internal ? [d - 1.2 * p, d + 1e-6] : [d - 0.3 * p, d + 0.1 * p];
    if (2 * place.radius < low - 1e-6 || 2 * place.radius > high) {
      const range = `${Math.round(low * 100) / 100} to ${Math.round(high * 100) / 100} mm`;
      throw new FeatureError(`An ${request.size} thread needs a ${place.internal ? 'hole' : 'shaft'} of ${range}; this one is ${Math.round(2 * place.radius * 100) / 100} mm.`);
    }
    const thread = { feature: request.feature, size: request.size, origin: place.origin, direction: place.direction, radius: place.radius, length, pitch: p, diameter: d, internal: place.internal };
    if (!request.modelled) return { bodies: request.bodies, thread };
    const shape = cut(body.named.shape, threadGroove(thread, place.length));
    if (measureVolume(shape) > measureVolume(body.named.shape) - 1e-3 * thread.pitch ** 3) throw new FeatureError('The thread could not be cut. Try a shorter thread, or start it at the other end.');
    const named = nameShape(shape, namedSurfaces(body.named), () => `f:${request.feature}:flank`, request.feature);
    const state = { id: body.state.id, key: `${request.key}:${body.state.id}` };
    return { ...this.store({ bodies: bodies.map((b) => (b === body ? state : b.state)), stored: [[state.key, named]] }), thread };
  }

  private treatEdges(feature: string, key: string, bodies: LoadedBody[], refs: readonly TopologyRef[], size: number, kind: 'fillet' | 'chamfer', endSize?: number): ModelingOutcome {
    if (refs.length === 0) throw new FeatureError('Select at least one edge.');
    const role = kind === 'fillet' ? 'round' : 'bevel';
    const stored: [string, NamedShape][] = [];
    const result = bodies.map((body) => {
      const mine = refs.filter((r) => r.body === body.state.id);
      if (!mine.length) return body.state;
      const edges = mine.map((ref) => this.element(body, ref) as Edge);
      const filter = (finder: { inList(list: Edge[]): typeof finder }) => finder.inList(edges);
      const shape = kind === 'fillet' ? body.named.shape.fillet(endSize === undefined ? size : [size, endSize], filter as never) : body.named.shape.chamfer(size, filter as never);
      // New faces are named after the edge they replace: the picked edge nearest to them (CAD-101).
      const named = nameShape(shape, namedSurfaces(body.named), (face) => `f:${feature}:${role}:${nearestEdge(face, mine, edges)}`, feature);
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

  /**
   * A pattern copy's axis (its name ends in `@<pattern>.<n>`) the same way round as its original's:
   * the copy's surface is the original's turned, so the side the largest-axis rule picked carries over.
   */
  private likeOriginal(body: LoadedBody, ref: TopologyRef, direction: Vec3): Vec3 | undefined {
    const name = ref.name.replace(/@[^@]+\.\d+(?=(~\d+)?$)/, '');
    if (name === ref.name) return undefined;
    const original = find(body.named, { kind: ref.kind, body: ref.body, name });
    if (!original || original instanceof Vertex) return undefined;
    const own = axisOf(original)?.direction;
    if (!own) return undefined;
    return dot3(own, positive3(own)) > 0 ? direction : scale3(direction, -1);
  }

  private face(bodies: LoadedBody[], ref: TopologyRef): Face {
    const body = bodies.find((b) => b.state.id === ref.body);
    if (!body) throw new FeatureError(`The body of ${ref.name} no longer exists.`);
    return this.element(body, ref) as Face;
  }

  private element(body: LoadedBody, ref: TopologyRef): Face | Edge {
    const found = find(body.named, ref);
    if (!found) throw new FeatureError(missing(body.named, ref));
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

/** Copies as one tool: their solids in a compound, with all their names. */
function together(copies: readonly NamedShape[]): NamedShape {
  if (copies.length === 1) return copies[0] as NamedShape;
  return {
    shape: makeCompound(copies.map((c) => c.shape)) as Shape3D,
    faces: new Map(copies.flatMap((c) => [...c.faces])),
    edges: new Map(copies.flatMap((c) => [...c.edges])),
  };
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
  if ('normalAt' in element) {
    if (element.geomType === 'PLANE') return { origin: element.center.toTuple() as Vec3, direction: normalize3(element.normalAt(element.center).toTuple() as Vec3) };
    if (element.geomType !== 'CYLINDRE' && element.geomType !== 'CONE') return undefined;
    const surface = new oc.BRepAdaptor_Surface(element.wrapped, false);
    try {
      const cone = element.geomType === 'CONE' ? (surface.Cone() as unknown as { Axis(): Axis; SemiAngle(): number }) : undefined;
      const axis = (cone ?? (surface.Cylinder() as unknown as { Axis(): Axis })).Axis();
      const direction = normalize3(tuple(axis.Direction()));
      // The middle of the face's extent along the axis, so the joint sits in the middle of a hole. The
      // surface's v runs along the axis (on a cone, along its slant). Not the face's box: that turns with
      // the face and depends on whether it was meshed, so pattern copies and sessions differed (CAD-117).
      const { vMin, vMax } = element.UVBounds;
      const along = ((vMin + vMax) / 2) * (cone ? Math.cos(cone.SemiAngle()) : 1);
      return { origin: add3(tuple(axis.Location()), scale3(direction, along)), direction };
    } finally {
      surface.delete();
    }
  }
  if (element.geomType === 'LINE') {
    const [start, end] = [element.startPoint.toTuple() as Vec3, element.endPoint.toTuple() as Vec3];
    return { origin: scale3(add3(start, end), 0.5), direction: normalize3(sub3(end, start)) };
  }
  if (element.geomType !== 'CIRCLE') return undefined;
  const curve = new oc.BRepAdaptor_Curve(element.wrapped);
  try {
    const circle = curve.Circle().Position() as unknown as Axis;
    return { origin: tuple(circle.Location()), direction: normalize3(tuple(circle.Direction())) };
  } finally {
    curve.delete();
  }
}

/** How far the shapes reach from a point, at most. */
function reach(shapes: readonly Shape3D[], from: Vec3): number {
  return Math.max(
    1,
    ...shapes.flatMap((s) => {
      const [low, high] = s.boundingBox.bounds as [Vec3, Vec3];
      return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => Math.hypot(...sub3([i & 1 ? high[0] : low[0], i & 2 ? high[1] : low[1], i & 4 ? high[2] : low[2]], from)));
    }),
  );
}

function positive(value: number, what: string): number {
  if (!(value > 0)) throw new FeatureError(`The ${what} must be greater than zero.`);
  return value;
}

function count(value: number): number {
  if (!Number.isInteger(value) || value < 2) throw new FeatureError('A pattern needs a whole number of at least 2 copies.');
  return value;
}

/** The name of the picked edge nearest to a face's centre (refs and edges in the same order). */
function nearestEdge(face: Face, refs: readonly TopologyRef[], edges: readonly Edge[]): string {
  const center = makeVertex(face.center.toTuple());
  let [best, nearest] = ['edge', Infinity];
  try {
    refs.forEach((ref, i) => {
      const d = distanceBetween(center, edges[i] as Edge);
      if (d < nearest - 1e-9) [best, nearest] = [ref.name, d];
    });
  } finally {
    center.delete();
  }
  return best;
}

/** The shortest distance between two shapes. */
function distanceBetween(a: Vertex | Face | Edge, b: Face | Edge): number {
  const tool = new (getOC().BRepExtrema_DistShapeShape)();
  try {
    tool.LoadS1(a.wrapped);
    tool.LoadS2(b.wrapped);
    tool.Perform();
    return tool.IsDone() ? tool.Value() : Infinity;
  } finally {
    tool.delete();
  }
}

/** Why a reference finds nothing: it is gone, or split into pieces without a hint to choose one. */
function missing(named: NamedShape, ref: TopologyRef): string {
  const pieces = piecesOf(named, ref);
  if (!pieces.length) return `The ${ref.kind} ${ref.name} no longer exists. Pick it again.`;
  return `The ${ref.kind} ${ref.name} is split into ${pieces.length} pieces (${pieces.join(', ')}). Name one of them, or pick it again.`;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  // The kernel throws WebAssembly exceptions, which only say "[object WebAssembly.Exception]" as text.
  if (typeof WebAssembly !== 'undefined' && 'Exception' in WebAssembly && error instanceof (WebAssembly as unknown as { Exception: new () => object }).Exception) {
    const [type, message] = (getOC() as unknown as { getExceptionMessage(e: unknown): [string, string] }).getExceptionMessage(error);
    return `${type}: ${message}`;
  }
  return String(error);
}

/** One edge projected onto the plane: straight lines and circles in the plane's direction stay exact, others become 24 short lines. */
function projectEdge(edge: Edge, flat: (p: Vec3) => Vec2, normal: Vec3): ProjectedCurve[] {
  const point = (t: number): Vec2 => {
    const v = edge.pointAt(t);
    const p = v.toTuple() as Vec3;
    v.delete();
    return flat(p);
  };
  const [start, end, middle] = [point(0), point(1), point(0.5)];
  const gap = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (edge.geomType === 'LINE') return gap(start, end) > 1e-7 ? [{ kind: 'line', start, end }] : [];
  if (edge.geomType === 'CIRCLE') {
    const curve = new (getOC().BRepAdaptor_Curve)(edge.wrapped);
    try {
      const circle = curve.Circle();
      const axis = circle.Axis().Direction();
      const location = circle.Location();
      const along = Math.abs(dot3([axis.X(), axis.Y(), axis.Z()], normal));
      if (along > 1 - 1e-9) {
        const center = flat([location.X(), location.Y(), location.Z()]);
        const radius = circle.Radius();
        if (gap(start, end) < 1e-7) return [{ kind: 'circle', center, radius }];
        // Counter-clockwise in the plane: the way round that passes the edge's middle.
        const angle = (p: Vec2) => Math.atan2(p[1] - center[1], p[0] - center[0]);
        const ccw = (a: number, b: number) => (((b - a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const forward = ccw(angle(start), angle(middle)) < ccw(angle(start), angle(end));
        return [{ kind: 'arc', center, start: forward ? start : end, end: forward ? end : start }];
      }
    } finally {
      curve.delete();
    }
  }
  const points = Array.from({ length: 25 }, (_, i) => point(i / 24));
  return points.slice(1).flatMap((p, i): ProjectedCurve[] => (gap(points[i] as Vec2, p) > 1e-7 ? [{ kind: 'line', start: points[i] as Vec2, end: p }] : []));
}
