import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { isCurve, type SketchEntity, sketchOriginId } from '@core/contracts';
import type { DrawingFormat } from '@core/managers/design';
import { newId } from '@core/utilities/identity';
import { Icon, type IconName } from '../../shared/icon';
import { DesignStore } from './design-store';
import { type ConstraintTool, constraintFor, type Tool } from './sketch-tools';

const tools: readonly { tool: Tool; icon: IconName; label: string; key: string }[] = [
  { tool: 'select', icon: 'select', label: 'Select and drag', key: 'S' },
  { tool: 'line', icon: 'line', label: 'Line', key: 'L' },
  { tool: 'rectangle', icon: 'rectangle', label: 'Rectangle', key: 'R' },
  { tool: 'circle', icon: 'circle', label: 'Circle', key: 'C' },
  { tool: 'arc', icon: 'arc', label: 'Arc (centre, start, end)', key: 'A' },
  { tool: 'point', icon: 'point', label: 'Point', key: 'P' },
  { tool: 'dimension', icon: 'dimension', label: 'Dimension', key: 'D' },
];

const constraintTools: readonly { tool: ConstraintTool; symbol: string; label: string }[] = [
  { tool: 'coincident', symbol: '●', label: 'Coincident (two points, or point on curve)' },
  { tool: 'horizontal', symbol: 'H', label: 'Horizontal (a line)' },
  { tool: 'vertical', symbol: 'V', label: 'Vertical (a line)' },
  { tool: 'parallel', symbol: '∥', label: 'Parallel (two lines)' },
  { tool: 'perpendicular', symbol: '⊥', label: 'Perpendicular (two lines)' },
  { tool: 'tangent', symbol: 'T', label: 'Tangent (line and arc, or two arcs)' },
  { tool: 'equal', symbol: '=', label: 'Equal (two lines, or two circles/arcs)' },
  { tool: 'midpoint', symbol: 'M', label: 'Midpoint (point and line)' },
  { tool: 'fix', symbol: '⚲', label: 'Fix (a point)' },
];

const hints: Readonly<Record<Tool, string>> = {
  select: 'Click to select, Shift+click to add, drag points to move them. Delete removes the selection.',
  line: 'Click to start, click to place each point. Double-click or Esc ends the line.',
  rectangle: 'Click two opposite corners.',
  circle: 'Click the centre, then a point on the circle.',
  arc: 'Click the centre, the start, then the end (counter-clockwise).',
  point: 'Click to place a point.',
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
  protected readonly constraintTools = constraintTools;

  protected readonly view = this.store.editedView;
  protected readonly hint = computed(() => hints[this.store.tool()]);
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
