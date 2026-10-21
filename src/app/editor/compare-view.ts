import { ChangeDetectionStrategy, Component, computed, inject, input, output, resource, signal } from '@angular/core';
import { type BodyMesh, type ComponentDocument, type DocumentChange, type DocumentSummary, type Matrix4, type Version, type Vec3 } from '@core/contracts';
import type { BodyComparison } from '@core/managers/design';
import { DESIGN_MANAGER, PROJECT_MANAGER } from '../core.providers';
import { relativeTime } from '../shared/format';
import { Icon } from '../shared/icon';
import type { PartDisplay } from '../viewport/viewport-scene';
import { Viewport } from '../viewport/viewport';
import { EditorStatus } from './editor-status';

/** Two versions of a document to compare: `to` absent means the document as it is now. */
export interface CompareRequest {
  readonly document: DocumentSummary;
  readonly from: Version;
  readonly to?: Version;
}

type Layout = 'overlay' | 'side-by-side';

const identity: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const shifted = (x: number): Matrix4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
/** Both versions see-through, so what was added (green) and removed (red) shows inside them. */
const looks = { kept: { color: '#9aa3ad', opacity: 0.35 }, added: { color: '#2f9e44', opacity: 1 }, removed: { color: '#d6453d', opacity: 1 } } as const;

const areaLabels: Readonly<Record<string, string>> = {
  timeline: 'Timeline',
  sketch: 'Sketches',
  parameters: 'Parameters',
  project: 'Project parameters',
  settings: 'Settings',
};

/** The smallest box around meshes. */
function extentOf(meshes: readonly BodyMesh[]): { min: Vec3; max: Vec3 } | undefined {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = mesh.positions[i + axis] as number;
        min[axis] = Math.min(min[axis] as number, value);
        max[axis] = Math.max(max[axis] as number, value);
      }
    }
  }
  return (min[0] as number) <= (max[0] as number) ? { min: min as unknown as Vec3, max: max as unknown as Vec3 } : undefined;
}

/**
 * Two versions of a document side by side or overlaid in the viewport, with what changed in its
 * timeline, sketches and parameters (CAD-175). Other kinds than components show only the list.
 */
