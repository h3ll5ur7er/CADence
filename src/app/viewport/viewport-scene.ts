import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';

export type StandardView = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'home';
export type RendererBackend = 'WebGPU' | 'WebGL 2';

/** Colours resolved from the CSS design tokens, so the 3D scene follows the app theme. */
export interface ViewportTheme {
  readonly grid: string;
  readonly gridMajor: string;
  readonly axisX: string;
  readonly axisY: string;
  readonly axisZ: string;
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

  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(35, 1, 0.5, 20_000);
  private readonly renderer: WebGPURenderer;
  private readonly controls: OrbitControls;
  private readonly origin: Group;
  private frame = 0;
  private transition: { from: Quaternion; to: Quaternion; start: number; distance: number } | undefined;
  private initialized = false;

  constructor(canvas: HTMLCanvasElement, theme: ViewportTheme, options: { forceWebGL?: boolean } = {}) {
    this.renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true, forceWebGL: options.forceWebGL ?? false });
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, canvas);
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
    this.scene.add(this.origin);
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
    this.scene.traverse((object) => {
      if (object instanceof Mesh || object instanceof LineSegments) {
        object.geometry.dispose();
        (object.material as { dispose(): void }).dispose();
      }
    });
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
