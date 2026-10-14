import type { BodyMesh, PlaneFrame, Vec3 } from '@core/contracts';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LineSegments,
  type Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { type Pick, pickAt, type PickKind, pickKey } from './picking';
import { createBody, createPlane, createSketch, edgeHighlight, faceHighlight, lines, type ViewportTheme } from './scene-content';
import type { SketchDisplay } from './sketch-display';
import type { Affine } from './sketch-planes';

export type { ViewportTheme } from './scene-content';
export type StandardView = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'home';
export type RendererBackend = 'WebGPU' | 'WebGL 2';

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
const worldUp = new Vector3(0, 0, 1);
const clickTolerance = 4; // px between press and release

/**
 * The three.js scene behind a viewport: WebGPU renderer (WebGL 2 fallback), Z-up camera, orbit
 * navigation, grid, origin, bodies, sketches and construction planes, with picking. Renders on demand.
 */
export class ViewportScene {
  /** Called with the camera's view matrix whenever the camera moves (drives the view cube). */
  onCameraChange: ((view: Matrix4) => void) | undefined;
  /** While a sketch plane is edited: called with the plane-to-pixel map whenever the camera moves. */
  onPlaneMatrix: ((matrix: Affine | undefined) => void) | undefined;
  /** Called when something pickable is clicked. */
  onPick: ((pick: Pick) => void) | undefined;

  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(35, 1, 0.5, 20_000);
  private readonly renderer: WebGPURenderer;
  private readonly controls: OrbitControls;
  private readonly origin: Group;
  private readonly bodies = new Group();
  private readonly sketches = new Group();
  private readonly planes = new Group();
  private readonly highlights = new Group();
  private readonly annotations = new Group();
  private flagged: readonly { readonly body: string; readonly name: string }[] = [];
  private readonly raycaster = new Raycaster();
  private meshes: readonly BodyMesh[] = [];
  private pickable: ReadonlySet<PickKind> = new Set();
  private selection: readonly Pick[] = [];
  private hovered: Pick | undefined;
  private editedFrame: PlaneFrame | undefined;
  private size = { width: 1, height: 1 };
  private frame = 0;
  private transition: { from: Quaternion; to: Quaternion; start: number; distance: number } | undefined;
  private initialized = false;
  private pressed: { x: number; y: number } | undefined;

