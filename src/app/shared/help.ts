import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type HelpTopic, helpTopics, helpUrl } from './help-topics';
import { Icon } from './icon';

/** A small “?” that opens the tool's or dialog's page of the User guide (CAD-181). */
@Component({
  selector: 'cad-help',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<a class="help" [href]="url()" target="_blank" rel="noopener" [attr.aria-label]="'Help: ' + label()" [title]="'User guide: ' + label()" data-testid="help-link"><cad-icon name="help" [size]="size()" /></a>`,
  styles: `
    :host { display: inline-flex; margin-left: auto; vertical-align: middle; }
    .help { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; color: var(--text-muted); }
    .help:hover, .help:focus-visible { background: var(--surface-2); color: var(--accent-strong); }
  `,
})
export class HelpLink {
  readonly topic = input.required<HelpTopic>();
  readonly size = input(16);
  protected readonly url = computed(() => helpUrl(this.topic()));
  protected readonly label = computed(() => helpTopics[this.topic()].label);
}
