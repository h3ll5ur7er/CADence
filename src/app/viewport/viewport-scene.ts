import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SketchPlane } from '@core/contracts';
import {
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  type Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Matrix4 as Matrix,
  PlaneGeometry,
  Path,
  Shape,
  ShapeGeometry,
  Quaternion,
  Scene,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import type { SketchDisplay } from './sketch-display';
import { type Affine, planeBasis, planeView } from './sketch-planes';

export type StandardView = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'home';
export type RendererBackend = 'WebGPU' | 'WebGL 2';

/** Colours resolved from the CSS design tokens, so the 3D scene follows the app theme. */
export interface ViewportTheme {
  readonly grid: string;
  readonly gridMajor: string;
  readonly axisX: string;
  readonly axisY: string;
  readonly axisZ: string;
  readonly sketch: string;
  readonly construction: string;
}

/** Direction from the target to the camera, Z up. Polar views are nudged off the pole for the orbit controls. */
const viewDirections: Readonly<Record<StandardView, Vector3>> = {
  front: new Vector3(0, -1, 0),
  back: new Vector3(0, 1, 0),
  right: new Vector3(1, 0, 0),
  left: new Vector3(-1, 0, 0),
  top: new Vector3(0, -1e-4, 1).normalize(),
  bottom: new Vector3(0, -1e-4, -1).normalize(),
  home: new Vector3(1, -1.2, 0.9).normalize(),
};

const gridExtent = 150; // mm in each direction
const gridMinor = 10;
const gridMajor = 50;
const planeSize = 60;
const homeDistance = 340;
const homeTarget = new Vector3(20, 20, 10);
const transitionMs = 350;

/**
 * The three.js scene behind a viewport: WebGPU renderer (WebGL 2 fallback), Z-up camera,
 * orbit navigation, grid and origin. Renders on demand only.
 */
export class ViewportScene {
  /** Called with the camera's view matrix whenever the camera moves (drives the view cube). */
  onCameraChange: ((view: Matrix4) => void) | undefined;
  /** While a sketch plane is edited: called with the plane-to-pixel map whenever the camera moves. */
  onPlaneMatrix: ((matrix: Affine | undefined) => void) | undefined;

  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(35, 1, 0.5, 20_000);
  private readonly renderer: WebGPURenderer;
  private readonly controls: OrbitControls;
  private readonly origin: Group;
  private readonly sketches = new Group();
  private editedPlane: SketchPlane | undefined;
  private size = { width: 1, height: 1 };
  private frame = 0;
  private transition: { from: Quaternion; to: Quaternion; start: number; distance: number } | undefined;
  private initialized = false;

  /** `eventTarget` wraps the canvas and its overlays, so overlay events not handled there reach the navigation. */
  constructor(
    canvas: HTMLCanvasElement,
    eventTarget: HTMLElement,
    private readonly theme: ViewportTheme,
    options: { forceWebGL?: boolean } = {},
  ) {
    this.renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true, forceWebGL: options.forceWebGL ?? false });
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, eventTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.requestRender());

    this.scene.add(new HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const sun = new DirectionalLight(0xffffff, 1.4);
    sun.position.set(300, -400, 600);
    this.scene.add(sun);
    this.scene.add(createGrid(theme));
    this.origin = createOrigin(theme);
    this.scene.add(this.origin, this.sketches);
    this.controls.target.copy(homeTarget);
    this.placeCamera(viewDirections.home, homeDistance);
  }

  async init(): Promise<RendererBackend> {
    await this.renderer.init();
    this.initialized = true;
    this.requestRender();
    return (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.size = { width, height };
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  setOriginVisible(visible: boolean): void {
    this.origin.visible = visible;
    this.requestRender();
  }

  /** Replaces the sketches drawn in 3D. */
  setSketches(displays: readonly SketchDisplay[]): void {
    disposeTree(this.sketches);
    this.sketches.clear();
    for (const display of displays) this.sketches.add(createSketch(display, this.theme));
    this.requestRender();
  }

  /** Looks straight at a sketch plane and locks rotation while it is edited; `undefined` ends editing. */
  editPlane(plane: SketchPlane | undefined): void {
    this.editedPlane = plane;
    this.controls.enableRotate = plane === undefined;
    if (plane) this.showView(planeView[plane]);
    else this.onPlaneMatrix?.(undefined);
    this.requestRender();
  }

  /** Turns the camera to a standard view around the current target, keeping the distance. */
  showView(view: StandardView): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = view === 'home' ? homeDistance : offset.length();
    if (view === 'home') this.controls.target.copy(homeTarget);
    const from = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), offset.normalize());
    const to = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), viewDirections[view]);
    this.transition = { from, to, start: performance.now(), distance };
    this.requestRender();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.controls.dispose();
    disposeTree(this.scene);
    this.renderer.dispose();
  }

  private requestRender(): void {
    if (this.frame || !this.initialized) return;
    this.frame = requestAnimationFrame(() => this.renderFrame());
  }

  private renderFrame(): void {
    this.frame = 0;
    const animating = this.stepTransition();
    const moving = this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.onCameraChange?.(this.camera.matrixWorldInverse);
    if (this.editedPlane) this.onPlaneMatrix?.(this.planeMatrix(this.editedPlane));
    if (animating || moving) this.requestRender();
  }

  /** Advances a running view transition; true while it still runs. */
  private stepTransition(): boolean {
    if (!this.transition) return false;
    const { from, to, start, distance } = this.transition;
    const t = Math.min((performance.now() - start) / transitionMs, 1);
    const eased = 1 - (1 - t) ** 3;
    const direction = new Vector3(0, 0, 1).applyQuaternion(from.clone().slerp(to, eased));
    this.placeCamera(direction, distance);
    if (t >= 1) this.transition = undefined;
    return t < 1;
  }

  /** Projects the plane's origin and axes; exact while the camera looks straight at the plane. */
  private planeMatrix(plane: SketchPlane): Affine {
    const { u, v } = planeBasis[plane];
    const project = (x: number, y: number, z: number): [number, number] => {
      const p = new Vector3(x, y, z).project(this.camera);
      return [((p.x + 1) / 2) * this.size.width, ((1 - p.y) / 2) * this.size.height];
    };
    const unit = 100;
    const [ox, oy] = project(0, 0, 0);
    const [ux, uy] = project(u[0] * unit, u[1] * unit, u[2] * unit);
    const [vx, vy] = project(v[0] * unit, v[1] * unit, v[2] * unit);
    return { a: (ux - ox) / unit, b: (uy - oy) / unit, c: (vx - ox) / unit, d: (vy - oy) / unit, e: ox, f: oy };
  }

  private placeCamera(direction: Vector3, distance: number): void {
    this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld();
  }
}