@Component({
  selector: 'cad-compare-view',
  imports: [Viewport, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage">
      <cad-viewport [showOrigin]="false" [parts]="parts()" [fit]="extent()" (backendReady)="status.renderer.set($event)" />
      <section class="browser" aria-label="Comparison">
        <h2 class="eyebrow browser-title">Compare</h2>
        <p class="versions" data-testid="compared-versions"><strong>{{ label(request().from) }}</strong> → <strong>{{ request().to ? label(request().to) : 'as it is now' }}</strong></p>
        @if (layout() === 'overlay') {
          <ul class="legend" aria-label="Legend">
            <li><span class="swatch added"></span> Added</li>
            <li><span class="swatch removed"></span> Removed</li>
            <li><span class="swatch kept"></span> {{ request().to ? label(request().to) : 'Now' }}</li>
          </ul>
        } @else {
          <ul class="legend" aria-label="Legend">
            <li>Left: {{ label(request().from) }}, removed in red</li>
            <li>Right: {{ request().to ? label(request().to) : 'now' }}, added in green</li>
          </ul>
        }
      </section>
      <div class="top-tools">
        <div class="model-bar" role="toolbar" aria-label="Compare tools">
          <div class="segmented" role="group" aria-label="Show the versions">
            <button type="button" class="btn" [class.active]="layout() === 'overlay'" [attr.aria-pressed]="layout() === 'overlay'" (click)="layout.set('overlay')">Overlaid</button>
            <button type="button" class="btn" [class.active]="layout() === 'side-by-side'" [attr.aria-pressed]="layout() === 'side-by-side'" (click)="layout.set('side-by-side')">Side by side</button>
          </div>
          <button type="button" class="btn btn-primary" (click)="closed.emit()"><cad-icon name="cross" [size]="14" /> Close comparison</button>
        </div>
      </div>
      @if (comparison.isLoading() || bodies.isLoading()) {
        <p class="notice">Building both versions…</p>
      } @else if (problem(); as message) {
        <p class="toast" role="alert">{{ message }}</p>
      }
    </div>
    <aside class="properties" aria-label="Differences">
      <p class="eyebrow">Differences</p>
      <h2>{{ request().document.name }}</h2>
      @if (built(); as result) {
        <dl data-testid="compare-volumes">
          <dt>Volume before</dt>
          <dd class="mono">{{ volume(result.volume.before) }}</dd>
          <dt>Volume after</dt>
          <dd class="mono">{{ volume(result.volume.after) }}</dd>
          <dt>Added</dt>
          <dd class="mono added-text">{{ volume(result.volume.added) }}</dd>
          <dt>Removed</dt>
          <dd class="mono removed-text">{{ volume(result.volume.removed) }}</dd>
        </dl>
      }
      @for (group of groups(); track group.area) {
        <p class="eyebrow">{{ group.title }}</p>
        <ul class="changes" [attr.aria-label]="group.title" data-testid="changes">
          @for (change of group.changes; track change.path + change.kind) {
            <li [attr.data-kind]="change.kind">
              <span class="kind">{{ change.kind }}</span>
              <span class="what">{{ change.label }}</span>
              @for (detail of change.details ?? []; track detail) {
                <span class="detail">{{ detail }}</span>
              }
            </li>
          }
        </ul>
      } @empty {
        @if (comparison.value()?.ok) {
          <p class="hint">Nothing changed between these versions.</p>
        }
      }
    </aside>
  `,
  styleUrls: ['./modes/mode-layout.scss', './modes/editor-tools.scss'],
  styles: `
    .top-tools { left: 264px; }
    .versions { margin: 0 var(--space-2) var(--space-2); font-size: 13px; }
    .legend { display: grid; gap: var(--space-1); margin: 0 var(--space-2); padding: 0; list-style: none; font-size: 12px; color: var(--text-muted); }
    .legend li { display: flex; align-items: center; gap: var(--space-2); }
    .swatch { width: 12px; height: 12px; border-radius: 3px; }
    .swatch.added { background: #2f9e44; }
    .swatch.removed { background: #d6453d; }
    .swatch.kept { background: #9aa3ad; opacity: 0.6; }
    .segmented { display: flex; gap: 2px; }
    .segmented .active { background: var(--accent-soft); color: var(--accent-strong); }
    .changes { display: grid; gap: var(--space-1); margin: 0 0 var(--space-3); padding: 0; list-style: none; }
    .changes li { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-2); padding: var(--space-1) var(--space-2); border-left: 3px solid var(--border); font-size: 12px; }
    .changes li[data-kind='added'] { border-color: #2f9e44; }
    .changes li[data-kind='removed'] { border-color: #d6453d; }
    .changes li[data-kind='changed'] { border-color: var(--accent); }
    .kind { color: var(--text-muted); text-transform: capitalize; min-width: 52px; }
    .what { font-weight: 500; }
    .detail { flex-basis: 100%; padding-left: 60px; color: var(--text-muted); overflow-wrap: anywhere; }
    .added-text { color: #2f9e44; }
    .removed-text { color: #d6453d; }
    .hint { color: var(--text-muted); font-size: 12px; }
  `,
})
export class CompareView {
  readonly request = input.required<CompareRequest>();
  readonly closed = output();
  protected readonly status = inject(EditorStatus);
  protected readonly layout = signal<Layout>('overlay');
  private readonly projects = inject(PROJECT_MANAGER);
  private readonly design = inject(DESIGN_MANAGER);

  protected readonly comparison = resource({
    params: () => this.request(),
    loader: ({ params }) => this.projects.compareVersions(params.document.id, params.from.id, params.to?.id),
  });
  /** Both versions built, for components. */
  protected readonly bodies = resource({
    params: () => {
      const result = this.comparison.value();
      return result?.ok && result.value.before.kind === 'component' && result.value.after.kind === 'component' ? result.value : undefined;
    },
    loader: ({ params }) => this.design.compareBodies(params.before as ComponentDocument, params.after as ComponentDocument, params.projectParameters),
  });

  protected readonly problem = computed(() => {
    const compared = this.comparison.value();
    if (compared && !compared.ok) return compared.error.message;
    const built = this.bodies.value();
    return built && !built.ok ? built.error.message : undefined;
  });

  protected readonly groups = computed(() => {
    const result = this.comparison.value();
    const changes: readonly DocumentChange[] = result?.ok ? result.value.changes : [];
    const areas = [...new Set(changes.map((c) => c.area))];
    return areas.map((area) => ({ area, title: areaLabels[area] ?? area.charAt(0).toUpperCase() + area.slice(1), changes: changes.filter((c) => c.area === area) }));
  });

  protected readonly built = computed<BodyComparison | undefined>(() => {
    const result = this.bodies.value();
    return result?.ok ? result.value : undefined;
  });

  protected readonly parts = computed<PartDisplay[]>(() => {
    const built = this.built();
    if (!built) return [];
    if (this.layout() === 'overlay') {
      return [
        { id: 'after', bodies: built.after, transform: identity, appearance: looks.kept },
        { id: 'added', bodies: built.added, transform: identity, appearance: looks.added },
        { id: 'removed', bodies: built.removed, transform: identity, appearance: looks.removed },
      ];
    }
    const box = extentOf([...built.before, ...built.after]);
    const width = box ? box.max[0] - box.min[0] : 0;
    const gap = Math.max(10, width * 0.25);
    return [
      { id: 'before', bodies: built.before, transform: identity, appearance: looks.kept },
      { id: 'removed', bodies: built.removed, transform: identity, appearance: looks.removed },
      { id: 'after', bodies: built.after, transform: shifted(width + gap), appearance: looks.kept },
      { id: 'added', bodies: built.added, transform: shifted(width + gap), appearance: looks.added },
    ];
  });

  protected readonly extent = computed(() => {
    const built = this.built();
    if (!built) return undefined;
    const box = extentOf([...built.before, ...built.after]);
    if (!box || this.layout() === 'overlay') return box;
    const width = box.max[0] - box.min[0];
    return { min: box.min, max: [box.max[0] + width + Math.max(10, width * 0.25), box.max[1], box.max[2]] as Vec3 };
  });

  protected label(version: Version | undefined): string {
    return version ? (version.names[0] ?? relativeTime(version.time)) : 'now';
  }

  protected volume(mm3: number): string {
    return `${Math.round(mm3).toLocaleString('en-US')} mm³`;
  }
}
