import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { helpUrl } from './help-topics';
import { Tour } from './tour';

interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** How often the tour looks at the page: where its target is, and whether the user did the step (ms). */
const watchEvery = 250;

/**
 * The tour's card and the ring around the button a step points at (CAD-181). Neither blocks the
 * page: the user does each step in the app itself. The card stays in the corner, off the menus and
 * panels the buttons open.
 */
@Component({
  selector: 'cad-tour',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tour.step(); as step) {
      @if (ring(); as box) {
        <div class="ring" aria-hidden="true" [style.top.px]="box.top - 4" [style.left.px]="box.left - 4" [style.width.px]="box.width + 8" [style.height.px]="box.height + 8"></div>
      }
      <section class="card" role="dialog" aria-modal="false" aria-labelledby="tour-title">
        <p class="count">{{ (tour.index() ?? 0) + 1 }} of {{ tour.steps.length }}</p>
        <h2 id="tour-title">{{ step.title }}</h2>
        <p>{{ step.text }}</p>
        <div class="actions">
          @if (tour.index() === 0) {
            <button type="button" class="btn" (click)="tour.skip()">Skip</button>
            <button type="button" class="btn btn-primary" (click)="tour.next()">Take the tour</button>
          } @else if (tour.index() === tour.steps.length - 1) {
            <a class="btn" [href]="guide" target="_blank" rel="noopener">User guide</a>
            <button type="button" class="btn btn-primary" (click)="tour.finish()">Done</button>
          } @else {
            <button type="button" class="btn" (click)="tour.skip()">Skip tour</button>
            <button type="button" class="btn btn-primary" (click)="tour.next()">Next</button>
          }
        </div>
      </section>
    }
  `,
  styles: `
    .ring { position: fixed; z-index: 90; border: 2px solid var(--accent); border-radius: 10px; box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent); pointer-events: none; transition: all 0.15s ease; }
    .card { position: fixed; right: 16px; bottom: 40px; z-index: 91; width: min(320px, calc(100vw - 24px)); padding: var(--space-4); border: 1px solid var(--border); border-radius: 12px; background: var(--surface-1); color: var(--text); box-shadow: var(--shadow); }
    .count { margin: 0; color: var(--text-muted); font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
    h2 { margin: var(--space-1) 0 var(--space-2); font-size: 16px; }
    p { margin: 0 0 var(--space-3); font-size: 13px; line-height: 1.45; }
    .actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
    a.btn { text-decoration: none; }
    @media (max-width: 720px) { .card { right: 12px; left: 12px; bottom: 96px; width: auto; } }
  `,
})
export class TourOverlay {
  protected readonly tour = inject(Tour);
  protected readonly guide = helpUrl('getting-started');
  /** Where the step's target is on screen. */
  protected readonly ring = signal<Box | undefined>(undefined);

  constructor() {
    let timer: ReturnType<typeof setInterval> | undefined;
    effect(() => {
      clearInterval(timer);
      const step = this.tour.step();
      this.place();
      if (step) timer = setInterval(() => this.watch(), watchEvery);
    });
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private watch(): void {
    this.tour.check();
    this.place();
  }

  /** Rings the step's target, wherever it is now. */
  private place(): void {
    const name = this.tour.step()?.target;
    const rect = name ? document.querySelector<HTMLElement>(`[data-tour="${name}"]`)?.getBoundingClientRect() : undefined;
    if (!rect || rect.width === 0) return this.ring.set(undefined);
    const ring = this.ring();
    if (ring && ring.top === rect.top && ring.left === rect.left && ring.width === rect.width && ring.height === rect.height) return;
    this.ring.set({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
  }
}
