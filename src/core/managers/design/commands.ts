import {
  type ComponentDocument,
  fail,
  type Feature,
  type FeatureType,
  isSketch,
  ok,
  type Result,
  type Sketch,
  type SketchConstraint,
  type SketchEntity,
  sketchOriginId,
} from '@core/contracts';
import type { DesignCommand } from './design-manager';

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
    case 'set-process': {
      const { process } = command;
      const sizes = process.kind === 'print' ? [...process.bed, process.nozzle, process.layerHeight] : [...process.bed, process.kerf, process.thickness];
      if (!process.name.trim() || sizes.some((v) => !(v > 0))) return invalid('Every size of a manufacturing profile must be above zero.');
      if (process.kind === 'print' && !(process.maxOverhang > 0 && process.maxOverhang <= 90)) return invalid('The overhang angle must be between 0° and 90°.');
      return ok({ document: { ...document, process } });
    }
  }
}
