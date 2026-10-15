import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { isCurve, isDimension, projectionOf, type SketchEntity, sketchOriginId, type Vec2 } from '@core/contracts';
import type { SketchView } from '@core/managers/design';
import { newId } from '@core/utilities/identity';
import { pointsOf } from '../../viewport/sketch-display';
import { type Affine, affineScale, applyAffine, invertAffine } from '../../viewport/sketch-planes';
import { Autofocus } from '../../shared/autofocus';
import { Shortcuts } from '../../shared/shortcuts';
import { DesignStore } from './design-store';
import { isShapeTool, shapeClicks, shapeCommand } from './shape-tools';
import { curvePath, dimensionLabels, glyphs, hitTest, profilePath } from './sketch-overlay';
import { boxSelect, copySelection, pasted } from './selection';
import { circularPatternCommand, mirrorCommand } from './sketch-patterns';
import { snap } from './snapping';
import {
  arcCommand,
  circleCommand,
  dimensionFor,
  type EditTool,
  isEditTool,
  lineCommand,
  type PointRef,
  pointCommand,
  rectangleCommand,
} from './sketch-tools';

const snapPixels = 10;
const hitPixels = 7;
const dragThreshold = 3;

interface DragState {
  readonly pointId: string;
  readonly start: Vec2;
  moved: boolean;
  last?: Vec2;
}

interface InlineEdit {
  readonly id: string;
  readonly expression: string;
  readonly x: number;
  readonly y: number;
}

/**
 * Edits one sketch on top of the viewport. Curves and profiles are drawn in sketch coordinates under
 * the plane matrix; points, constraint glyphs and dimension labels in screen pixels.
 */
