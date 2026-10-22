import type { Core } from '@core/composition';
import type {
  AssemblyDocument,
  BodyProperties,
  DocumentId,
  DocumentSummary,
  Joint,
  LimitHold,
  Matrix4,
  Measurement,
  ProjectSummary,
  ReachTarget,
  Result,
  SimulationResult,
  SketchConstraint,
  SketchFreedom,
  TopologyRef,
  ValidationReport,
  Vec2,
  Vec3,
} from '@core/contracts';
import { describeChange, isDimension, jointDofs, type MotionFrame, sourceKey } from '@core/contracts';
import { type AssemblyCommand, type AssemblyFormat, type AssemblySession, type AssemblyState, type BomLine, cableMesh, cableRoute, type CollisionOptions, type CollisionReport, type InstructionPicture, type LoadOptions, type PlacedRef } from '@core/managers/assembly';
import type { BrokenReference, DesignSession, DesignState, DrawingFormat, ExportOptions, SketchView, SolidFormat } from '@core/managers/design';
import type { ProjectManager } from '@core/managers/project';
import { deflate, encodeGif, encodePng, type Pixels } from '@core/utilities/picture';
import { boundsOf, type RasterMesh, rasterize, type RasterView, rasterViews, type Vec3 as RasterVec3 } from '@core/utilities/raster';
import type { ViewerFormat } from '@core/utilities/scene';
import { DrawingScript } from './drawing';
import { CadenceError, deliveredSince, type ExportTarget, unwrap } from './results';
import { expandShape, roughValue, type ScriptCommand } from './shapes';

/** How a picture of a component or an assembly is taken. */
export interface PictureOptions {
  /** From where: `iso` (front, right, above; the default), `front`, `back`, `top`, `bottom`, `left` or `right`. */
  readonly view?: RasterView;
  /** A free camera instead of a view: from the model towards the viewer, and which way is up. */
  readonly direction?: Vec3;
  readonly up?: Vec3;
  /** Pixels; 800 × 600 by default. */
  readonly width?: number;
  readonly height?: number;
  /** A white ground instead of a transparent one. */
  readonly white?: boolean;
  /** Bodies (of a component) or instances (of an assembly) to zoom onto: the picture is framed to them. */
  readonly focus?: readonly string[];
  /** Bodies or instances left out. */
  readonly hide?: readonly string[];
  /** Bodies or instances shown see-through, to look at what is behind or inside them. */
  readonly ghost?: readonly string[];
  /** A section view, as the app's section plane: what lies on the side the normal points to is taken away. */
  readonly section?: { readonly point: Vec3; readonly normal: Vec3 };
}

/** An assembly's picture: also exploded, or at a moment of a motion study. */
export interface AssemblyPictureOptions extends PictureOptions {
  /** An exploded view, with its first `steps` steps applied (all by default). */
  readonly explode?: string;
  readonly steps?: number;
  /** A motion study, at `time` seconds (0 by default). */
  readonly study?: string;
  readonly time?: number;
}

/** A mesh to draw, with the body or instance it shows (for focus, hide and ghost). */
type Shown = RasterMesh & { readonly of: string };

/** The meshes as pixels, seen from the chosen view or camera; `bounds` keeps the camera where another picture had it. */
function pixels(meshes: readonly Shown[], options: PictureOptions & { readonly bounds?: readonly [RasterVec3, RasterVec3] }): Pixels {
  const view = options.direction ? { direction: options.direction, up: options.up ?? [0, 0, 1] } : rasterViews[options.view ?? 'iso'];
  if (!view) throw new CadenceError('usage', `No view "${options.view}".`);
  const [width, height] = [Math.round(options.width ?? 800), Math.round(options.height ?? 600)];
  if (!(width > 0 && height > 0 && width * height <= 16_000_000)) throw new CadenceError('usage', 'A picture is 1 to 16 million pixels.');
  const [focus, hide, ghost] = [new Set(options.focus), new Set(options.hide), new Set(options.ghost)];
  for (const id of [...focus, ...hide, ...ghost]) if (!meshes.some((m) => m.of === id)) throw new CadenceError('usage', `There is no body or instance "${id}" to show.`);
  const shown = meshes.filter((m) => !hide.has(m.of)).map((m): RasterMesh => ({ ...m, ...(focus.has(m.of) ? { focus: true } : {}), ...(ghost.has(m.of) ? { opacity: 0.25 } : {}) }));
  if (!shown.length) throw new CadenceError('nothing-to-show', 'There are no bodies to show yet.');
  const data = rasterize(shown, { width, height, ...view, ...(options.white ? { background: [255, 255, 255, 255] as const } : {}), ...(options.bounds ? { bounds: options.bounds } : {}), ...(options.section ? { clip: options.section } : {}) });
  return { width, height, data };
}

/**
 * One box for the camera over several pictures (the frames of an animation): around what each
 * frames, so the view stays put while the parts move (CAD-122).
 */
function framing(pictures: readonly (readonly Shown[])[], options: PictureOptions): [RasterVec3, RasterVec3] | undefined {
  const [focus, hide] = [new Set(options.focus), new Set(options.hide)];
  const boxes = pictures.flatMap((meshes) => {
    const shown = meshes.filter((m) => !hide.has(m.of));
    const box = boundsOf(focus.size ? shown.filter((m) => focus.has(m.of)) : shown);
    return box ? [box] : [];
  });
  if (!boxes.length) return undefined;
  return [0, 1].map((side) => [0, 1, 2].map((k) => (side ? Math.max : Math.min)(...boxes.map((b) => b[side]?.[k] as number)))) as unknown as [RasterVec3, RasterVec3];
}

/**
 * Frames for a sheet of `count` moments, spread over the study, each showing a pose no other one
 * shows: a study of whole turns shows the same pose at every whole second (CAD-122).
 */
function distinctMoments(frames: readonly MotionFrame[], count: number): number[] {
  const pose = (frame: MotionFrame) => Object.entries(frame.poses).map(([id, m]) => `${id}:${m.map((v) => v.toFixed(3)).join(',')}`).join(';');
  const poses = frames.map(pose);
  const [picked, seen] = [new Set<number>(), new Set<string>()];
  for (let i = 0; i < count; i++) {
    const target = Math.round((i * (frames.length - 1)) / Math.max(1, count - 1));
    for (let d = 0; d < frames.length; d++) {
      const k = [target + d, target - d].find((j) => j >= 0 && j < frames.length && !picked.has(j) && !seen.has(poses[j] as string));
      if (k === undefined) continue;
      picked.add(k);
      seen.add(poses[k] as string);
      break;
    }
  }
  return [...picked].sort((a, b) => a - b);
}

