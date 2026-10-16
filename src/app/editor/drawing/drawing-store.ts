import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { type DimensionType, type DocumentId, type DocumentSummary, type ProjectId, type Vec2, type ViewAnchor } from '@core/contracts';
import type { DrawingCommand, DrawingSession, DrawingState, SheetAnchor } from '@core/managers/drawing';
import { DRAWING_MANAGER, PROJECT_MANAGER } from '../../core.providers';

/** What a click on the sheet does. */
export type DrawingTool =
  | { readonly kind: 'select' }
  | { readonly kind: 'dimension'; readonly type: DimensionType }
  | { readonly kind: 'note' }
  | { readonly kind: 'center-mark' }
  | { readonly kind: 'center-line' }
  | { readonly kind: 'callout' }
  | { readonly kind: 'balloon' }
  | { readonly kind: 'parts-list' }
  | { readonly kind: 'detail' };

export type DrawingSelection = { readonly kind: 'view' | 'annotation'; readonly id: string } | undefined;

/** The anchors each dimension type needs, in order. */
export const dimensionAnchors: Readonly<Record<DimensionType, readonly ViewAnchor['kind'][]>> = {
  linear: ['point', 'point'],
  horizontal: ['point', 'point'],
  vertical: ['point', 'point'],
  radius: ['circle'],
  diameter: ['circle'],
  angle: ['line', 'line'],
};

/** Client-side state of the drawing editor: the Drawing session as signals, plus the tool, selection and picks. */
@Injectable()
export class DrawingStore {
  private readonly manager = inject(DRAWING_MANAGER);
  private readonly projects = inject(PROJECT_MANAGER);
  private session: DrawingSession | undefined;
  private unsubscribe: (() => void) | undefined;

  readonly state = signal<DrawingState | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);
  readonly tool = signal<DrawingTool>({ kind: 'select' });
  readonly selection = signal<DrawingSelection>(undefined);
  /** Anchors picked so far for the annotation being made. */
  readonly picked = signal<readonly SheetAnchor[]>([]);
  /** Components and assemblies of the project, for views. */
  readonly sources = signal<readonly DocumentSummary[]>([]);
  readonly layout = computed(() => this.state()?.layout);
  readonly document = computed(() => this.state()?.document);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close());
  }

  async open(documentId: DocumentId, projectId: ProjectId): Promise<void> {
    this.close();
    this.state.set(undefined);
    this.selection.set(undefined);
    const opened = await this.manager.open(documentId);
    if (!opened.ok) {
      this.error.set(opened.error.message);
      return;
    }
    this.session = opened.value;
    this.state.set(this.session.state());
    this.unsubscribe = this.session.subscribe((state) => this.state.set(state));
    this.sources.set((await this.projects.listDocuments(projectId)).filter((d) => d.kind === 'component' || d.kind === 'assembly'));
  }

  async run(command: DrawingCommand): Promise<boolean> {
    if (!this.session) return false;
    const result = await this.session.execute(command);
    this.error.set(result.ok ? undefined : result.error.message);
    return result.ok;
  }

  use(tool: DrawingTool): void {
    this.tool.set(tool);
    this.picked.set([]);
    this.error.set(undefined);
  }

  /** The anchor nearest a sheet point (within `reach` mm) that the current tool can use. */
  anchorNear(at: Vec2, reach: number): SheetAnchor | undefined {
    const layout = this.layout();
    const tool = this.tool();
    const kinds: readonly ViewAnchor['kind'][] =
      tool.kind === 'dimension'
        ? [dimensionAnchors[tool.type][this.picked().length] ?? 'point']
        : tool.kind === 'center-mark' || tool.kind === 'callout'
          ? ['circle']
          : tool.kind === 'center-line'
            ? ['point', 'circle']
            : [];
    let best: { anchor: SheetAnchor; distance: number } | undefined;
    for (const anchor of layout?.anchors ?? []) {
      if (!kinds.includes(anchor.kind)) continue;
      // Circles are picked on their rim, lines anywhere along them, points at themselves.
      const distance =
        anchor.kind === 'circle'
          ? Math.abs(Math.hypot(at[0] - anchor.at[0], at[1] - anchor.at[1]) - (anchor.radius ?? 0))
          : anchor.kind === 'line' && anchor.start && anchor.end
            ? toSegment(at, anchor.start, anchor.end)
            : Math.hypot(at[0] - anchor.at[0], at[1] - anchor.at[1]);
      if (distance <= reach && (!best || distance < best.distance)) best = { anchor, distance };
    }
    return best?.anchor;
  }

  async undo(): Promise<void> {
    await this.session?.undo();
  }

  async redo(): Promise<void> {
    await this.session?.redo();
  }

  async exportPdf(): Promise<void> {
    const result = await this.session?.exportPdf();
    if (result && !result.ok) this.error.set(result.error.message);
  }

  async exportDxf(): Promise<void> {
    const result = await this.session?.exportDxf();
    if (result && !result.ok) this.error.set(result.error.message);
  }

  private close(): void {
    this.unsubscribe?.();
    this.session?.close();
    this.session = undefined;
  }
}

function toSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1] || 1)));
  return Math.hypot(p[0] - (a[0] + d[0] * t), p[1] - (a[1] + d[1] * t));
}
