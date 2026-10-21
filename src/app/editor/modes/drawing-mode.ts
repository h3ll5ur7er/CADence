import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, type ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import {
  type DimensionType,
  type DocumentSummary,
  type DrawingAnnotation,
  type DrawingView,
  fitsDimension,
  nextDimensionAnchor,
  type SectionCut,
  type Sheet,
  type SheetSize,
  sheetSizes,
  type SurfaceProcess,
  type TitleBlock,
  type Tolerance,
  type Vec2,
  type ViewAnchor,
  type ViewDirection,
} from '@core/contracts';
import { newId } from '@core/utilities/identity';
import { Icon } from '../../shared/icon';
import { Shortcuts } from '../../shared/shortcuts';
import { DrawingStore, type DrawingTool } from '../drawing/drawing-store';
import { ChangedElsewhereNotice } from '../changed-elsewhere';

const directionLabels: Readonly<Record<ViewDirection, string>> = { front: 'Front', top: 'Top', right: 'Right', left: 'Left', back: 'Back', bottom: 'Bottom', iso: 'Isometric' };
const dimensionLabels: Readonly<Record<DimensionType, string>> = { linear: 'Aligned', horizontal: 'Horizontal', vertical: 'Vertical', radius: 'Radius', diameter: 'Diameter', angle: 'Angle' };
const scales: readonly { readonly value: number; readonly label: string }[] = [
  { value: 10, label: '10:1' },
  { value: 5, label: '5:1' },
  { value: 2, label: '2:1' },
  { value: 1, label: '1:1' },
  { value: 0.5, label: '1:2' },
  { value: 0.2, label: '1:5' },
  { value: 0.1, label: '1:10' },
  { value: 0.05, label: '1:20' },
];
/** What to click for each kind of anchor. */
const anchorWords: Readonly<Record<ViewAnchor['kind'], string>> = { point: 'a corner', circle: 'a circle', line: 'a straight edge or outline' };
/** Arrowheads 3 mm long, as in the PDF and DXF. */
const arrowPoints = (tip: Vec2, d: Vec2): Vec2[] => [tip, [tip[0] - d[0] * 3 - d[1] * 0.6, tip[1] - d[1] * 3 + d[0] * 0.6], [tip[0] - d[0] * 3 + d[1] * 0.6, tip[1] - d[1] * 3 - d[0] * 0.6]];

