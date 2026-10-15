import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { isCurve, type SketchEntity, sketchOriginId } from '@core/contracts';
import type { DrawingFormat } from '@core/managers/design';
import { newId } from '@core/utilities/identity';
import { Icon, type IconName } from '../../shared/icon';
import { Shortcuts } from '../../shared/shortcuts';
import { DesignStore } from './design-store';
import { linearPatternCommand } from './sketch-patterns';
import { type ConstraintTool, constraintFor, type TextDraft, type Tool } from './sketch-tools';

interface ToolButton { readonly tool: Tool; readonly icon: IconName; readonly label: string; readonly key?: string }

/** Always in view. */
const tools: readonly ToolButton[] = [
  { tool: 'select', icon: 'select', label: 'Select and drag', key: 'S' },
  { tool: 'line', icon: 'line', label: 'Line', key: 'L' },
  { tool: 'rectangle', icon: 'rectangle', label: 'Rectangle', key: 'R' },
  { tool: 'circle', icon: 'circle', label: 'Circle', key: 'C' },
  { tool: 'arc', icon: 'arc', label: 'Arc (centre, start, end)', key: 'A' },
  { tool: 'point', icon: 'point', label: 'Point', key: 'P' },
  { tool: 'dimension', icon: 'dimension', label: 'Dimension', key: 'D' },
];

/** The Shapes menu. */
const shapeTools: readonly ToolButton[] = [
  { tool: 'center-rectangle', icon: 'centerRectangle', label: 'Centre rectangle' },
  { tool: 'three-point-arc', icon: 'threePointArc', label: 'Three-point arc' },
  { tool: 'slot', icon: 'slot', label: 'Slot' },
  { tool: 'polygon', icon: 'polygon', label: 'Polygon' },
  { tool: 'ellipse', icon: 'ellipse', label: 'Ellipse' },
  { tool: 'spline', icon: 'spline', label: 'Spline' },
  { tool: 'text', icon: 'text', label: 'Text' },
  { tool: 'project', icon: 'project', label: 'Project edges or faces of bodies' },
];

/** The Modify menu: tools that change or copy existing geometry. */
const modifyTools: readonly ToolButton[] = [
  { tool: 'trim', icon: 'trim', label: 'Trim', key: 'T' },
  { tool: 'extend', icon: 'extend', label: 'Extend' },
  { tool: 'split', icon: 'split', label: 'Split' },
  { tool: 'fillet', icon: 'fillet', label: 'Sketch fillet' },
  { tool: 'chamfer', icon: 'chamfer', label: 'Sketch chamfer' },
  { tool: 'move', icon: 'move', label: 'Move the selection', key: 'M' },
  { tool: 'rotate', icon: 'rotate', label: 'Rotate the selection' },
  { tool: 'mirror', icon: 'mirror', label: 'Mirror the selection across a line' },
  { tool: 'circular-pattern', icon: 'circular', label: 'Circular pattern of the selection' },
];

const constraintTools: readonly { tool: ConstraintTool; symbol: string; label: string }[] = [
  { tool: 'coincident', symbol: '●', label: 'Coincident (two points, or point on curve)' },
  { tool: 'horizontal', symbol: 'H', label: 'Horizontal (a line, or two points level)' },
  { tool: 'vertical', symbol: 'V', label: 'Vertical (a line, or two points above each other)' },
  { tool: 'parallel', symbol: '∥', label: 'Parallel (two lines)' },
  { tool: 'perpendicular', symbol: '⊥', label: 'Perpendicular (two lines)' },
  { tool: 'collinear', symbol: '⋯', label: 'Collinear (two lines)' },
  { tool: 'tangent', symbol: 'T', label: 'Tangent (line and arc, or two arcs)' },
  { tool: 'equal', symbol: '=', label: 'Equal (two lines, or two circles/arcs)' },
  { tool: 'concentric', symbol: '◎', label: 'Concentric (two circles, arcs or ellipses)' },
  { tool: 'midpoint', symbol: 'M', label: 'Midpoint (point and line)' },
  { tool: 'symmetric', symbol: '⇹', label: 'Symmetric (two points and a line)' },
  { tool: 'fix', symbol: '⚲', label: 'Fix (a point)' },
];