/** Pictures side by side in rows, left to right and top to bottom. */
function sheet(pictures: readonly Pixels[], columns: number): Pixels {
  const first = pictures[0] as Pixels;
  const rows = Math.ceil(pictures.length / columns);
  const [width, height] = [first.width * columns, first.height * rows];
  const data = new Uint8Array(width * height * 4).fill(255);
  pictures.forEach((picture, i) => {
    const [x0, y0] = [(i % columns) * first.width, Math.floor(i / columns) * first.height];
    for (let y = 0; y < picture.height; y++) data.set(picture.data.subarray(y * picture.width * 4, (y + 1) * picture.width * 4), ((y0 + y) * width + x0) * 4);
  });
  return { width, height, data };
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const roundAll = (values: readonly number[]) => values.map(round);

/** A wildcard pattern (`f:pocket:*`) as a test of names. */
function matcher(pattern: string | undefined): (name: string) => boolean {
  if (!pattern) return () => true;
  const expression = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  return (name) => expression.test(name);
}

/** Lists in answers are cut here, with a note of how many more there are. */
const listLimit = 200;

/** A component as plain data, for printing and for agents. */
export interface ComponentSummary {
  readonly id: string;
  readonly name: string;
  readonly units: string;
  readonly parameters: readonly { readonly name: string; readonly expression: string; readonly value?: string; readonly project?: boolean }[];
  readonly timeline: readonly TimelineEntry[];
  readonly sketches: readonly SketchEntry[];
  readonly bodies: readonly BodyEntry[];
  readonly sheetMetal: boolean;
  /** Why some lists are shorter than they are. */
  readonly notes?: readonly string[];
}

type Listed = 'parameters' | 'timeline' | 'sketches' | 'bodies';
/** Part of a component, as a filter picked it. */
export type FilteredSummary = Omit<ComponentSummary, Listed> & Partial<Pick<ComponentSummary, Listed>>;

interface TimelineEntry {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly state: string;
  readonly error?: string;
}

interface SketchEntry {
  readonly id: string;
  /** Where the sketch lies: its origin, and its x (u) and y (v) axes in the model (CAD-136). */
  readonly frame?: { readonly origin: Point; readonly u: Point; readonly v: Point };
  readonly status: string;
  readonly degreesOfFreedom: number;
  readonly error?: string;
  /** Closed regions: area (mm²), extent of the outline, and how many holes are cut out of it. */
  readonly profiles: readonly { readonly id: string; readonly area: number; readonly holes: number; readonly min: Vec2; readonly max: Vec2 }[];
  /** What its reference dimensions measure (mm, or degrees for angles), with their names (ADR-54). */
  readonly references?: readonly { readonly id: string; readonly name?: string; readonly value: number }[];
  /** A block other sketches place (ADR-54a). */
  readonly block?: true;
}

interface BodyEntry {
  readonly id: string;
  readonly faceCount: number;
  readonly edgeCount: number;
  /** Each face's name, whether it is flat, and its centre (pass it as a reference's `hint`). */
  readonly faces?: readonly { readonly name: string; readonly planar: boolean; readonly center: readonly number[] }[];
  /** Each edge's name and its middle (pass it as a reference's `hint`). */
  readonly edges?: readonly { readonly name: string; readonly middle: readonly number[] }[];
}

/** Which parts of a component to list (all by default). */
export interface SummaryFilter {
  /** Only these: `parameters`, `timeline`, `sketches`, `faces` or `edges` (faces and edges of the bodies). */
  readonly only?: readonly ('parameters' | 'timeline' | 'sketches' | 'faces' | 'edges')[];
  /** One sketch. */
  readonly sketch?: string;
  /** One body. */
  readonly body?: string;
  /** Faces and edges whose names match, with `*` for any text: `f:pocket:*`. */
  readonly match?: string;
  /** Faces and edges that pass within `within` mm (5 by default) of this point. */
  readonly near?: Vec3;
  readonly within?: number;
}

/** What one edit changed in a component, for agents: much shorter than the whole component. */
export interface ComponentChanges {
  readonly id: string;
  /** Timeline items added or whose state, name or error changed. */
  readonly timeline: readonly TimelineEntry[];
  readonly removed?: readonly string[];
  /** Every timeline item that fails now. */
  readonly errors?: readonly TimelineEntry[];
  /** Sketches added or changed, with their profiles. */
  readonly sketches: readonly SketchEntry[];
  /** Every body with its face and edge counts, and the names of faces it gained or lost. */
  /**
   * Every body with its face and edge counts, the names of faces it gained or lost, and faces only
   * renumbered (the same face where it was, its piece number `~n` changed: old name → new, CAD-139).
   */
  readonly bodies: readonly {
    readonly id: string;
    readonly faceCount: number;
    readonly edgeCount: number;
    readonly newFaces?: readonly string[];
    readonly goneFaces?: readonly string[];
    readonly renumbered?: Readonly<Record<string, string>>;
    readonly more?: string;
  }[];
  readonly goneBodies?: readonly string[];
  readonly parameters?: ComponentSummary['parameters'];
  readonly hint: string;
}

type Point = readonly [number, number, number];
const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dotted = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Which faces a body gained and lost between two listings, and which only changed their piece
 * number (`~n`) where they were: the same face renumbered, old name → new (CAD-139).
 */
export function faceChanges(
  before: readonly { readonly name: string; readonly center: readonly number[] }[],
  after: readonly { readonly name: string; readonly center: readonly number[] }[],
): { added: string[]; gone: string[]; renumbered: Record<string, string> } {
  const numbered = (name: string) => /~\d+$/.test(name);
  const base = (name: string) => name.replace(/~\d+$/, '');
  // Faces without a piece number, by name.
  const [was, is] = [new Set(before.filter((f) => !numbered(f.name)).map((f) => f.name)), new Set(after.filter((f) => !numbered(f.name)).map((f) => f.name))];
  const added = [...is].filter((n) => !was.has(n));
  const gone = [...was].filter((n) => !is.has(n));
  // Pieces, by what they are a piece of and where they are: numbers follow the kernel's order, not the face.
  const [earlier, later] = [before.filter((f) => numbered(f.name)), after.filter((f) => numbered(f.name))];
  const near = (a: readonly number[], b: readonly number[]) => a.every((c, i) => Math.abs(c - (b[i] as number)) < 1e-3);
  const renumbered: Record<string, string> = {};
  const [used, matched] = [new Set<string>(), new Set<string>()];
  for (const piece of later) {
    const was = earlier.find((f) => !used.has(f.name) && base(f.name) === base(piece.name) && near(f.center, piece.center));
    if (!was) continue;
    used.add(was.name);
    matched.add(piece.name);
    if (was.name !== piece.name) renumbered[was.name] = piece.name;
  }
  // A piece that changed its shape where it kept its name is no new face either.
  const [left, unmatched] = [earlier.filter((f) => !used.has(f.name)), later.filter((f) => !matched.has(f.name))];
  const kept = new Set(unmatched.filter((f) => left.some((l) => l.name === f.name)).map((f) => f.name));
  return {
    added: [...added, ...unmatched.filter((f) => !kept.has(f.name)).map((f) => f.name)],
    gone: [...gone, ...left.filter((f) => !kept.has(f.name)).map((f) => f.name)],
    renumbered,
  };
}

/** How far a point is from a segment. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const ab = minus(b, a);
  const t = Math.max(0, Math.min(1, dotted(minus(p, a), ab) / (dotted(ab, ab) || 1)));
  const q = minus(p, [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]]);
  return Math.hypot(q[0], q[1], q[2]);
}

/** How far a point is from a triangle (Ericson's closest point, by region). */
function triangleDistance(p: Point, a: Point, b: Point, c: Point): number {
  const [ab, ac] = [minus(b, a), minus(c, a)];
  const n: Point = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const area = dotted(n, n);
  if (area > 0) {
    // Inside the triangle's prism: the distance to its plane.
    const ap = minus(p, a);
    const side = (u: Point, v: Point, w: Point) => {
      const [uv, uw] = [minus(v, u), minus(w, u)];
      const cross: Point = [uv[1] * uw[2] - uv[2] * uw[1], uv[2] * uw[0] - uv[0] * uw[2], uv[0] * uw[1] - uv[1] * uw[0]];
      return dotted(cross, n);
    };
    if (side(a, b, p) >= 0 && side(b, c, p) >= 0 && side(c, a, p) >= 0) return Math.abs(dotted(ap, n)) / Math.sqrt(area);
  }
  return Math.min(segmentDistance(p, a, b), segmentDistance(p, b, c), segmentDistance(p, c, a));
}

/** How far a point is from a face of a body mesh (its triangles), so a point on a round wall finds it (CAD-111). */
function faceDistance(body: { positions: Float32Array; indices: Uint32Array }, face: { start: number; count: number }, p: Point): number {
  const vertex = (i: number): Point => {
    const k = (body.indices[i] as number) * 3;
    return [body.positions[k] as number, body.positions[k + 1] as number, body.positions[k + 2] as number];
  };
  let nearest = Infinity;
  for (let i = face.start; i < face.start + face.count; i += 3) nearest = Math.min(nearest, triangleDistance(p, vertex(i), vertex(i + 1), vertex(i + 2)));
  return nearest;
}

/** How far a point is from an edge of a body mesh (its segments). */
function edgeDistance(body: { edgePositions: Float32Array }, edge: { start: number; count: number }, p: Point): number {
  const at = (i: number): Point => [body.edgePositions[i * 3] as number, body.edgePositions[i * 3 + 1] as number, body.edgePositions[i * 3 + 2] as number];
  let nearest = Infinity;
  for (let i = edge.start; i + 1 < edge.start + edge.count; i += 2) nearest = Math.min(nearest, segmentDistance(p, at(i), at(i + 1)));
  return nearest;
}

/** Half-way along an edge: its segments (pairs of points) in the body mesh's edge positions. */
function middleOf(positions: Float32Array, start: number, count: number): number[] {
  const p = (i: number) => [positions[i * 3] as number, positions[i * 3 + 1] as number, positions[i * 3 + 2] as number];
  const segments = Array.from({ length: Math.floor(count / 2) }, (_, k) => [p(start + 2 * k), p(start + 2 * k + 1)] as const);
  const length = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - (b[i] as number)));
  let rest = segments.reduce((sum, [a, b]) => sum + length(a, b), 0) / 2;
  for (const [a, b] of segments) {
    const l = length(a, b);
    if (rest <= l) return roundAll(a.map((v, i) => v + ((b[i] as number) - v) * (l ? rest / l : 0)));
    rest -= l;
  }
  return roundAll(p(start));
}

