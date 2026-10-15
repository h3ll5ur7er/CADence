import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';

/**
 * A stored picture (PNG bytes from `source`), or the projected content while there is none. The
 * `key` reloads it when what it shows has changed.
 */
@Component({
  selector: 'cad-thumbnail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (url(); as src) {
      <img [src]="src" alt="" />
    } @else {
      <ng-content />
    }
  `,
  styles: `
    :host { display: contents; }
    img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
  `,
})
export class Thumbnail {
  readonly source = input.required<() => Promise<Uint8Array | undefined>>();
  readonly key = input<string>('');
  protected readonly url = signal<string | undefined>(undefined);

  constructor() {
    effect((onCleanup) => {
      this.key();
      const load = this.source();
      let current: string | undefined;
      let live = true;
      void load().then((png) => {
        if (!live || !png) return;
        current = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }));
        this.url.set(current);
      });
      onCleanup(() => {
        live = false;
        if (current) URL.revokeObjectURL(current);
      });
    });
  }
}
