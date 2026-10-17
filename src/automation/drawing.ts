import type { DrawingAnnotation, DrawingView, Sheet, TitleBlock, Vec2 } from '@core/contracts';
import type { DrawingCommand, DrawingSession, DrawingState, SheetAnchor } from '@core/managers/drawing';
import { CadenceError, type ExportTarget, unwrap } from './results';

const round = (value: number) => Math.round(value * 1000) / 1000;
const roundPoint = (p: Vec2): Vec2 => [round(p[0]), round(p[1])];

/** Which anchors a drawing summary lists (all of them by default, which can be many). */
export interface DrawingFilter {
  readonly view?: string;
  readonly kind?: SheetAnchor['kind'];
  /** Anchors within `within` sheet millimetres (5 by default) of this sheet point. */
  readonly near?: Vec2;
  readonly within?: number;
}

/** A drawing as data: the sheet, its views (where they are on the sheet), annotations, and what annotations can attach to. */
export interface DrawingSummary {
  readonly id: string;
  readonly name: string;
  readonly sheet: Sheet & { readonly width: number; readonly height: number };
  readonly titleBlock: TitleBlock;
  /** Each view with its box on the sheet (mm) and, when it cannot be drawn, why. */
  readonly views: readonly (DrawingView & { readonly box?: { readonly min: Vec2; readonly max: Vec2 }; readonly error?: string })[];
  readonly annotations: readonly DrawingAnnotation[];
  /** Annotations whose model geometry is gone. */
  readonly lost: readonly string[];
  /**
   * The views' points, circles (centre and radius) and lines (ends) on the sheet (mm), by the
   * persistent names annotations anchor to: `{ view, kind, name }`.
   */
  readonly anchors: readonly SheetAnchor[];
  /** How many anchors each view has, when the filter left some out. */
  readonly anchorCounts?: Readonly<Record<string, number>>;
}

/** What changed since an earlier summary: the answer to an edit. */
export interface DrawingChanges {
  readonly id: string;
  readonly created?: { readonly views?: readonly string[]; readonly annotations?: readonly string[] };
  readonly changed?: { readonly views?: readonly string[]; readonly annotations?: readonly string[]; readonly sheet?: true; readonly titleBlock?: true };
  readonly removed?: readonly string[];
  /** New and changed views, where they are now on the sheet. */
  readonly placed?: Readonly<Record<string, { readonly min: Vec2; readonly max: Vec2 }>>;
  /** Views that cannot be drawn, with why. */
  readonly viewErrors?: Readonly<Record<string, string>>;
  readonly lost?: readonly string[];
  readonly counts: { readonly views: number; readonly annotations: number; readonly anchors: number };
}

/** One technical drawing open for scripting (CAD-123). */
export class DrawingScript {
  constructor(
    private readonly session: DrawingSession,
    private readonly exports: ExportTarget,
    private readonly closed: () => void = () => undefined,
    /** Resolves once this process's events are handled (Core.settled). */
    private readonly settled: () => Promise<void> = async () => undefined,
  ) {}

  state(): DrawingState {
    return this.session.state();
  }

  async run(...commands: readonly DrawingCommand[]): Promise<void> {
    for (const command of commands) unwrap(await this.session.execute(command));
  }

  undo(): Promise<void> {
    return this.session.undo();
  }

  redo(): Promise<void> {
    return this.session.redo();
  }

