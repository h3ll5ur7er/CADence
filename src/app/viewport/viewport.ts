import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { Appearance, BodyMesh, PlaneFrame, ThreadMarker, Vec3 } from '@core/contracts';
import { Icon } from '../shared/icon';
import { mouseBindings } from '../shared/keymap';
import { Shortcuts } from '../shared/shortcuts';
import { UserSettings } from '../shared/user-settings';
import { sectionAxis, sectionPlane, type SectionSetting } from './looks';
import type { StressField, SurfaceAnalysis } from './surface-analysis';
import type { Pick, PickKind } from './picking';
import type { SketchDisplay } from './sketch-display';
import type { Affine } from './sketch-planes';
import { ViewCube } from './view-cube';
import { type MoveHandle, type PartDisplay, type RendererBackend, type StandardView, ViewportScene, type ViewportTheme } from './viewport-scene';

function readTheme(element: HTMLElement): ViewportTheme {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    grid: token('--border-strong'),
    gridMajor: token('--text-muted'),
    axisX: token('--axis-x'),
    axisY: token('--axis-y'),
    axisZ: token('--axis-z'),
    sketch: token('--sketch'),
    construction: token('--text-muted'),
    body: token('--body'),
    edge: token('--edge'),
    hover: token('--hover'),
    selection: token('--selection'),
    flag: token('--flag'),
    section: token('--section'),
  };
}

type SectionPlaneChoice = SectionSetting['plane'];

/**
 * True when WebGPU would run on the processor (a fallback adapter, such as SwiftShader on machines
 * without a usable GPU). WebGL 2 is the proven path there: software WebGPU may render nothing.
 */
async function softwareWebGPU(): Promise<boolean> {
  const gpu = (navigator as { gpu?: { requestAdapter(): Promise<{ isFallbackAdapter?: boolean; info?: { isFallbackAdapter?: boolean } } | null> } }).gpu;
  try {
    const adapter = await gpu?.requestAdapter();
    return (adapter?.info?.isFallbackAdapter ?? adapter?.isFallbackAdapter) === true;
  } catch {
    return false;
  }
}

/**
 * The 3D viewport shared by all editor modes. Pure presentation: it renders what it is given
 * and never talks to a manager. Rendering happens outside change detection, on demand.
 * Overlays (such as the sketch editor) are projected on top and share its navigation.
 * How the view is seen (projection, section, framing) belongs to the viewport, not to the document.
 */
/** How long the model must stay unchanged before its picture is taken (ms). */
const thumbnailDelay = 1500;

