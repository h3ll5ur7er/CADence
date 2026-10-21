import { ChangeDetectionStrategy, Component, type ElementRef, inject, input, output, resource, signal, viewChild } from '@angular/core';
import type { ViewerFormat } from '@core/utilities/scene';
import { Icon } from '../shared/icon';
import { Layout } from '../shared/layout';
import { AR_SUPPORT, type ArMode, type ArSession, openQuickLook, startWebXr } from '../viewport/augmented-reality';
import type { Viewport } from '../viewport/viewport';

/** A file of the model for augmented reality, made by the mode's store. */
export type ArFile = (format: Exclude<ViewerFormat, 'html'>) => Promise<{ readonly name: string; readonly bytes: Uint8Array } | undefined>;

/**
 * The touch tools of the phone layout (CAD-179), along the bottom of the model: the project's
 * documents, fit and home view, measuring by tapping, and the model in augmented reality where the
 * device can show it (CAD-180). One finger turns the view, two pan and pinch to zoom.
 */
@Component({
  selector: 'cad-phone-bar',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (message(); as text) {
      <p class="message" role="alert">{{ text }} <button type="button" class="icon-btn" aria-label="Dismiss" (click)="message.set(undefined)">×</button></p>
    }
    <nav class="bar" role="toolbar" aria-label="Viewer tools">
      <button type="button" aria-label="Documents" [attr.aria-expanded]="layout.drawer()" (click)="layout.drawer.set(!layout.drawer())">
        <cad-icon name="folder" [size]="22" /><span>Documents</span>
      </button>
      <button type="button" aria-label="Zoom to fit" (click)="viewport().zoomToFit()"><cad-icon name="fit" [size]="22" /><span>Fit</span></button>
      <button type="button" aria-label="Home view" (click)="viewport().showView('home')"><cad-icon name="home" [size]="22" /><span>Home</span></button>
      @if (measurable()) {
        <button type="button" aria-label="Measure" [attr.aria-pressed]="measuring()" [class.on]="measuring()" (click)="measure.emit()">
          <cad-icon name="ruler" [size]="22" /><span>Measure</span>
        </button>
      }
      @if (arFile() && ar.value(); as mode) {
        <button type="button" aria-label="View in AR" [attr.data-ar]="mode" [disabled]="starting()" (click)="viewInAr(mode)"><cad-icon name="ar" [size]="22" /><span>AR</span></button>
      }
    </nav>
    <div #overlay class="ar-overlay" [hidden]="!session()" data-testid="ar-overlay">
      <p>Point at the floor or a table, then tap to set the model down at its real size.</p>
      <button type="button" class="btn" (click)="session()?.end()">Exit AR</button>
    </div>
  `,
  styles: `
    :host { position: absolute; inset: auto 0 0 0; display: grid; gap: var(--space-2); padding: 0 var(--space-3) calc(var(--space-3) + env(safe-area-inset-bottom)); pointer-events: none; }
    .bar { display: flex; justify-content: space-around; gap: var(--space-1); padding: var(--space-1); border: 1px solid var(--border); border-radius: 14px; background: var(--surface-1); box-shadow: var(--shadow); pointer-events: auto; }
    .bar button { display: grid; justify-items: center; gap: 2px; min-width: 56px; min-height: 52px; padding: var(--space-1); border: 0; border-radius: 10px; background: none; color: var(--text); font: 600 11px var(--font); touch-action: manipulation; }
    .bar button.on { background: var(--accent-soft); color: var(--accent-strong); }
    .bar button:disabled { opacity: 0.5; }
    .message { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius); background: var(--danger-soft); color: var(--danger); font-size: 13px; pointer-events: auto; }
    .ar-overlay { position: fixed; inset: auto 0 0 0; display: grid; justify-items: center; gap: var(--space-2); padding: var(--space-4) var(--space-4) calc(var(--space-6) + env(safe-area-inset-bottom)); color: #fff; text-align: center; text-shadow: 0 1px 3px rgb(0 0 0 / 60%); pointer-events: auto; }
    .ar-overlay[hidden] { display: none; }
  `,
})
export class PhoneBar {
  readonly viewport = input.required<Viewport>();
  /** Measuring by tapping: the mode has a measure tool. */
  readonly measurable = input(false);
  readonly measuring = input(false);
  /** Makes the files augmented reality shows; without it there is no AR button. */
  readonly arFile = input<ArFile>();
  readonly measure = output();

  protected readonly layout = inject(Layout);
  /** How this device shows models in augmented reality, if it can. */
  private readonly arSupport = inject(AR_SUPPORT);
  protected readonly ar = resource({ loader: () => this.arSupport() });
  protected readonly session = signal<ArSession | undefined>(undefined);
  protected readonly starting = signal(false);
  protected readonly message = signal<string | undefined>(undefined);
  private readonly overlay = viewChild.required<ElementRef<HTMLElement>>('overlay');

  protected async viewInAr(mode: ArMode): Promise<void> {
    const make = this.arFile();
    if (!make) return;
    this.starting.set(true);
    try {
      const file = await make(mode === 'quick-look' ? 'usdz' : 'glb');
      if (!file) return;
      if (mode === 'quick-look') return openQuickLook(file);
      const session = await startWebXr(file.bytes, this.overlay().nativeElement);
      this.session.set(session);
      await session.ended;
    } catch (error) {
      this.message.set(`Augmented reality could not start: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.session.set(undefined);
      this.starting.set(false);
    }
  }
}