const hints: Readonly<Record<Tool, string>> = {
  select: 'Click to select, Shift+click to add, drag a box to select several (left to right: inside; right to left: touching). Drag points to move them.',
  line: 'Click to start, click to place each point. Double-click or Esc ends the line.',
  rectangle: 'Click two opposite corners.',
  circle: 'Click the centre, then a point on the circle.',
  arc: 'Click the centre, the start, then the end (counter-clockwise).',
  point: 'Click to place a point.',
  'center-rectangle': 'Click the centre, then a corner.',
  'three-point-arc': 'Click the start, the end, then a point the arc passes through.',
  slot: 'Click the centres of both ends, then how wide the slot is.',
  polygon: 'Click the centre, then a corner. Set the number of sides in the toolbar.',
  ellipse: 'Click the centre, the end of the long axis, then how wide the ellipse is.',
  spline: 'Click each point the curve passes through. Double-click to end; click the first point to close it.',
  text: 'Type the text and its height in the toolbar, then click where its baseline starts. Select a text to change it.',
  project: 'Click edges or faces of bodies in the view: their outline becomes fixed geometry in the sketch that follows the body.',
  trim: 'Click the piece of a curve to cut away, up to where other curves cross it.',
  extend: 'Click near the end of a line or arc to lengthen it to the next curve.',
  split: 'Click a line or arc where it should break in two.',
  fillet: 'Click a corner where two lines meet to round it with the radius in the toolbar.',
  chamfer: 'Click a corner where two lines meet to cut it at the distance in the toolbar.',
  move: 'With geometry selected: click a base point, then where it goes. Ctrl+C, Ctrl+X and Ctrl+V copy, cut and paste.',
  rotate: 'With geometry selected: click the centre, then a direction, then the direction to turn it to.',
  mirror: 'With geometry selected: click the line to mirror it across. The mirror image follows the original.',
  'circular-pattern': 'With geometry selected: set the number of copies, then click the centre point.',
  dimension: 'Click a line, circle or arc, or two items, then type the value.',
};

/** Tools, constraints and actions of the sketch being edited. */
@Component({
  selector: 'cad-sketch-toolbar',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sketch-toolbar.html',
  styleUrl: './sketch-toolbar.scss',
})
export class SketchToolbar {
  protected readonly store = inject(DesignStore);
  protected readonly tools = tools;
  protected readonly shapeTools = shapeTools;
  protected readonly modifyTools = modifyTools;
  /** The open tool menu. */
  protected readonly menu = signal<'shapes' | 'modify' | undefined>(undefined);
  /** The tool of a menu that is active, shown on the menu's button. */
  protected readonly activeShape = computed(() => shapeTools.find((t) => t.tool === this.store.tool()));
  protected readonly activeModify = computed(() => modifyTools.find((t) => t.tool === this.store.tool()));
  /** The linear pattern form, while it is open. */
  protected readonly linearOpen = signal(false);
  /** Distance of the offset form, while it is open. */
  protected readonly offsetDistance = signal<number | undefined>(undefined);
  protected readonly canOffset = computed(() => this.selected().some((e) => e.kind === 'line' || e.kind === 'arc' || e.kind === 'circle'));
  protected readonly constraintTools = constraintTools;

