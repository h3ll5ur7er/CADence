import { computed, Injectable, InjectionToken, inject, signal } from '@angular/core';
import { Layout } from './layout';
import { SETTINGS_STORAGE } from './user-settings';

/**
 * One step of the tour. `target` is the element it points at (a `data-tour` name); `until` is what
 * the user's own action brings up, which moves the tour on (a CSS selector). A step without `until`
 * waits for Next.
 */
export interface TourStep {
  readonly title: string;
  readonly text: string;
  readonly target?: string;
  readonly until?: string;
}

/**
 * A first part, from a project to an export (CAD-181): each step points at the button to press and
 * goes on when the user has pressed it.
 */
export const tourSteps: readonly TourStep[] = [
  {
    title: 'Welcome to CADence',
    text: 'In a few minutes you model a first part: a sketch, an extrude and an export. Take the tour, or skip it; Take the tour on the home page starts it again whenever you want.',
  },
  { title: 'A project', text: 'Everything you make lives in a project. Click New project, keep “Empty project” and press Create project.', target: 'new-project', until: '[data-tour="new-sketch"]' },
  { title: 'A sketch', text: 'A part starts as a drawing on a plane. Click New sketch and choose the XY plane (top).', target: 'new-sketch', until: '[data-tour="rectangle"]' },
  {
    title: 'Draw a rectangle',
    text: 'Pick the Rectangle tool (R), then click two corners in the view. Dimensions (D) set its exact size. Press Next when it is drawn.',
    target: 'rectangle',
  },
  { title: 'Finish the sketch', text: 'The closed rectangle is a profile, shaded in the view. Finish the sketch to go back to the model.', target: 'finish-sketch', until: '[data-tour="extrude"]' },
  {
    title: 'Extrude',
    text: 'Click Extrude: the profile is picked for you. Set a distance, such as 6 mm, and press OK. Your part has a body once the Export button can be pressed.',
    target: 'extrude',
    until: '[data-tour="export"]:not([disabled])',
  },
  {
    title: 'Export',
    text: 'Export sends the part to your slicer (STL, 3MF), to other CAD programs (STEP), or as a viewer anyone can open, also on a phone.',
    target: 'export',
  },
  {
    title: 'That is a part',
    text: 'Change it any time: every step stays in the timeline. The samples on the home page show more, and the ? beside a tool opens its page of the User guide.',
  },
];

/** Where the tour finds the page's elements; tests give their own. */
export const TOUR_DOCUMENT = new InjectionToken<Pick<Document, 'querySelector'>>('TourDocument', { factory: () => document });

/** True when a browser is driven by tests or tools (WebDriver, Playwright): the tour does not start by itself there. */
export const AUTOMATED = new InjectionToken<boolean>('Automated', { factory: () => typeof navigator !== 'undefined' && navigator.webdriver === true });

const key = 'cadence.tour';

/**
 * The tour of a first part (CAD-181). It starts by itself once, on the first start, unless the
 * browser is automated; Skip or the end keep it from starting again. Help on the home page and the
 * command palette start it again.
 */
@Injectable({ providedIn: 'root' })
export class Tour {
  readonly steps = tourSteps;
  /** The step shown, or `undefined` while the tour is closed. */
  readonly index = signal<number | undefined>(undefined);
  readonly step = computed(() => {
    const index = this.index();
    return index === undefined ? undefined : this.steps[index];
  });
  private readonly storage = inject(SETTINGS_STORAGE);
  private readonly page = inject(TOUR_DOCUMENT);
  private readonly automated = inject(AUTOMATED);
  private readonly layout = inject(Layout);

  /** Starts the tour on the first start: never seen, a person at the keys, and a screen to model on (not a phone). */
  offer(): void {
    if (this.automated || this.layout.phone() || this.index() !== undefined) return;
    let seen: string | null = null;
    try {
      seen = this.storage?.getItem(key) ?? null;
    } catch {
      // Without storage the tour is offered on every start.
    }
    if (!seen) this.start();
  }

  start(): void {
    this.index.set(0);
  }

  /** The next step, passing over those whose action is already done (a project already open). */
  next(): void {
    const index = this.index();
    if (index === undefined) return;
    let next = index + 1;
    while (next < this.steps.length - 1 && this.done(this.steps[next] as TourStep)) next++;
    if (next >= this.steps.length) return this.close('done');
    this.index.set(next);
  }

  /** Moves on when the user has done what the step asks; called as the page changes. */
  check(): void {
    const step = this.step();
    if (step && this.done(step)) this.next();
  }

  skip(): void {
    this.close('skipped');
  }

  finish(): void {
    this.close('done');
  }

  private done(step: TourStep): boolean {
    return step.until !== undefined && this.page.querySelector(step.until) !== null;
  }

  private close(how: 'done' | 'skipped'): void {
    this.index.set(undefined);
    try {
      this.storage?.setItem(key, how);
    } catch {
      // As in `offer`.
    }
  }
}
