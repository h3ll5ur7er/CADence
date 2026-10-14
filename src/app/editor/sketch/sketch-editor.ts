import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { isCurve, isDimension, type SketchEntity, sketchOriginId, type Vec2 } from '@core/contracts';
import type { SketchView } from '@core/managers/design';
import { newId } from '@core/utilities/identity';
import { pointsOf } from '../../viewport/sketch-display';
import { type Affine, affineScale, applyAffine, invertAffine } from '../../viewport/sketch-planes';
import { Autofocus } from '../../shared/autofocus';
import { DesignStore } from './design-store';
import { curvePath, dimensionLabels, glyphs, profilePath } from './sketch-overlay';
import {
  arcCommand,
  circleCommand,
  dimensionFor,
  lineCommand,
  type PointRef,
  pointCommand,
  rectangleCommand,
} from './sketch-tools';

const snapPixels = 10;
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
  host: {
    '(document:keydown)': 'key($event)',
  },
})
export class SketchEditor {
  readonly view = input.required<SketchView>();
  readonly matrix = input<Affine | undefined>();

  protected readonly store = inject(DesignStore);
  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('svg');

  /** Clicks collected by the active drawing tool. */
  protected readonly pending = signal<readonly PointRef[]>([]);
  protected readonly cursor = signal<Vec2 | undefined>(undefined);
  protected readonly snapped = signal<string | undefined>(undefined);
  protected readonly hovered = signal<string | undefined>(undefined);
  /** The dimension whose value is being typed; the input sits on its label. */
  private readonly editingDimension = signal<string | undefined>(undefined);
  private readonly picked = signal<readonly string[]>([]);
  private drag: DragState | undefined;

  protected readonly sketch = computed(() => this.view().sketch);
  protected readonly points = computed(() => pointsOf(this.sketch()));
  protected readonly transform = computed(() => {
    const m = this.matrix();
    return m ? `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})` : '';
  });
  protected readonly curves = computed(() =>
    this.sketch()
      .entities.filter(isCurve)
      .map((e) => ({ id: e.id, d: curvePath(e, this.points()), construction: e.construction })),
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
      this.selectTarget(target?.id, event.shiftKey || event.ctrlKey);
      return;
    }
    if (tool === 'dimension') return void this.dimensionClick(target);
    void this.toolClick(this.snapRef(at));
  }

  protected move(event: PointerEvent): void {
    const at = this.toPlane(event);
    if (!at) return;
    this.cursor.set(at);
    this.snapped.set(this.snapRef(at).id);
    this.hovered.set(this.targetOf(event)?.id);
    const drag = this.drag;
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.start[0], event.clientY - drag.start[1]) < dragThreshold) return;
    drag.moved = true;
    drag.last = at;
    this.store.drag(drag.pointId, at[0], at[1]);
  }

  protected up(): void {
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
    this.pending.set([]);
  }

  protected key(event: KeyboardEvent): void {
    if ((event.target as HTMLElement | null)?.closest('input, textarea')) return;
    const shortcuts: Record<string, () => void> = {
      Escape: () => {
        if (this.pending().length || this.picked().length) {
          this.pending.set([]);
          this.picked.set([]);
        } else if (this.store.tool() !== 'select') this.store.tool.set('select');
        else this.store.select([]);
      },
      Delete: () => void this.deleteSelection(),
      Backspace: () => void this.deleteSelection(),
      s: () => this.setTool('select'),
      l: () => this.setTool('line'),
      r: () => this.setTool('rectangle'),
      c: () => this.setTool('circle'),
      a: () => this.setTool('arc'),
      p: () => this.setTool('point'),
      d: () => this.setTool('dimension'),
      x: () => void this.toggleConstruction(),
    };
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const action = shortcuts[event.key];
    if (!action) return;
    event.preventDefault();
    action();
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
      default:
        return;
    }
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

  /** The nearest existing point within a few pixels, else the free position. */
  private snapRef(at: Vec2): PointRef {
    const m = this.matrix();
    if (!m) return { at };
    const radius = snapPixels / affineScale(m);
    let best: { id: string; at: Vec2; d: number } | undefined;
    for (const [id, p] of this.points()) {
      const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
      if (d <= radius && (!best || d < best.d)) best = { id, at: p, d };
    }
    return best ? { id: best.id, at: best.at } : { at };
  }

  private targetOf(event: Event): { id: string; kind: string } | undefined {
    const element = (event.target as Element | null)?.closest('[data-id]');
    const id = element?.getAttribute('data-id');
    const kind = element?.getAttribute('data-kind');
    return id && kind ? { id, kind } : undefined;
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
      default:
        return undefined;
    }
  }
}
