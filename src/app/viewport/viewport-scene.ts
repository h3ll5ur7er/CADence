import type { Appearance, BodyMesh, Matrix4 as Placement, PlaneFrame, ThreadMarker, Vec3 } from '@core/contracts';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
  Box3,
  ClippingGroup,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LineSegments,
  type Matrix4,
  Matrix3,
  Mesh,
  MeshBasicMaterial,
  MOUSE,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import type { DragAction, MouseBindings } from '../shared/keymap';
import { lookOf, type SectionPlane } from './looks';
import { meshVertices, type Pick, pickAt, type PickKind, pickKey, type TopologyPick } from './picking';
import { createBody, createPlane, createSketch, edgeHighlight, faceHighlight, lines, threadHelix, type ViewportTheme } from './scene-content';
import type { SketchDisplay } from './sketch-display';
import type { Affine } from './sketch-planes';

export type { ViewportTheme } from './scene-content';

/** An assembly instance: its component's bodies where the assembly puts them. */
export interface PartDisplay {
  readonly id: string;
  readonly bodies: readonly BodyMesh[];
  readonly transform: Placement;
  /** Shown in the flag colour (e.g. interfering parts). */
  readonly flagged?: boolean;
  /** How the component shows its bodies, by body id. */
  readonly bodyAppearances?: Readonly<Record<string, Appearance>>;
  /** The instance's own appearance, over its bodies'. */
  readonly appearance?: Appearance;
}
/** Arrows (or rings) to drag a part by: where they sit and point, and which of their axes move. */
export interface MoveHandle {
  readonly at: Placement;
  readonly mode: 'translate' | 'rotate';
  readonly axes: readonly ('X' | 'Y' | 'Z')[];
}

export type StandardView = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'home';
export type RendererBackend = 'WebGPU' | 'WebGL 2';
export type Projection = 'perspective' | 'orthographic';

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
const vertexReach = 8; // px from the cursor to a vertex
const fov = 35;
const mouseActions: Readonly<Record<Exclude<DragAction, null>, MOUSE>> = { orbit: MOUSE.ROTATE, pan: MOUSE.PAN, zoom: MOUSE.DOLLY };

/**
 * The three.js scene behind a viewport: WebGPU renderer (WebGL 2 fallback), Z-up perspective or
 * orthographic camera, orbit navigation, grid, origin, bodies, sketches and construction planes, a
 * section plane, with picking. Renders on demand.
 */
export class ViewportScene {
  /** Called with the camera's view matrix whenever the camera moves (drives the view cube). */
  onCameraChange: ((view: Matrix4) => void) | undefined;
  /** While a sketch plane is edited: called with the plane-to-pixel map whenever the camera moves. */
  onPlaneMatrix: ((matrix: Affine | undefined) => void) | undefined;
  /** Called when something pickable is clicked. */
  onPick: ((pick: Pick) => void) | undefined;
  /** Called while the move handle is dragged (where it is now), and once more when it is let go. */
  onHandleMove: ((at: Placement, done: boolean) => void) | undefined;

  private readonly scene = new Scene();
  private readonly perspective = new PerspectiveCamera(fov, 1, 0.5, 20_000);
  private readonly orthographic = new OrthographicCamera(-1, 1, 1, -1, -20_000, 20_000);
  private camera: PerspectiveCamera | OrthographicCamera = this.perspective;
  private readonly renderer: WebGPURenderer;
  private readonly controls: OrbitControls;
  private readonly origin: Group;
  /** Bodies and parts: what a section view cuts. */
  private readonly model = new ClippingGroup();
  private readonly bodies = new Group();
  private readonly sketches = new Group();
  private readonly planes = new Group();
  private readonly highlights = new Group();
  private readonly annotations = new Group();
  private readonly grid: Group;
  private readonly threads = new Group();
  /** Lines from where exploded parts were to where they are. */
  private readonly trails = new Group();
  private readonly parts = new Group();
  private partEntries = new Map<string, { readonly group: Group; readonly signature: string; readonly part: PartDisplay }>();
  private flagged: readonly { readonly body: string; readonly name: string }[] = [];
  private readonly raycaster = new Raycaster();
  /** The component's shown bodies. */
  private meshes: readonly BodyMesh[] = [];
  private pickable: ReadonlySet<PickKind> = new Set();
  private selection: readonly Pick[] = [];
  private hovered: Pick | undefined;
  private section: SectionPlane | undefined;
  private editedFrame: PlaneFrame | undefined;
  private size = { width: 1, height: 1 };
  private frame = 0;
  private transition: { from: Quaternion; to: Quaternion; start: number; distance: number } | undefined;
  private initialized = false;
  private pressed: { x: number; y: number } | undefined;
  private handle: { readonly controls: TransformControls; readonly proxy: Object3D } | undefined;
  private handleDragging = false;

