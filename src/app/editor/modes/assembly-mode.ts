import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { DocumentSummary } from '@core/contracts';
import { relativeTime } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { Viewport } from '../../viewport/viewport';
import { EditorStatus } from '../editor-status';

/** Assembly mode. Instances, joints and motion studies arrive in phase 5. */
@Component({
  selector: 'cad-assembly-mode',
  imports: [Viewport, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage">
      <cad-viewport (backendReady)="status.renderer.set($event)" />
      <section class="browser" aria-label="Assembly browser">
        <h2 class="eyebrow browser-title">Browser</h2>
        <ul class="tree">
          <li>
            <div class="node"><cad-icon name="instance" /> Instances <span class="count">0</span></div>
            <p class="node-empty">Components you insert will appear here.</p>
          </li>
          <li>
            <div class="node"><cad-icon name="joint" /> Joints <span class="count">0</span></div>
          </li>
          <li>
            <div class="node"><cad-icon name="film" /> Motion studies <span class="count">0</span></div>
          </li>
        </ul>
      </section>
      <p class="notice">Inserting components and joints arrives with the Assemblies phase.</p>
    </div>
    <aside class="properties" aria-label="Properties">
      <p class="eyebrow">Assembly</p>
      <h2>{{ document().name }}</h2>
      <dl>
        <dt>Instances</dt>
        <dd>0</dd>
        <dt>Created</dt>
        <dd>{{ relativeTime(document().createdAt) }}</dd>
        <dt>Modified</dt>
        <dd>{{ relativeTime(document().modifiedAt) }}</dd>
      </dl>
    </aside>
  `,
  styleUrl: './mode-layout.scss',
})
export class AssemblyMode {
  readonly document = input.required<DocumentSummary>();
  protected readonly status = inject(EditorStatus);
  protected readonly relativeTime = relativeTime;
}
