import { ChangeDetectionStrategy, Component, type ElementRef, inject, signal, viewChild } from '@angular/core';
import { PROJECT_MANAGER } from '../core.providers';
import { ModalDialog } from '../shared/dialogs';
import type { Viewport } from '../viewport/viewport';

/** Saves a picture of the view at any size (on white or transparent), or a turntable video (CAD-90). */
@Component({
  selector: 'cad-picture-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="dialog" aria-labelledby="picture-heading" (close)="finish(undefined)">
      <form (submit)="$event.preventDefault(); picture()">
        <h2 id="picture-heading">Picture or turntable</h2>
        <p class="hint">The view as it is now, without grid and origin. Realistic lighting (the sun button) adds reflections and shadows.</p>
        <div class="row">
          <label class="field">Width (px)<input id="picture-width" type="number" min="16" max="8000" [value]="width()" (change)="width.set(+$any($event.target).value)" /></label>
          <label class="field">Height (px)<input id="picture-height" type="number" min="16" max="8000" [value]="height()" (change)="height.set(+$any($event.target).value)" /></label>
        </div>
        <label class="check"><input id="picture-transparent" type="checkbox" [checked]="transparent()" (change)="transparent.set($any($event.target).checked)" /> Transparent background</label>
        <label class="field">Turntable length (s)<input id="turntable-seconds" type="number" min="2" max="60" [value]="seconds()" (change)="seconds.set(+$any($event.target).value)" /></label>
        @if (problem(); as problem) {
          <p class="error" role="alert">{{ problem }}</p>
        }
        <div class="actions">
          <button type="button" class="btn" (click)="finish(undefined)">Close</button>
          <button type="button" class="btn" [disabled]="busy()" (click)="turntable()">{{ busy() === 'video' ? 'Recording…' : 'Turntable video' }}</button>
          <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ busy() === 'picture' ? 'Saving…' : 'Save picture' }}</button>
        </div>
      </form>
    </dialog>
  `,
  styleUrl: '../shared/dialogs.scss',
  styles: '.row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); } .hint { margin: 0; color: var(--text-muted); font-size: 12px; } .check { display: flex; gap: var(--space-2); align-items: center; font-size: 13px; }',
})
export class PictureDialog extends ModalDialog<undefined> {
  protected readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly projects = inject(PROJECT_MANAGER);
  protected readonly width = signal(1920);
  protected readonly height = signal(1080);
  protected readonly transparent = signal(false);
  protected readonly seconds = signal(8);
  protected readonly busy = signal<'picture' | 'video' | undefined>(undefined);
  protected readonly problem = signal<string | undefined>(undefined);
  private viewport: Viewport | undefined;
  private name = '';

  ask(viewport: Viewport, name: string): Promise<undefined> {
    [this.viewport, this.name] = [viewport, name];
    this.problem.set(undefined);
    return this.open();
  }

  protected async picture(): Promise<void> {
    const [width, height] = [Math.round(this.width()), Math.round(this.height())];
    if (!(width >= 16 && height >= 16 && width <= 8000 && height <= 8000)) return this.problem.set('Width and height go from 16 to 8000 pixels.');
    this.busy.set('picture');
    try {
      const png = await this.viewport?.exportPicture(width, height, this.transparent());
      if (!png) return this.problem.set('The view could not take a picture.');
      await this.projects.deliverFile({ name: `${this.name}.png`, mediaType: 'image/png', bytes: png });
      this.finish(undefined);
    } finally {
      this.busy.set(undefined);
    }
  }

  protected async turntable(): Promise<void> {
    this.busy.set('video');
    try {
      const video = await this.viewport?.recordTurntable(Math.max(2, Math.min(60, this.seconds())));
      if (!video) return this.problem.set('Recording is not available in this browser.');
      await this.projects.deliverFile({ name: `${this.name} turntable.webm`, mediaType: 'video/webm', bytes: video });
      this.finish(undefined);
    } finally {
      this.busy.set(undefined);
    }
  }

  protected dismissed(): undefined {
    return undefined;
  }
}