/** One component open for scripting: commands, exports and checks. */
export class ComponentScript {
  constructor(
    private readonly session: DesignSession,
    private readonly exports: ExportTarget,
  ) {}

  state(): DesignState {
    return this.session.state();
  }

  /** Reads the project's parameters again, where they changed (CAD-146). */
  catchUp(): Promise<void> {
    return this.session.catchUp();
  }

  /** Runs the commands in order; stops at the first refusal with a CadenceError (the ones before stay). */
  async run(...commands: readonly ScriptCommand[]): Promise<void> {
    for (const command of commands) {
      if (command.type === 'insert-drawing') {
        const { sketchId, document, idPrefix, onePiece, relations } = command;
        unwrap(await this.session.insertDrawing(sketchId, document as DocumentId, idPrefix, { ...(onePiece !== undefined ? { onePiece } : {}), ...(relations ? { relations } : {}) }));
      } else if (command.type === 'import-configurations') {
        const read = unwrap(this.session.readConfigurations(command.csv));
        if (read.problems.length) throw new CadenceError('invalid-configurations', read.problems.join(' '));
        unwrap(await this.session.execute({ type: 'set-configurations', configurations: read.configurations }));
      } else if (command.type === 'add-suggested-constraints') {
        const constraints = await this.session.suggestConstraints(command.sketchId, command.idPrefix);
        if (constraints.length) unwrap(await this.session.execute({ type: 'add-sketch-geometry', sketchId: command.sketchId, entities: [], constraints }));
      } else unwrap(await this.session.execute(expandShape(command, this.guess())));
    }
  }

  /** What a sketch's relations and dimensions leave free: points that still move (and which way), circles of open size. */
  freedom(sketchId: string): Promise<SketchFreedom> {
    return this.session.freedom(sketchId);
  }

  /** Relations the sketcher would suggest for a sketch, not yet added. */
  suggestConstraints(sketchId: string, idPrefix = 'suggested'): Promise<SketchConstraint[]> {
    return this.session.suggestConstraints(sketchId, idPrefix);
  }

  /** The references of a timeline item that no longer find their face or edge, each with the nearest candidates. */
  async brokenReferences(itemId: string): Promise<readonly BrokenReference[]> {
    return unwrap(await this.session.brokenReferences(itemId));
  }

  /** The configuration table as CSV; returns the path. */
  exportConfigurations(options: { readonly to?: string } = {}): Promise<string> {
    return this.delivered(options.to, () => this.session.exportConfigurations());
  }

  /** The shown bodies as one HTML file with a viewer, for people without CADence, or as glTF or USDZ (augmented reality); returns the path. */
  exportViewer(options: { readonly to?: string; readonly format?: ViewerFormat } = {}): Promise<string> {
    return this.delivered(options.to, () => this.session.exportViewer(options.format));
  }

  /** Rough values of expressions from the parameters' values, for where shorthands start their points. */
  private guess() {
    const values = new Map<string, number>();
    for (const { parameter, display } of this.session.state().parameters) {
      const match = /^(-?[\d.]+(?:e[+-]?\d+)?)\s*(mm|cm|m|in)?$/.exec(display ?? '');
      if (match) values.set(parameter.name, Number(match[1]) * ({ mm: 1, cm: 10, m: 1000, in: 25.4 }[match[2] ?? 'mm'] ?? 1));
    }
    return roughValue(values);
  }

  undo(): Promise<void> {
    return this.session.undo();
  }

  redo(): Promise<void> {
    return this.session.redo();
  }

  /** The component as data; a filter lists only part of it (CAD-102). */
  summary(): ComponentSummary;
  summary(filter: SummaryFilter): FilteredSummary;
  summary(filter: SummaryFilter = {}): FilteredSummary {
    const { document, items, sketches, bodies, parameters, sheetMetal } = this.session.state();
    const wanted = (part: NonNullable<SummaryFilter['only']>[number]) => !filter.only || filter.only.includes(part);
    const notes: string[] = [];
    const named = matcher(filter.match);
    const near = filter.near;
    const within = filter.within ?? 5;
    const cut = <T>(list: readonly T[], what: string): readonly T[] => {
      if (list.length <= listLimit) return list;
      notes.push(`${list.length - listLimit} more ${what}: filter by body, match or near to see them.`);
      return list.slice(0, listLimit);
    };
    const focused = filter.sketch !== undefined || filter.body !== undefined;
    const summary: FilteredSummary = {
      id: document.id,
      name: document.name,
      units: document.units,
      ...(wanted('parameters') && !focused
        ? {
            parameters: parameters.map(({ parameter, display, project }) => ({
              name: parameter.name,
              expression: parameter.expression,
              ...(display ? { value: display } : {}),
              ...(project ? { project } : {}),
            })),
          }
        : {}),
      ...(wanted('timeline') && !focused
        ? {
            timeline: document.timeline.map((item) => {
              const status = items.get(item.id);
              return { id: item.id, type: item.type, name: item.name, state: status?.state ?? 'ok', ...(status?.error ? { error: status.error } : {}) };
            }),
          }
        : {}),
      ...(wanted('sketches') && filter.body === undefined
        ? {
            sketches: [...sketches.values()]
              .filter((view) => filter.sketch === undefined || view.sketch.id === filter.sketch)
              .map((view) => ({
                id: view.sketch.id,
                ...(view.frame ? { frame: { origin: roundAll(view.frame.origin) as unknown as Point, u: roundAll(view.frame.u) as unknown as Point, v: roundAll(view.frame.v) as unknown as Point } } : {}),
                status: view.status,
                degreesOfFreedom: view.degreesOfFreedom,
                ...(view.error ? { error: view.error } : {}),
                ...referencesOf(view),
                ...(view.sketch.block ? { block: true as const } : {}),
                profiles: view.profiles.map((profile) => {
                  const xs = profile.outer.polygon.map((p) => p[0]);
                  const ys = profile.outer.polygon.map((p) => p[1]);
                  return {
                    id: profile.id,
                    area: round(profile.area),
                    holes: profile.holes.length,
                    min: roundAll([Math.min(...xs), Math.min(...ys)]) as unknown as Vec2,
                    max: roundAll([Math.max(...xs), Math.max(...ys)]) as unknown as Vec2,
                  };
                }),
              })),
          }
        : {}),
      ...((wanted('faces') || wanted('edges')) && filter.sketch === undefined
        ? {
            bodies: bodies
              .filter((body) => filter.body === undefined || body.body === filter.body)
              .map((body) => ({
                id: body.body,
                faceCount: body.faces.length,
                edgeCount: body.edges.length,
                ...(wanted('faces')
                  ? {
                      faces: cut(
                        body.faces.filter((face) => named(face.name) && (!near || faceDistance(body, face, near) <= within)).map((face) => ({ name: face.name, planar: face.planar, center: roundAll(face.center) })),
                        `faces of ${body.body}`,
                      ),
                    }
                  : {}),
                ...(wanted('edges')
                  ? {
                      edges: cut(
                        body.edges.filter((edge) => named(edge.name) && (!near || edgeDistance(body, edge, near) <= within)).map((edge) => ({ name: edge.name, middle: middleOf(body.edgePositions, edge.start, edge.count) })),
                        `edges of ${body.body}`,
                      ),
                    }
                  : {}),
              })),
          }
        : {}),
      sheetMetal,
      ...(notes.length ? { notes } : {}),
    };
    return summary;
  }