@Component({
  selector: 'cad-sketch-editor',
  imports: [Autofocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sketch-editor.html',
  styleUrl: './sketch-editor.scss',
})
export class SketchEditor {
  readonly view = input.required<SketchView>();
  readonly matrix = input<Affine | undefined>();

  protected readonly store = inject(DesignStore);
  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('svg');

  /** Clicks collected by the active drawing tool. */
  protected readonly pending = signal<readonly PointRef[]>([]);
  protected readonly cursor = signal<Vec2 | undefined>(undefined);
  /** Where the next click would land while drawing. */
  protected readonly snapped = signal<PointRef | undefined>(undefined);
  /** A marker where a click would land on a line's middle or on a curve, in screen pixels. */
  protected readonly snapMarker = computed(() => {
    const ref = this.snapped();
    const m = this.matrix();
    if (!ref?.on || !m || this.store.tool() === 'select' || this.store.tool() === 'dimension') return undefined;
    const [x, y] = applyAffine(m, ref.at[0], ref.at[1]);
    return { x, y, kind: ref.on.kind, title: ref.on.kind === 'midpoint' ? 'Midpoint' : 'On the curve' };
  });
  protected readonly hovered = signal<string | undefined>(undefined);
  /** The dimension whose value is being typed; the input sits on its label. */
  private readonly editingDimension = signal<string | undefined>(undefined);
  private readonly picked = signal<readonly string[]>([]);
  private drag: DragState | undefined;
  /** A selection box being dragged, in sketch coordinates. */
  private readonly box = signal<{ from: Vec2; to: Vec2; screen: Vec2 } | undefined>(undefined);
  /** The selection box on screen: solid when it selects what lies inside, dashed when what it touches. */
  protected readonly boxRect = computed(() => {
    const box = this.box();
    const m = this.matrix();
    if (!box || !m) return undefined;
    const [a, b] = [applyAffine(m, box.from[0], box.from[1]), applyAffine(m, box.to[0], box.to[1])];
    return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), crossing: box.to[0] < box.from[0] };
  });

  constructor() {
    const stop = inject(Shortcuts).register('sketch', {
      cancel: () => this.escape(),
      'sketch-delete': () => void this.deleteSelection(),
      'sketch-select': () => this.setTool('select'),
      'sketch-line': () => this.setTool('line'),
      'sketch-rectangle': () => this.setTool('rectangle'),
      'sketch-circle': () => this.setTool('circle'),
      'sketch-arc': () => this.setTool('arc'),
      'sketch-point': () => this.setTool('point'),
      'sketch-dimension': () => this.setTool('dimension'),
      'sketch-construction': () => void this.toggleConstruction(),
      'sketch-trim': () => this.setTool('trim'),
      'sketch-move': () => this.setTool('move'),
      'sketch-copy': () => this.copy(false),
      'sketch-cut': () => this.copy(true),
      'sketch-paste': () => void this.paste(),
      'finish-sketch': () => this.store.finishEditing(),
    });
    inject(DestroyRef).onDestroy(stop);
  }

  protected readonly sketch = computed(() => this.view().sketch);
  protected readonly points = computed(() => pointsOf(this.sketch()));
  protected readonly transform = computed(() => {
    const m = this.matrix();
    return m ? `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})` : '';
  });
  protected readonly curves = computed(() =>
    this.sketch()
      .entities.filter(isCurve)
      .map((e) => ({ id: e.id, d: curvePath(e, this.points()), construction: e.construction, projected: projectionOf(this.sketch(), e.id) !== undefined })),
  );
  protected readonly profiles = computed(() => this.view().profiles.map((p) => ({ id: p.id, d: profilePath(p) })));
  protected readonly screenPoints = computed(() => {
    const m = this.matrix();
    if (!m) return [];
    return [...this.points()].map(([id, [x, y]]) => {
      const [sx, sy] = applyAffine(m, x, y);
      return { id, x: sx, y: sy, origin: id === sketchOriginId };
    });
  });
  protected readonly glyphs = computed(() => {
    const m = this.matrix();
    return m ? glyphs(this.sketch(), m) : [];
  });
  protected readonly dimensions = computed(() => {
    const m = this.matrix();
    return m ? dimensionLabels(this.sketch(), this.view().values, m) : [];
  });
  protected readonly inline = computed((): InlineEdit | undefined => {
    const id = this.editingDimension();
    const dimension = this.sketch().constraints.find((c) => c.id === id);
    const label = this.dimensions().find((d) => d.id === id);
    return id && dimension && isDimension(dimension) && label ? { id, expression: dimension.expression, x: label.x, y: label.y } : undefined;
  });
  protected readonly highlighted = computed(() => new Set([...this.store.selection(), ...this.picked()]));
  protected readonly fully = computed(() => this.view().status === 'fully-constrained');
  /** What the active tool would add, drawn in sketch coordinates. */
  protected readonly rubberBand = computed(() => this.preview());

  // ---- pointer input ------------------------------------------------------------------

  protected down(event: PointerEvent): void {
    if (event.button !== 0) return; // middle and right buttons pan and zoom the viewport
    event.stopPropagation();
    const at = this.toPlane(event);
    if (!at) return;
    const target = this.targetOf(event);
    const tool = this.store.tool();
    if (target?.kind === 'dimension') return this.openInline(target.id);
    if (tool === 'select') {
      if (target?.kind === 'point' && target.id !== sketchOriginId) {
        (event.target as Element).setPointerCapture?.(event.pointerId);
        this.drag = { pointId: target.id, start: [event.clientX, event.clientY], moved: false };
      }
      if (!target) {
        // A drag on empty space draws a selection box; a click clears the selection.
        (event.target as Element).setPointerCapture?.(event.pointerId);
        this.box.set({ from: at, to: at, screen: [event.clientX, event.clientY] });
        if (!(event.shiftKey || event.ctrlKey)) this.store.select([]);
        return;
      }
      this.selectTarget(target.id, event.shiftKey || event.ctrlKey);
      return;
    }
    if (tool === 'move' || tool === 'rotate') return void this.transformClick(tool, this.snapRef(at));
    if (tool === 'mirror' || tool === 'circular-pattern') return void this.copyClick(tool, target);
    if (tool === 'dimension') return void this.dimensionClick(target);
    if (isEditTool(tool)) return void this.editClick(tool, target, at);
    void this.toolClick(this.snapRef(at));
  }

  protected move(event: PointerEvent): void {
    const at = this.toPlane(event);
    if (!at) return;
    this.cursor.set(at);
    this.snapped.set(this.snapRef(at));
    this.hovered.set(this.targetOf(event)?.id);
    const box = this.box();
    if (box) this.box.set({ ...box, to: at });
    const drag = this.drag;
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.start[0], event.clientY - drag.start[1]) < dragThreshold) return;
    drag.moved = true;
    drag.last = at;
    this.store.drag(drag.pointId, at[0], at[1]);
  }

  protected up(event?: PointerEvent): void {
    const box = this.box();
    this.box.set(undefined);
    if (box && event && Math.hypot(event.clientX - box.screen[0], event.clientY - box.screen[1]) >= dragThreshold) {
      const found = boxSelect(this.sketch(), box.from, box.to);
      this.store.select([...new Set([...this.store.selection(), ...found])]);
    }
    const drag = this.drag;
    this.drag = undefined;
    if (drag?.moved && drag.last) void this.store.drop(drag.pointId, drag.last[0], drag.last[1]);
  }

  protected leave(): void {
    this.cursor.set(undefined);
    this.hovered.set(undefined);
  }

  /** Double click ends a line chain. */
  protected doubleClick(): void {
    // A double-click is two clicks first: the spline got its last point twice.
    if (this.store.tool() === 'spline') {
      const clicks = this.pending().filter((c, i, all) => i === 0 || Math.hypot(c.at[0] - (all[i - 1] as PointRef).at[0], c.at[1] - (all[i - 1] as PointRef).at[1]) > 1e-9);
      const command = shapeCommand('spline', this.sketch().id, clicks, this.store.polygonSides(), newId);
      if (command) void this.store.run(command);
    }
    this.pending.set([]);
  }

  /** Escape steps back: drops the clicks of the tool, then the tool, then the selection. */
  private escape(): void {
    if (this.pending().length || this.picked().length) {
      this.pending.set([]);
      this.picked.set([]);
    } else if (this.store.tool() !== 'select') this.store.tool.set('select');
    else this.store.select([]);
  }

  // ---- inline dimension editing -----------------------------------------------------------

  protected async commitInline(expression: string): Promise<void> {
    const edit = this.inline();
    if (!edit) return;
    if (expression.trim() === edit.expression) return this.editingDimension.set(undefined);
    const ok = await this.store.run({ type: 'set-dimension', sketchId: this.sketch().id, constraintId: edit.id, expression });
    if (ok) this.editingDimension.set(undefined);
  }

  protected cancelInline(): void {
    this.editingDimension.set(undefined);
    this.store.error.set(undefined);
  }

  private openInline(id: string): void {
    this.editingDimension.set(id);
  }

  // ---- tools -------------------------------------------------------------------------------

  private setTool(tool: Parameters<DesignStore['tool']['set']>[0]): void {
    this.pending.set([]);
    this.picked.set([]);
    this.store.tool.set(tool);
  }

  private async toolClick(ref: PointRef): Promise<void> {
    const sketchId = this.sketch().id;
    const clicks = [...this.pending(), ref];
    switch (this.store.tool()) {
      case 'point':
        await this.store.run(pointCommand(sketchId, ref.at, newId));
        return;
      case 'line': {
        if (clicks.length < 2) return this.pending.set(clicks);
        const [from, to] = clicks as [PointRef, PointRef];
        if (from.id && from.id === to.id) return;
        let drawn = lineCommand(sketchId, from, to, newId);
        let ok = await this.store.run(drawn.command);
        if (!ok && drawn.command.constraints.length) {
          drawn = lineCommand(sketchId, from, to, newId, false); // the inferred axis may conflict
          ok = await this.store.run(drawn.command);
        }
        // Keep drawing from the new end, unless the chain just closed on an existing point.
        this.pending.set(ok && !to.id ? [{ id: drawn.end, at: to.at }] : []);
        return;
      }
      case 'rectangle':
        if (clicks.length < 2) return this.pending.set(clicks);
        this.pending.set([]);
        await this.store.run(rectangleCommand(sketchId, clicks[0] as PointRef, clicks[1] as PointRef, newId));
        return;
      case 'circle': {
        if (clicks.length < 2) return this.pending.set(clicks);
        const [center, rim] = clicks as [PointRef, PointRef];
        this.pending.set([]);
        const radius = Math.hypot(rim.at[0] - center.at[0], rim.at[1] - center.at[1]);
        if (radius > 0) await this.store.run(circleCommand(sketchId, center, radius, newId));
        return;
      }
      case 'arc': {
        if (clicks.length < 3) return this.pending.set(clicks);
        const [center, start, end] = clicks as [PointRef, PointRef, PointRef];
        this.pending.set([]);
        await this.store.run(arcCommand(sketchId, center, start.at, end.at, newId));
        return;
      }
      default: {
        const tool = this.store.tool();
        if (!isShapeTool(tool)) return;
        // Clicking a spline's first point again closes it.
        const first = clicks[0];
        const m = this.matrix();
        const closing = tool === 'spline' && clicks.length > 3 && first && m && Math.hypot(ref.at[0] - first.at[0], ref.at[1] - first.at[1]) <= snapPixels / affineScale(m);
        const all = closing ? [...this.pending(), first] : clicks;
        if (!closing && all.length < shapeClicks[tool]) return this.pending.set(all);
        this.pending.set([]);
        const command = shapeCommand(tool, sketchId, all, this.store.polygonSides(), newId);
        if (command) await this.store.run(command);
        return;
      }
    }
  }

  // ---- selection: copy and paste, move and rotate ------------------------------------------

  private copy(cut: boolean): void {
    const clipboard = copySelection(this.sketch(), this.store.selection());
    if (!clipboard) return;
    this.store.sketchClipboard.set(clipboard);
    if (cut) void this.deleteSelection();
  }

  /** Pastes at the pointer (or beside the original), with new ids; the copy is selected. */
  private async paste(): Promise<void> {
    const clipboard = this.store.sketchClipboard();
    if (!clipboard) return;
    const points = clipboard.entities.flatMap((e) => (e.kind === 'point' ? [[e.x, e.y] as Vec2] : []));
    const beside: Vec2 = points.length ? [Math.max(...points.map((p) => p[0])) + 10, Math.max(...points.map((p) => p[1])) + 10] : [0, 0];
    const copy = pasted(clipboard, this.cursor() ?? beside, newId);
    if (await this.store.run({ type: 'add-sketch-geometry', sketchId: this.sketch().id, entities: copy.entities, constraints: copy.constraints })) {
      this.store.select(copy.entities.filter((e) => e.kind !== 'point').map((e) => e.id));
    }
  }

  /** Mirror: click the line to mirror across. Circular pattern: click the centre point. */
  private async copyClick(tool: 'mirror' | 'circular-pattern', target: { id: string; kind: string } | undefined): Promise<void> {
    const ids = this.store.selection().filter((id) => id !== sketchOriginId);
    if (!target || !ids.length) return;
    const command =
      tool === 'mirror'
        ? target.kind === 'curve' && mirrorCommand(this.sketch(), ids, target.id, newId)
        : target.kind === 'point' && circularPatternCommand(this.sketch(), ids, this.store.patternCount(), target.id, newId);
    if (!command) return;
    if (await this.store.run(command)) {
      this.store.select([]);
      this.store.tool.set('select');
    }
  }

  /** Move: a base point, then where it goes. Rotate: the centre, a direction, then the direction it turns to. */
  private async transformClick(tool: 'move' | 'rotate', ref: PointRef): Promise<void> {
    const ids = this.store.selection().filter((id) => id !== sketchOriginId);
    if (!ids.length) return;
    const clicks = [...this.pending(), ref];
    if (clicks.length < (tool === 'move' ? 2 : 3)) return this.pending.set(clicks);
    this.pending.set([]);
    const command = transformOf(tool, clicks);
    if (command) await this.store.run({ type: 'transform-sketch-elements', sketchId: this.sketch().id, ids, ...command });
  }

  /** An editing tool's click: on a curve for trim, extend and split; on a corner point for fillet and chamfer. */
  private async editClick(tool: EditTool, target: { id: string; kind: string } | undefined, at: Vec2): Promise<void> {
    if (!target) return;
    const corner = tool === 'fillet' || tool === 'chamfer';
    if (corner !== (target.kind === 'point')) return;
    const operation = corner ? { kind: tool, point: target.id, size: this.store.cornerSize() } : { kind: tool, curve: target.id, at };
    await this.store.run({ type: 'edit-sketch', sketchId: this.sketch().id, operation, idPrefix: `${newId()}-` });
  }

  /** First pick, then a second pick or a click on empty space to place a single-entity dimension. */
  private async dimensionClick(target: { id: string; kind: string } | undefined): Promise<void> {
    const entity = (id: string) => this.sketch().entities.find((e) => e.id === id) ?? this.originEntity(id);
    const picked = this.picked();
    const clicked = target && (target.kind === 'point' || target.kind === 'curve') ? entity(target.id) : undefined;
    let selection: SketchEntity[];
    if (picked.length === 0) {
      if (!clicked) return;
      if (clicked.kind === 'circle' || clicked.kind === 'arc') selection = [clicked];
      else return this.picked.set([clicked.id]);
    } else {
      const first = entity(picked[0] as string);
      if (!first) return this.picked.set([]);
      if (clicked && clicked.id !== first.id) selection = [first, clicked];
      else if (first.kind === 'line') selection = [first]; // a line alone: its length
      else return this.picked.set([]);
    }
    this.picked.set([]);
    const id = newId();
    const dimension = dimensionFor(selection, id, this.sketch());
    if (!dimension) return;
    if (await this.store.run({ type: 'add-constraint', sketchId: this.sketch().id, constraint: dimension })) {
      this.openInline(id);
    }
  }

  private originEntity(id: string): SketchEntity | undefined {
    return id === sketchOriginId ? { id, kind: 'point', x: 0, y: 0 } : undefined;
  }

  private selectTarget(id: string | undefined, additive: boolean): void {
    if (!id) return void (additive || this.store.select([]));
    const current = this.store.selection();
    if (!additive) return this.store.select([id]);
    this.store.select(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }

  private async deleteSelection(): Promise<void> {
    const ids = this.store.selection().filter((id) => id !== sketchOriginId);
    if (!ids.length) return;
    if (await this.store.run({ type: 'delete-sketch-elements', sketchId: this.sketch().id, ids })) this.store.select([]);
  }

  private async toggleConstruction(): Promise<void> {
    const ids = this.store.selection();
    if (ids.length) await this.store.run({ type: 'toggle-construction', sketchId: this.sketch().id, ids });
  }

  // ---- geometry helpers ---------------------------------------------------------------------

  private toPlane(event: PointerEvent): Vec2 | undefined {
    const m = this.matrix();
    const svg = this.svg()?.nativeElement;
    if (!m || !svg) return undefined;
    const rect = svg.getBoundingClientRect();
    return applyAffine(invertAffine(m), event.clientX - rect.left, event.clientY - rect.top);
  }

  /** Where a click lands: an existing point, a line's middle or a curve within a few pixels, else the free position. */
  private snapRef(at: Vec2): PointRef {
    const m = this.matrix();
    if (!m) return { at };
    return snap(this.sketch(), at, snapPixels / affineScale(m), hitPixels / affineScale(m));
  }

  /** Labels and badges are hit by the DOM; points and curves geometrically, within a few pixels. */
  private targetOf(event: PointerEvent): { id: string; kind: string } | undefined {
    const element = (event.target as Element | null)?.closest('[data-id]');
    const id = element?.getAttribute('data-id');
    const kind = element?.getAttribute('data-kind');
    if (id && kind) return { id, kind };
    const at = this.toPlane(event);
    const m = this.matrix();
    return at && m ? hitTest(this.sketch(), at, hitPixels / affineScale(m)) : undefined;
  }

  private preview(): string | undefined {
    const cursor = this.cursor();
    const clicks = this.pending();
    const first = clicks[0];
    if (!cursor || !first) return undefined;
    const end = this.snapRef(cursor).at;
    const [x0, y0] = first.at;
    switch (this.store.tool()) {
      case 'line':
        return `M ${x0} ${y0} L ${end[0]} ${end[1]}`;
      case 'rectangle':
        return `M ${x0} ${y0} L ${end[0]} ${y0} L ${end[0]} ${end[1]} L ${x0} ${end[1]} Z`;
      case 'circle': {
        const r = Math.hypot(end[0] - x0, end[1] - y0);
        return `M ${x0 + r} ${y0} A ${r} ${r} 0 1 1 ${x0 - r} ${y0} A ${r} ${r} 0 1 1 ${x0 + r} ${y0}`;
      }
      case 'arc': {
        const start = clicks[1]?.at;
        if (!start) return `M ${x0} ${y0} L ${end[0]} ${end[1]}`;
        const r = Math.hypot(start[0] - x0, start[1] - y0);
        const angle = Math.atan2(end[1] - y0, end[0] - x0);
        const e: Vec2 = [x0 + r * Math.cos(angle), y0 + r * Math.sin(angle)];
        let sweep = angle - Math.atan2(start[1] - y0, start[0] - x0);
        while (sweep <= 0) sweep += 2 * Math.PI;
        return `M ${start[0]} ${start[1]} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${e[0]} ${e[1]}`;
      }
      case 'move':
      case 'rotate':
        return this.transformPreview(this.store.tool() as 'move' | 'rotate', [...clicks, { at: end }]);
      default:
        return this.shapePreview(clicks, end);
    }
  }

  /** The selection where a move or turn would put it, with the line it follows. */
  private transformPreview(tool: 'move' | 'rotate', clicks: readonly PointRef[]): string | undefined {
    const [base] = clicks;
    const last = clicks.at(-1);
    if (!base || !last) return undefined;
    const guide = clicks.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.at[0]} ${c.at[1]}`).join(' ');
    const command = transformOf(tool, clicks);
    if (!command) return guide;
    const chosen = new Set(this.store.selection());
    const [dx, dy] = command.translate;
    const turn = command.rotate;
    const moved = new Map<string, Vec2>();
    for (const [id, p] of this.points()) {
      const [x, y] = [p[0] + dx - (turn?.center[0] ?? 0), p[1] + dy - (turn?.center[1] ?? 0)];
      const [cos, sin] = turn ? [Math.cos(turn.angle), Math.sin(turn.angle)] : [1, 0];
      moved.set(id, [x * cos - y * sin + (turn?.center[0] ?? 0), x * sin + y * cos + (turn?.center[1] ?? 0)]);
    }
    const paths = this.sketch().entities.filter((e) => e.kind !== 'point' && chosen.has(e.id)).map((e) => curvePath(e, moved));
    return [guide, ...paths].join(' ');
  }

  /** What a shape tool would draw if the pointer were its next click: its own geometry, drawn as such. */
  private shapePreview(clicks: readonly PointRef[], cursor: Vec2): string | undefined {
    const tool = this.store.tool();
    if (!isShapeTool(tool)) return undefined;
    const all = [...clicks, { at: cursor }];
    let n = 0;
    const command = shapeCommand(tool, this.sketch().id, all, this.store.polygonSides(), () => `preview-${++n}`);
    const last = clicks.at(-1);
    if (!command) return last ? `M ${last.at[0]} ${last.at[1]} L ${cursor[0]} ${cursor[1]}` : undefined;
    const points = new Map(this.points());
    for (const e of command.entities) if (e.kind === 'point') points.set(e.id, [e.x, e.y]);
    return command.entities
      .filter((e) => e.kind !== 'point')
      .map((e) => curvePath(e, points))
      .join(' ');
  }
}

/** The move or turn three clicks describe: move by base → target; turn about the first click from the second towards the third. */
function transformOf(tool: 'move' | 'rotate', clicks: readonly PointRef[]): { translate: Vec2; rotate?: { center: Vec2; angle: number } } | undefined {
  const [a, b, c] = clicks;
  if (tool === 'move') return a && b ? { translate: [b.at[0] - a.at[0], b.at[1] - a.at[1]] } : undefined;
  if (!a || !b || !c) return undefined;
  const angle = Math.atan2(c.at[1] - a.at[1], c.at[0] - a.at[0]) - Math.atan2(b.at[1] - a.at[1], b.at[0] - a.at[0]);
  return { translate: [0, 0], rotate: { center: a.at, angle } };
}
