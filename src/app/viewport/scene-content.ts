import type { BodyMesh, PlaneFrame, Vec2 } from '@core/contracts';
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
export function createBody(mesh: BodyMesh, theme: ViewportTheme, look: Look = { color: theme.body, opacity: 1 }): Group {
  const group = new Group();
  group.name = `body-${mesh.body}`;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  const clear = look.opacity < 1;
  const faces = new Mesh(
    geometry,
    new MeshStandardMaterial({
      color: new Color(look.color),
      roughness: 0.55,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      transparent: clear,
      opacity: look.opacity,
      depthWrite: !clear,
    }),
  );
  faces.userData = { body: mesh };
  const edges = lines(mesh.edgePositions, theme.edge, clear ? Math.max(look.opacity, 0.3) : 1);
  edges.userData = { body: mesh };
  const cut = new Mesh(geometry, new MeshBasicMaterial({ color: new Color(theme.section), side: BackSide }));
  cut.name = 'cut';
  cut.visible = false;
  group.add(faces, edges, cut);
  return group;
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