  /** What changed since an earlier summary (`summary()` before the edit): the answer to an edit. */
  changes(before: FilteredSummary): ComponentChanges {
    const after = this.summary({ only: ['parameters', 'timeline', 'sketches', 'faces'] });
    const earlier = <T extends { id: string }>(list: readonly T[] | undefined, id: string) => list?.find((x) => x.id === id);
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const timeline = (after.timeline ?? []).filter((t) => !same(earlier(before.timeline, t.id), t));
    const removed = (before.timeline ?? []).filter((t) => !after.timeline?.some((u) => u.id === t.id)).map((t) => t.id);
    const errors = (after.timeline ?? []).filter((t) => t.error);
    const sketches = (after.sketches ?? []).filter((s) => !same(earlier(before.sketches, s.id), s));
    const cap = 40;
    const bodies = (after.bodies ?? []).map((body) => {
      const previous = earlier(before.bodies, body.id);
      const { added, gone, renumbered } = previous ? faceChanges(previous.faces ?? [], body.faces ?? []) : { added: [], gone: [], renumbered: {} };
      const more = added.length + gone.length > 2 * cap ? `${Math.max(0, added.length - cap)} more new and ${Math.max(0, gone.length - cap)} more gone faces: get_component lists them` : undefined;
      const renamed = Object.entries(renumbered);
      return {
        id: body.id,
        faceCount: body.faceCount,
        edgeCount: body.edgeCount,
        ...(added.length ? { newFaces: added.slice(0, cap) } : {}),
        ...(gone.length ? { goneFaces: gone.slice(0, cap) } : {}),
        ...(renamed.length ? { renumbered: Object.fromEntries(renamed.slice(0, cap)) } : {}),
        ...(more ? { more } : {}),
      };
    });
    const goneBodies = (before.bodies ?? []).filter((b) => !after.bodies?.some((a) => a.id === b.id)).map((b) => b.id);
    const parameters = same(before.parameters, after.parameters) ? undefined : after.parameters;
    return {
      id: after.id,
      timeline,
      ...(removed.length ? { removed } : {}),
      ...(errors.length ? { errors } : {}),
      sketches,
      bodies,
      ...(goneBodies.length ? { goneBodies } : {}),
      ...(parameters ? { parameters } : {}),
      hint: 'get_component lists faces and edges with their positions; filter it by body, match or near.',
    };
  }

  /** All bodies (or `options.bodies`) as one file; returns its path. */
  async export(format: SolidFormat, options: ExportOptions & { readonly to?: string } = {}): Promise<string> {
    const { to, ...rest } = options;
    return this.delivered(to, () => this.session.exportBodies(format, rest));
  }

  async exportSketch(sketchId: string, format: DrawingFormat, options: { readonly to?: string; readonly compensateKerf?: boolean } = {}): Promise<string> {
    const { to, ...rest } = options;
    return this.delivered(to, () => this.session.exportSketch(sketchId, format, rest));
  }

  async exportFlatPattern(format: DrawingFormat, options: { readonly to?: string } = {}): Promise<string> {
    return this.delivered(options.to, () => this.session.exportFlatPattern(format));
  }

  /** The shown bodies as the file a plugin's exporter writes (CAD-174); returns its path. */
  async exportWith(plugin: string, exporter: string, options: { readonly to?: string } = {}): Promise<string> {
    return this.delivered(options.to, () => this.session.exportWith(plugin, exporter));
  }

  properties(): Promise<BodyProperties[]> {
    return this.session.properties();
  }

  validate(): Promise<ValidationReport> {
    return this.session.validate();
  }

  async measure(refs: readonly TopologyRef[]): Promise<Measurement> {
    return unwrap(await this.session.measure(refs));
  }

  /** The strength check of the stored setup (`set-simulation`): stresses in MPa, deflections in mm. */
  async simulate(): Promise<SimulationResult> {
    return unwrap(await this.session.simulate());
  }

  /** A picture of the shown bodies as a PNG (software rendering, no GPU needed). */
  picture(options: PictureOptions = {}): Promise<Uint8Array> {
    const { bodies, document } = this.session.state();
    const shown = bodies.filter((b) => !document.appearances?.[b.body]?.hidden);
    const meshes = shown.map((b): Shown => {
      const color = document.appearances?.[b.body]?.color;
      return { of: b.body, positions: b.positions, normals: b.normals, indices: b.indices, edges: b.edgePositions, ...(color ? { color } : {}) };
    });
    return encodePng(pixels(meshes, options));
  }

  private async delivered(to: string | undefined, write: () => Promise<Result<void>>): Promise<string> {
    if (to) this.exports.deliverNextTo(to);
    const before = this.exports.delivered.length;
    unwrap(await write());
    const path = deliveredSince(this.exports, before);
    if (!path) throw new CadenceError('not-exported', 'Nothing was written.');
    return path;
  }
}

/** An assembly as plain data, for agents (CAD-97). */
export interface AssemblySummary {
  readonly id: string;
  readonly name: string;
  readonly components: readonly { readonly key: string; readonly name: string; readonly status: string; readonly configurations?: readonly { readonly id: string; readonly name: string }[] }[];
  /** Where each instance is: its transform (column-major, mm) and its origin; `placed` when a joint places it. */
  readonly instances: readonly (AssemblyDocument['instances'][number] & { readonly placed: boolean; readonly origin: Vec3 })[];
  readonly copies: readonly { readonly id: string; readonly of: string; readonly pattern: string; readonly origin: Vec3 }[];
  /** Each joint with why it fails, and where it is (its frame on A, in assembly coordinates: origin and axis). */
  readonly joints: readonly (AssemblyDocument['joints'][number] & { readonly error?: string; readonly frame?: { readonly origin: Vec3; readonly axis: Vec3 } })[];
  /** Where limits hold joints in this pose (CAD-186), in words. */
  readonly limits?: readonly string[];
  readonly links: NonNullable<AssemblyDocument['links']>;
  readonly patterns: NonNullable<AssemblyDocument['patterns']>;
  readonly studies: AssemblyDocument['motionStudies'];
  readonly explodedViews: NonNullable<AssemblyDocument['explodedViews']>;
  /** Cables (CAD-192), with how long and how tightly bent they are now (mm). */
  readonly cables: readonly (NonNullable<AssemblyDocument['cables']>[number] & { readonly length?: number; readonly bendRadius?: number; readonly tooTight?: boolean })[];
}

