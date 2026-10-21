import { type BodyMesh, type HelixPath, helixPoint, type PlaneFrame, type SimulationSurface, type ThreadMarker, type Vec2, type Vec3 } from '@core/contracts';
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Path,
  Shape,
  ShapeGeometry,
} from 'three/webgpu';
import type { Look } from './looks';
import { analysisColors, type StressField, stressColors, type SurfaceAnalysis } from './surface-analysis';
import type { SketchDisplay } from './sketch-display';

/** Colours resolved from the CSS design tokens, so the 3D scene follows the app theme. */
export interface ViewportTheme {
  readonly grid: string;
  readonly gridMajor: string;
  readonly axisX: string;
  readonly axisY: string;
  readonly axisZ: string;
  readonly sketch: string;
  readonly construction: string;
  readonly body: string;
  readonly edge: string;
  readonly hover: string;
  readonly selection: string;
  /** Faces a check flags. */
  readonly flag: string;
  /** Where a section view cuts through bodies. */
  readonly section: string;
}

/** Placement matrix of a plane frame: sketch (u, v, 0) to world. */
export function frameMatrix(frame: PlaneFrame): Matrix4 {
  const { origin: o, u, v } = frame;
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]] as const;
  return new Matrix4().set(u[0], v[0], n[0], o[0], u[1], v[1], n[1], o[1], u[2], v[2], n[2], o[2], 0, 0, 0, 1);
}

/** A thread shown as a helix of its pitch on its face, slightly off the surface so it stays visible. */
export function threadHelix(thread: ThreadMarker, color: string): LineSegments {
  const { origin, direction, radius, length, pitch, internal } = thread;
  const d = direction;
  // Two directions across the axis.
  const seed: Vec3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a: Vec3): Vec3 => {
    const l = Math.hypot(...a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const x = norm(cross(d, seed));
  const y = cross(d, x);
  const r = radius * (internal ? 0.995 : 1.005);
  const steps = Math.max(24, Math.ceil((length / pitch) * 24));
  const at = (i: number): number[] => {
    const t = (i / steps) * length;
    const a = (t / pitch) * 2 * Math.PI;
    return [0, 1, 2].map((k) => (origin[k] as number) + (d[k] as number) * t + r * (Math.cos(a) * (x[k] as number) + Math.sin(a) * (y[k] as number)));
  };
  // Line segments: each from one point of the helix to the next.
  const points = Array.from({ length: steps }, (_, i) => [...at(i), ...at(i + 1)]).flat();
  return lines(points, color, 0.9);
}

/** A helix feature as a curve: a path for sweeps (CAD-161). */
export function helixCurve(helix: HelixPath, color: string): LineSegments {
  const steps = Math.max(48, Math.ceil((helix.height / helix.pitch) * 48));
  const points = Array.from({ length: steps }, (_, i) => [...helixPoint(helix, i / steps), ...helixPoint(helix, (i + 1) / steps)]).flat();
  return lines(points, color);
}

export function lines(points: number[] | Float32Array, color: string, opacity = 1): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  const material = new LineBasicMaterial({ color: new Color(color), transparent: opacity < 1, opacity });
  return new LineSegments(geometry, material);
}

/** Polylines as line-segment pairs. */
function segments(polylines: readonly (readonly Vec2[])[]): number[] {
  return polylines.flatMap((line) =>
    line.slice(1).flatMap((p, i) => {
      const q = line[i] as Vec2;
      return [q[0], q[1], 0, p[0], p[1], 0];
    }),
  );
}

function shapePath<T extends Path>(target: T, polygon: readonly Vec2[]): T {
  polygon.forEach(([x, y], i) => (i === 0 ? target.moveTo(x, y) : target.lineTo(x, y)));
  target.closePath();
  return target;
}