  /** `eventTarget` wraps the canvas and its overlays, so overlay events not handled there reach the navigation. */
  constructor(
    canvas: HTMLCanvasElement,
    private readonly eventTarget: HTMLElement,
    private readonly theme: ViewportTheme,
    options: { forceWebGL?: boolean } = {},
  ) {
    this.renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true, forceWebGL: options.forceWebGL ?? false });
    this.perspective.up.copy(worldUp);
    this.orthographic.up.copy(worldUp);
    this.controls = new OrbitControls(this.camera, eventTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.requestRender());

    this.scene.add(new HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const sun = new DirectionalLight(0xffffff, 1.4);
    sun.position.set(300, -400, 600);
    this.scene.add(sun);
    this.grid = createGrid(theme);
    this.scene.add(this.grid);
    this.origin = createOrigin(theme);
    this.model.enabled = false;
    this.model.add(this.bodies, this.parts);
    this.scene.add(this.origin, this.model, this.sketches, this.planes, this.threads, this.trails, this.highlights, this.annotations);
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
    this.perspective.aspect = width / Math.max(height, 1);
    this.perspective.updateProjectionMatrix();
    this.setOrthographicHeight(this.orthographic.top - this.orthographic.bottom, false);
    this.requestRender();
  }

  setOriginVisible(visible: boolean): void {
    this.origin.visible = visible;
    this.requestRender();
  }

  setSketches(displays: readonly SketchDisplay[]): void {
    this.replace(this.sketches, displays.map((d) => createSketch(d, this.theme)));
  }

  /** The component's bodies, in their appearances; hidden ones are neither drawn nor picked. */
  setBodies(meshes: readonly BodyMesh[], appearances: Readonly<Record<string, Appearance>> = {}): void {
    const shown = meshes.flatMap((mesh) => {
      const look = lookOf(this.theme.body, appearances[mesh.body]);
      return look ? [{ mesh, look }] : [];
    });
    this.meshes = shown.map((s) => s.mesh);
    this.replace(this.bodies, shown.map(({ mesh, look }) => createBody(mesh, this.theme, look)));
    this.showCuts();
    this.updateHighlights();
  }

  /**
   * Assembly instances. Parts whose bodies and looks did not change keep their scene objects and only
   * move, so playing a motion study costs one matrix per part and frame. Hidden instances are left out.
   */
  setParts(parts: readonly PartDisplay[]): void {
    const next = new Map<string, { group: Group; signature: string; part: PartDisplay }>();
    for (const part of parts) {
      if (part.appearance?.hidden) continue;
      const looks = part.bodies.map((b) => (part.flagged ? { color: this.theme.flag, opacity: 1 } : lookOf(this.theme.body, part.bodyAppearances?.[b.body], part.appearance)));
      const signature = `${part.bodies.map((b) => b.key).join('|')}:${JSON.stringify(looks)}`;
      let entry = this.partEntries.get(part.id);
      if (!entry || entry.signature !== signature) {
        if (entry) this.drop(entry.group);
        const group = new Group();
        group.name = `part-${part.id}`;
        group.userData = { instance: part.id };
        group.matrixAutoUpdate = false;
        part.bodies.forEach((mesh, i) => {
          const look = looks[i];
          if (look) group.add(createBody(mesh, this.theme, look));
        });
        this.parts.add(group);
        entry = { group, signature, part };
      }
      entry.group.matrix.fromArray([...part.transform]);
      entry.group.updateMatrixWorld(true);
      next.set(part.id, { ...entry, part });
    }
    for (const [id, entry] of this.partEntries) if (!next.has(id)) this.drop(entry.group);
    this.partEntries = next;
    this.showCuts();
    this.updateHighlights();
  }

  private drop(group: Group): void {
    disposeTree(group);
    this.parts.remove(group);
  }

  /** Threads as helices on their faces, seen through the material like hidden lines in a drawing. */
  setThreads(threads: readonly ThreadMarker[]): void {
    const helices = threads.map((t) => {
      const helix = threadHelix(t, this.theme.selection);
      (helix.material as { depthTest: boolean; opacity: number; transparent: boolean }).depthTest = false;
      helix.renderOrder = 4;
      return helix;
    });
    this.replace(this.threads, helices);
    this.requestRender();
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
      const ends = points.map((p) => this.marker(p, radius, this.theme.selection));
      children.push(line, ...ends);
    }
    this.replace(this.annotations, children);
    this.requestRender();
  }

  setTrails(segments: readonly (readonly [Vec3, Vec3])[]): void {
    this.replace(this.trails, segments.length ? [lines(segments.flatMap(([a, b]) => [...a, ...b]), this.theme.construction)] : []);
    this.requestRender();
  }

  /** Cuts the bodies and parts with a plane, or shows them whole again. */
  setSection(plane: SectionPlane | undefined): void {
    this.section = plane;
    this.model.enabled = plane !== undefined;
    this.model.clippingPlanes = plane ? [this.clippingPlane(plane)] : [];
    this.showCuts();
    this.hovered = undefined;
    this.updateHighlights();
  }

  /** How far the bodies and parts reach along a direction, to bound a section offset. */
  extentAlong(normal: Vec3): readonly [number, number] | undefined {
    const box = new Box3().setFromObject(this.model);
    if (box.isEmpty()) return undefined;
    const n = new Vector3(...normal);
    const values = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).dot(n),
    );
    return [Math.min(...values), Math.max(...values)];
  }

  /** The outward normal of a picked flat face, in world space. */
  faceNormal(pick: Pick): Vec3 | undefined {
    if (pick.kind !== 'face') return undefined;
    const part = pick.instance ? this.partEntries.get(pick.instance) : undefined;
    const mesh = (part ? part.part.bodies : this.meshes).find((m) => m.body === pick.body);
    const face = mesh?.faces.find((f) => f.name === pick.name);
    const vertex = mesh && face ? (mesh.indices[face.start] as number) : undefined;
    if (!mesh || vertex === undefined) return undefined;
    const normal = new Vector3(mesh.normals[vertex * 3], mesh.normals[vertex * 3 + 1], mesh.normals[vertex * 3 + 2]);
    if (part) normal.applyMatrix3(new Matrix3().getNormalMatrix(part.group.matrix));
    normal.normalize();
    return [normal.x + 0, normal.y + 0, normal.z + 0];
  }

  /** Mouse buttons and wheel as the control scheme has them. */
  setMouse(bindings: MouseBindings): void {
    const action = (drag: DragAction) => (drag ? mouseActions[drag] : null);
    this.controls.mouseButtons = { LEFT: action(bindings.left), MIDDLE: action(bindings.middle), RIGHT: action(bindings.right) };
    this.controls.zoomToCursor = bindings.zoomToCursor;
  }

  /** Perspective, or orthographic (parallel lines stay parallel); the view keeps its direction and scale. */
  setProjection(projection: Projection): void {
    const orthographic = projection === 'orthographic';
    if (orthographic === (this.camera === this.orthographic)) return;
    const height = this.viewHeight();
    const from = this.camera;
    const to = orthographic ? this.orthographic : this.perspective;
    const direction = from.position.clone().sub(this.controls.target).normalize();
    to.up.copy(from.up);
    this.camera = to;
    if (orthographic) this.setOrthographicHeight(height, true);
    this.placeCamera(direction, orthographic ? from.position.distanceTo(this.controls.target) : height / (2 * Math.tan((fov * Math.PI) / 360)));
    this.controls.object = to;
    this.controls.update();
    if (this.handle) this.handle.controls.camera = to;
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

  /** Looks at a box from the home direction, close enough that it fills most of the view. */
  fitTo(min: Vec3, max: Vec3): void {
    this.frameBox(new Box3(new Vector3(...min), new Vector3(...max)), viewDirections.home);
  }

  /** Frames everything shown (bodies and parts, else sketches) from the current direction. */
  zoomToFit(): void {
    const box = new Box3().setFromObject(this.model);
    if (box.isEmpty()) box.setFromObject(this.sketches);
    if (box.isEmpty()) return this.showView('home');
    this.frameBox(box, this.camera.position.clone().sub(this.controls.target).normalize());
  }

  /** Turns the camera to a standard view around the current target, keeping the distance. */
  showView(view: StandardView): void {
    const home = view === 'home';
    const distance = home ? homeDistance : this.camera.position.distanceTo(this.controls.target);
    if (home) this.controls.target.copy(homeTarget);
    this.turnTo(viewDirections[view], distance, home);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.eventTarget.removeEventListener('pointermove', this.hover);
    this.eventTarget.removeEventListener('pointerdown', this.press);
    this.eventTarget.removeEventListener('pointerup', this.release);
    this.setHandle(undefined);
    this.controls.dispose();
    disposeTree(this.scene);
    this.renderer.dispose();
  }

  // ---- move handle --------------------------------------------------------------------------

  /** Shows the move handle (or removes it). It keeps where it is while being dragged. */
  setHandle(handle: MoveHandle | undefined): void {
    if (!handle) {
      if (this.handle) {
        this.handle.controls.detach();
        this.scene.remove(this.handle.controls.getHelper(), this.handle.proxy);
        this.handle.controls.dispose();
        this.handle = undefined;
        this.handleDragging = false;
        this.controls.enabled = true;
      }
      this.requestRender();
      return;
    }
    if (!this.handle) {
      const proxy = new Object3D();
      const controls = new TransformControls(this.camera, this.eventTarget);
      controls.space = 'local';
      controls.size = 0.8;
      controls.attach(proxy);
      const placement = (): Placement => (proxy.updateMatrixWorld(), proxy.matrixWorld.toArray());
      controls.addEventListener('dragging-changed', (event) => {
        const dragging = (event as unknown as { value: boolean }).value;
        this.handleDragging = dragging;
        this.controls.enabled = !dragging;
        if (!dragging) this.onHandleMove?.(placement(), true);
      });
      controls.addEventListener('objectChange', () => this.onHandleMove?.(placement(), false));
      controls.addEventListener('change', () => this.requestRender());
      this.scene.add(proxy, controls.getHelper());
      this.handle = { controls, proxy };
    }
    if (this.handleDragging) return;
    const { controls, proxy } = this.handle;
    proxy.matrix.fromArray([...handle.at]);
    proxy.matrix.decompose(proxy.position, proxy.quaternion, proxy.scale);
    proxy.updateMatrixWorld(true);
    controls.setMode(handle.mode);
    controls.showX = handle.axes.includes('X');
    controls.showY = handle.axes.includes('Y');
    controls.showZ = handle.axes.includes('Z');
    this.requestRender();
  }

  // ---- section ------------------------------------------------------------------------------

  /** Three.js keeps what lies on the positive side of a clipping plane: the side away from the normal. */
  private clippingPlane(plane: SectionPlane): Plane {
    const normal = new Vector3(...plane.normal).normalize();
    return new Plane(normal.clone().negate(), normal.dot(new Vector3(...plane.point)));
  }

  /** False for points the section cuts away. */
  private readonly kept = (point: Vector3): boolean =>
    !this.section || new Vector3(...this.section.normal).dot(point.clone().sub(new Vector3(...this.section.point))) <= 1e-6;

  /** The cut faces show only while a section cuts the model. */
  private showCuts(): void {
    this.model.traverse((object) => {
      if (object.name === 'cut') object.visible = this.section !== undefined;
    });
    this.requestRender();
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
    // A press on the move handle drags it; it picks nothing.
    if (this.handleDragging) return;
    if (!pressed || Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > clickTolerance) return;
    const pick = this.pickUnder(event);
    if (pick) this.onPick?.(pick);
  };

  private pickUnder(event: PointerEvent): Pick | undefined {
    const rect = this.eventTarget.getBoundingClientRect();
    const ndc = new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // Edges are picked within a few pixels of the cursor.
    const worldPerPixel = this.viewHeight() / Math.max(rect.height, 1);
    this.raycaster.params.Line = { threshold: worldPerPixel * 5 };
    const vertex = this.pickable.has('vertex') ? this.vertexUnder(event.clientX - rect.left, event.clientY - rect.top, worldPerPixel) : undefined;
    return vertex ?? pickAt(this.raycaster, [this.bodies, this.parts, this.sketches], this.pickable, this.kept);
  }

  /**
   * The vertex nearest the cursor within a few pixels that is not hidden behind a surface: vertices
   * are too small to hit with a ray, so they are found on screen.
   */
  private vertexUnder(x: number, y: number, worldPerPixel: number): TopologyPick | undefined {
    const surface = this.raycaster.intersectObjects([this.bodies, this.parts], true).find((h) => h.object instanceof Mesh && h.object.name !== 'cut' && this.kept(h.point));
    let best: { pick: TopologyPick; distance: number } | undefined;
    const consider = (mesh: BodyMesh, matrix: Matrix4 | undefined, instance: string | undefined) => {
      for (const vertex of meshVertices(mesh)) {
        const world = new Vector3(...vertex.point);
        if (matrix) world.applyMatrix4(matrix);
        if (!this.kept(world)) continue;
        const screen = world.clone().project(this.camera);
        const distance = Math.hypot(((screen.x + 1) / 2) * this.size.width - x, ((1 - screen.y) / 2) * this.size.height - y);
        if (distance > vertexReach || (best && distance >= best.distance)) continue;
        // Behind the surface under the cursor: hidden.
        if (surface && world.distanceTo(this.raycaster.ray.origin) > surface.distance + worldPerPixel * 10) continue;
        best = { pick: { kind: 'vertex', body: mesh.body, name: vertex.name, hint: vertex.point, ...(instance ? { instance } : {}) }, distance };
      }
    };
    for (const mesh of this.meshes) consider(mesh, undefined, undefined);
    for (const [id, entry] of this.partEntries) for (const mesh of entry.part.bodies) consider(mesh, entry.group.matrix, id);
    return best?.pick;
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
      const part = pick.instance ? this.partEntries.get(pick.instance) : undefined;
      if (pick.kind === 'vertex') {
        const at = new Vector3(...pick.hint);
        if (part) at.applyMatrix4(part.group.matrix);
        this.highlights.add(this.marker([at.x, at.y, at.z], (this.viewHeight() / Math.max(this.size.height, 1)) * 5, color));
        return;
      }
      const mesh = (part ? part.part.bodies : this.meshes).find((m) => m.body === pick.body);
      const highlight = mesh && (pick.kind === 'face' ? faceHighlight(mesh, pick.name, color) : edgeHighlight(mesh, pick.name, color));
      if (!highlight) return;
      if (part) {
        highlight.matrixAutoUpdate = false;
        highlight.matrix.copy(part.group.matrix);
      }
      this.highlights.add(highlight);
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

  /** A small sphere drawn over everything. */
  private marker(point: Vec3, radius: number, color: string): Mesh {
    const marker = new Mesh(new SphereGeometry(radius, 12, 8), new MeshBasicMaterial({ color: new Color(color), depthTest: false }));
    marker.position.set(...point);
    marker.renderOrder = 6;
    return marker;
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

  /**
   * A picture of the model from the home direction, framed to fit (without the grid, origin, planes
   * and highlights), cropped to `width` × `height`, as PNG bytes.
   */
  async snapshot(width = 320, height = 200, type: 'image/png' | 'image/jpeg' = 'image/png', frame?: { readonly min: Vec3; readonly max: Vec3 }): Promise<Uint8Array | undefined> {
    const box = frame ? new Box3(new Vector3(...frame.min), new Vector3(...frame.max)) : new Box3().setFromObject(this.model);
    if (box.isEmpty()) box.setFromObject(this.sketches);
    if (box.isEmpty()) return undefined;
    const helpers = [this.grid, this.origin, this.planes, this.highlights, this.annotations];
    const shown = helpers.map((h) => h.visible);
    for (const h of helpers) h.visible = false;
    try {
      const source = this.renderer.domElement;
      const camera = new PerspectiveCamera(fov, source.width / Math.max(source.height, 1), 0.1, 1e6);
      const center = box.getCenter(new Vector3());
      const radius = Math.max(box.getSize(new Vector3()).length() / 2, 1);
      // Far enough that the model's sphere fits the picture's height (the crop keeps the middle).
      const distance = (radius / Math.sin((fov * Math.PI) / 360)) * 1.05;
      camera.position.copy(center).add(viewDirections.home.clone().normalize().multiplyScalar(distance));
      camera.up.set(0, 0, 1);
      camera.lookAt(center);
      camera.near = Math.max(distance - radius * 2, 0.1);
      camera.far = distance + radius * 2;
      camera.updateProjectionMatrix();
      this.renderer.render(this.scene, camera);
      const picture = document.createElement('canvas');
      [picture.width, picture.height] = [width, height];
      const context = picture.getContext('2d');
      if (!context || !source.width || !source.height) return undefined;
      // Crop the middle of the view to the picture's proportions.
      const scale = Math.min(source.width / width, source.height / height);
      const [w, h] = [width * scale, height * scale];
      // JPEG has no transparency: white behind the model.
      if (type === 'image/jpeg') {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
      }
      context.drawImage(source, (source.width - w) / 2, (source.height - h) / 2, w, h, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => picture.toBlob(resolve, type, 0.9));
      return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
    } finally {
      helpers.forEach((h, i) => (h.visible = shown[i] as boolean));
      this.requestRender();
    }
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

  /** The height of the view at the target, in millimetres. */
  private viewHeight(): number {
    if (this.camera === this.orthographic) return (this.orthographic.top - this.orthographic.bottom) / this.orthographic.zoom;
    return 2 * this.camera.position.distanceTo(this.controls.target) * Math.tan((fov * Math.PI) / 360);
  }

  /** Sizes the orthographic view to show `height` millimetres (`reset`: at zoom 1). */
  private setOrthographicHeight(height: number, reset: boolean): void {
    const camera = this.orthographic;
    const half = height / 2;
    const aspect = this.size.width / Math.max(this.size.height, 1);
    Object.assign(camera, { top: half, bottom: -half, left: -half * aspect, right: half * aspect });
    if (reset) camera.zoom = 1;
    camera.updateProjectionMatrix();
  }

  /** Looks at a box along `direction`, close enough that it fills most of the view. */
  private frameBox(box: Box3, direction: Vector3): void {
    const center = box.getCenter(new Vector3());
    const radius = Math.max(1, box.max.distanceTo(box.min) / 2);
    const distance = (radius / Math.sin((fov * Math.PI) / 360)) * 1.15;
    this.perspective.near = Math.max(0.01, distance / 2000);
    this.perspective.far = distance * 100;
    this.perspective.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.turnTo(direction, distance, true);
  }

  /** Turns to a direction at a distance; `rescale` also sizes an orthographic view to match that distance. */
  private turnTo(direction: Vector3, distance: number, rescale = false): void {
    if (rescale && this.camera === this.orthographic) this.setOrthographicHeight(2 * distance * Math.tan((fov * Math.PI) / 360), true);
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