type AssemblyKind = 'instances' | 'joints' | 'links' | 'patterns' | 'studies' | 'explodedViews' | 'cables';

/** What one edit changed in an assembly, short (CAD-111): get_assembly has the whole of it. */
export interface AssemblyChanges {
  readonly id: string;
  /** What the commands made, in full (cam profiles and study keys counted, not listed). */
  readonly created?: Partial<Record<AssemblyKind, readonly unknown[]>>;
  /** Joints whose values (or errors) changed: id, values and error. */
  readonly joints?: readonly { readonly id: string; readonly values: readonly number[]; readonly error?: string }[];
  /** Ids of other things that changed, by kind. */
  readonly changed?: Partial<Record<AssemblyKind, readonly string[]>>;
  readonly removed?: readonly string[];
  /** Every joint that does not hold now, with the reason. */
  readonly jointErrors?: Readonly<Record<string, string>>;
  /** Instances that moved, with their new origins. */
  readonly moved?: Readonly<Record<string, Vec3>>;
  /** Components that are not there to use, by name: still being rebuilt (`loading`) or `missing`. */
  readonly notReady?: Readonly<Record<string, 'loading' | 'missing'>>;
  /** Where a limit held a joint the change asked more of, or moved a joint onto (CAD-186). */
  readonly limits?: readonly string[];
  /** What the change does that was not asked for: study keys and drives past a joint's limits (CAD-186). */
  readonly notes?: readonly string[];
  readonly counts: { readonly instances: number; readonly copies: number; readonly joints: number };
}

/** A limit's hold in words: "J2 shoulder (Angle) is held at its maximum, 90° (asked 120°)". */
export function limitText(hold: LimitHold & { readonly time?: number }, joints: readonly Joint[]): string {
  const joint = joints.find((j) => j.id === hold.joint);
  const name = joint?.name || hold.joint;
  const when = hold.time === undefined ? '' : `From ${Math.round(hold.time * 1000) / 1000} s, `;
  if (hold.dof === 'cone') return `${when}${name} is held at its cone of ${round(hold.value)}°${hold.asked === undefined ? '' : ` (asked ${round(hold.asked)}°)`}.`;
  const dof = joint ? jointDofs[joint.type][hold.dof] : undefined;
  const unit = dof?.kind === 'translate' ? ' mm' : '°';
  return `${when}${name}${dof ? ` (${dof.label})` : ''} is held at its ${hold.at === 'min' ? 'minimum' : 'maximum'}, ${round(hold.value)}${unit}${hold.asked === undefined ? '' : ` (asked ${round(hold.asked)}${unit})`}.`;
}


/** The work's end or the deadline (a time in ms), whichever comes first. */
function before(deadline: number, work: Promise<unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** An item as an answer shows it: long lists (a cam's profile, a study's keys) as their count. */
function brief(item: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).map(([key, value]) => (Array.isArray(value) && value.length > 8 && Array.isArray(value[0]) ? [key, `${value.length} entries`] : key === 'keys' && Array.isArray(value) ? [key, `${value.length} keys`] : [key, value])));
}

const originOf = (transform: Matrix4 | undefined): Vec3 => roundAll([transform?.[12] ?? 0, transform?.[13] ?? 0, transform?.[14] ?? 0]) as unknown as Vec3;

/** One assembly open for scripting. */
export class AssemblyScript {
  constructor(
    private readonly session: AssemblySession,
    private readonly exports: ExportTarget,
    private readonly deliver: (file: { readonly name: string; readonly mediaType: string; readonly bytes: Uint8Array }) => Promise<void>,
    private readonly closed: () => void = () => undefined,
    /** Resolves once this process's events are handled (Core.settled). */
    private readonly settled: () => Promise<void> = async () => undefined,
  ) {}

  state(): AssemblyState {
    return this.session.state();
  }

  async run(...commands: readonly AssemblyCommand[]): Promise<void> {
    for (const command of commands) unwrap(await this.session.execute(command));
  }

  undo(): Promise<void> {
    return this.session.undo();
  }

  redo(): Promise<void> {
    return this.session.redo();
  }