function lines(points: number[], color: string, opacity = 1): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  const material = new LineBasicMaterial({ color: new Color(color), transparent: opacity < 1, opacity });
  return new LineSegments(geometry, material);
}

/** Grid on the XY plane (the "ground" in a Z-up world): minor lines every 10 mm, major every 50 mm. */
function createGrid(theme: ViewportTheme): Group {
  const minor: number[] = [];
  const major: number[] = [];
  for (let v = -gridExtent; v <= gridExtent; v += gridMinor) {
    if (v === 0) continue; // the axes draw the zero lines
    const target = v % gridMajor === 0 ? major : minor;
    target.push(v, -gridExtent, 0, v, gridExtent, 0, -gridExtent, v, 0, gridExtent, v, 0);
  }
  const grid = new Group();
  grid.name = 'grid';
  grid.add(lines(minor, theme.grid, 0.35), lines(major, theme.gridMajor, 0.45));
  return grid;
}

/** Origin: X/Y/Z axes and the three origin planes, each tinted with the colour of its normal axis. */
function createOrigin(theme: ViewportTheme): Group {
  const origin = new Group();
  origin.name = 'origin';
  const half = planeSize / 2;
  origin.add(
    lines([0, 0, 0, gridExtent, 0, 0], theme.axisX),
    lines([0, 0, 0, 0, gridExtent, 0], theme.axisY),
    lines([0, 0, 0, 0, 0, planeSize * 1.4], theme.axisZ),
  );
  const planes: [string, string, (m: Mesh | LineSegments) => void][] = [
    ['XY', theme.axisZ, () => undefined],
    ['XZ', theme.axisY, (m) => m.rotateX(Math.PI / 2)],
    ['YZ', theme.axisX, (m) => m.rotateY(Math.PI / 2)],
  ];
  for (const [name, color, orient] of planes) {
    const fill = new Mesh(
      new PlaneGeometry(planeSize, planeSize),
      new MeshBasicMaterial({ color: new Color(color), transparent: true, opacity: 0.07, side: DoubleSide, depthWrite: false }),
    );
    const outline = lines(
      [-half, -half, 0, half, -half, 0, half, -half, 0, half, half, 0, half, half, 0, -half, half, 0, -half, half, 0, -half, -half, 0],
      color,
      0.55,
    );
    for (const part of [fill, outline]) {
      orient(part);
      // Each plane sits in the positive quadrant, touching the origin.
      part.position.set(name === 'YZ' ? 0 : half, name === 'XZ' ? 0 : half, name === 'XY' ? 0 : half);
      part.name = `plane-${name}`;
      origin.add(part);
    }
  }
  return origin;
}

function disposeTree(root: Group | Scene): void {
  root.traverse((object) => {
    if (object instanceof Mesh || object instanceof LineSegments) {
      object.geometry.dispose();
      (object.material as { dispose(): void }).dispose();
    }
  });
}

/** Polylines as line-segment pairs. */
function segments(polylines: readonly (readonly (readonly [number, number])[])[]): number[] {
  return polylines.flatMap((line) => line.slice(1).flatMap((p, i) => {
    const q = line[i] as readonly [number, number];
    return [q[0], q[1], 0, p[0], p[1], 0];
  }));
}

function shapePath<T extends Path>(target: T, polygon: readonly (readonly [number, number])[]): T {
  polygon.forEach(([x, y], i) => (i === 0 ? target.moveTo(x, y) : target.lineTo(x, y)));
  target.closePath();
  return target;
}

/** A sketch in its plane: curves, faint construction lines and lightly shaded profiles. */
function createSketch(display: SketchDisplay, theme: ViewportTheme): Group {
  const group = new Group();
  group.name = `sketch-${display.id}`;
  const { u, v } = planeBasis[display.plane];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  group.matrixAutoUpdate = false;
  group.matrix.copy(new Matrix().set(u[0], v[0], n[0] as number, 0, u[1], v[1], n[1] as number, 0, u[2], v[2], n[2] as number, 0, 0, 0, 0, 1));
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
    group.add(fill);
  }
  return group;
}