  /** `eventTarget` wraps the canvas and its overlays, so overlay events not handled there reach the navigation. */
  constructor(
    canvas: HTMLCanvasElement,
    private readonly eventTarget: HTMLElement,
    private readonly theme: ViewportTheme,
    options: { forceWebGL?: boolean } = {},
  ) {
    this.renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true, forceWebGL: options.forceWebGL ?? false });
    this.camera.up.copy(worldUp);
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
    this.scene.add(this.origin, this.bodies, this.sketches, this.planes, this.highlights, this.annotations);
    this.controls.target.copy(homeTarget);
    this.placeCamera(viewDirections.home, homeDistance);

    eventTarget.addEventListener('pointermove', this.hover);
    eventTarget.addEventListener('pointerdown', this.press);
    eventTarget.addEventListener('pointerup', this.release);
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

  setSketches(displays: readonly SketchDisplay[]): void {
    this.replace(this.sketches, displays.map((d) => createSketch(d, this.theme)));
  }

  setBodies(meshes: readonly BodyMesh[]): void {
    this.meshes = meshes;
    this.replace(this.bodies, meshes.map((m) => createBody(m, this.theme)));
    this.updateHighlights();
  }

  setPlanes(frames: readonly PlaneFrame[]): void {
    this.replace(this.planes, frames.map((f) => createPlane(f, this.theme.construction)));
  }

  /** What clicks may pick; nothing while a sketch is edited. */
  setPickable(kinds: ReadonlySet<PickKind>): void {
    this.pickable = kinds;
    if (this.hovered && !kinds.has(this.hovered.kind)) this.hovered = undefined;
    this.updateHighlights();
  }

  setSelection(picks: readonly Pick[]): void {
    this.selection = picks;
    this.updateHighlights();
  }

  /** Faces a validation check is about, shown in the flag colour. */
  setFlagged(faces: readonly { readonly body: string; readonly name: string }[]): void {
    this.flagged = faces;
    this.updateHighlights();
  }

  /** A measured distance: a line between the two closest points, drawn over everything. */
  setMeasureLine(points: readonly [Vec3, Vec3] | undefined): void {
    const children: Object3D[] = [];
    if (points) {
      const [a, b] = points;
      const line = lines([...a, ...b], this.theme.selection);
      (line.material as { depthTest: boolean }).depthTest = false;
      line.renderOrder = 5;
      // End markers sized to the model, so they read at any zoom that shows the whole part.
      let extent = 10;
      for (const mesh of this.meshes) for (const v of mesh.positions) extent = Math.max(extent, Math.abs(v));
      const radius = extent / 100;
      const ends = points.map((p) => {
        const end = new Mesh(new SphereGeometry(radius, 12, 8), new MeshBasicMaterial({ color: new Color(this.theme.selection), depthTest: false }));
        end.position.set(...p);
        end.renderOrder = 5;
        return end;
      });
      children.push(line, ...ends);
    }
    this.replace(this.annotations, children);
    this.requestRender();
  }

  /** Looks straight at a plane (u right, v up) and locks rotation while it is edited; `undefined` ends editing. */
  editPlane(frame: PlaneFrame | undefined): void {
    const same = frame && this.editedFrame && JSON.stringify(frame) === JSON.stringify(this.editedFrame);
    if (same) return;
    this.editedFrame = frame;
    this.controls.enableRotate = frame === undefined;
    if (frame) {
      const normal = new Vector3(...frame.u).cross(new Vector3(...frame.v)).normalize();
      this.camera.up.set(...frame.v);
      this.controls.target.set(...frame.origin);
      this.turnTo(normal, this.camera.position.distanceTo(this.controls.target));
    } else {
      this.camera.up.copy(worldUp);
      this.onPlaneMatrix?.(undefined);
    }
    this.requestRender();
  }

  /** Turns the camera to a standard view around the current target, keeping the distance. */
  showView(view: StandardView): void {
    const distance = view === 'home' ? homeDistance : this.camera.position.distanceTo(this.controls.target);
    if (view === 'home') this.controls.target.copy(homeTarget);
    this.turnTo(viewDirections[view], distance);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.eventTarget.removeEventListener('pointermove', this.hover);
    this.eventTarget.removeEventListener('pointerdown', this.press);
    this.eventTarget.removeEventListener('pointerup', this.release);
    this.controls.dispose();
    disposeTree(this.scene);
    this.renderer.dispose();
  }

  // ---- picking ------------------------------------------------------------------------------

  private readonly hover = (event: PointerEvent): void => {
    if (this.pickable.size === 0 || event.buttons !== 0) return;
    const pick = this.pickUnder(event);
    if (pick?.kind === this.hovered?.kind && pick && this.hovered && pickKey(pick) === pickKey(this.hovered)) return;
    this.hovered = pick;
    this.eventTarget.style.cursor = pick ? 'pointer' : '';
    this.updateHighlights();
  };

  private readonly press = (event: PointerEvent): void => {
    this.pressed = event.button === 0 ? { x: event.clientX, y: event.clientY } : undefined;
  };

  private readonly release = (event: PointerEvent): void => {
    const pressed = this.pressed;
    this.pressed = undefined;
    if (!pressed || Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > clickTolerance) return;
    const pick = this.pickUnder(event);
    if (pick) this.onPick?.(pick);
  };

  private pickUnder(event: PointerEvent): Pick | undefined {
    const rect = this.eventTarget.getBoundingClientRect();
    const ndc = new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // Edges are picked within a few pixels of the cursor.
    const distance = this.camera.position.distanceTo(this.controls.target);
    const worldPerPixel = (2 * distance * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(rect.height, 1);
    this.raycaster.params.Line = { threshold: worldPerPixel * 5 };
    return pickAt(this.raycaster, [this.bodies, this.sketches], this.pickable);
  }

  private updateHighlights(): void {
    disposeTree(this.highlights);
    this.highlights.clear();
    const add = (pick: Pick, color: string) => {
      if (pick.kind === 'profile') {
        const fill = this.sketches.getObjectByName(`sketch-${pick.sketch}`)?.children.find(
          (c) => (c.userData as { pick?: Pick }).pick?.kind === 'profile' && ((c.userData as { pick: Pick }).pick as { profile: string }).profile === pick.profile,
        ) as Mesh | undefined;
        if (!fill) return;
        const copy = new Mesh(fill.geometry.clone(), new MeshBasicMaterial({ color: new Color(color), transparent: true, opacity: 0.4, side: DoubleSide, depthWrite: false }));
        copy.matrixAutoUpdate = false;
        copy.matrix.copy((fill.parent as Group).matrix);
        copy.renderOrder = 2;
        this.highlights.add(copy);
        return;
      }
      const mesh = this.meshes.find((m) => m.body === pick.body);
      const highlight = mesh && (pick.kind === 'face' ? faceHighlight(mesh, pick.name, color) : edgeHighlight(mesh, pick.name, color));
      if (highlight) this.highlights.add(highlight);
    };
    for (const face of this.flagged) {
      const mesh = this.meshes.find((m) => m.body === face.body);
      const highlight = mesh && faceHighlight(mesh, face.name, this.theme.flag);
      if (highlight) this.highlights.add(highlight);
    }
    for (const pick of this.selection) add(pick, this.theme.selection);
    if (this.hovered && !this.selection.some((s) => pickKey(s) === pickKey(this.hovered as Pick))) add(this.hovered, this.theme.hover);
    this.requestRender();
  }

  // ---- rendering and camera -----------------------------------------------------------------

  private replace(group: Group, children: readonly Object3D[]): void {
    disposeTree(group);
    group.clear();
    if (children.length) group.add(...children);
    this.requestRender();
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
    if (this.editedFrame) this.onPlaneMatrix?.(this.planeMatrix(this.editedFrame));
    if (animating || moving) this.requestRender();
  }

  private turnTo(direction: Vector3, distance: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target).normalize();
    const from = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), offset);
    const to = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), direction.clone().normalize());
    this.transition = { from, to, start: performance.now(), distance };
    this.requestRender();
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

  private placeCamera(direction: Vector3, distance: number): void {
    this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld();
  }

  /** Projects the plane's origin and axes; exact while the camera looks straight at the plane. */
  private planeMatrix(frame: PlaneFrame): Affine {
    const project = (p: Vector3): [number, number] => {
      const ndc = p.clone().project(this.camera);
      return [((ndc.x + 1) / 2) * this.size.width, ((1 - ndc.y) / 2) * this.size.height];
    };
    const unit = 100;
    const origin = new Vector3(...frame.origin);
    const [ox, oy] = project(origin);
    const [ux, uy] = project(origin.clone().addScaledVector(new Vector3(...frame.u), unit));
    const [vx, vy] = project(origin.clone().addScaledVector(new Vector3(...frame.v), unit));
    return { a: (ux - ox) / unit, b: (uy - oy) / unit, c: (vx - ox) / unit, d: (vy - oy) / unit, e: ox, f: oy };
  }
}

function disposeTree(root: Object3D): void {
  root.traverse((object) => {
    if (object instanceof Mesh || object instanceof LineSegments) {
      object.geometry.dispose();
      (object.material as { dispose(): void }).dispose();
    }
  });
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