/** A finished sketch in its plane: curves, faint construction lines and lightly shaded, pickable profiles. */
export function createSketch(display: SketchDisplay, theme: ViewportTheme): Group {
  const group = new Group();
  group.name = `sketch-${display.id}`;
  group.matrixAutoUpdate = false;
  group.matrix.copy(frameMatrix(display.frame));
  if (display.curves.length) group.add(lines(segments(display.curves), theme.sketch));
  if (display.construction.length) group.add(lines(segments(display.construction), theme.construction, 0.6));
  for (const profile of display.profiles) {
    const shape = shapePath(new Shape(), profile.outer.polygon);
    shape.holes = profile.holes.map((hole) => shapePath(new Path(), hole.polygon));
    const fill = new Mesh(
      new ShapeGeometry(shape),
      new MeshBasicMaterial({ color: new Color(theme.sketch), transparent: true, opacity: 0.12, side: DoubleSide, depthWrite: false }),
    );
    fill.renderOrder = 1;
    fill.userData = { pick: { kind: 'profile', sketch: display.id, profile: profile.id } };
    group.add(fill);
  }
  return group;
}

/**
 * A solid body: shaded faces, pushed back slightly so its edge lines stay visible on top, in its look
 * (colour, transparency). Its inside faces, drawn flat in the section colour, show only in a section
 * view: where the cut opens the body they read as its cut surface.
 */
/** Roughness and metalness by finish (CAD-90); glass is also see-through, wood warm. */
const finishes: Readonly<Record<NonNullable<Look['finish']>, { readonly roughness: number; readonly metalness: number; readonly opacity?: number; readonly tint?: string }>> = {
  matte: { roughness: 0.55, metalness: 0.05 },
  plastic: { roughness: 0.3, metalness: 0 },
  metal: { roughness: 0.22, metalness: 1 },
  glass: { roughness: 0.05, metalness: 0, opacity: 0.35 },
  wood: { roughness: 0.75, metalness: 0, tint: '#a06a3b' },
};

/**
 * GPU geometry of a body mesh, shared by every drawing of it (an assembly's many instances of one
 * component): uploaded once instead of once per instance (CAD-94). Counted, and freed with its last user.
 */
const shared = new WeakMap<BodyMesh, { readonly faces: BufferGeometry; readonly edges: BufferGeometry; users: number }>();

function sharedGeometry(mesh: BodyMesh, kind: 'faces' | 'edges'): BufferGeometry {
  let entry = shared.get(mesh);
  if (!entry) {
    const faces = new BufferGeometry();
    faces.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    faces.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
    faces.setIndex(new BufferAttribute(mesh.indices, 1));
    const edges = new BufferGeometry();
    edges.setAttribute('position', new Float32BufferAttribute(mesh.edgePositions, 3));
    for (const geometry of [faces, edges]) geometry.userData = { shared: mesh };
    entry = { faces, edges, users: 0 };
    shared.set(mesh, entry);
  }
  entry.users++;
  return entry[kind];
}

/** Lets go of a geometry; shared ones are freed when nothing draws them any more. */
export function releaseGeometry(geometry: BufferGeometry): void {
  const mesh = (geometry.userData as { shared?: BodyMesh }).shared;
  const entry = mesh && shared.get(mesh);
  if (!mesh || !entry) {
    geometry.dispose();
    return;
  }
  if (--entry.users > 0) return;
  entry.faces.dispose();
  entry.edges.dispose();
  shared.delete(mesh);
}

/**
 * A body: its faces (in its look, or coloured by a surface analysis), its edges, and its section cut.
 * With the results of a strength check, its faces are only picked: the solution's surface is drawn
 * instead, coloured by stress and bent by the displacements (then without edges).
 */