  /**
   * Waits, at most two minutes, until the components are current: new results of this process's edits
   * read (edit_component), other processes' edits caught up with, stale results regenerated (CAD-116).
   */
  async ready(): Promise<void> {
    const deadline = Date.now() + 120_000;
    await before(deadline, this.settled().then(() => this.session.catchUp()));
    const loading = () => [...this.session.state().components.values()].some((c) => c.status === 'loading');
    if (!loading()) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, Math.max(0, deadline - Date.now()));
      const stop = this.session.subscribe(() => (loading() ? undefined : done()));
      function done() {
        clearTimeout(timer);
        stop();
        resolve();
      }
    });
  }

  /** The assembly as data: instances and copies where they are, joints with their errors, links, patterns, studies and exploded views. */
  async summary(): Promise<AssemblySummary> {
    await this.ready();
    const { document, components, poses, placed, jointErrors, copies, jointFrames, holds } = this.session.state();
    const frameOf = (id: string) => {
      const frame = jointFrames.get(id);
      if (!frame) return {};
      const [u, v] = [frame.u, frame.v];
      return { frame: { origin: roundAll(frame.origin) as unknown as Vec3, axis: roundAll([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]) as unknown as Vec3 } };
    };
    return {
      id: document.id,
      name: document.name,
      components: [...components].map(([key, c]) => ({ key, name: c.name, status: c.status, ...(c.configurations?.length ? { configurations: c.configurations } : {}) })),
      instances: document.instances.map((instance) => ({ ...instance, transform: roundAll(poses.get(instance.id) ?? instance.transform), placed: placed.has(instance.id), origin: originOf(poses.get(instance.id) ?? instance.transform) })),
      copies: [...copies].map(([id, copy]) => ({ id, of: copy.instance, pattern: copy.pattern, origin: originOf(poses.get(id)) })),
      joints: document.joints.map((joint) => ({ ...joint, ...(jointErrors.get(joint.id) ? { error: jointErrors.get(joint.id) as string } : {}), ...frameOf(joint.id) })),
      ...(holds.length ? { limits: holds.map((hold) => limitText(hold, document.joints)) } : {}),
      links: document.links ?? [],
      patterns: document.patterns ?? [],
      studies: document.motionStudies,
      explodedViews: document.explodedViews ?? [],
      cables: (document.cables ?? []).map((cable) => {
        const now = this.session.state().cables.find((c) => c.id === cable.id);
        return { ...cable, ...(now ? { length: round(now.length), bendRadius: Number.isFinite(now.bendRadius) ? round(now.bendRadius) : now.bendRadius, ...(now.tooTight ? { tooTight: true } : {}) } : {}) };
      }),
    };
  }

  /** What changed since an earlier summary: the answer to an edit. */
  async changes(before: AssemblySummary): Promise<AssemblyChanges> {
    const after = await this.summary();
    const kinds = ['instances', 'joints', 'links', 'patterns', 'studies', 'explodedViews', 'cables'] as const;
    const created: Partial<Record<AssemblyKind, readonly unknown[]>> = {};
    const changed: Partial<Record<AssemblyKind, readonly string[]>> = {};
    const removed: string[] = [];
    const moved: Record<string, Vec3> = {};
    const without = (item: object, ...keys: string[]) => Object.fromEntries(Object.entries(item).filter(([key]) => !keys.includes(key)));
    for (const kind of kinds) {
      const [was, is] = [before[kind] as readonly { id: string }[], after[kind] as readonly { id: string }[]];
      const added = is.filter((item) => !was.some((w) => w.id === item.id));
      if (added.length) created[kind] = added.map((item) => brief(item as unknown as Record<string, unknown>));
      // Instances move and joints change values all the time: those are reported apart, below.
      const ignored = kind === 'instances' ? ['transform', 'origin', 'placed'] : kind === 'joints' ? ['values', 'error', 'frame'] : kind === 'cables' ? ['length', 'bendRadius', 'tooTight'] : [];
      const different = is.filter((item) => {
        const old = was.find((w) => w.id === item.id);
        return old && JSON.stringify(without(old, ...ignored)) !== JSON.stringify(without(item, ...ignored));
      });
      if (different.length) changed[kind] = different.map((item) => item.id);
      removed.push(...was.filter((w) => !is.some((i) => i.id === w.id)).map((w) => w.id));
    }
    const joints = after.joints.flatMap((joint) => {
      const old = before.joints.find((j) => j.id === joint.id);
      return old && (JSON.stringify(old.values) !== JSON.stringify(joint.values) || old.error !== joint.error) ? [{ id: joint.id, values: joint.values, ...(joint.error ? { error: joint.error } : {}) }] : [];
    });
    for (const instance of after.instances) {
      const was = before.instances.find((i) => i.id === instance.id);
      if (was && JSON.stringify(was.origin) !== JSON.stringify(instance.origin)) moved[instance.id] = instance.origin;
    }
    const jointErrors = Object.fromEntries(after.joints.flatMap((j) => (j.error ? [[j.id, j.error]] : [])));
    return {
      id: after.id,
      ...(Object.keys(created).length ? { created } : {}),
      ...(joints.length ? { joints } : {}),
      ...(Object.keys(changed).length ? { changed } : {}),
      ...(removed.length ? { removed } : {}),
      ...(Object.keys(jointErrors).length ? { jointErrors } : {}),
      ...(Object.keys(moved).length ? { moved } : {}),
      ...(Object.keys(this.notReady()).length ? { notReady: this.notReady() } : {}),
      ...(after.limits && JSON.stringify(after.limits) !== JSON.stringify(before.limits) ? { limits: after.limits } : {}),
      ...(this.session.state().notes.length ? { notes: this.session.state().notes } : {}),
      counts: { instances: after.instances.length, copies: after.copies.length, joints: after.joints.length },
    };
  }

  /** Overlapping instances; `onProgress` is told as each part is checked against the others. */
  async interference(options: { readonly onProgress?: (done: number, total: number) => void } = {}) {
    await this.loaded();
    return this.session.interference(options);
  }

  /** Where instances hit while a motion study plays: the first moment for each pair, and how many moments were checked. */
  async collisions(studyId: string, fps = 10, options: CollisionOptions = {}): Promise<Omit<CollisionReport, 'holds'> & { readonly limits?: readonly string[] }> {
    await this.loaded();
    const { holds, ...report } = unwrap(await this.session.collisions(studyId, fps, options));
    // Where the study runs into joint limits, in words (CAD-186).
    return holds?.length ? { ...report, limits: holds.map((hold) => limitText(hold, this.session.state().document.joints)) } : report;
  }

  async properties() {
    await this.loaded();
    return this.session.properties();
  }

  async billOfMaterials(): Promise<readonly BomLine[]> {
    await this.loaded();
    return this.session.billOfMaterials();
  }

  /** A picture of the shown instances as a PNG, once their components are loaded: as they stand, exploded, or at a moment of a study. */
  async picture(options: AssemblyPictureOptions = {}): Promise<Uint8Array> {
    await this.loaded();
    return encodePng(pixels(this.meshes(await this.poses(options)), options));
  }

  /**
   * A motion study as an animated GIF (written to the exports, its path returned) and a sheet of
   * `moments` pictures of it, in order, to look at (CAD-100).
   */
  async animation(studyId: string, options: PictureOptions & { readonly fps?: number; readonly moments?: number; readonly to?: string } = {}): Promise<{ readonly path: string; readonly sheet: Uint8Array; readonly times: readonly number[] }> {
    await this.loaded();
    const fps = Math.max(1, Math.min(30, options.fps ?? 10));
    const frames = unwrap(await this.session.motion(studyId, fps));
    if (!frames.length) throw new CadenceError('nothing-to-show', 'The study has no frames.');
    const [width, height] = [options.width ?? 480, options.height ?? 360];
    const shown = frames.map((frame) => this.meshes(this.withCopies(frame.poses)));
    const bounds = framing(shown, options);
    const pictures = shown.map((meshes) => pixels(meshes, { ...options, width, height, white: true, ...(bounds ? { bounds } : {}) }));
    if (options.to) this.exports.deliverNextTo(options.to);
    const before = this.exports.delivered.length;
    const name = this.session.state().document.motionStudies.find((s) => s.id === studyId)?.name ?? studyId;
    await this.deliver({ name: `${name}.gif`, mediaType: 'image/gif', bytes: encodeGif(pictures, 1000 / fps) });
    const moments = Math.max(1, Math.min(16, options.moments ?? 9, frames.length));
    const picked = distinctMoments(frames, moments);
    const columns = Math.ceil(Math.sqrt(picked.length));
    const small = picked.map((i) => pixels(shown[i] as Shown[], { ...options, width: Math.round(width / 1.5), height: Math.round(height / 1.5), white: true, ...(bounds ? { bounds } : {}) }));
    return { path: deliveredSince(this.exports, before) as string, sheet: await encodePng(sheet(small, columns)), times: picked.map((i) => round((frames[i] as (typeof frames)[number]).time)) };
  }

  async export(format: AssemblyFormat, options: { readonly to?: string } = {}): Promise<string> {
    await this.loaded();
    return this.delivered(options.to, () => this.session.exportAssembly(format));
  }

  /** Area, length, radius, distance and angle of faces, edges and vertices of instances, where they are or at a moment of a study (CAD-196). */
  async measure(refs: readonly PlacedRef[], moment?: { readonly study: string; readonly time: number }): Promise<Measurement> {
    await this.loaded();
    return unwrap(await this.session.measure(refs, moment));
  }

  /**
   * The assembly at moments of a study (CAD-196): where each instance (and pattern copy) is and every
   * joint's values, only the instances and joints asked for when given.
   */
  async moments(studyId: string, times: readonly number[], only: { readonly instances?: readonly string[]; readonly joints?: readonly string[] } = {}) {
    await this.ready();
    const wanted = (list: readonly string[] | undefined, id: string) => !list?.length || list.includes(id);
    const moments = [];
    for (const time of times) {
      const moment = unwrap(await this.session.at(studyId, time));
      moments.push({
        time,
        instances: [...moment.poses].filter(([id]) => wanted(only.instances, id)).map(([id, transform]) => ({ id, origin: originOf(transform), transform: roundAll(transform) })),
        joints: [...moment.values].filter(([id]) => wanted(only.joints, id)).map(([id, values]) => ({ id, values: roundAll(values) })),
      });
    }
    return { study: studyId, moments };
  }

  /** Joint values that meet targets (CAD-188); with `apply`, set as one change. */
  async reach(targets: readonly ReachTarget[], options: { readonly hold?: readonly string[]; readonly apply?: boolean } = {}) {
    await this.loaded();
    const reached = unwrap(await this.session.reach(targets, options.hold));
    const { document } = this.session.state();
    const joints = document.joints.flatMap((joint) => {
      const values = reached.values.get(joint.id);
      return values && JSON.stringify(values) !== JSON.stringify(joint.values) ? [{ id: joint.id, values: roundAll(values) }] : [];
    });
    const answer = { joints, miss: { distance: round(reached.miss.distance), angle: round(reached.miss.angle) }, reached: reached.miss.distance <= 0.01 && reached.miss.angle <= 0.01 };
    if (!options.apply) return answer;
    const before = await this.summary();
    unwrap(await this.session.execute({ type: 'reach', targets, ...(options.hold ? { hold: options.hold } : {}) }));
    return { ...answer, applied: await this.changes(before) };
  }

  /** What each actuator must hold (CAD-189), with each joint's name and freedom. */
  async loads(options: LoadOptions = {}) {
    await this.loaded();
    const report = unwrap(await this.session.loads(options));
    const { document } = this.session.state();
    return {
      ...report,
      loads: report.loads.map((line) => {
        const joint = document.joints.find((j) => j.id === line.joint);
        return { ...line, name: joint?.name ?? line.joint, freedom: joint ? jointDofs[joint.type][line.dof]?.label : undefined, load: Math.round(line.load * 1e6) / 1e6 };
      }),
    };
  }

  /** The bill of materials as CSV; returns the path. */
  async exportBillOfMaterials(options: { readonly to?: string } = {}): Promise<string> {
    await this.loaded();
    return this.delivered(options.to, () => this.session.exportBillOfMaterials());
  }

  /** The assembly as one HTML file with a viewer (turn, measure, hide, explode), or as glTF or USDZ (augmented reality); returns the path. */
  async exportViewer(options: { readonly to?: string; readonly format?: ViewerFormat } = {}): Promise<string> {
    await this.loaded();
    return this.delivered(options.to, () => this.session.exportViewer(options.format));
  }

  /**
   * Build instructions as a PDF from an exploded view: the parts list, a page per step and the
   * finished assembly, from pictures framed alike (the app's are its viewport's); returns the path.
   */
  async exportInstructions(viewId: string, options: PictureOptions & { readonly to?: string } = {}): Promise<string> {
    await this.loaded();
    const view = this.session.state().document.explodedViews?.find((v) => v.id === viewId);
    if (!view) throw new CadenceError('usage', `There is no exploded view "${viewId}".`);
    const [width, height] = [options.width ?? 1200, options.height ?? 800];
    const states = Array.from({ length: view.steps.length + 1 }, (_, k) => this.meshes(this.session.explode(viewId, k)));
    const bounds = framing(states, options);
    const pictures: InstructionPicture[] = [];
    for (const meshes of states) {
      const { data } = pixels(meshes, { ...options, width, height, white: true, ...(bounds ? { bounds } : {}) });
      const rgb = new Uint8Array(width * height * 3);
      for (let i = 0; i < width * height; i++) rgb.set(data.subarray(i * 4, i * 4 + 3), i * 3);
      pictures.push({ width, height, deflatedRgb: await deflate(rgb) });
    }
    return this.delivered(options.to, () => this.session.exportInstructions(viewId, pictures));
  }

  /** Runs an export and returns the path of the file it wrote. */
  private async delivered(to: string | undefined, write: () => Promise<Result<void>>): Promise<string> {
    if (to) this.exports.deliverNextTo(to);
    const before = this.exports.delivered.length;
    unwrap(await write());
    return deliveredSince(this.exports, before) as string;
  }

  close(): void {
    this.session.close();
    this.closed();
  }

  /** Components that are not there to use, by name. */
  private notReady(): Record<string, 'loading' | 'missing'> {
    return Object.fromEntries([...this.session.state().components.values()].flatMap((c) => (c.status === 'ready' ? [] : [[c.name, c.status]])));
  }

  /** Waits for the components; refuses, naming them, when some are still being rebuilt, rather than answer from their old shapes. */
  private async loaded(): Promise<void> {
    await this.ready();
    const loading = Object.entries(this.notReady()).flatMap(([name, status]) => (status === 'loading' ? [name] : []));
    if (loading.length) throw new CadenceError('not-ready', `${loading.join(', ')} ${loading.length > 1 ? 'are' : 'is'} still being rebuilt after two minutes. Ask again shortly.`);
  }

  /** Where the instances are for a picture: as they stand, exploded, or at a moment of a study. */
  private async poses(options: AssemblyPictureOptions): Promise<ReadonlyMap<string, Matrix4>> {
    const state = this.session.state();
    if (options.explode !== undefined) {
      if (!state.document.explodedViews?.some((v) => v.id === options.explode)) throw new CadenceError('usage', `There is no exploded view "${options.explode}".`);
      return this.session.explode(options.explode, options.steps);
    }
    if (options.study === undefined) return state.poses;
    const study = state.document.motionStudies.find((s) => s.id === options.study);
    if (!study) throw new CadenceError('usage', `There is no motion study "${options.study}".`);
    const time = Math.max(0, Math.min(study.duration, options.time ?? 0));
    const frames = unwrap(await this.session.motion(study.id, 30));
    const frame = frames.reduce((best, f) => (Math.abs(f.time - time) < Math.abs(best.time - time) ? f : best), frames[0] as (typeof frames)[number]);
    return this.withCopies(frame.poses);
  }

  /** A study frame's poses, with the instances it leaves out where they stand. */
  private withCopies(poses: Readonly<Record<string, Matrix4>>): ReadonlyMap<string, Matrix4> {
    const all = new Map(this.session.state().poses);
    for (const [id, pose] of Object.entries(poses)) all.set(id, pose);
    return all;
  }

  /** The shown instances' (and copies') bodies, where the poses put them. */
  private meshes(poses: ReadonlyMap<string, Matrix4>): Shown[] {
    const state = this.session.state();
    const instances = [
      ...state.document.instances,
      ...[...state.copies].flatMap(([id, copy]) => {
        const original = state.document.instances.find((i) => i.id === copy.instance);
        return original ? [{ ...original, id }] : [];
      }),
    ];
    const shown = instances.flatMap((instance) => {
      const component = state.components.get(sourceKey(instance.component, instance.configuration));
      const transform = poses.get(instance.id);
      if (!component || !transform || instance.appearance?.hidden) return [];
      return component.bodies.flatMap((b): Shown[] => {
        const look = instance.appearance?.color ?? component.appearances?.[b.body]?.color;
        return component.appearances?.[b.body]?.hidden ? [] : [{ of: instance.id, positions: b.positions, normals: b.normals, indices: b.indices, edges: b.edgePositions, transform, ...(look ? { color: look } : {}) }];
      });
    });
    // Cables, where these poses put them (CAD-192).
    const cables = (state.document.cables ?? []).flatMap((cable): Shown[] => {
      const route = cableRoute(cable, poses);
      if (!route) return [];
      const mesh = cableMesh(cable, route);
      return [{ of: `cable:${cable.id}`, positions: mesh.positions, normals: mesh.normals, indices: mesh.indices, edges: mesh.edgePositions, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], color: '#2f3e46' }];
    });
    return [...shown, ...cables];
  }
}

