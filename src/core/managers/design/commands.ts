import {
  type ComponentDocument,
  fail,
  ok,
  type Result,
  type Sketch,
  type SketchConstraint,
  type SketchEntity,
  sketchOriginId,
} from '@core/contracts';
import type { DesignCommand } from './design-manager';

/** The document a command produces, plus what must be solved before it can be accepted. */
export interface Applied {
  readonly document: ComponentDocument;
  /** The sketch to solve (and to reject the command for when it does not solve). */
  readonly sketchId?: string;
  readonly drag?: { readonly point: string; readonly x: number; readonly y: number };
}

const invalid = (message: string) => fail({ code: 'invalid-command', message });

/** Ids an entity or constraint refers to. */
function references(item: SketchEntity | SketchConstraint): string[] {
  switch (item.kind) {
    case 'point':
      return [];
    case 'line':
      return [item.start, item.end];
    case 'circle':
      return [item.center];
    case 'arc':
      return [item.center, item.start, item.end];
    case 'coincident':
    case 'distance':
    case 'horizontal-distance':
    case 'vertical-distance':
      return [...item.points];
    case 'horizontal':
    case 'vertical':
      return [item.line];
    case 'parallel':
    case 'perpendicular':
    case 'angle':
      return [...item.lines];
    case 'equal':
    case 'tangent':
      return [...item.curves];
    case 'point-on':
      return [item.point, item.curve];
    case 'midpoint':
    case 'point-line-distance':
      return [item.point, item.line];
    case 'fix':
      return [item.point];
    case 'radius':
    case 'diameter':
      return [item.curve];
  }
}

function nextName(document: ComponentDocument): string {
  const numbers = document.timeline.map((item) => Number(/^Sketch (\d+)$/.exec(item.name)?.[1] ?? 0));
  return `Sketch ${Math.max(0, ...numbers) + 1}`;
}

function withSketch(
  document: ComponentDocument,
  sketchId: string,
  change: (sketch: Sketch) => Result<Sketch>,
): Result<Applied> {
  const sketch = document.timeline.find((item) => item.id === sketchId);
  if (!sketch) return invalid(`Sketch ${sketchId} does not exist.`);
  const changed = change(sketch);
  if (!changed.ok) return changed;
  return ok({
    document: { ...document, timeline: document.timeline.map((item) => (item.id === sketchId ? changed.value : item)) },
    sketchId,
  });
}

/** Adds entities and constraints after checking ids are new and references resolve. */
function extend(sketch: Sketch, entities: readonly SketchEntity[], constraints: readonly SketchConstraint[]): Result<Sketch> {
  const ids = new Set([sketchOriginId, ...sketch.entities.map((e) => e.id), ...sketch.constraints.map((c) => c.id)]);
  for (const item of [...entities, ...constraints]) {
    if (ids.has(item.id)) return invalid(`Id ${item.id} is already in use.`);
    ids.add(item.id);
  }
  const entityIds = new Set([sketchOriginId, ...sketch.entities.map((e) => e.id), ...entities.map((e) => e.id)]);
  for (const item of [...entities, ...constraints]) {
    const missing = references(item).find((id) => !entityIds.has(id));
    if (missing) return invalid(`${item.kind} ${item.id} refers to the unknown element ${missing}.`);
  }
  return ok({ ...sketch, entities: [...sketch.entities, ...entities], constraints: [...sketch.constraints, ...constraints] });
}

/** Removes elements, the constraints on them, curves on removed points and points no curve uses any more. */
function remove(sketch: Sketch, ids: readonly string[]): Sketch {
  const doomed = new Set(ids);
  const removedCurves = sketch.entities.filter((e) => e.kind !== 'point' && (doomed.has(e.id) || references(e).some((r) => doomed.has(r))));
  for (const curve of removedCurves) doomed.add(curve.id);
  const remaining = sketch.entities.filter((e) => !doomed.has(e.id));
  const stillUsed = new Set(remaining.flatMap(references));
  for (const point of removedCurves.flatMap(references)) if (!stillUsed.has(point)) doomed.add(point);
  return {
    ...sketch,
    entities: sketch.entities.filter((e) => !doomed.has(e.id)),
    constraints: sketch.constraints.filter((c) => !doomed.has(c.id) && !references(c).some((r) => doomed.has(r))),
  };
}

export function applyCommand(document: ComponentDocument, command: DesignCommand): Result<Applied> {
  switch (command.type) {
    case 'create-sketch': {
      if (document.timeline.some((item) => item.id === command.id)) return invalid(`Id ${command.id} is already in use.`);
      const sketch: Sketch = {
        id: command.id,
        type: 'sketch',
        name: nextName(document),
        suppressed: false,
        plane: command.plane,
        entities: [],
        constraints: [],
      };
      return ok({ document: { ...document, timeline: [...document.timeline, sketch] }, sketchId: sketch.id });
    }
    case 'add-sketch-geometry':
      return withSketch(document, command.sketchId, (s) => extend(s, command.entities, command.constraints));
    case 'add-constraint':
      return withSketch(document, command.sketchId, (s) => extend(s, [], [command.constraint]));
    case 'set-dimension':
      return withSketch(document, command.sketchId, (s) => {
        const target = s.constraints.find((c) => c.id === command.constraintId);
        if (!target || !('expression' in target)) return invalid(`Dimension ${command.constraintId} does not exist.`);
        return ok({
          ...s,
          constraints: s.constraints.map((c) => (c === target ? { ...target, expression: command.expression } : c)),
        });
      });
    case 'move-point': {
      const applied = withSketch(document, command.sketchId, (s) =>
        s.entities.some((e) => e.id === command.pointId && e.kind === 'point') ? ok(s) : invalid(`Point ${command.pointId} does not exist.`),
      );
      return applied.ok ? ok({ ...applied.value, drag: { point: command.pointId, x: command.x, y: command.y } }) : applied;
    }
    case 'toggle-construction':
      return withSketch(document, command.sketchId, (s) =>
        ok({
          ...s,
          entities: s.entities.map((e) => (e.kind !== 'point' && command.ids.includes(e.id) ? { ...e, construction: !e.construction } : e)),
        }),
      );
    case 'delete-sketch-elements':
      return withSketch(document, command.sketchId, (s) => ok(remove(s, command.ids)));
    case 'rename-item': {
      const name = command.name.trim();
      if (!name || name.length > 80) return fail({ code: 'invalid-name', message: 'Names need 1 to 80 characters.' });
      if (!document.timeline.some((item) => item.id === command.itemId)) return invalid(`Item ${command.itemId} does not exist.`);
      return ok({ document: { ...document, timeline: document.timeline.map((item) => (item.id === command.itemId ? { ...item, name } : item)) } });
    }
    case 'delete-item':
      if (!document.timeline.some((item) => item.id === command.itemId)) return invalid(`Item ${command.itemId} does not exist.`);
      return ok({ document: { ...document, timeline: document.timeline.filter((item) => item.id !== command.itemId) } });
  }
}
