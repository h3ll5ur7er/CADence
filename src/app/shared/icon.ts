import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** 24×24 stroke icons. Paths are drawn for CADence; add new ones here. */
const paths = {
  plus: 'M12 5v14M5 12h14',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  component: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9',
  assembly: 'M3 8l5-3 5 3v6l-5 3-5-3zM11 13l5-3 5 3v6l-5 3-5-3z',
  imported: 'M14 3H6v18h12V7l-4-4zM14 3v4h4M12 10v7M9 14l3 3 3-3',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  plane: 'M3 15l6-8h12l-6 8z',
  origin: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M12 3v4M12 17v4M3 12h4M17 12h4',
  folder: 'M3 6h6l2 2h10v11H3z',
  chevronRight: 'M9 6l6 6-6 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  timeline: 'M4 12h16M7 8v8M12 8v8M17 8v8',
  variable: 'M5 4c-2 4-2 12 0 16M19 4c2 4 2 12 0 16M9 9l6 6M15 9l-6 6',
  joint: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M4 12h5M15 12h5',
  film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
  instance: 'M5 5h14v14H5zM9 9h6v6H9z',
} as const;

export type IconName = keyof typeof paths;

@Component({
  selector: 'cad-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" aria-hidden="true">
    <path [attr.d]="path()" />
  </svg>`,
  styles: `
    :host { display: inline-flex; flex: none; }
    svg { fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(16);
  protected readonly path = computed(() => paths[this.name()]);
}
