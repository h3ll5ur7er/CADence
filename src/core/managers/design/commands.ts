import {
  projectionOf,
  appearanceProblem,
  type ComponentDocument,
  fail,
  type Feature,
  type FeatureType,
  isDefaultAppearance,
  isSketch,
  ok,
  type Result,
  type Sketch,
  type SketchConstraint,
  type SketchEntity,
  sketchOriginId,
} from '@core/contracts';
import { chamfer, type EditResult, extend as extendCurve, fillet, offset, type SketchEdit, split, trim } from '@core/engines/sketch';
import type { DesignCommand, SketchOperation } from './design-manager';

/** The document a command produces, plus what must come out of regeneration intact for it to be accepted. */
export interface Applied {
  readonly document: ComponentDocument;
  /** The timeline item the command is about: the command is refused when this item fails. */
  readonly target?: string;
  /** Parameter commands are refused when any expression stops evaluating. */
  readonly parameters?: boolean;
  readonly drag?: { readonly sketch: string; readonly point: string; readonly x: number; readonly y: number };
}

const featureLabels: Readonly<Record<FeatureType, string>> = {
  insert: 'Insert body',
  extrude: 'Extrude',
  revolve: 'Revolve',
  fillet: 'Fillet',
  chamfer: 'Chamfer',
  shell: 'Shell',
  plane: 'Plane',
  'linear-pattern': 'Linear pattern',
  'circular-pattern': 'Circular pattern',
  mirror: 'Mirror',
};

const invalid = (message: string) => fail({ code: 'invalid-command', message });

