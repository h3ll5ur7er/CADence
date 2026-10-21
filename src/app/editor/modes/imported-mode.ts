import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, resource, signal } from '@angular/core';
import { type DocumentSummary, type ImportFormat, originFrames } from '@core/contracts';
import type { SimplifiedImport } from '@core/managers/project';
import { PROJECT_MANAGER } from '../../core.providers';
import { byteSize, relativeTime } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { sketchDisplay } from '../../viewport/sketch-display';
import { Viewport } from '../../viewport/viewport';
import { Layout } from '../../shared/layout';
import { PhoneBar } from '../phone-bar';
import { pictureUrl } from '../../shared/picture-url';
import { grams, millimetres, point } from '../analysis/units';
import { EditorStatus } from '../editor-status';
import { ThumbnailSaver } from '../thumbnail-saver';
import { HelpLink } from '../../shared/help';

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
  imports: [HelpLink, Viewport, Icon, PhoneBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage">
      <cad-viewport #viewport [compact]="layout.phone()" [bodies]="meshes()" [sketches]="drawing()" [fit]="extent()" (backendReady)="status.renderer.set($event)" (thumbnail)="thumbnails.save($event)" />
      @if (pictureUrl(); as url) {
        <img class="picture" [src]="url" [alt]="document().name" data-testid="imported-picture" />
      }
      <section class="browser" aria-label="Imported file">
        <h2 class="eyebrow browser-title">Browser</h2>
        <ul class="tree">
          <li class="node"><cad-icon name="imported" /> {{ view.value()?.fileName ?? document().name }}</li>
        </ul>
      </section>
      <div class="top-tools">
        <div class="model-bar" role="toolbar" aria-label="Imported file tools">
          <div class="menu">
            <button type="button" class="btn" aria-haspopup="menu" [attr.aria-expanded]="menuOpen()" [disabled]="!content() || content()?.kind === 'picture'" (click)="menuOpen.set(!menuOpen())">
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
      } @else if (simplified()) {
        <p class="notice" data-testid="simplified-notice">The simplified mesh. Keep it as a new file to use it as a solid; the original stays as it is.</p>
      } @else if (content(); as c) {
        <p class="notice">
          {{
            c.kind === 'drawing'
              ? 'Insert it into a sketch with Insert drawing in the sketch toolbar.'
              : c.kind === 'picture'
                ? 'Draw over it with Picture in the sketch toolbar, or trace it into curves with Insert drawing.'
                : c.board
                  ? 'Insert it into an assembly: its holes are named for joints (hole:H1 for a part H1 with one hole).'
                  : c.usableAsSolid
                  ? 'Use it in a component with Insert body, or insert it into an assembly.'
                  : 'Too many triangles to use as a solid. Simplify it first (under Simplify), or view and convert it as it is.'
          }}
        </p>
      }
      @if (layout.phone()) {
        <cad-phone-bar [viewport]="viewport" />
      }
    </div>
    <aside class="properties" aria-label="Properties">
      <p class="eyebrow">Imported file</p>
      <h2>{{ document().name }} <cad-help topic="imported" /></h2>
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
            @if (c.board; as board) {
              <dt>Thickness</dt>
              <dd class="mono">{{ mm(board.thickness) }}</dd>
              <dt>Holes</dt>
              <dd class="mono" data-testid="board-holes">{{ board.holes }}</dd>
              <dt>Mounting holes</dt>
              <dd class="mono" data-testid="board-mounting-holes">{{ board.mountingHoles.length ? board.mountingHoles.join(', ') : 'none' }}</dd>
              <dt>Parts</dt>
              <dd class="mono" data-testid="board-parts">{{ board.parts }}{{ board.models ? ' (' + board.models + ' as STEP models)' : '' }}</dd>
            } @else {
              <dt>PLA</dt>
              <dd class="mono">{{ grams((c.volume * 1.24) / 1000) }}</dd>
            }
          } @else if (c.kind === 'drawing') {
            <dt>Curves</dt>
            <dd class="mono" data-testid="imported-curves">{{ curveCount() }}</dd>
          }
          <dt>Size</dt>
          @if (c.kind === 'picture') {
            <dd class="mono" data-testid="imported-size">{{ c.width }} × {{ c.height }} pixels</dd>
          } @else {
            <dd class="mono" data-testid="imported-size">{{ point(size()) }} mm</dd>
          }
        </dl>
      }
      @if (simplifiable()) {
        <section class="simplify" aria-label="Simplify">
          <p class="eyebrow">Simplify</p>
          <p class="hint">Fewer triangles, with openings closed and triangles turned outwards, so it can be used as a solid (up to 100,000 triangles). The original stays as it is.</p>
          <label class="field">
            <span>Triangles</span>
            <input type="number" min="4" step="1000" [value]="budget()" (change)="setBudget($event)" data-testid="simplify-triangles" />
          </label>
          <div class="simplify-actions">
            <button type="button" class="btn" [disabled]="simplifying()" (click)="previewSimplified()">Preview</button>
            <button type="button" class="btn btn-primary" [disabled]="simplifying()" (click)="keepSimplified()">Keep as new file</button>
          </div>
          @if (simplifying()) {
            <p class="hint">Simplifying…</p>
          } @else if (simplified(); as s) {
            <dl data-testid="simplified-contents">
              <dt>Triangles</dt>
              <dd class="mono" data-testid="simplified-triangles">{{ s.content.triangles.toLocaleString('en-US') }} of {{ s.before.toLocaleString('en-US') }}</dd>
              <dt>Volume</dt>
              <dd class="mono">{{ mm(s.content.volume, 3) }}</dd>
              <dt>Openings closed</dt>
              <dd class="mono">{{ s.repair.closedHoles }}</dd>
              <dt>Triangles turned</dt>
              <dd class="mono">{{ s.repair.flippedTriangles }}</dd>
              <dt>Duplicates removed</dt>
              <dd class="mono">{{ s.repair.mergedVertices + s.repair.removedTriangles }}</dd>
            </dl>
          }
        </section>
      }
    </aside>
  `,
  styleUrls: ['./mode-layout.scss', './editor-tools.scss'],
  host: { '[attr.data-layout]': 'layout.phone() ? "phone" : null' },
  styles: `
    .format { text-transform: uppercase; }
    .top-tools { left: 264px; }
    .simplify { display: grid; gap: var(--space-3); }
    .hint { margin: 0; font-size: 12px; color: var(--text-muted); }
    .simplify-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .picture { position: absolute; inset: 72px 24px 48px 264px; width: calc(100% - 288px); height: calc(100% - 120px); object-fit: contain; pointer-events: none; }
  `,
})
export class ImportedMode {
  readonly document = input.required<DocumentSummary>();
  /** A file this view made (a simplified mesh), for the editor to list and open. */
  readonly created = output<DocumentSummary>();
  /** The phone layout: a viewer with touch tools (CAD-179). */
  protected readonly layout = inject(Layout);
  protected readonly status = inject(EditorStatus);
  protected readonly thumbnails = inject(ThumbnailSaver);
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
  /** The simplified mesh being previewed, shown in place of the original (CAD-169). */
  protected readonly simplified = signal<SimplifiedImport | undefined>(undefined);
  protected readonly simplifying = signal(false);
  protected readonly budget = signal(50_000);
  protected readonly simplifiable = computed(() => {
    const format = this.view.value()?.format;
    return this.content()?.kind === 'model' && (format === 'stl' || format === 'obj' || format === '3mf');
  });
  protected readonly meshes = computed(() => {
    const preview = this.simplified();
    if (preview) return preview.content.meshes;
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
    return c && c.kind !== 'picture' ? { min: c.min, max: c.max } : undefined;
  });
  protected readonly size = computed(() => {
    const c = this.content();
    return c && c.kind !== 'picture' ? [0, 1, 2].map((axis) => (c.max[axis] as number) - (c.min[axis] as number)) : [0, 0, 0];
  });
  /** A picture is shown as it is, over the empty 3D view. */
  protected readonly pictureUrl = computed(() => {
    const c = this.content();
    return c?.kind === 'picture' ? pictureUrl(c.bytes, c.mediaType) : undefined;
  });
  protected readonly formats = computed(() => (this.content()?.kind === 'drawing' ? drawingFormats : modelFormats));

  constructor() {
    // A new file starts without a preview, with a size that makes a solid of it.
    effect(() => {
      this.document();
      this.simplified.set(undefined);
    });
    effect(() => {
      const c = this.content();
      if (c?.kind === 'model') this.budget.set(Math.max(4, Math.min(50_000, Math.round(c.triangles / 2))));
    });
  }

  protected setBudget(event: Event): void {
    const value = Math.round(Number((event.target as HTMLInputElement).value));
    if (Number.isFinite(value) && value >= 4) this.budget.set(value);
  }

  protected async previewSimplified(): Promise<void> {
    this.simplifying.set(true);
    const result = await this.projectManager.previewSimplified(this.document().id, this.budget());
    this.simplifying.set(false);
    this.exportError.set(result.ok ? undefined : result.error.message);
    this.simplified.set(result.ok ? result.value : undefined);
  }

  protected async keepSimplified(): Promise<void> {
    this.simplifying.set(true);
    const result = await this.projectManager.simplifyImported(this.document().id, this.budget());
    this.simplifying.set(false);
    if (!result.ok) return this.exportError.set(result.error.message);
    this.created.emit(result.value);
  }

  protected async exportAs(format: ImportFormat): Promise<void> {
    this.menuOpen.set(false);
    const result = await this.projectManager.exportImported(this.document().id, format);
    this.exportError.set(result.ok ? undefined : result.error.message);
  }
}
