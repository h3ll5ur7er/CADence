import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import type { DocumentSummary } from '@core/contracts';
import { relativeTime } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { Viewport } from '../../viewport/viewport';
import { EditorStatus } from '../editor-status';

/** Part modeling mode. Sketches, features and parameters arrive in phases 2 and 3. */
@Component({
  selector: 'cad-component-mode',
  imports: [Viewport, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage">
      <cad-viewport [showOrigin]="originVisible()" (backendReady)="status.renderer.set($event)" />
      <section class="browser" aria-label="Model browser">
        <h2 class="eyebrow browser-title">Browser</h2>
        <ul class="tree">
          <li>
            <div class="node">
              <cad-icon name="origin" /> Origin
              <label class="toggle" title="Show origin">
                <input type="checkbox" [checked]="originVisible()" (change)="originVisible.set(!originVisible())" aria-label="Show origin" />
              </label>
            </div>
            <ul>
              <li class="node"><span class="swatch" style="color: var(--axis-z)"></span> XY plane</li>
              <li class="node"><span class="swatch" style="color: var(--axis-y)"></span> XZ plane</li>
              <li class="node"><span class="swatch" style="color: var(--axis-x)"></span> YZ plane</li>
            </ul>
          </li>
          <li>
            <div class="node"><cad-icon name="variable" /> Parameters <span class="count">0</span></div>
          </li>
          <li>
            <div class="node"><cad-icon name="timeline" /> Timeline <span class="count">0</span></div>
            <p class="node-empty">Sketches and features will appear here.</p>
          </li>
        </ul>
      </section>
    </div>
    <aside class="properties" aria-label="Properties">
      <p class="eyebrow">Component</p>
      <h2>{{ document().name }}</h2>
      <dl>
        <dt>Units</dt>
        <dd>Millimetres</dd>
        <dt>Bodies</dt>
        <dd>None yet</dd>
        <dt>Created</dt>
        <dd>{{ relativeTime(document().createdAt) }}</dd>
        <dt>Modified</dt>
        <dd>{{ relativeTime(document().modifiedAt) }}</dd>
      </dl>
    </aside>
  `,
  styleUrl: './mode-layout.scss',
})
export class ComponentMode {
  readonly document = input.required<DocumentSummary>();
  protected readonly status = inject(EditorStatus);
  protected readonly originVisible = signal(true);
  protected readonly relativeTime = relativeTime;
}