/** Ids an entity or constraint refers to. */
export function references(item: SketchEntity | SketchConstraint): string[] {
  switch (item.kind) {
    case 'point':
      return [];
    case 'line':
      return [item.start, item.end];
    case 'circle':
      return [item.center];
    case 'arc':
      return [item.center, item.start, item.end];
    case 'ellipse':
      return [item.center, item.major];
    case 'spline':
      return [...item.points];
    case 'projection':
      return [];
    case 'horizontal-points':
    case 'vertical-points':
      return [...item.points];
    case 'symmetric':
      return [...item.points, item.line];
    case 'concentric':
      return [...item.curves];
    case 'collinear':
      return [...item.lines];
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

/** "Extrude 3": one more than the highest number already used with that label. */
function nextName(document: ComponentDocument, label: string): string {
  const numbers = document.timeline.map((item) =>
    item.name.startsWith(`${label} `) ? Number(item.name.slice(label.length + 1)) || 0 : 0,
  );
  return `${label} ${Math.max(0, ...numbers) + 1}`;
}

function withSketch(
  document: ComponentDocument,
  sketchId: string,
  change: (sketch: Sketch) => Result<Sketch>,
): Result<Applied> {
  const sketch = document.timeline.find((item): item is Sketch => item.id === sketchId && isSketch(item));
  if (!sketch) return invalid(`Sketch ${sketchId} does not exist.`);
  const changed = change(sketch);
  if (!changed.ok) return changed;
  return ok({
    document: { ...document, timeline: document.timeline.map((item) => (item.id === sketchId ? changed.value : item)) },
    target: sketchId,
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
  // Projected geometry goes with its projection, and a projection with any of its curves.
  for (const id of ids) {
    const owner = projectionOf(sketch, id);
    if (owner) doomed.add(owner.id);
  }
  for (const e of sketch.entities) {
    const owner = projectionOf(sketch, e.id);
    if (owner && doomed.has(owner.id)) doomed.add(e.id);
  }
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

/** Moves and turns elements: their points, and the points their curves use. */
function transformed(sketch: Sketch, ids: readonly string[], [dx, dy]: readonly [number, number], rotate?: { readonly center: readonly [number, number]; readonly angle: number }): Result<Sketch> {
  const chosen = sketch.entities.filter((e) => ids.includes(e.id));
  if (chosen.length !== ids.length || !chosen.length) return invalid('Select sketch elements to move.');
  const points = new Set(chosen.flatMap((e) => (e.kind === 'point' ? [e.id] : references(e))));
  points.delete(sketchOriginId);
  const [cos, sin] = rotate ? [Math.cos(rotate.angle), Math.sin(rotate.angle)] : [1, 0];
  const [cx, cy] = rotate?.center ?? [0, 0];
  const entities = sketch.entities.map((e) => {
    if (e.kind !== 'point' || !points.has(e.id)) return e;
    const [x, y] = [e.x + dx - cx, e.y + dy - cy];
    return { ...e, x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
  });
  // Horizontal and vertical relations on what turned would pull it back.
  const turned = rotate && Math.abs(rotate.angle) > 1e-12;
  const moved = new Set([...points, ...chosen.map((e) => e.id)]);
  const constraints = sketch.constraints.filter((c) => {
    if (!turned) return true;
    if (c.kind === 'horizontal' || c.kind === 'vertical') return !moved.has(c.line);
    if (c.kind === 'horizontal-points' || c.kind === 'vertical-points') return !c.points.every((p) => moved.has(p));
    return true;
  });
  return ok({ ...sketch, entities, constraints });
}

/** The edit an editing tool makes of a sketch, or why it cannot. */
function editOf(sketch: Sketch, operation: SketchOperation, prefix: string): EditResult {
  switch (operation.kind) {
    case 'trim':
      return trim(sketch, operation.curve, operation.at, prefix);
    case 'extend':
      return extendCurve(sketch, operation.curve, operation.at, prefix);
    case 'split':
      return split(sketch, operation.curve, operation.at, prefix);
    case 'offset':
      return offset(sketch, operation.curves, operation.distance, prefix);
    case 'fillet':
      return fillet(sketch, operation.point, operation.size, prefix);
    case 'chamfer':
      return chamfer(sketch, operation.point, operation.size, prefix);
  }
}

/** Applies an edit: changed entities, removals (with what depends on them), points no curve uses any more, then additions. */
function applyEdit(sketch: Sketch, edit: SketchEdit): Result<Sketch> {
  const changed = new Map(edit.update.map((e) => [e.id, e]));
  const before = new Set(edit.update.flatMap((e) => references(sketch.entities.find((x) => x.id === e.id) ?? e)));
  let next = remove({ ...sketch, entities: sketch.entities.map((e) => changed.get(e.id) ?? e) }, edit.remove);
  const used = new Set([...next.entities, ...edit.add].flatMap(references));
  const orphans = [...before].filter((p) => p !== sketchOriginId && !used.has(p) && next.entities.some((e) => e.id === p && e.kind === 'point'));
  next = remove(next, orphans);
  return extend(next, edit.add, edit.constraints);
}

export function applyCommand(document: ComponentDocument, command: DesignCommand): Result<Applied> {
  switch (command.type) {
    case 'create-sketch': {
      if (document.timeline.some((item) => item.id === command.id)) return invalid(`Id ${command.id} is already in use.`);
      const sketch: Sketch = {
        id: command.id,
        type: 'sketch',
        name: nextName(document, 'Sketch'),
        suppressed: false,
        plane: command.plane,
        entities: [],
        constraints: [],
      };
      return ok({ document: { ...document, timeline: [...document.timeline, sketch] }, target: sketch.id });
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
      return applied.ok
        ? ok({ ...applied.value, drag: { sketch: command.sketchId, point: command.pointId, x: command.x, y: command.y } })
        : applied;
    }
    case 'toggle-construction':
      return withSketch(document, command.sketchId, (s) =>
        ok({
          ...s,
          entities: s.entities.map((e) => {
            // A projected curve stands for its whole projection: the projection and all its curves switch.
            const toggled = new Set(command.ids.flatMap((id) => [id, projectionOf(s, id)?.id ?? id]));
            const owner = projectionOf(s, e.id);
            return e.kind !== 'point' && (toggled.has(e.id) || (owner && toggled.has(owner.id))) ? { ...e, construction: !e.construction } : e;
          }),
        }),
      );
    case 'delete-sketch-elements':
      return withSketch(document, command.sketchId, (s) => ok(remove(s, command.ids)));
    case 'transform-sketch-elements':
      return withSketch(document, command.sketchId, (s) => transformed(s, command.ids, command.translate, command.rotate));
    case 'edit-sketch':
      return withSketch(document, command.sketchId, (s) => {
        const result = editOf(s, command.operation, command.idPrefix);
        return result.ok ? applyEdit(s, result.edit) : invalid(result.reason);
      });
    case 'rename-item': {
      const name = command.name.trim();
      if (!name || name.length > 80) return fail({ code: 'invalid-name', message: 'Names need 1 to 80 characters.' });
      if (!document.timeline.some((item) => item.id === command.itemId)) return invalid(`Item ${command.itemId} does not exist.`);
      return ok({ document: { ...document, timeline: document.timeline.map((item) => (item.id === command.itemId ? { ...item, name } : item)) } });
    }
    case 'delete-item':
      if (!document.timeline.some((item) => item.id === command.itemId)) return invalid(`Item ${command.itemId} does not exist.`);
      return ok({ document: { ...document, timeline: document.timeline.filter((item) => item.id !== command.itemId) } });
    case 'add-feature': {
      if (document.timeline.some((item) => item.id === command.feature.id)) return invalid(`Id ${command.feature.id} is already in use.`);
      const name = command.feature.name.trim() || nextName(document, featureLabels[command.feature.type]);
      const feature = { ...command.feature, name } as Feature;
      return ok({ document: { ...document, timeline: [...document.timeline, feature] }, target: feature.id });
    }
    case 'edit-feature': {
      const existing = document.timeline.find((item) => item.id === command.feature.id);
      if (!existing || isSketch(existing) || existing.type !== command.feature.type) {
        return invalid(`Feature ${command.feature.id} does not exist.`);
      }
      const feature = { ...command.feature, name: command.feature.name.trim() || existing.name } as Feature;
      return ok({
        document: { ...document, timeline: document.timeline.map((item) => (item.id === feature.id ? feature : item)) },
        target: feature.id,
      });
    }
    case 'suppress-item':
      if (!document.timeline.some((item) => item.id === command.itemId)) return invalid(`Item ${command.itemId} does not exist.`);
      return ok({
        document: {
          ...document,
          timeline: document.timeline.map((item) => (item.id === command.itemId ? { ...item, suppressed: command.suppressed } : item)),
        },
      });
    case 'add-parameter':
      if (document.parameters.some((p) => p.id === command.parameter.id)) return invalid(`Id ${command.parameter.id} is already in use.`);
      return ok({ document: { ...document, parameters: [...document.parameters, command.parameter] }, parameters: true });
    case 'set-parameter':
      if (!document.parameters.some((p) => p.id === command.parameter.id)) return invalid(`Parameter ${command.parameter.id} does not exist.`);
      return ok({
        document: { ...document, parameters: document.parameters.map((p) => (p.id === command.parameter.id ? command.parameter : p)) },
        parameters: true,
      });
    case 'delete-parameter':
      return ok({ document: { ...document, parameters: document.parameters.filter((p) => p.id !== command.id) }, parameters: true });
    case 'set-material':
      if (!command.material.name.trim() || !(command.material.density > 0)) return invalid('A material needs a name and a density above zero.');
      return ok({ document: { ...document, material: command.material } });
    case 'set-appearance': {
      const problem = appearanceProblem(command.appearance);
      if (problem) return invalid(problem);
      const others = Object.entries(document.appearances ?? {}).filter(([body]) => body !== command.body);
      const appearances = Object.fromEntries(isDefaultAppearance(command.appearance) ? others : [...others, [command.body, command.appearance]]);
      return ok({ document: { ...document, appearances } });
    }
    case 'set-process': {
      const { process } = command;
      const sizes = process.kind === 'print' ? [...process.bed, process.nozzle, process.layerHeight] : [...process.bed, process.kerf, process.thickness];
      if (!process.name.trim() || sizes.some((v) => !(v > 0))) return invalid('Every size of a manufacturing profile must be above zero.');
      if (process.kind === 'print' && !(process.maxOverhang > 0 && process.maxOverhang <= 90)) return invalid('The overhang angle must be between 0° and 90°.');
      return ok({ document: { ...document, process } });
    }
  }
}
