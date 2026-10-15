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
import type { SketchPlane } from '@core/contracts';
import type { SketchDisplay } from './sketch-display';
import type { Affine } from './sketch-planes';
import { ViewCube } from './view-cube';
import { type RendererBackend, type StandardView, ViewportScene, type ViewportTheme } from './viewport-scene';

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
  /** The sketch plane being edited: the camera looks straight at it and rotation is locked. */
  readonly editPlane = input<SketchPlane | undefined>(undefined);
  readonly backendReady = output<RendererBackend>();

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
  }

  showView(view: StandardView): void {
    this.scene()?.showView(view);
  }
}
