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
  };
}

/**
 * The 3D viewport shared by all editor modes. Pure presentation: it renders what it is given
 * and never talks to a manager. Rendering happens outside change detection, on demand.
 */
@Component({
  selector: 'cad-viewport',
  imports: [ViewCube],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas #canvas aria-label="3D viewport"></canvas>
    <cad-view-cube class="cube" (viewSelected)="showView($event)" />
    @if (failed()) {
      <p class="failure" role="alert">3D graphics are unavailable in this browser.</p>
    }
    <ng-content />
  `,
  styleUrl: './viewport.scss',
})
export class Viewport {
  readonly showOrigin = input(true);
  readonly backendReady = output<RendererBackend>();

  protected readonly failed = signal(false);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly cube = viewChild.required(ViewCube);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private scene: ViewportScene | undefined;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const canvas = this.canvas().nativeElement;
      const forceWebGL = new URLSearchParams(location.search).has('webgl');
      const scene = new ViewportScene(canvas, readTheme(this.host.nativeElement), { forceWebGL });
      scene.onCameraChange = (view) => this.cube().setCamera(view);
      this.scene = scene;
      const resize = new ResizeObserver(([entry]) => {
        if (entry) scene.resize(entry.contentRect.width, entry.contentRect.height, devicePixelRatio);
      });
      resize.observe(canvas);
      scene.setOriginVisible(this.showOrigin());
      scene.init().then(
        (backend) => {
          this.host.nativeElement.dataset['backend'] = backend;
          this.backendReady.emit(backend);
        },
        (error: unknown) => {
          console.error(error);
          this.failed.set(true);
        },
      );
      destroyRef.onDestroy(() => {
        resize.disconnect();
        scene.dispose();
      });
    });
    effect(() => this.scene?.setOriginVisible(this.showOrigin()));
  }

  showView(view: StandardView): void {
    this.scene?.showView(view);
  }
}
