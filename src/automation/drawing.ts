import type { DrawingAnnotation, DrawingView, Sheet, TitleBlock, Vec2, Vec3, ViewAnchor } from '@core/contracts';
import type { DrawingCommand, DrawingSession, DrawingState, SheetAnchor, SheetLayout } from '@core/managers/drawing';
import { CadenceError, type ExportTarget, unwrap } from './results';

const round = (value: number) => Math.round(value * 1000) / 1000;
const roundPoint = (p: Vec2): Vec2 => [round(p[0]), round(p[1])];
const roundPoint3 = (p: Vec3): Vec3 => [round(p[0]), round(p[1]), round(p[2])];

/** The parts of a drawing summary. */
export type DrawingPart = 'sheet' | 'views' | 'annotations' | 'anchors';

/** Which parts and anchors a drawing summary lists (all of them by default, which can be many). */
export interface DrawingFilter {
  /** Only these parts (CAD-128); the anchor counts come always. */
  readonly only?: readonly DrawingPart[];
  readonly view?: string;
  readonly kind?: SheetAnchor['kind'];
  /** Anchors within `within` sheet millimetres (5 by default) of this sheet point. */
  readonly near?: Vec2;
  readonly within?: number;
  /** Circles of this diameter, in model millimetres (within 0.01). */
  readonly diameter?: number;
  /** Only the outermost points each view shows (left, right, top, bottom), for overall dimensions. */
  readonly extremes?: boolean;
  /** Also anchors their view does not show: hidden, with the view's hidden lines off. */
  readonly hidden?: boolean;
  /** Each anchor's persistent name too, which can be long; `ref` does instead. */
  readonly names?: boolean;
}

/**
 * Model geometry annotations attach to, on the sheet (mm): one per place, though several names may
 * meet there (CAD-128). `ref` is a short handle, accepted in place of the name as `{ view, ref }`;
 * `model` is where it is in the model (mm); circles give their `diameter` in model mm too.
 */
export interface DrawingAnchor {
  readonly view: string;
  readonly ref: string;
  readonly kind: SheetAnchor['kind'];
  readonly at: Vec2;
  readonly radius?: number;
  readonly diameter?: number;
  readonly start?: Vec2;
  readonly end?: Vec2;
  readonly model?: Vec3;
  readonly hidden?: true;
  readonly name?: string;
}

/** A drawing as data: the sheet, its views (where they are on the sheet), annotations, and what annotations can attach to. */
export interface DrawingSummary {
  readonly id: string;
  readonly name: string;
  readonly sheet?: Sheet & { readonly width: number; readonly height: number };
  readonly titleBlock?: TitleBlock;
  /** Each view with its box on the sheet (mm), why it cannot be drawn, and how it was drawn when not exactly. */
  readonly views?: readonly (DrawingView & { readonly box?: { readonly min: Vec2; readonly max: Vec2 }; readonly error?: string; readonly note?: string })[];
  /** Annotations, their anchors by `ref` (by name with `names`). */
  readonly annotations?: readonly DrawingAnnotation[];
  /** Annotations whose model geometry is gone. */
  readonly lost: readonly string[];
  readonly anchors?: readonly DrawingAnchor[];
  /** How many places each view offers to attach to. */
  readonly anchorCounts: Readonly<Record<string, number>>;
}

/** A handle per anchor, short and stable while its name lasts: the kind's letter and a hash of the name, unique within the view. */
function handles(layout: SheetLayout): Map<SheetAnchor, string> {
  const refs = new Map<SheetAnchor, string>();
  const taken = new Map<string, Map<string, string>>();
  for (const anchor of layout.anchors) {
    const view = taken.get(anchor.view) ?? new Map<string, string>();
    taken.set(anchor.view, view);
    let hash = 0x811c9dc5;
    for (let i = 0; i < anchor.name.length; i++) hash = Math.imul(hash ^ anchor.name.charCodeAt(i), 0x01000193) >>> 0;
    let ref = `${anchor.kind[0]}${hash.toString(36)}`;
    const key = `${anchor.kind}:${anchor.name}`;
    for (let n = 2; view.has(ref) && view.get(ref) !== key; n++) ref = `${anchor.kind[0]}${hash.toString(36)}.${n}`;
    view.set(ref, key);
    refs.set(anchor, ref);
  }
  return refs;
}

