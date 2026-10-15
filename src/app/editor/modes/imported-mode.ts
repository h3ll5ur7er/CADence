import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { type DocumentSummary, type ImportFormat, originFrames } from '@core/contracts';
import { PROJECT_MANAGER } from '../../core.providers';
import { byteSize, relativeTime } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { sketchDisplay } from '../../viewport/sketch-display';
import { Viewport } from '../../viewport/viewport';
import { grams, millimetres, point } from '../analysis/units';
import { EditorStatus } from '../editor-status';

const modelFormats: readonly { format: ImportFormat; label: string }[] = [
  { format: 'step', label: 'STEP' },
  { format: 'stl', label: 'STL' },
  { format: '3mf', label: '3MF' },
  { format: 'obj', label: 'OBJ' },
];
const drawingFormats: readonly { format: ImportFormat; label: string }[] = [
  { format: 'dxf', label: 'DXF' },
  { format: 'svg', label: 'SVG' },
];

/** An imported file: its geometry, what it holds, and conversion to other formats. */
@Component({
  selector: 'cad-imported-mode',
  imports: [Viewport, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage">
      <cad-viewport [bodies]="meshes()" [sketches]="drawing()" [fit]="extent()" (backendReady)="status.renderer.set($event)" />
      <section class="browser" aria-label="Imported file">
        <h2 class="eyebrow browser-title">Browser</h2>
        <ul class="tree">
          <li class="node"><cad-icon name="imported" /> {{ view.value()?.fileName ?? document().name }}</li>
        </ul>
      </section>
      <div class="top-tools">
        <div class="model-bar" role="toolbar" aria-label="Imported file tools">
          <div class="menu">
            <button type="button" class="btn" aria-haspopup="menu" [attr.aria-expanded]="menuOpen()" [disabled]="!content()" (click)="menuOpen.set(!menuOpen())">
              <cad-icon name="download" /> Export as
            </button>
            @if (menuOpen()) {
              <div class="menu-list" role="menu" aria-label="Export format">
                @for (f of formats(); track f.format) {
                  <button type="button" role="menuitem" (click)="exportAs(f.format)">{{ f.label }}</button>
                }
              </div>
            }
          </div>
        </div>
      </div>
      @if (preview.isLoading()) {
        <p class="notice">Reading the file…</p>
      } @else if (problem(); as message) {
        <p class="toast" role="alert">{{ message }}</p>
      } @else if (content(); as c) {
        <p class="notice">{{ c.kind === 'drawing' ? 'Insert it into a sketch with Insert drawing in the sketch toolbar.' : c.usableAsSolid ? 'Use it in a component with Insert body, or insert it into an assembly.' : 'Too many triangles to use as a solid; it can still be viewed and converted.' }}</p>
      }
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
      @if (content(); as c) {
        <p class="eyebrow">Contents</p>
        <dl data-testid="imported-contents">
          @if (c.kind === 'model') {
            <dt>Objects</dt>
            <dd>{{ c.meshes.length }}</dd>
            <dt>Triangles</dt>
            <dd class="mono">{{ c.triangles.toLocaleString('en-US') }}</dd>
            <dt>Volume</dt>
            <dd class="mono" data-testid="imported-volume">{{ mm(c.volume, 3) }}</dd>
            <dt>PLA</dt>
            <dd class="mono">{{ grams((c.volume * 1.24) / 1000) }}</dd>
          } @else {
            <dt>Curves</dt>
            <dd class="mono" data-testid="imported-curves">{{ curveCount() }}</dd>
          }
          <dt>Size</dt>
          <dd class="mono" data-testid="imported-size">{{ point(size()) }} mm</dd>
        </dl>
      }
    </aside>
  `,
  styleUrls: ['./mode-layout.scss', './editor-tools.scss'],
  styles: '.format { text-transform: uppercase; } .top-tools { left: 264px; }',
})
export class ImportedMode {
  readonly document = input.required<DocumentSummary>();
  protected readonly status = inject(EditorStatus);
  private readonly projectManager = inject(PROJECT_MANAGER);
  protected readonly menuOpen = signal(false);
  protected readonly byteSize = byteSize;
  protected readonly relativeTime = relativeTime;
  protected readonly mm = millimetres;
  protected readonly grams = grams;
  protected readonly point = point;
  protected readonly exportError = signal<string | undefined>(undefined);

  protected readonly view = resource({
    params: () => this.document().id,
    loader: ({ params }) => this.projectManager.openImported(params),
  });
  protected readonly preview = resource({
    params: () => this.document().id,
    loader: ({ params }) => this.projectManager.previewImported(params),
  });

  protected readonly content = computed(() => {
    const result = this.preview.value();
    return result?.ok ? result.value : undefined;
  });
  protected readonly problem = computed(() => {
    const result = this.preview.value();
    return this.exportError() ?? (result && !result.ok ? result.error.message : undefined);
  });
  protected readonly meshes = computed(() => {
    const c = this.content();
    return c?.kind === 'model' ? c.meshes : [];
  });
  protected readonly drawing = computed(() => {
    const c = this.content();
    if (c?.kind !== 'drawing') return [];
    const sketch = { id: 'imported', type: 'sketch' as const, name: this.document().name, suppressed: false, plane: 'XY' as const, entities: c.entities, constraints: [] };
    return [sketchDisplay(sketch, [], originFrames.XY, c.texts)];
  });
  protected readonly curveCount = computed(() => {
    const c = this.content();
    return c?.kind === 'drawing' ? c.entities.filter((e) => e.kind !== 'point').length : 0;
  });
  protected readonly extent = computed(() => {
    const c = this.content();
    return c ? { min: c.min, max: c.max } : undefined;
  });
  protected readonly size = computed(() => {
    const c = this.content();
    return c ? [0, 1, 2].map((axis) => (c.max[axis] as number) - (c.min[axis] as number)) : [0, 0, 0];
  });
  protected readonly formats = computed(() => (this.content()?.kind === 'drawing' ? drawingFormats : modelFormats));

  protected async exportAs(format: ImportFormat): Promise<void> {
    this.menuOpen.set(false);
    const result = await this.projectManager.exportImported(this.document().id, format);
    this.exportError.set(result.ok ? undefined : result.error.message);
  }
}