@Component({
  selector: 'cad-viewport',
  imports: [ViewCube, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-projection]': 'settings.projection()',
    '[attr.data-section]': 'section() ? "on" : "off"',
  },
  template: `
    <canvas #canvas aria-label="3D viewport"></canvas>
    <ng-content />
    <cad-view-cube class="cube" (viewSelected)="showView($event)" (pointerdown)="$event.stopPropagation()">
      <button type="button" class="icon-btn tool" aria-label="Zoom to fit" title="Zoom to fit" (click)="zoomToFit()">
        <cad-icon name="fit" />
      </button>
      <button
        type="button"
        class="icon-btn tool"
        [attr.aria-label]="orthographic() ? 'Perspective view' : 'Orthographic view'"
        [title]="orthographic() ? 'Switch to perspective' : 'Switch to orthographic'"
        [attr.aria-pressed]="orthographic()"
        [class.on]="orthographic()"
        (click)="toggleProjection()"
      >
        <cad-icon [name]="orthographic() ? 'orthographic' : 'perspective'" />
      </button>
      <button type="button" class="icon-btn tool" aria-label="Section view" title="Section view" [attr.aria-pressed]="!!section()" [class.on]="!!section()" (click)="toggleSection()">
        <cad-icon name="section" />
      </button>
      <button type="button" class="icon-btn tool" aria-label="Surface analysis" title="Surface analysis: zebra, curvature, draft" [attr.aria-pressed]="!!analysis()" [class.on]="!!analysis()" (click)="toggleAnalysis()">
        <cad-icon name="analysis" />
      </button>
      <button type="button" class="icon-btn tool" aria-label="Realistic lighting" title="Realistic lighting: reflections and shadows" [attr.aria-pressed]="settings.realistic()" [class.on]="settings.realistic()" (click)="settings.realistic.set(!settings.realistic())">
        <cad-icon name="light" />
      </button>
    </cad-view-cube>
    @if (section(); as s) {
      <form class="section-panel" aria-label="Section view" (pointerdown)="$event.stopPropagation()" (submit)="$event.preventDefault()">
        <p class="eyebrow">Section view</p>
        <label class="field">
          Plane
          <select id="section-plane" [value]="s.plane" (change)="setSectionPlane($any($event.target).value)">
            <option value="XY">XY plane (top)</option>
            <option value="XZ">XZ plane (front)</option>
            <option value="YZ">YZ plane (right)</option>
            <option value="face" [disabled]="!selectedFaceNormal()">Parallel to the selected face</option>
          </select>
        </label>
        <label class="field">
          Offset <span class="value" data-testid="section-offset">{{ s.offset.toFixed(1) }} mm</span>
          <input
            id="section-offset"
            type="range"
            [min]="sectionRange()[0]"
            [max]="sectionRange()[1]"
            [step]="sectionStep()"
            [value]="s.offset"
            (input)="setSectionOffset(+$any($event.target).value)"
          />
        </label>
        <label class="check"><input type="checkbox" [checked]="s.flipped" (change)="flipSection()" /> Flip the side that is cut away</label>
      </form>
    }
    @if (analysis(); as a) {
      <form class="section-panel analysis-panel" aria-label="Surface analysis" (pointerdown)="$event.stopPropagation()" (submit)="$event.preventDefault()">
        <p class="eyebrow">Surface analysis</p>
        <label class="field">
          Show
          <select id="analysis-kind" (change)="setAnalysisKind($any($event.target).value)">
            <option value="zebra" [selected]="a.kind === 'zebra'">Zebra stripes</option>
            <option value="curvature" [selected]="a.kind === 'curvature'">Curvature</option>
            <option value="draft" [selected]="a.kind === 'draft'">Draft angle</option>
          </select>
        </label>
        @if (a.kind === 'zebra') {
          <p class="legend">Stripes that run on smoothly across an edge: the faces meet smoothly; kinks: a crease.</p>
        } @else if (a.kind === 'curvature') {
          <p class="legend"><span class="swatch flat"></span> flat <span class="swatch curved"></span> tightly curved</p>
        } @else {
          <label class="field">
            Pulled along
            <select id="analysis-pull" (change)="setDraft({ pull: pullAt(+$any($event.target).value) })">
              @for (p of pulls; track p.label; let i = $index) {
                <option [value]="i" [selected]="p.direction.join() === a.pull.join()">{{ p.label }}</option>
              }
            </select>
          </label>
          <label class="field">
            Least draft (°)
            <input id="analysis-draft" type="number" min="0" max="45" step="0.5" [value]="a.minimum" (change)="setDraft({ minimum: +$any($event.target).value })" />
          </label>
          <p class="legend"><span class="swatch up"></span> draws out <span class="swatch down"></span> the other half <span class="swatch none"></span> too little draft</p>
        }
      </form>
    }
    @if (failed()) {
      <p class="failure" role="alert">3D graphics are unavailable in this browser.</p>
    }
  `,
  styleUrl: './viewport.scss',
})
export class Viewport {
  readonly showOrigin = input(true);
  readonly sketches = input<readonly SketchDisplay[]>([]);
  readonly bodies = input<readonly BodyMesh[]>([]);
  /** How the component's bodies are shown, by body id. */
  readonly appearances = input<Readonly<Record<string, Appearance>>>({});
  /** Assembly instances, each placed by its transform. */
  readonly parts = input<readonly PartDisplay[]>([]);
  /** Construction planes to show. */
  readonly planes = input<readonly PlaneFrame[]>([]);
  /** The sketch plane being edited: the camera looks straight at it and rotation is locked. */
  readonly editPlane = input<PlaneFrame | undefined>(undefined);
  /** What a click may pick, and what is shown as selected. */
  readonly pickable = input<ReadonlySet<PickKind>>(new Set());
  readonly selection = input<readonly Pick[]>([]);
  /** Faces to flag, such as those a manufacturability check found. */
  readonly flagged = input<readonly { readonly body: string; readonly name: string }[]>([]);
  /** A box to frame whenever it changes (imported files of any size). */
  readonly fit = input<{ readonly min: Vec3; readonly max: Vec3 } | undefined>(undefined);
  /** The two closest points of a distance measurement. */
  readonly measureLine = input<readonly [Vec3, Vec3] | undefined>(undefined);
  /** Threads, drawn as helices on their faces. */
  readonly threads = input<readonly ThreadMarker[]>([]);
  /** Results of a strength check drawn on the bodies. */
  readonly field = input<StressField | undefined>(undefined);
  readonly backendReady = output<RendererBackend>();
  readonly picked = output<Pick>();
  /** A handle to drag a part by (assemblies), and where it is dragged to. */
  readonly handle = input<MoveHandle | undefined>(undefined);
  /** Lines from where exploded parts were to where they are. */
  readonly trails = input<readonly (readonly [Vec3, Vec3])[]>([]);
  readonly handleMoved = output<{ readonly at: readonly number[]; readonly done: boolean }>();
  /** A picture of the model (PNG), a moment after what it shows changed. */
  readonly thumbnail = output<Uint8Array>();