/** The anchors to list: one per place in each view (a seen one where several names meet), and each outermost point (CAD-128). */
function distinct(anchors: readonly SheetAnchor[]): SheetAnchor[] {
  const places = new Map<string, SheetAnchor>();
  const at = (p?: Vec2) => (p ? `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}` : '');
  for (const anchor of anchors) {
    const ends = [at(anchor.start), at(anchor.end)].sort().join(' ');
    const place = anchor.name.startsWith('extreme:') ? `${anchor.view}|${anchor.name}` : `${anchor.view}|${anchor.kind}|${at(anchor.at)}|${Math.round((anchor.radius ?? 0) * 100)}|${ends}`;
    const before = places.get(place);
    if (!before || (before.hidden && !anchor.hidden)) places.set(place, anchor);
  }
  return [...places.values()];
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

  /** Runs commands in order; their annotations may name anchors by `{ view, ref }` from a summary (CAD-128). */
  async run(...commands: readonly DrawingCommand[]): Promise<void> {
    for (const command of commands) unwrap(await this.session.execute(await this.resolved(command)));
  }

  /** The command with anchors given by `ref` named as the drawing knows them. */
  private async resolved(command: DrawingCommand): Promise<DrawingCommand> {
    if (command.type !== 'add-annotation' && command.type !== 'edit-annotation') return command;
    const given = command.annotation as unknown as Record<string, unknown>;
    const fields = ['anchors', 'circle', 'a', 'b'].filter((f) => f in given);
    const refs = (value: unknown) => (Array.isArray(value) ? value : [value]).some((a) => a && typeof a === 'object' && 'ref' in a);
    if (!fields.some((f) => refs(given[f]))) return command;
    await this.ready();
    const { layout } = this.session.state();
    const byRef = new Map([...handles(layout)].map(([anchor, ref]) => [`${anchor.view}|${ref}`, anchor]));
    const named = (value: unknown): ViewAnchor => {
      const { view, ref } = value as { view?: string; ref?: string };
      if (ref === undefined) return value as ViewAnchor;
      const anchor = byRef.get(`${view}|${ref}`);
      if (!anchor) throw new CadenceError('unknown-anchor', `View ${view} has no anchor ${ref}; get_drawing lists them.`);
      return { view: anchor.view, kind: anchor.kind, name: anchor.name };
    };
    const annotation = Object.fromEntries(Object.entries(given).map(([key, value]) => [key, !fields.includes(key) ? value : Array.isArray(value) ? value.map(named) : named(value)]));
    return { ...command, annotation: annotation as unknown as DrawingAnnotation };
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
    const loading = () => this.session.state().layout.views.some((v) => v.error === 'Loading…' || v.error === 'Drawing…');
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

  /** The drawing as data; the filter picks the parts and which anchors are listed. */
  async summary(filter: DrawingFilter = {}): Promise<DrawingSummary> {
    await this.ready();
    const { document, layout } = this.session.state();
    if (filter.view !== undefined && !document.views.some((v) => v.id === filter.view)) throw new CadenceError('usage', `There is no view "${filter.view}".`);
    const part = (name: DrawingPart) => !filter.only || filter.only.includes(name);
    const refs = handles(layout);
    const hiddenShown = new Set(document.views.filter((v) => v.hidden || document.views.find((p) => p.id === v.detail?.of)?.hidden).map((v) => v.id));
    const scaleOf = (view: string) => layout.views.find((v) => v.id === view)?.scale ?? 1;
    // What each view offers: what it shows (hidden geometry where it draws hidden lines), once per place.
    const offered = distinct(layout.anchors.filter((a) => filter.hidden || !a.hidden || hiddenShown.has(a.view)));
    const within = filter.within ?? 5;
    const listed = offered.filter(
      (a) =>
        (filter.view === undefined || a.view === filter.view) &&
        (filter.kind === undefined || a.kind === filter.kind) &&
        (!filter.near || Math.hypot(a.at[0] - filter.near[0], a.at[1] - filter.near[1]) <= within) &&
        (filter.diameter === undefined || (a.kind === 'circle' && Math.abs((2 * (a.radius ?? 0)) / scaleOf(a.view) - filter.diameter) < 0.01)) &&
        (!filter.extremes || a.name.startsWith('extreme:')),
    );
    // Circles largest first, so one size's circles come together.
    if (filter.kind === 'circle') listed.sort((a, b) => (b.radius ?? 0) / scaleOf(b.view) - (a.radius ?? 0) / scaleOf(a.view));
    const counts: Record<string, number> = {};
    for (const a of offered) counts[a.view] = (counts[a.view] ?? 0) + 1;
    const byName = new Map([...refs].map(([anchor, ref]) => [`${anchor.view}|${anchor.kind}|${anchor.name}`, ref]));
    const short = (anchor: ViewAnchor) => {
      const ref = byName.get(`${anchor.view}|${anchor.kind}|${anchor.name}`);
      return filter.names || !ref ? anchor : { view: anchor.view, kind: anchor.kind, ref };
    };
    const annotations = document.annotations.map((a): DrawingAnnotation => {
      switch (a.kind) {
        case 'dimension':
          return { ...a, anchors: a.anchors.map(short) as ViewAnchor[] };
        case 'center-mark':
        case 'callout':
          return { ...a, circle: short(a.circle) as ViewAnchor };
        case 'center-line':
          return { ...a, a: short(a.a) as ViewAnchor, b: short(a.b) as ViewAnchor };
        default:
          return a;
      }
    });
    return {
      id: document.id,
      name: document.name,
      ...(part('sheet') ? { sheet: { ...document.sheet, width: layout.width, height: layout.height }, titleBlock: document.titleBlock } : {}),
      ...(part('views')
        ? {
            views: document.views.map((view) => {
              const placed = layout.views.find((v) => v.id === view.id);
              return { ...view, ...(placed ? { box: { min: roundPoint(placed.min), max: roundPoint(placed.max) } } : {}), ...(placed?.error ? { error: placed.error } : {}), ...(placed?.note ? { note: placed.note } : {}) };
            }),
          }
        : {}),
      ...(part('annotations') ? { annotations } : {}),
      lost: layout.lost,
      ...(part('anchors')
        ? {
            anchors: listed.map((a) => ({
              view: a.view,
              ref: refs.get(a) as string,
              kind: a.kind,
              at: roundPoint(a.at),
              ...(a.radius !== undefined ? { radius: round(a.radius), diameter: round((2 * a.radius) / scaleOf(a.view)) } : {}),
              ...(a.start ? { start: roundPoint(a.start) } : {}),
              ...(a.end ? { end: roundPoint(a.end) } : {}),
              ...(a.model ? { model: roundPoint3(a.model) } : {}),
              ...(a.hidden ? { hidden: true as const } : {}),
              ...(filter.names ? { name: a.name } : {}),
            })),
          }
        : {}),
      anchorCounts: counts,
    };
  }

  /** What changed since an earlier summary, one taken with `names: true` (as this one compares). */
  async changes(before: DrawingSummary): Promise<DrawingChanges> {
    const after = (await this.summary({ names: true, only: ['sheet', 'views', 'annotations'] })) as Required<DrawingSummary>;
    const diff = <T extends { readonly id: string }>(was: readonly T[], is: readonly T[]) => ({
      created: is.filter((i) => !was.some((w) => w.id === i.id)).map((i) => i.id),
      changed: is.filter((i) => was.some((w) => w.id === i.id && JSON.stringify(w) !== JSON.stringify(i))).map((i) => i.id),
      removed: was.filter((w) => !is.some((i) => i.id === w.id)).map((w) => w.id),
    });
    const views = diff(before.views ?? [], after.views);
    const annotations = diff(before.annotations ?? [], after.annotations);
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
      counts: { views: after.views.length, annotations: after.annotations.length, anchors: Object.values(after.anchorCounts).reduce((sum, n) => sum + n, 0) },
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