/** Two versions of a document compared: its changes in words and, for components, volumes in mm³. */
export interface VersionsCompared {
  readonly changes: readonly string[];
  readonly volume?: { readonly before: number; readonly after: number; readonly added: number; readonly removed: number };
}

/**
 * The scripting API: the project manager as it is, plus components and assemblies opened for
 * scripting. Projects and documents are found by id or by name.
 */
export class Cadence {
  readonly projects: ProjectManager;
  private readonly components = new Map<string, Promise<ComponentScript>>();
  private readonly assemblies = new Map<string, Promise<AssemblyScript>>();
  private readonly drawings = new Map<string, Promise<DrawingScript>>();
  /** The kernel generation the open documents' shapes belong to. */
  private generation: string | undefined;

  constructor(
    private readonly core: Core,
    /** Where exported files go. */
    readonly exports: ExportTarget,
  ) {
    this.projects = core.projectManager;
  }

  async project(idOrName: string): Promise<ProjectSummary> {
    const projects = await this.projects.listProjects();
    const found = projects.find((p) => p.id === idOrName) ?? projects.find((p) => p.name === idOrName);
    if (!found) throw new CadenceError('unknown-project', `No project "${idOrName}".`);
    return found;
  }

  /** A document of a project, by id or name; without a project, a document id. */
  async document(idOrName: string, project?: string): Promise<DocumentSummary> {
    if (!project) {
      const found = await this.projects.findDocument(idOrName as DocumentId);
      if (!found) throw new CadenceError('unknown-document', `No document ${idOrName}.`);
      return found;
    }
    const documents = await this.projects.listDocuments((await this.project(project)).id);
    const found = documents.find((d) => d.id === idOrName) ?? documents.find((d) => d.name === idOrName);
    if (!found) throw new CadenceError('unknown-document', `No document "${idOrName}" in ${project}.`);
    return found;
  }