  /** Plane-to-pixel map of the edited plane, updated as the camera pans and zooms. */
  readonly planeMatrix = signal<Affine | undefined>(undefined);
  protected readonly settings = inject(UserSettings);
  protected readonly failed = signal(false);
  protected readonly orthographic = computed(() => this.settings.projection() === 'orthographic');
  protected readonly section = signal<SectionSetting | undefined>(undefined);
  /** Faces coloured to show their shape, or `undefined` for their looks. */
  protected readonly analysis = signal<SurfaceAnalysis | undefined>(undefined);
  protected readonly pulls = [
    { label: 'Z (up)', direction: [0, 0, 1] as const },
    { label: 'Y', direction: [0, 1, 0] as const },
    { label: 'X', direction: [1, 0, 0] as const },
  ];
  protected readonly sectionRange = signal<readonly [number, number]>([-50, 50]);
  protected readonly sectionStep = computed(() => Math.max(0.01, Number(((this.sectionRange()[1] - this.sectionRange()[0]) / 200).toPrecision(1))));
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly cube = viewChild.required(ViewCube);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scene = signal<ViewportScene | undefined>(undefined);
  /** The normal of the selected flat face, for a section parallel to it. */
  protected readonly selectedFaceNormal = computed(() => {
    const scene = this.scene();
    const face = this.selection().find((p) => p.kind === 'face' && p.planar);
    return scene && face ? scene.faceNormal(face) : undefined;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    let destroyed = false;
    destroyRef.onDestroy(() => (destroyed = true));
    afterNextRender(async () => {
      const forceWebGL = new URLSearchParams(location.search).has('webgl') || (await softwareWebGPU());
      if (destroyed) return;
      const canvas = this.canvas().nativeElement;
      const host = this.host.nativeElement;
      const scene = new ViewportScene(canvas, host, readTheme(host), { forceWebGL });
      scene.onCameraChange = (view) => this.cube().setCamera(view);
      scene.onPlaneMatrix = (matrix) => this.planeMatrix.set(matrix);
      scene.onPick = (pick) => this.picked.emit(pick);
      scene.onHandleMove = (at, done) => this.handleMoved.emit({ at, done });
      // Resizing in the next frame keeps layout changes out of the observer callback.
      let pending = 0;
      const resize = new ResizeObserver(([entry]) => {
        if (!entry) return;
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(() => scene.resize(entry.contentRect.width, entry.contentRect.height, devicePixelRatio));
      });
      resize.observe(canvas);
      scene.init().then(
        (backend) => {
          host.dataset['backend'] = backend;
          this.backendReady.emit(backend);
        },
        (error: unknown) => {
          console.error(error);
          this.failed.set(true);
        },
      );
      this.scene.set(scene);
      destroyRef.onDestroy(() => {
        resize.disconnect();
        cancelAnimationFrame(pending);
        scene.dispose();
      });
    });
    effect(() => this.scene()?.setOriginVisible(this.showOrigin()));
    effect(() => this.scene()?.setSketches(this.sketches()));
    effect(() => this.scene()?.editPlane(this.editPlane()));
    effect(() => this.scene()?.setBodies(this.bodies(), this.appearances()));
    effect(() => this.scene()?.setParts(this.parts()));
    effect(() => this.scene()?.setPlanes(this.planes()));
    effect(() => this.scene()?.setPickable(this.pickable()));
    effect(() => this.scene()?.setSelection(this.selection()));
    effect(() => this.scene()?.setFlagged(this.flagged()));
    effect(() => this.scene()?.setField(this.field()));
    effect(() => this.scene()?.setMeasureLine(this.measureLine()));
    effect(() => this.scene()?.setThreads(this.threads()));
    effect(() => this.scene()?.setHandle(this.handle()));
    effect(() => this.scene()?.setAnalysis(this.analysis()));
    effect(() => void this.scene()?.setRealistic(this.settings.realistic()));
    effect(() => this.scene()?.setTrails(this.trails()));
    // A picture once the model has settled: after its bodies, parts or sketches stop changing.
    let pending: ReturnType<typeof setTimeout> | undefined;
    effect((onCleanup) => {
      const scene = this.scene();
      const content = [this.bodies(), this.parts(), this.sketches(), this.appearances()];
      if (!scene || !content.slice(0, 3).some((list) => (list as readonly unknown[]).length)) return;
      clearTimeout(pending);
      pending = setTimeout(() => void scene.snapshot().then((png) => png && this.thumbnail.emit(png)), thumbnailDelay);
      onCleanup(() => clearTimeout(pending));
    });
    effect(() => this.scene()?.setProjection(this.settings.projection()));
    effect(() => this.scene()?.setMouse(mouseBindings[this.settings.controls()]));
    effect(() => {
      const setting = this.section();
      this.scene()?.setSection(setting && sectionPlane(setting));
    });
    effect(() => {
      const box = this.fit();
      if (box) this.scene()?.fitTo(box.min, box.max);
    });
    const unregister = inject(Shortcuts).register('view', {
      'zoom-fit': () => this.zoomToFit(),
      'view-home': () => this.showView('home'),
      'view-front': () => this.showView('front'),
      'view-back': () => this.showView('back'),
      'view-left': () => this.showView('left'),
      'view-right': () => this.showView('right'),
      'view-top': () => this.showView('top'),
      'view-bottom': () => this.showView('bottom'),
      'toggle-projection': () => this.toggleProjection(),
      'toggle-section': () => this.toggleSection(),
    });
    destroyRef.onDestroy(unregister);
  }

  /** The rendered picture as a video stream, for recording animations. */
  /** A JPEG picture of the model from the home direction, framing `box` (the whole model by default). */
  picture(width: number, height: number, box?: { readonly min: Vec3; readonly max: Vec3 }): Promise<Uint8Array | undefined> {
    return this.scene()?.snapshot(width, height, 'image/jpeg', box) ?? Promise.resolve(undefined);
  }

  captureStream(fps: number): MediaStream {
    return this.canvas().nativeElement.captureStream(fps);
  }

  showView(view: StandardView): void {
    this.scene()?.showView(view);
  }

  zoomToFit(): void {
    this.scene()?.zoomToFit();
  }

  toggleProjection(): void {
    this.settings.projection.update((p) => (p === 'orthographic' ? 'perspective' : 'orthographic'));
  }

  /** Turns the section view on, through the middle of the model, or off. */
  protected toggleAnalysis(): void {
    this.analysis.set(this.analysis() ? undefined : { kind: 'zebra', stripes: 12 });
  }

  protected setAnalysisKind(kind: SurfaceAnalysis['kind']): void {
    this.analysis.set(kind === 'zebra' ? { kind, stripes: 12 } : kind === 'curvature' ? { kind } : { kind, pull: [0, 0, 1], minimum: 1 });
  }

  protected pullAt(index: number): readonly [number, number, number] {
    return this.pulls[index]?.direction ?? [0, 0, 1];
  }

  protected setDraft(change: { pull?: readonly [number, number, number]; minimum?: number }): void {
    const current = this.analysis();
    if (current?.kind === 'draft') this.analysis.set({ ...current, ...change });
  }

  /** A PNG of the view as it is seen now, at any size, on white or transparent (CAD-90). */
  exportPicture(width: number, height: number, transparent: boolean): Promise<Uint8Array | undefined> {
    return this.scene()?.picture(width, height, transparent) ?? Promise.resolve(undefined);
  }

  /** A video (WebM) of the model turning once around, `seconds` long; undefined where recording is not available. */
  async recordTurntable(seconds: number): Promise<Uint8Array | undefined> {
    const scene = this.scene();
    if (!scene || typeof MediaRecorder === 'undefined') return undefined;
    const stream = this.captureStream(30);
    const type = ['video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : {});
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    recorder.start();
    // A full turn in `seconds`, following the clock rather than the frame rate.
    await new Promise<void>((resolve) => {
      const start = performance.now();
      let turned = 0;
      const step = () => {
        const target = Math.min(1, (performance.now() - start) / (seconds * 1000)) * 2 * Math.PI;
        scene.orbit(target - turned);
        turned = target;
        if (turned < 2 * Math.PI) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    recorder.stop();
    await stopped;
    for (const track of stream.getTracks()) track.stop();
    return new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
  }

  toggleSection(): void {
    if (this.section()) return this.section.set(undefined);
    this.startSection({ plane: 'XZ', offset: 0, flipped: false });
  }

  protected setSectionPlane(plane: SectionPlaneChoice): void {
    const flipped = this.section()?.flipped ?? false;
    const normal = this.selectedFaceNormal();
    if (plane === 'face') {
      if (normal) this.startSection({ plane, normal, offset: 0, flipped });
    } else {
      this.startSection({ plane, offset: 0, flipped });
    }
  }

  protected setSectionOffset(offset: number): void {
    this.section.update((s) => s && { ...s, offset });
  }

  protected flipSection(): void {
    this.section.update((s) => s && { ...s, flipped: !s.flipped });
  }

  /** A new section plane, placed halfway through what is shown along its axis. */
  private startSection(setting: SectionSetting): void {
    const range = untracked(() => this.scene()?.extentAlong(sectionAxis(setting))) ?? [-50, 50];
    this.sectionRange.set(range);
    this.section.set({ ...setting, offset: Number(((range[0] + range[1]) / 2).toFixed(3)) });
  }
}