  protected readonly view = this.store.editedView;
  protected readonly hint = computed(() => hints[this.store.tool()]);
  protected readonly insertOpen = signal(false);
  /** The kerf of a laser profile, for compensated exports. */
  protected readonly kerf = computed(() => {
    const process = this.store.process();
    return process.kind === 'laser' ? process.kerf : undefined;
  });
  protected readonly selected = computed((): SketchEntity[] => {
    const sketch = this.view()?.sketch;
    if (!sketch) return [];
    return this.store
      .selection()
      .map((id) => (id === sketchOriginId ? ({ id, kind: 'point', x: 0, y: 0 } as const) : sketch.entities.find((e) => e.id === id)))
      .filter((e): e is SketchEntity => e !== undefined);
  });
  protected readonly status = computed(() => {
    const view = this.view();
    if (!view) return '';
    if (view.status === 'fully-constrained') return 'Fully constrained';
    if (view.status === 'failed') return 'Does not solve';
    return `${view.degreesOfFreedom} degree${view.degreesOfFreedom === 1 ? '' : 's'} of freedom`;
  });
  protected readonly canToggleConstruction = computed(() => this.selected().some(isCurve));

  constructor() {
    const stop = inject(Shortcuts).register('sketch', { 'sketch-offset': () => this.canOffset() && this.offsetDistance.set(2) });
    inject(DestroyRef).onDestroy(stop);
  }

  protected choose(tool: Tool): void {
    this.menu.set(undefined);
    this.store.tool.set(tool);
  }

  protected setCornerSize(value: string): void {
    const size = Number(value);
    if (size > 0) this.store.cornerSize.set(size);
  }

  /** Offsets the selected curves; a negative distance offsets to the other side. */
  protected async applyOffset(value: string): Promise<void> {
    const sketchId = this.store.editing();
    const distance = Number(value);
    if (!sketchId || !Number.isFinite(distance) || distance === 0) return;
    const curves = this.selected().filter((e) => e.kind !== 'point').map((e) => e.id);
    if (await this.store.run({ type: 'edit-sketch', sketchId, operation: { kind: 'offset', curves, distance }, idPrefix: `${newId()}-` })) {
      this.offsetDistance.set(undefined);
      this.store.select([]);
    }
  }

  /** Copies the selection in a row: `count` in all (the original counts), `x`, `y` apart. */
  protected async applyLinearPattern(count: string, x: string, y: string): Promise<void> {
    const sketch = this.view()?.sketch;
    const command = sketch && linearPatternCommand(sketch, this.store.selection(), Math.round(Number(count)), [Number(x), Number(y)], newId);
    if (command && (await this.store.run(command))) {
      this.linearOpen.set(false);
      this.store.select([]);
    }
  }

  protected setPatternCount(value: string): void {
    const count = Math.round(Number(value));
    if (count >= 2 && count <= 360) this.store.patternCount.set(count);
  }

  protected setText(change: Partial<TextDraft>): void {
    this.store.textDraft.update((draft) => ({ ...draft, ...change }));
  }

  protected setSides(value: string): void {
    const sides = Math.round(Number(value));
    if (sides >= 3 && sides <= 64) this.store.polygonSides.set(sides);
  }

  protected applicable(tool: ConstraintTool): boolean {
    const sketch = this.view()?.sketch;
    return !!sketch && constraintFor(tool, this.selected(), 'probe', sketch) !== undefined;
  }

  protected async constrain(tool: ConstraintTool): Promise<void> {
    const sketch = this.view()?.sketch;
    const constraint = sketch && constraintFor(tool, this.selected(), newId(), sketch);
    if (!sketch || !constraint) return;
    if (await this.store.run({ type: 'add-constraint', sketchId: sketch.id, constraint })) this.store.select([]);
  }

  protected async toggleConstruction(): Promise<void> {
    const sketchId = this.store.editing();
    if (sketchId) await this.store.run({ type: 'toggle-construction', sketchId, ids: this.store.selection() });
  }

  protected async remove(): Promise<void> {
    const sketchId = this.store.editing();
    const ids = this.store.selection().filter((id) => id !== sketchOriginId);
    if (sketchId && ids.length && (await this.store.run({ type: 'delete-sketch-elements', sketchId, ids }))) this.store.select([]);
  }

  protected export(format: DrawingFormat, compensateKerf = false): void {
    const sketchId = this.store.editing();
    if (sketchId) void this.store.exportSketch(sketchId, format, compensateKerf);
  }
}