/** Drawing mode: a sheet with views of components and assemblies, dimensions and notes; exported as PDF and DXF. */
@Component({
  selector: 'cad-drawing-mode',
  imports: [ChangedElsewhereNotice, Icon],
  providers: [DrawingStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './drawing-mode.html',
  styleUrls: ['./mode-layout.scss', './editor-tools.scss', './drawing-mode.scss'],
})
export class DrawingMode {
  /** Opens the document again, with what another program changed (CAD-150). */
  protected reopen(): void {
    const { id, projectId } = this.document();
    void this.store.open(id, projectId);
  }

  readonly document = input.required<DocumentSummary>();
  protected readonly store = inject(DrawingStore);
  protected readonly menu = signal<'view' | 'dimension' | 'export' | undefined>(undefined);
  protected readonly directionLabels = directionLabels;
  protected readonly directions = Object.keys(directionLabels) as ViewDirection[];
  protected readonly dimensionLabels = dimensionLabels;
  protected readonly dimensionTypes = Object.keys(dimensionLabels) as DimensionType[];
  protected readonly scales = scales;
  protected readonly sizes = Object.keys(sheetSizes) as SheetSize[];
  /** The view being added: its source and direction. */
  protected readonly newView = signal<{ source: string; configuration: string; direction: ViewDirection; hidden: boolean }>({ source: '', configuration: '', direction: 'front', hidden: true });
  /** The visible part of the sheet (SVG coordinates: x right, y down, in mm). */
  protected readonly viewBox = signal({ x: -10, y: -10, w: 440, h: 317 });
  /** The anchor under the pointer that the tool would pick. */
  protected readonly hover = signal<{ at: Vec2; radius?: number } | undefined>(undefined);
  /** An instance picked for a balloon, or a circle for a callout: the next click places it. */
  private readonly pending = signal<{ readonly kind: 'balloon'; readonly view: string; readonly instance: string } | undefined>(undefined);
  private readonly sheet = viewChild<ElementRef<SVGSVGElement>>('sheet');
  private drag: { owner: string; from: Vec2; start: Vec2; moved: boolean } | { pan: true; from: Vec2; box: { x: number; y: number; w: number; h: number } } | undefined;

  protected readonly layout = computed(() => this.store.layout());
  protected readonly height = computed(() => this.layout()?.height ?? 297);
  /** Sheet millimetres to SVG coordinates (y down). */
  protected readonly y = (v: number) => this.height() - v;
  protected readonly points = (points: readonly Vec2[]) => points.map((p) => `${p[0]},${this.height() - p[1]}`).join(' ');
  protected readonly arrow = (tip: Vec2, direction: Vec2) => this.points(arrowPoints(tip, direction));
  protected readonly views = computed(() => this.store.document()?.views ?? []);
  protected readonly selectedView = computed(() => {
    const selection = this.store.selection();
    return selection?.kind === 'view' ? this.views().find((v) => v.id === selection.id) : undefined;
  });
  protected readonly selectedAnnotation = computed(() => {
    const selection = this.store.selection();
    return selection?.kind === 'annotation' ? this.store.document()?.annotations.find((a) => a.id === selection.id) : undefined;
  });
  protected readonly hint = computed(() => {
    const tool = this.store.tool();
    const picked = this.store.picked().length;
    switch (tool.kind) {
      case 'dimension': {
        const next = nextDimensionAnchor(tool.type, this.store.picked().map((a) => a.kind));
        return `${dimensionLabels[tool.type]} dimension: click ${picked ? 'then ' : ''}${next.map((kind) => anchorWords[kind]).join(' or ')}.`;
      }
      case 'note':
        return 'Click where the note goes.';
      case 'center-mark':
        return 'Click a circle.';
      case 'center-line':
        return picked ? 'Click the second corner or circle.' : 'Click a corner or circle.';
      case 'callout':
        return picked ? 'Click where the callout goes.' : 'Click a hole.';
      case 'surface-finish':
        return picked ? 'Click the side of the edge the symbol stands on.' : 'Click a straight edge or outline, or where the symbol goes.';
      case 'balloon':
        return this.pending() ? 'Click where the balloon goes.' : 'Click a part of an assembly view.';
      case 'parts-list':
        return 'Click where the parts list’s top right corner goes.';
      case 'detail':
        return 'Click the middle of the detail in a view.';
      case 'select':
        return '';
    }
  });

  constructor() {
    effect(() => {
      const { id, projectId } = this.document();
      untracked(() => void this.store.open(id, projectId));
    });
    // The whole sheet in view when it opens or changes size.
    effect(() => {
      const layout = this.layout();
      if (layout) untracked(() => this.viewBox.set({ x: -10, y: -10, w: layout.width + 20, h: layout.height + 20 }));
    });
    effect(() => {
      const first = this.store.sources()[0];
      if (first && !this.newView().source) untracked(() => this.newView.update((v) => ({ ...v, source: first.id })));
    });
    const stop = inject(Shortcuts).register('document', {
      undo: () => void this.store.undo(),
      redo: () => void this.store.redo(),
      cancel: () => this.cancel(),
    });
    inject(DestroyRef).onDestroy(stop);
  }

  protected viewBoxText(): string {
    const b = this.viewBox();
    return `${b.x} ${b.y} ${b.w} ${b.h}`;
  }

  protected isSelected(owner: string | undefined): boolean {
    return !!owner && this.store.selection()?.id === owner;
  }

  protected toggleMenu(menu: 'view' | 'dimension' | 'export'): void {
    this.menu.set(this.menu() === menu ? undefined : menu);
  }

  protected use(tool: DrawingTool): void {
    this.menu.set(undefined);
    this.pending.set(undefined);
    this.store.selection.set(undefined);
    this.store.use(tool);
  }

  protected cancel(): void {
    this.pending.set(undefined);
    this.store.use({ kind: 'select' });
    this.store.selection.set(undefined);
  }

  /** The sheet point (mm, y up) under a pointer event. */
  private sheetPoint(event: { clientX: number; clientY: number }): Vec2 {
    const svg = this.sheet()?.nativeElement;
    const matrix = svg?.getScreenCTM()?.inverse();
    if (!svg || !matrix) return [0, 0];
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    return [p.x, this.height() - p.y];
  }

  /** How far a pick reaches: 6 screen pixels, in sheet millimetres. */
  private reach(): number {
    const svg = this.sheet()?.nativeElement;
    return svg ? (6 * this.viewBox().w) / Math.max(1, svg.clientWidth) : 2;
  }

  protected zoom(event: WheelEvent): void {
    event.preventDefault();
    const box = this.viewBox();
    const svg = this.sheet()?.nativeElement;
    const matrix = svg?.getScreenCTM()?.inverse();
    if (!matrix) return;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15;
    this.viewBox.set({ x: p.x - (p.x - box.x) * factor, y: p.y - (p.y - box.y) * factor, w: box.w * factor, h: box.h * factor });
  }

  protected fit(): void {
    const layout = this.layout();
    if (layout) this.viewBox.set({ x: -10, y: -10, w: layout.width + 20, h: layout.height + 20 });
  }

  protected down(event: PointerEvent): void {
    const at = this.sheetPoint(event);
    const owner = (event.target as Element).closest('[data-owner]')?.getAttribute('data-owner') ?? undefined;
    if (this.store.tool().kind !== 'select') return;
    if (owner && event.button === 0) {
      this.store.selection.set({ kind: this.views().some((v) => v.id === owner) ? 'view' : 'annotation', id: owner });
      const start = this.positionOf(owner);
      if (start) this.drag = { owner, from: at, start, moved: false };
      (event.target as Element).setPointerCapture?.(event.pointerId);
      return;
    }
    this.store.selection.set(undefined);
    this.drag = { pan: true, from: [event.clientX, event.clientY], box: this.viewBox() };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  protected move(event: PointerEvent): void {
    const drag = this.drag;
    if (drag && 'pan' in drag) {
      const svg = this.sheet()?.nativeElement;
      const scale = drag.box.w / Math.max(1, svg?.clientWidth ?? 1);
      this.viewBox.set({ ...drag.box, x: drag.box.x - (event.clientX - drag.from[0]) * scale, y: drag.box.y - (event.clientY - drag.from[1]) * scale });
      return;
    }
    if (drag) {
      drag.moved = true;
      return;
    }
    const tool = this.store.tool();
    const placing = (tool.kind === 'callout' || tool.kind === 'surface-finish') && this.store.picked().length;
    if (tool.kind === 'select' || tool.kind === 'note' || tool.kind === 'parts-list' || tool.kind === 'detail' || placing || tool.kind === 'balloon') {
      this.hover.set(undefined);
      return;
    }
    const anchor = this.store.anchorNear(this.sheetPoint(event), this.reach());
    this.hover.set(anchor ? { at: anchor.at, ...(anchor.kind === 'circle' ? { radius: anchor.radius } : {}) } : undefined);
  }

  protected async up(event: PointerEvent): Promise<void> {
    const drag = this.drag;
    this.drag = undefined;
    if (drag && 'owner' in drag) {
      if (drag.moved) {
        const at = this.sheetPoint(event);
        await this.moveTo(drag.owner, [drag.start[0] + at[0] - drag.from[0], drag.start[1] + at[1] - drag.from[1]]);
      }
      return;
    }
    if (drag) return;
    await this.click(this.sheetPoint(event));
  }

  /** Where a view or a placed annotation is. */
  private positionOf(owner: string): Vec2 | undefined {
    const view = this.views().find((v) => v.id === owner);
    if (view) return view.at;
    const annotation = this.store.document()?.annotations.find((a) => a.id === owner);
    return annotation && 'at' in annotation ? annotation.at : undefined;
  }

  private async moveTo(owner: string, at: Vec2): Promise<void> {
    const view = this.views().find((v) => v.id === owner);
    if (view) {
      await this.store.run({ type: 'edit-view', view: { ...view, at } });
      return;
    }
    const annotation = this.store.document()?.annotations.find((a) => a.id === owner);
    if (annotation && 'at' in annotation) await this.store.run({ type: 'edit-annotation', annotation: { ...annotation, at } as DrawingAnnotation });
  }

  /** A click on the sheet with the current tool. */
  private async click(at: Vec2): Promise<void> {
    const tool = this.store.tool();
    const id = newId();
    const add = async (annotation: DrawingAnnotation) => {
      if (await this.store.run({ type: 'add-annotation', annotation })) this.store.picked.set([]);
    };
    const anchorRef = (a: { view: string; kind: 'point' | 'circle' | 'line'; name: string }) => ({ view: a.view, kind: a.kind, name: a.name });
    switch (tool.kind) {
      case 'select':
        return;
      case 'note':
        if (await this.store.run({ type: 'add-annotation', annotation: { kind: 'note', id, at, text: 'Note' } })) {
          this.store.use({ kind: 'select' });
          this.store.selection.set({ kind: 'annotation', id });
        }
        return;
      case 'parts-list': {
        const assemblyView = this.views().find((v) => this.store.sources().find((s) => s.id === v.source)?.kind === 'assembly');
        if (!assemblyView) return this.store.error.set('A parts list needs a view of an assembly.');
        await add({ kind: 'parts-list', id, view: assemblyView.id, at });
        this.store.use({ kind: 'select' });
        return;
      }
      case 'detail':
        return this.addDetail(at);
      case 'balloon': {
        const pending = this.pending();
        if (pending) {
          await add({ kind: 'balloon', id, view: pending.view, instance: pending.instance, at });
          this.pending.set(undefined);
          return;
        }
        const reach = this.reach() * 3;
        const near = (this.layout()?.instances ?? []).map((i) => ({ i, d: Math.hypot(i.at[0] - at[0], i.at[1] - at[1]) })).filter((x) => x.d <= Math.max(reach, 15)).sort((a, b) => a.d - b.d)[0];
        if (near) this.pending.set({ kind: 'balloon', view: near.i.view, instance: near.i.instance });
        return;
      }
      case 'callout': {
        const [circle] = this.store.picked();
        if (circle) return add({ kind: 'callout', id, circle: anchorRef(circle), at });
        const anchor = this.store.anchorNear(at, this.reach());
        if (anchor) this.store.picked.set([anchor]);
        return;
      }
      case 'surface-finish': {
        // On an edge, on the side clicked next; else where clicked (CAD-165).
        const [edge] = this.store.picked();
        const anchor = edge ? undefined : this.store.anchorNear(at, this.reach());
        if (anchor) return this.store.picked.set([anchor]);
        if (await this.store.run({ type: 'add-annotation', annotation: { kind: 'surface-finish', id, at, ...(edge ? { edge: anchorRef(edge) } : {}), process: 'removal', roughness: 'Ra 3.2' } })) {
          this.store.use({ kind: 'select' });
          this.store.selection.set({ kind: 'annotation', id });
        }
        return;
      }
      default: {
        const anchor = this.store.anchorNear(at, this.reach());
        if (!anchor) return;
        const picked = [...this.store.picked(), anchor];
        this.store.picked.set(picked);
        if (tool.kind === 'center-mark') return add({ kind: 'center-mark', id, circle: anchorRef(anchor) });
        if (tool.kind === 'center-line' && picked.length === 2) return add({ kind: 'center-line', id, a: anchorRef(picked[0] as typeof anchor), b: anchorRef(anchor) });
        if (tool.kind === 'dimension' && fitsDimension(tool.type, picked.map((a) => a.kind))) {
          const round = picked[0]?.kind === 'circle' && (tool.type === 'radius' || tool.type === 'diameter');
          await add({ kind: 'dimension', id, type: tool.type, anchors: picked.map(anchorRef), offset: tool.type === 'angle' ? 15 : round ? 8 : 10 });
          this.hover.set(undefined);
        }
      }
    }
  }

  /** A detail of the view under the point: its circle there, twice as large, placed to the right. */
  private async addDetail(at: Vec2): Promise<void> {
    const placed = (this.layout()?.views ?? []).find((v) => !v.error && at[0] >= v.min[0] - 5 && at[0] <= v.max[0] + 5 && at[1] >= v.min[1] - 5 && at[1] <= v.max[1] + 5);
    const parent = placed && this.views().find((v) => v.id === placed.id && !v.detail);
    if (!placed || !parent || !placed.center || !placed.scale) return this.store.error.set('Click inside a view.');
    const center: Vec2 = [placed.center[0] + (at[0] - parent.at[0]) / placed.scale, placed.center[1] + (at[1] - parent.at[1]) / placed.scale];
    const letter = String.fromCharCode(66 + this.views().filter((v) => v.detail).length);
    const scale = placed.scale * 2;
    const radius = 12 / placed.scale;
    // Below its view, clear of the views beside it.
    const place: Vec2 = [parent.at[0], Math.max(60, placed.min[1] - radius * scale - 25)];
    const view: DrawingView = { id: newId(), source: parent.source, direction: parent.direction, at: place, hidden: parent.hidden, scale, detail: { of: parent.id, center, radius }, label: `Detail ${letter}` };
    if (await this.store.run({ type: 'add-view', view })) {
      this.store.use({ kind: 'select' });
      this.store.selection.set({ kind: 'view', id: view.id });
    }
  }

  /** Adds the chosen view: the first in the sheet's left half, later ones to the right of the last, then below. */
  protected async addView(): Promise<void> {
    const choice = this.newView();
    const layout = this.layout();
    if (!choice.source || !layout) return;
    const last = layout.views.at(-1);
    const at: Vec2 = !last ? [layout.width * 0.3, layout.height * 0.62] : last.max[0] + 90 < layout.width - 20 ? [last.max[0] + 70, (last.min[1] + last.max[1]) / 2] : [layout.width * 0.3, last.min[1] - 60];
    const view: DrawingView = {
      id: newId(),
      source: choice.source as DrawingView['source'],
      ...(choice.configuration && this.store.configurations()[choice.source] ? { configuration: choice.configuration } : {}),
      direction: choice.direction,
      at,
      hidden: choice.direction !== 'iso' && choice.hidden,
    };
    this.menu.set(undefined);
    if (await this.store.run({ type: 'add-view', view })) this.store.selection.set({ kind: 'view', id: view.id });
  }

  /** Changes a view; `null` takes a setting away (the sheet's scale, no section, no label). */
  protected setView(
    view: DrawingView,
    change: Omit<Partial<DrawingView>, 'scale' | 'section' | 'label' | 'configuration'> & { scale?: number | null; section?: DrawingView['section'] | null; label?: string | null; configuration?: string | null },
  ): void {
    const merged: Record<string, unknown> = { ...view, ...change };
    const next = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== null && value !== ''));
    void this.store.run({ type: 'edit-view', view: next as unknown as DrawingView });
  }

  protected setAnnotation(annotation: DrawingAnnotation, change: Record<string, unknown>): void {
    const merged: Record<string, unknown> = { ...annotation, ...change };
    // An empty dimension text shows the measured value again, an empty angle places the leader itself, and null takes a setting away.
    const empty = (key: string, value: unknown) => value === null || (key === 'text' && value === '' && annotation.kind === 'dimension') || (key === 'angle' && Number.isNaN(value)) || ((key === 'roughness' || key === 'method') && value === '');
    const next = Object.fromEntries(Object.entries(merged).filter(([key, value]) => !empty(key, value)));
    void this.store.run({ type: 'edit-annotation', annotation: next as unknown as DrawingAnnotation });
  }

  /** A dimension's tolerance of a kind, with values to start from (CAD-165); empty: none. */
  protected setTolerance(annotation: DrawingAnnotation, kind: string): void {
    const starts: Record<string, Tolerance> = {
      symmetric: { kind: 'symmetric', value: 0.1 },
      deviations: { kind: 'deviations', upper: 0.1, lower: -0.1 },
      limits: { kind: 'limits', upper: 0.1, lower: -0.1 },
      fit: { kind: 'fit', fit: 'H7' },
    };
    this.setAnnotation(annotation, { tolerance: starts[kind] ?? null });
  }

  /** Changes a value of a dimension's tolerance. */
  protected setToleranceValue(annotation: DrawingAnnotation, change: Record<string, unknown>): void {
    if (annotation.kind === 'dimension' && annotation.tolerance) this.setAnnotation(annotation, { tolerance: { ...annotation.tolerance, ...change } });
  }

  protected readonly processes: readonly { readonly value: SurfaceProcess; readonly label: string }[] = [
    { value: 'removal', label: 'Material removed' },
    { value: 'any', label: 'Any process' },
    { value: 'no-removal', label: 'No material removed' },
  ];

  /** A section's steps as text: pairs of where and how far (mm), separated by semicolons (CAD-164). */
  protected stepsText(section: SectionCut): string {
    return (section.steps ?? []).map((s) => `${s.at}:${s.offset}`).join('; ');
  }

  /** Changes how a view cuts; settings not used are left out, not stored empty. */
  protected setSection(view: DrawingView, change: { half?: boolean; steps?: string; along?: string }): void {
    const section = view.section ?? { offset: 0 };
    const parsed = (text: string) =>
      text
        .split(';')
        .map((pair) => pair.split(':').map((v) => Number(v.trim())))
        .filter((pair) => pair.length === 2 && pair.every((v) => Number.isFinite(v)))
        .map(([at, offset]) => ({ at: at as number, offset: offset as number }));
    const steps = change.steps === undefined ? section.steps : parsed(change.steps);
    const half = change.half ?? section.half;
    const along = change.along ?? section.along;
    const next: SectionCut = { offset: section.offset, ...(steps?.length ? { steps } : {}), ...(along === 'v' ? { along: 'v' as const } : {}), ...(half ? { half: true } : {}) };
    this.setView(view, { section: next });
  }

  protected remove(): void {
    const selection = this.store.selection();
    if (!selection) return;
    this.store.selection.set(undefined);
    void this.store.run(selection.kind === 'view' ? { type: 'remove-view', viewId: selection.id } : { type: 'remove-annotation', annotationId: selection.id });
  }

  protected setSheet(change: Partial<Sheet>): void {
    const document = this.store.document();
    if (document) void this.store.run({ type: 'set-sheet', sheet: { ...document.sheet, ...change } });
  }

  protected setTitle(change: Partial<TitleBlock>): void {
    const document = this.store.document();
    if (document) void this.store.run({ type: 'set-title-block', titleBlock: { ...document.titleBlock, ...change } });
  }

  protected sourceName(id: string): string {
    return this.store.sources().find((s) => s.id === id)?.name ?? 'Missing document';
  }

  protected viewName(view: DrawingView): string {
    const configuration = view.configuration && this.store.configurations()[view.source]?.find((c) => c.id === view.configuration)?.name;
    return view.label ?? `${directionLabels[view.direction]} of ${this.sourceName(view.source)}${configuration ? ` (${configuration})` : ''}`;
  }

  /** How a view was drawn when not exactly (CAD-125). */
  protected noteOf(id: string): string | undefined {
    return this.layout()?.views.find((v) => v.id === id)?.note;
  }

  protected annotationName(annotation: DrawingAnnotation): string {
    return annotation.kind === 'dimension' ? `${dimensionLabels[annotation.type]} dimension` : annotation.kind === 'note' ? 'Note' : annotation.kind.replaceAll('-', ' ').replace(/^./, (c) => c.toUpperCase());

  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }
}
