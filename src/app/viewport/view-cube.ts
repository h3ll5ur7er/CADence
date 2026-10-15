import { ChangeDetectionStrategy, Component, type ElementRef, output, viewChild } from '@angular/core';
import type { Matrix4 } from 'three/webgpu';
import { Icon } from '../shared/icon';
import type { StandardView } from './viewport-scene';

type Vec = readonly [number, number, number];

interface Face {
  readonly view: Exclude<StandardView, 'home'>;
  readonly label: string;
  /** World directions of the label's right and down when the face is viewed head-on, and its normal. */
  readonly right: Vec;
  readonly down: Vec;
  readonly normal: Vec;
}

const half = 30; // px

const faces: readonly Face[] = [
  { view: 'top', label: 'Top', right: [1, 0, 0], down: [0, -1, 0], normal: [0, 0, 1] },
  { view: 'bottom', label: 'Bottom', right: [1, 0, 0], down: [0, 1, 0], normal: [0, 0, -1] },
  { view: 'front', label: 'Front', right: [1, 0, 0], down: [0, 0, -1], normal: [0, -1, 0] },
  { view: 'back', label: 'Back', right: [-1, 0, 0], down: [0, 0, -1], normal: [0, 1, 0] },
  { view: 'right', label: 'Right', right: [0, 1, 0], down: [0, 0, -1], normal: [1, 0, 0] },
  { view: 'left', label: 'Left', right: [0, -1, 0], down: [0, 0, -1], normal: [-1, 0, 0] },
];

/** CSS matrix placing a face's local (right, down, out) frame into world space, pushed out along its normal. */
function faceTransform({ right: r, down: d, normal: n }: Face): string {
  return `matrix3d(${[...r, 0, ...d, 0, ...n, 0, n[0] * half, n[1] * half, n[2] * half, 1].join(',')})`;
}

/** A clickable orientation cube that mirrors the camera; pure CSS 3D, no second WebGL context. */
@Component({
  selector: 'cad-view-cube',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage">
      <div #cube class="cube">
        @for (face of faces; track face.view) {
          <button
            type="button"
            class="face"
            [style.transform]="face.transform"
            [attr.aria-label]="face.label + ' view'"
            [attr.data-view]="face.view"
            (click)="viewSelected.emit(face.view)"
          >
            {{ face.label }}
          </button>
        }
      </div>
    </div>
    <button type="button" class="home icon-btn" aria-label="Home view" title="Home view" (click)="viewSelected.emit('home')">
      <cad-icon name="home" />
    </button>
    <ng-content />
  `,
  styleUrl: './view-cube.scss',
})
export class ViewCube {
  readonly viewSelected = output<StandardView>();
  protected readonly faces = faces.map((face) => ({ ...face, transform: faceTransform(face) }));
  private readonly cube = viewChild.required<ElementRef<HTMLElement>>('cube');

  /** Mirrors the camera. Called per rendered frame, so it bypasses change detection. */
  setCamera(view: Matrix4): void {
    const e = view.elements;
    // World → camera rotation, then flip Y because CSS's Y axis points down.
    const m = [e[0], -e[1], e[2], 0, e[4], -e[5], e[6], 0, e[8], -e[9], e[10], 0, 0, 0, 0, 1];
    this.cube().nativeElement.style.transform = `matrix3d(${m.join(',')})`;
  }
}
