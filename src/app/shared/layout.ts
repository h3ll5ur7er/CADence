import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';

/** Small screens: phones upright, and phones turned on their side (short and touched). */
export const phoneQuery = '(max-width: 720px), (max-height: 500px) and (pointer: coarse)';

/** Media queries as the layout asks them; tests give their own. */
export const MEDIA_QUERIES = new InjectionToken<(query: string) => Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'> | undefined>('MediaQueries', {
  factory: () => (query) => (typeof matchMedia === 'function' ? matchMedia(query) : undefined),
});

/**
 * How the editor is laid out (CAD-179): on small screens it is a viewer, the model filling the
 * screen with a bar of touch tools (fit, views, measure, augmented reality) and the project's
 * documents in a drawer; the modelling tools are left out.
 */
@Injectable({ providedIn: 'root' })
export class Layout {
  /** The phone layout. */
  readonly phone = signal(false);
  /** The project's documents, shown over the model in the phone layout. */
  readonly drawer = signal(false);

  constructor() {
    const media = inject(MEDIA_QUERIES)(phoneQuery);
    if (!media) return;
    this.phone.set(media.matches);
    const changed = (event: { matches: boolean }) => {
      this.phone.set(event.matches);
      if (!event.matches) this.drawer.set(false);
    };
    media.addEventListener('change', changed);
    inject(DestroyRef).onDestroy(() => media.removeEventListener('change', changed));
  }
}
