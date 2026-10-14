import { ChangeDetectionStrategy, Component, inject, input, resource } from '@angular/core';
import type { DocumentSummary } from '@core/contracts';
import { PROJECT_MANAGER } from '../../core.providers';
import { byteSize, relativeTime } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { Viewport } from '../../viewport/viewport';
import { EditorStatus } from '../editor-status';

/** Imported-file mode. Geometry preview and conversion arrive in phase 6. */
@Component({
  selector: 'cad-imported-mode',
  imports: [Viewport, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage">
      <cad-viewport (backendReady)="status.renderer.set($event)" />
      <section class="browser" aria-label="Imported file">
        <h2 class="eyebrow browser-title">Browser</h2>
        <ul class="tree">
          <li class="node"><cad-icon name="imported" /> {{ view.value()?.fileName ?? document().name }}</li>
        </ul>
      </section>
      <p class="notice">The original file is stored with the project. Its 3D preview arrives with the Import phase.</p>
    </div>
    <aside class="properties" aria-label="Properties">
      <p class="eyebrow">Imported file</p>
      <h2>{{ document().name }}</h2>
      @if (view.value(); as file) {
        <dl>
          <dt>File</dt>
          <dd>{{ file.fileName }}</dd>
          <dt>Format</dt>
          <dd class="format">{{ file.format }}</dd>
          <dt>Size</dt>
          <dd>{{ byteSize(file.byteLength) }}</dd>
          <dt>Imported</dt>
          <dd>{{ relativeTime(document().createdAt) }}</dd>
        </dl>
      }
    </aside>
  `,
  styleUrl: './mode-layout.scss',
  styles: '.format { text-transform: uppercase; }',
})
export class ImportedMode {
  readonly document = input.required<DocumentSummary>();
  protected readonly status = inject(EditorStatus);
  private readonly projectManager = inject(PROJECT_MANAGER);
  protected readonly view = resource({
    params: () => this.document().id,
    loader: ({ params }) => this.projectManager.openImported(params),
  });
  protected readonly byteSize = byteSize;
  protected readonly relativeTime = relativeTime;
}
