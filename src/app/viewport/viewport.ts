import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { BodyMesh, PlaneFrame, Vec3 } from '@core/contracts';
import type { Pick, PickKind } from './picking';
import type { SketchDisplay } from './sketch-display';
import type { Affine } from './sketch-planes';
import { ViewCube } from './view-cube';
import { type PartDisplay, type RendererBackend, type StandardView, ViewportScene, type ViewportTheme } from './viewport-scene';

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
  };
}

/**
 * The 3D viewport shared by all editor modes. Pure presentation: it renders what it is given
 * and never talks to a manager. Rendering happens outside change detection, on demand.
 * Overlays (such as the sketch editor) are projected on top and share its navigation.
 */
@Component({
  selector: 'cad-viewport',
  imports: [ViewCube],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas #canvas aria-label="3D viewport"></canvas>
    <ng-content />
    <cad-view-cube class="cube" (viewSelected)="showView($event)" (pointerdown)="$event.stopPropagation()" />
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
  readonly backendReady = output<RendererBackend>();
  readonly picked = output<Pick>();

  /** Plane-to-pixel map of the edited plane, updated as the camera pans and zooms. */
  readonly planeMatrix = signal<Affine | undefined>(undefined);
  protected readonly failed = signal(false);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly cube = viewChild.required(ViewCube);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scene = signal<ViewportScene | undefined>(undefined);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const canvas = this.canvas().nativeElement;
      const host = this.host.nativeElement;
      const forceWebGL = new URLSearchParams(location.search).has('webgl');
      const scene = new ViewportScene(canvas, host, readTheme(host), { forceWebGL });
      scene.onCameraChange = (view) => this.cube().setCamera(view);
      scene.onPlaneMatrix = (matrix) => this.planeMatrix.set(matrix);
      scene.onPick = (pick) => this.picked.emit(pick);
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
    effect(() => this.scene()?.setBodies(this.bodies()));
    effect(() => this.scene()?.setParts(this.parts()));
    effect(() => this.scene()?.setPlanes(this.planes()));
    effect(() => this.scene()?.setPickable(this.pickable()));
    effect(() => this.scene()?.setSelection(this.selection()));
    effect(() => this.scene()?.setFlagged(this.flagged()));
    effect(() => this.scene()?.setMeasureLine(this.measureLine()));
    effect(() => {
      const box = this.fit();
      if (box) this.scene()?.fitTo(box.min, box.max);
    });
  }

  /** The rendered picture as a video stream, for recording animations. */
  captureStream(fps: number): MediaStream {
    return this.canvas().nativeElement.captureStream(fps);
  }

  showView(view: StandardView): void {
    this.scene()?.showView(view);
  }
}