  /** A component open for scripting; kept open, and opened again when another process changed it. */
  component(documentId: string): Promise<ComponentScript> {
    return this.opened(this.components, documentId, async () => new ComponentScript(unwrap(await this.core.designManager.open(documentId as DocumentId)), this.exports));
  }

  /** An assembly open for scripting; kept open until closed, and opened again when another process changed it. */
  assembly(documentId: string): Promise<AssemblyScript> {
    const deliver = (file: { readonly name: string; readonly mediaType: string; readonly bytes: Uint8Array }) => this.projects.deliverFile(file);
    return this.opened(this.assemblies, documentId, async () => new AssemblyScript(unwrap(await this.core.assemblyManager.open(documentId as DocumentId)), this.exports, deliver, () => this.assemblies.delete(documentId), () => this.core.settled()));
  }

  /** A technical drawing open for scripting; kept open until closed, and opened again when another process changed it (CAD-123). */
  drawing(documentId: string): Promise<DrawingScript> {
    return this.opened(this.drawings, documentId, async () => new DrawingScript(unwrap(await this.core.drawingManager.open(documentId as DocumentId)), this.exports, () => this.drawings.delete(documentId), () => this.core.settled()));
  }

  /**
   * Two versions of a document compared in words (CAD-175): what changed in its timeline, sketches
   * and parameters and, for components, the volume before and after and how much was added and removed.
   * Without `to`, `from` is compared with the document as it is now.
   */
  async compareVersions(documentId: string, from: string, to?: string): Promise<VersionsCompared> {
    const compared = unwrap(await this.projects.compareVersions(documentId as DocumentId, from, to));
    const changes = compared.changes.map(describeChange);
    if (compared.before.kind !== 'component' || compared.after.kind !== 'component') return { changes };
    const built = unwrap(await this.core.designManager.compareBodies(compared.before, compared.after, compared.projectParameters));
    const round = (mm3: number) => Math.round(mm3 * 1000) / 1000;
    const { before, after, added, removed } = built.volume;
    return { changes, volume: { before: round(before), after: round(after), added: round(added), removed: round(removed) } };
  }

  /** Resolves once the work this process started is done: components rebuilt, results written (CAD-119). */
  settled(): Promise<void> {
    return this.core.settled();
  }

  /** A picture of a component, an assembly or a drawing (`focus` on one of its views zooms onto it) as a PNG. */
  async picture(documentId: string, options: AssemblyPictureOptions = {}): Promise<Uint8Array> {
    const document = await this.document(documentId);
    if (document.kind === 'imported') {
      const content = unwrap(await this.projects.previewImported(document.id));
      if (content.kind !== 'model') throw new CadenceError('not-a-model', `${document.name} is a ${content.kind}, not a 3D file: insert it into a sketch to use it.`);
      return encodePng(pixels(content.meshes.map((m) => ({ of: m.body, positions: m.positions, normals: m.normals, indices: m.indices, edges: m.edgePositions })), options));
    }
    if (document.kind === 'drawing') {
      if ((options.focus?.length ?? 0) > 1) throw new CadenceError('usage', 'A picture of a drawing zooms onto one view at most.');
      return (await this.drawing(document.id)).picture({ ...(options.width ? { width: options.width } : {}), ...(options.focus?.[0] ? { view: options.focus[0] } : {}) });
    }
    if (document.kind === 'component') {
      if (options.explode !== undefined || options.study !== undefined) throw new CadenceError('usage', 'Exploded views and motion studies belong to assemblies.');
      return (await this.component(document.id)).picture(options);
    }
    if (document.kind !== 'assembly') throw new CadenceError('not-a-model', `${document.name} is not a component, an assembly, a drawing or an imported file.`);
    return (await this.assembly(document.id)).picture(options);
  }

  /** Hands a file of an imported document over in another format; returns its path. */
  async exportImported(documentId: string, format: Parameters<ProjectManager['exportImported']>[1], options: { readonly to?: string } = {}): Promise<string> {
    if (options.to) this.exports.deliverNextTo(options.to);
    const before = this.exports.delivered.length;
    unwrap(await this.projects.exportImported(documentId as DocumentId, format));
    return deliveredSince(this.exports, before) as string;
  }

  /**
   * A document open for scripting: the one already open, unless its document changed since (the app or
   * another process saved it), which an edit here would overwrite (CAD-116).
   */
  private async opened<T extends ComponentScript | AssemblyScript | DrawingScript>(open: Map<string, Promise<T>>, documentId: string, start: () => Promise<T>): Promise<T> {
    await this.kernelRestarted();
    const script = open.get(documentId);
    if (script) {
      const [current, saved] = await Promise.all([script.catch(() => undefined), this.projects.findDocument(documentId as DocumentId)]);
      if (current && current.state().document.modifiedAt === saved?.modifiedAt) {
        if (current instanceof ComponentScript) await current.catchUp();
        return current;
      }
      if (current instanceof AssemblyScript || current instanceof DrawingScript) current.close();
      open.delete(documentId);
    }
    const started = start();
    started.catch(() => open.delete(documentId));
    open.set(documentId, started);
    return started;
  }

  /** Stops what the geometry kernel computes, where its host can (a worker, CAD-134); false where it cannot. */
  stop(): boolean {
    if (!this.core.stopGeometry) return false;
    this.core.stopGeometry();
    return true;
  }

  /**
   * Whether the geometry kernel started again since this was last asked (after a failure or a
   * cancelled computation: CAD-133, CAD-134). The open documents' shapes went with the old kernel,
   * so they are all forgotten, and open anew when used.
   */
  async kernelRestarted(): Promise<boolean> {
    const now = await this.core.kernelGeneration();
    const restarted = this.generation !== undefined && now !== this.generation;
    this.generation = now;
    if (restarted) this.forget();
    return restarted;
  }

  /** Forgets the open components and assemblies (after documents changed elsewhere). */
  forget(documentId?: string): void {
    const close = (script: Promise<AssemblyScript | DrawingScript> | undefined) => void script?.then((s) => s.close(), () => undefined);
    if (documentId) {
      this.components.delete(documentId);
      close(this.assemblies.get(documentId));
      close(this.drawings.get(documentId));
      this.assemblies.delete(documentId);
      this.drawings.delete(documentId);
      return;
    }
    this.components.clear();
    for (const script of [...this.assemblies.values(), ...this.drawings.values()]) close(script);
    this.assemblies.clear();
    this.drawings.clear();
  }
}

export { CadenceError, type ExportTarget, unwrap };
export type { ScriptCommand };

/** A sketch's reference dimensions and what they measure, when it has any. */
function referencesOf(view: SketchView): Pick<SketchEntry, 'references'> {
  const references = view.sketch.constraints.filter(isDimension).flatMap((d) => {
    const value = d.reference ? view.values.get(d.id) : undefined;
    return value === undefined ? [] : [{ id: d.id, ...(d.name ? { name: d.name } : {}), value: round(d.kind === 'angle' ? (value * 180) / Math.PI : value) }];
  });
  return references.length ? { references } : {};
}