export function createBody(mesh: BodyMesh, theme: ViewportTheme, look: Look = { color: theme.body, opacity: 1 }, analysis?: SurfaceAnalysis, field?: StressField): Group {
  const group = new Group();
  group.name = `body-${mesh.body}`;
  const results = field?.bodies.get(mesh.body);
  // Analysis colours belong to one drawing: its geometry is its own.
  const geometry = analysis ? new BufferGeometry() : sharedGeometry(mesh, 'faces');
  if (analysis) {
    geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
    geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  }
  const finish = finishes[look.finish ?? 'matte'];
  const opacity = Math.min(look.opacity, finish.opacity ?? 1);
  const clear = opacity < 1;
  const offset = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
  if (analysis) geometry.setAttribute('color', new BufferAttribute(analysisColors(mesh, analysis), 3));
  const faces = new Mesh(
    geometry,
    analysis
      ? new MeshBasicMaterial({ vertexColors: true, ...offset })
      : new MeshStandardMaterial({
          // Wood without a colour of its own is wood-coloured.
          color: new Color(finish.tint && look.color === theme.body ? finish.tint : look.color),
          roughness: finish.roughness,
          metalness: finish.metalness,
          ...offset,
          transparent: clear,
          opacity,
          depthWrite: !clear,
        }),
  );
  faces.castShadow = true;
  faces.receiveShadow = true;
  faces.userData = { body: mesh };
  const edgeOpacity = clear ? Math.max(look.opacity, 0.3) : 1;
  const edges = new LineSegments(sharedGeometry(mesh, 'edges'), new LineBasicMaterial({ color: new Color(theme.edge), transparent: edgeOpacity < 1, opacity: edgeOpacity }));
  edges.userData = { body: mesh };
  const cut = new Mesh(analysis ? geometry : sharedGeometry(mesh, 'faces'), new MeshBasicMaterial({ color: new Color(theme.section), side: BackSide }));
  cut.name = 'cut';
  cut.visible = false;
  group.add(faces, edges, cut);
  if (results && field) {
    faces.visible = false; // still hit by picking rays
    edges.visible = field.deform === 0;
    group.add(stressSurface(results, field, offset));
  }
  return group;
}

/** The solution's surface of a body, coloured by stress and bent by `deform` times the displacements. */
function stressSurface(results: SimulationSurface, field: StressField, offset: object): Mesh {
  const geometry = new BufferGeometry();
  const positions = field.deform > 0 ? results.positions.map((p, i) => p + (results.displacement[i] as number) * field.deform) : results.positions;
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(stressColors(results.stress, field.max), 3));
  geometry.setIndex(new BufferAttribute(results.indices, 1));
  const surface = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, ...offset }));
  surface.name = 'stress';
  return surface;
}

/** A construction plane: a translucent square with an outline. */
export function createPlane(frame: PlaneFrame, color: string, size = 50): Group {
  const group = new Group();
  group.matrixAutoUpdate = false;
  group.matrix.copy(frameMatrix(frame));
  const h = size / 2;
  group.add(
    new Mesh(
      new ShapeGeometry(shapePath(new Shape(), [[-h, -h], [h, -h], [h, h], [-h, h]])),
      new MeshBasicMaterial({ color: new Color(color), transparent: true, opacity: 0.08, side: DoubleSide, depthWrite: false }),
    ),
    lines([-h, -h, 0, h, -h, 0, h, -h, 0, h, h, 0, h, h, 0, -h, h, 0, -h, h, 0, -h, -h, 0], color, 0.7),
  );
  return group;
}

/** A face of a body as its own geometry, to draw a highlight over it. */
export function faceHighlight(mesh: BodyMesh, name: string, color: string): Mesh | undefined {
  const face = mesh.faces.find((f) => f.name === name);
  if (!face) return undefined;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices.slice(face.start, face.start + face.count), 1));
  const highlight = new Mesh(geometry, new MeshBasicMaterial({ color: new Color(color), transparent: true, opacity: 0.45, depthWrite: false }));
  highlight.renderOrder = 3;
  return highlight;
}

/** An edge of a body, drawn in the highlight colour. */
export function edgeHighlight(mesh: BodyMesh, name: string, color: string): LineSegments | undefined {
  const edge = mesh.edges.find((e) => e.name === name);
  if (!edge) return undefined;
  const highlight = lines(mesh.edgePositions.slice(edge.start * 3, (edge.start + edge.count) * 3), color);
  highlight.renderOrder = 4;
  (highlight.material as LineBasicMaterial).depthTest = false;
  return highlight;
}