  /** Waits, at most two minutes, until the views' sources are drawn: this process's events handled, other processes caught up with. */
  async ready(): Promise<void> {
    const deadline = Date.now() + 120_000;
    await this.settled();
    await this.session.catchUp();
    const loading = () => this.session.state().layout.views.some((v) => v.error === 'Loading…');
    while (loading() && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, Math.max(0, deadline - Date.now()));
        const stop = this.session.subscribe(() => (loading() ? undefined : done()));
        function done() {
          clearTimeout(timer);
          stop();
          resolve();
        }
      });
    }
  }

  /** The drawing as data; the filter picks which anchors are listed. */
  async summary(filter: DrawingFilter = {}): Promise<DrawingSummary> {
    await this.ready();
    const { document, layout } = this.session.state();
    if (filter.view !== undefined && !document.views.some((v) => v.id === filter.view)) throw new CadenceError('usage', `There is no view "${filter.view}".`);
    const within = filter.within ?? 5;
    const anchors = layout.anchors.filter(
      (a) => (filter.view === undefined || a.view === filter.view) && (filter.kind === undefined || a.kind === filter.kind) && (!filter.near || Math.hypot(a.at[0] - filter.near[0], a.at[1] - filter.near[1]) <= within),
    );
    const filtered = filter.view !== undefined || filter.kind !== undefined || filter.near !== undefined;
    const counts: Record<string, number> = {};
    for (const a of layout.anchors) counts[a.view] = (counts[a.view] ?? 0) + 1;
    return {
      id: document.id,
      name: document.name,
      sheet: { ...document.sheet, width: layout.width, height: layout.height },
      titleBlock: document.titleBlock,
      views: document.views.map((view) => {
        const placed = layout.views.find((v) => v.id === view.id);
        return { ...view, ...(placed ? { box: { min: roundPoint(placed.min), max: roundPoint(placed.max) } } : {}), ...(placed?.error ? { error: placed.error } : {}) };
      }),
      annotations: document.annotations,
      lost: layout.lost,
      anchors: anchors.map((a) => ({
        ...a,
        at: roundPoint(a.at),
        ...(a.radius !== undefined ? { radius: round(a.radius) } : {}),
        ...(a.start ? { start: roundPoint(a.start) } : {}),
        ...(a.end ? { end: roundPoint(a.end) } : {}),
      })),
      ...(filtered ? { anchorCounts: counts } : {}),
    };
  }

  /** What changed since an earlier summary. */
  async changes(before: DrawingSummary): Promise<DrawingChanges> {
    const after = await this.summary();
    const diff = <T extends { readonly id: string }>(was: readonly T[], is: readonly T[]) => ({
      created: is.filter((i) => !was.some((w) => w.id === i.id)).map((i) => i.id),
      changed: is.filter((i) => was.some((w) => w.id === i.id && JSON.stringify(w) !== JSON.stringify(i))).map((i) => i.id),
      removed: was.filter((w) => !is.some((i) => i.id === w.id)).map((w) => w.id),
    });
    const views = diff(before.views, after.views);
    const annotations = diff(before.annotations, after.annotations);
    const list = <K extends string>(entries: Partial<Record<K, readonly string[] | true>>) => Object.fromEntries(Object.entries(entries).filter(([, v]) => v === true || (Array.isArray(v) && v.length)));
    const created = list({ views: views.created, annotations: annotations.created });
    const changed = list({
      views: views.changed,
      annotations: annotations.changed,
      ...(JSON.stringify(before.sheet) !== JSON.stringify(after.sheet) ? { sheet: true as const } : {}),
      ...(JSON.stringify(before.titleBlock) !== JSON.stringify(after.titleBlock) ? { titleBlock: true as const } : {}),
    });
    const removed = [...views.removed, ...annotations.removed];
    const placed = Object.fromEntries(after.views.flatMap((v) => (v.box && (views.created.includes(v.id) || views.changed.includes(v.id)) ? [[v.id, v.box]] : [])));
    const viewErrors = Object.fromEntries(after.views.flatMap((v) => (v.error ? [[v.id, v.error]] : [])));
    return {
      id: after.id,
      ...(Object.keys(created).length ? { created } : {}),
      ...(Object.keys(changed).length ? { changed } : {}),
      ...(removed.length ? { removed } : {}),
      ...(Object.keys(placed).length ? { placed } : {}),
      ...(Object.keys(viewErrors).length ? { viewErrors } : {}),
      ...(after.lost.length ? { lost: after.lost } : {}),
      counts: { views: after.views.length, annotations: after.annotations.length, anchors: after.anchors.length },
    };
  }

  /** The sheet as a PNG (or one view of it, zoomed), as the PDF shows it. */
  async picture(options: { readonly width?: number; readonly view?: string } = {}): Promise<Uint8Array> {
    await this.ready();
    return unwrap(await this.session.picture(options));
  }

  /** Writes the sheet as PDF or DXF; returns the path. */
  async export(format: 'pdf' | 'dxf', options: { readonly to?: string } = {}): Promise<string> {
    await this.ready();
    if (options.to) this.exports.deliverNextTo(options.to);
    const before = this.exports.delivered.length;
    unwrap(await (format === 'pdf' ? this.session.exportPdf() : this.session.exportDxf()));
    return this.exports.delivered[before] as string;
  }

  close(): void {
    this.session.close();
    this.closed();
  }
}
