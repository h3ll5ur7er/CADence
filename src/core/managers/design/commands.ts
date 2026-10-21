import {
  generatorOf,
  appearanceProblem,
  type ComponentDocument,
  fail,
  type Feature,
  type FeatureType,
  isDefaultAppearance,
  isDimension,
  isSketch,
  lengthUnitSize,
  ok,
  type Result,
  type Sketch,
  type SketchConstraint,
  isCurve,
  type SketchEntity,
  type SketchInsertion,
  sketchOriginId,
  folderItems,
  type TimelineFolder,
  type TimelineItem,
} from '@core/contracts';
import { chamfer, type EditResult, extend as extendCurve, fillet, measureDimension, offset, type SketchEdit, split, trim } from '@core/engines/sketch';
import type { DesignCommand, SketchOperation } from './design-manager';
import { replaceReference } from './references';

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
  part: 'Part',
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
  combine: 'Combine',
  split: 'Split',
  move: 'Move',
  scale: 'Scale',
  loft: 'Loft',
  sweep: 'Sweep',
  'path-pattern': 'Path pattern',
  hole: 'Hole',
  thread: 'Thread',
  draft: 'Draft',
  rib: 'Rib',
  wrap: 'Wrap',
  'base-flange': 'Base flange',
  'edge-flange': 'Edge flange',
};

const invalid = (message: string) => fail({ code: 'invalid-command', message });
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

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
    case 'equation':
      return [];
    case 'drawing':
    case 'picture':
      return [item.origin, item.handle];
    case 'text':
      return [item.anchor];
    case 'block':
      return [item.origin];
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
/** The document with an item inserted at the rollback marker. */
function insertAtMarker(document: ComponentDocument, item: TimelineItem): ComponentDocument {
  const at = document.timeline.length - document.rollbackIndex;
  return { ...document, timeline: [...document.timeline.slice(0, at), item, ...document.timeline.slice(at)] };
}

/**
 * The timeline items an item uses: its sketch, plane, repeated features, and the features that made
 * the bodies, faces and edges it refers to (named in their persistent names).
 */
export function itemDependencies(item: TimelineItem, timeline: readonly TimelineItem[]): Set<string> {
  const found = new Set<string>();
  const visit = (value: unknown, key?: string): void => {
    if (typeof value === 'string') {
      if (key === 'sketch' || key === 'plane' || key === 'features' || key === 'path') found.add(value);
      if (key === 'body' || key === 'target' || key === 'tools' || key === 'bodies') found.add(value.split(':')[0] as string);
      if (key === 'name') {
        for (const m of value.matchAll(/(?:^|[|&:])f:([^:|&~@]+)/g)) found.add(m[1] as string);
        for (const m of value.matchAll(/@([^.|&~]+)\./g)) found.add(m[1] as string);
      }
      return;
    }
    if (Array.isArray(value)) value.forEach((v) => visit(v, key));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) visit(v, k);
  };
  // A sketch's own geometry refers to nothing in the timeline; its plane, projections and blocks of this component do.
  if (isSketch(item)) {
    visit(item.plane, 'plane');
    for (const e of item.entities) if (e.kind === 'projection') visit(e.refs);
    for (const e of item.entities) if (e.kind === 'block' && !e.document) found.add(e.block);
  } else {
    visit({ ...item, id: undefined, name: undefined });
  }
  const ids = new Set(timeline.map((i) => i.id));
  return new Set([...found].filter((id) => id !== item.id && ids.has(id)));
}

/**
 * Folders after the timeline changed: each keeps the items it had that are still there (`moved`
 * leaves it, unless the folder is `carried` along with them), from the first to the last of them, so
 * items dropped between them join it; a folder left empty goes.
 */
function refolded(
  folders: readonly TimelineFolder[] | undefined,
  before: readonly TimelineItem[],
  after: readonly TimelineItem[],
  moved: readonly string[] = [],
  carried: ReadonlySet<string> = new Set(),
): TimelineFolder[] | undefined {
  if (!folders) return undefined;
  const leaving = new Set(moved);
  return folders.flatMap((folder) => {
    const items = folderItems(folder, before);
    const kept = new Set(carried.has(folder.id) ? items : items.filter((id) => !leaving.has(id)));
    const members = after.filter((i) => kept.has(i.id));
    const [first, last] = [members[0], members.at(-1)];
    return first && last ? [{ ...folder, first: first.id, last: last.id }] : [];
  });
}

const withFolders = (document: ComponentDocument, folders: readonly TimelineFolder[] | undefined): ComponentDocument =>
  folders?.length ? { ...document, folders } : (Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'folders')) as unknown as ComponentDocument);

/** Why a timeline order does not work: an item before something it uses. */
function orderProblem(timeline: readonly TimelineItem[]): string | undefined {
  const seen = new Set<string>();
  for (const item of timeline) {
    const missing = [...itemDependencies(item, timeline)].find((id) => !seen.has(id));
    if (missing) {
      const used = timeline.find((i) => i.id === missing);
      return `${item.name} uses ${used?.name ?? missing}, so it has to come after it.`;
    }
    seen.add(item.id);
  }
  return undefined;
}

/** The document with `configuration` as the one edited and shown (none: the parameters' own values). */
function withConfiguration(document: ComponentDocument, configuration: string | undefined): ComponentDocument {
  if (configuration) return { ...document, configuration };
  return Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'configuration')) as unknown as ComponentDocument;
}

function nextFolderName(document: ComponentDocument): string {
  const used = (document.folders ?? []).map((f) => /^Folder (\d+)$/.exec(f.name)?.[1]).map(Number).filter(Number.isFinite);
  return `Folder ${Math.max(0, ...used) + 1}`;
}

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

/** Why a text cannot be drawn, or `undefined`. */
function textProblem(text: string, height: number): string | undefined {
  if (!text.trim()) return 'A text needs at least one character.';
  if (!(height > 0)) return 'Text height must be above zero.';
  return undefined;
}

/** Adds entities and constraints after checking ids are new and references resolve. */
function extend(sketch: Sketch, entities: readonly SketchEntity[], constraints: readonly SketchConstraint[]): Result<Sketch> {
  for (const e of entities) {
    const problem = e.kind === 'text' ? textProblem(e.text, e.height) : undefined;
    if (problem) return invalid(problem);
  }
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
    const owner = generatorOf(sketch, id);
    if (owner) doomed.add(owner.id);
  }
  for (const e of sketch.entities) {
    const owner = generatorOf(sketch, e.id);
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

/**
 * A block made of chosen points, curves and texts of a sketch (ADR-54a): they move into a new block
 * sketch, with the relations among them, placed so that `base` is its origin, and the sketch places
 * the block at `base` instead. Points that other curves use stay as well; relations between the chosen
 * geometry and the rest go, so the block is placed by its point alone.
 */
function makeBlock(document: ComponentDocument, command: Extract<DesignCommand, { type: 'make-block' }>): Result<Applied> {
  const index = document.timeline.findIndex((item) => item.id === command.sketchId && isSketch(item));
  const source = document.timeline[index] as Sketch | undefined;
  if (!source) return invalid(`Sketch ${command.sketchId} does not exist.`);
  if (document.timeline.some((item) => item.id === command.block)) return invalid(`Id ${command.block} is already in use.`);
  const origin = `${command.insertion}-origin`;
  if (source.entities.some((e) => e.id === command.insertion || e.id === origin)) return invalid(`Id ${command.insertion} is already in use.`);
  const chosen = source.entities.filter((e) => command.ids.includes(e.id));
  if (chosen.some((e) => generatorOf(source, e.id) || (e.kind !== 'point' && !isCurve(e) && e.kind !== 'text'))) {
    return invalid('Only drawn points, curves and texts go into a block: explode projections, drawings and blocks first.');
  }
  if (!chosen.length) return invalid('Select the curves, points or texts to make a block of.');
  const members = new Set(chosen.flatMap((e) => [e.id, ...(e.kind === 'point' ? [] : references(e))]));
  members.delete(sketchOriginId);
  const [bx, by] = command.base;
  const entities = source.entities.filter((e) => members.has(e.id)).map((e) => (e.kind === 'point' ? { ...e, x: e.x - bx, y: e.y - by } : e));
  const within = (c: SketchConstraint) => references(c).every((r) => members.has(r));
  const constraints: SketchConstraint[] = source.constraints.filter(within).map((c) => (c.kind === 'fix' ? { ...c, x: c.x - bx, y: c.y - by } : c));
  // A chosen point at the base is the block's insertion point: it stays on the block's origin.
  const atBase = entities.find((e) => e.kind === 'point' && Math.hypot(e.x, e.y) < 1e-9);
  if (atBase) constraints.push({ id: `${command.block}-base`, kind: 'coincident', points: [atBase.id, sketchOriginId] });
  const block: Sketch = { id: command.block, type: 'sketch', name: command.name?.trim() || nextName(document, 'Block'), suppressed: false, plane: 'XY', entities, constraints, block: true };
  // Points the rest of the sketch still uses stay in it.
  const rest = source.entities.filter((e) => !members.has(e.id));
  const used = new Set(rest.flatMap(references));
  const kept = source.entities.filter((e) => !members.has(e.id) || (e.kind === 'point' && used.has(e.id)));
  const keptIds = new Set(kept.map((e) => e.id));
  const placed: Sketch = {
    ...source,
    entities: [
      ...kept,
      { id: origin, kind: 'point', x: bx, y: by },
      { id: command.insertion, kind: 'block', block: command.block, origin, angle: '0 deg', scale: '1', construction: false },
    ],
    constraints: source.constraints.filter((c) => !within(c) && references(c).every((r) => r === sketchOriginId || keptIds.has(r))),
  };
  const timeline = [...document.timeline.slice(0, index), block, placed, ...document.timeline.slice(index + 1)];
  return ok({ document: { ...document, timeline }, target: command.sketchId });
}

/** A placed block made plain points, curves and texts of the sketch, where it is now (they lose their `:`). */
function explode(sketch: Sketch, insertionId: string): Result<Sketch> {
  const insertion = sketch.entities.find((e) => e.id === insertionId && e.kind === 'block');
  if (!insertion) return invalid(`There is no block placed as ${insertionId}.`);
  const plain = (id: string) => (generatorOf(sketch, id) === insertion ? `${insertionId}.${id.slice(insertionId.length + 1)}` : id);
  const renamed = (e: SketchEntity): SketchEntity => {
    switch (e.kind) {
      case 'point':
        return { ...e, id: plain(e.id) };
      case 'line':
        return { ...e, id: plain(e.id), start: plain(e.start), end: plain(e.end) };
      case 'circle':
        return { ...e, id: plain(e.id), center: plain(e.center) };
      case 'arc':
        return { ...e, id: plain(e.id), center: plain(e.center), start: plain(e.start), end: plain(e.end) };
      case 'ellipse':
        return { ...e, id: plain(e.id), center: plain(e.center), major: plain(e.major) };
      case 'spline':
        return { ...e, id: plain(e.id), points: e.points.map(plain) };
      case 'text':
        return { ...e, id: plain(e.id), anchor: plain(e.anchor), ...(e.along ? { along: { ...e.along, curve: plain(e.along.curve) } } : {}) };
      default:
        return e;
    }
  };
  const swap = (value: unknown): unknown =>
    typeof value === 'string' ? plain(value) : Array.isArray(value) ? value.map(swap) : value;
  const constraints = sketch.constraints.map((c) => Object.fromEntries(Object.entries(c).map(([key, value]) => [key, key === 'id' || key === 'expression' || key === 'name' ? value : swap(value)])) as unknown as SketchConstraint);
  return ok({ ...sketch, entities: sketch.entities.filter((e) => e !== insertion).map(renamed), constraints });
}

/** Moves and turns elements: their points, and the points their curves use. */
function transformed(sketch: Sketch, ids: readonly string[], [dx, dy]: readonly [number, number], rotate?: { readonly center: readonly [number, number]; readonly angle: number }): Result<Sketch> {
  if (!ids.length || ids.some((id) => !sketch.entities.some((e) => e.id === id))) return invalid('Select sketch elements to move.');
  // A piece of a drawing kept as one piece moves the whole drawing, by its handle points.
  // A piece of a placed block moves the block, by its point.
  const owners = new Set(ids.map((id) => (generatorOf(sketch, id)?.kind === 'drawing' || generatorOf(sketch, id)?.kind === 'block' ? (generatorOf(sketch, id)?.id ?? id) : id)));
  const chosen = sketch.entities.filter((e) => owners.has(e.id));
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
      return ok({ document: insertAtMarker(document, sketch), target: sketch.id });
    }
    case 'add-sketch-geometry':
      return withSketch(document, command.sketchId, (s) => extend(s, command.entities, command.constraints));
    case 'add-constraint':
      return withSketch(document, command.sketchId, (s) => extend(s, [], [command.constraint]));
    case 'set-dimension':
      return withSketch(document, command.sketchId, (s) => {
        const target = s.constraints.find((c) => c.id === command.constraintId);
        if (!target || !('expression' in target)) return invalid(`Dimension ${command.constraintId} does not exist.`);
        if (target.reference) return invalid('A reference dimension shows what the sketch measures: make it driving to set its value.');
        return ok({
          ...s,
          constraints: s.constraints.map((c) => (c === target ? { ...target, expression: command.expression } : c)),
        });
      });
    case 'set-dimension-reference':
      return withSketch(document, command.sketchId, (s) => {
        const target = s.constraints.find((c) => c.id === command.constraintId);
        if (!target || !isDimension(target)) return invalid(`Dimension ${command.constraintId} does not exist.`);
        if (command.reference) {
          const { name: _, ...rest } = target;
          return ok({ ...s, constraints: s.constraints.map((c) => (c === target ? { ...rest, reference: true, ...(command.name ? { name: command.name } : {}) } : c)) });
        }
        // A reference made driving keeps the value it shows.
        const measured = measureDimension(s, target);
        const { reference: _r, name: _n, ...driving } = target;
        const expression = measured === undefined ? target.expression : target.kind === 'angle' ? `${round6((measured * 180) / Math.PI)} deg` : `${round6(measured)} mm`;
        return ok({ ...s, constraints: s.constraints.map((c) => (c === target ? { ...driving, expression } : c)) });
      });
    case 'move-point': {
      const applied = withSketch(document, command.sketchId, (s) => {
        if (!s.entities.some((e) => e.id === command.pointId && e.kind === 'point')) return invalid(`Point ${command.pointId} does not exist.`);
        // A fix holds the point against any drag: say so, rather than leave it where it is (CAD-118).
        const fix = s.constraints.find((c) => c.kind === 'fix' && c.point === command.pointId);
        if (!fix) return ok(s);
        // The fix a shape placed by numbers made for its own point (c:fix for c:center) moves with it (CAD-144).
        const shape = command.pointId.slice(0, command.pointId.lastIndexOf(':'));
        if (shape && fix.id.startsWith(`${shape}:fix`)) {
          return ok({ ...s, constraints: s.constraints.map((c) => (c === fix ? { ...fix, x: command.x, y: command.y } : c)) });
        }
        return fail({ code: 'invalid-command', message: `Point ${command.pointId} is fixed (${fix.id}); remove the fix to move it.`, related: [fix.id] });
      });
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
            const toggled = new Set(command.ids.flatMap((id) => [id, generatorOf(s, id)?.id ?? id]));
            const owner = generatorOf(s, e.id);
            return e.kind !== 'point' && e.kind !== 'picture' && (toggled.has(e.id) || (owner && toggled.has(owner.id))) ? { ...e, construction: !e.construction } : e;
          }),
        }),
      );
    case 'delete-sketch-elements':
      return withSketch(document, command.sketchId, (s) => ok(remove(s, command.ids)));
    case 'make-block':
      return makeBlock(document, command);
    case 'set-sketch-block':
      return withSketch(document, command.sketchId, (s) => {
        const { block: _, ...rest } = s;
        return ok(command.block ? { ...rest, block: true } : rest);
      });
    case 'explode-block':
      return withSketch(document, command.sketchId, (s) => explode(s, command.insertion));
    case 'set-block':
      return withSketch(document, command.sketchId, (s) => {
        const target = s.entities.find((e): e is SketchInsertion => e.id === command.insertion && e.kind === 'block');
        if (!target) return invalid(`There is no block placed as ${command.insertion}.`);
        const changed: SketchInsertion = { ...target, angle: command.angle, scale: command.scale };
        return ok({ ...s, entities: s.entities.map((e) => (e === target ? changed : e)) });
      });
    case 'set-sketch-picture':
      return withSketch(document, command.sketchId, (s) => {
        const target = s.entities.find((e) => e.id === command.pictureId && e.kind === 'picture');
        if (!target) return invalid(`Picture ${command.pictureId} does not exist.`);
        if (!(command.opacity >= 0.05 && command.opacity <= 1)) return invalid('Opacity goes from 0.05 to 1.');
        return ok({ ...s, entities: s.entities.map((e) => (e === target ? { ...e, opacity: command.opacity, hidden: command.hidden } : e)) });
      });
    case 'set-sketch-text':
      return withSketch(document, command.sketchId, (s) => {
        const target = s.entities.find((e) => e.id === command.textId && e.kind === 'text');
        if (!target) return invalid(`Text ${command.textId} does not exist.`);
        const problem = textProblem(command.text, command.height);
        if (problem) return invalid(problem);
        const { text, height, weight, angle, font, along } = command;
        if (along && !s.entities.some((e) => e.id === along.curve && isCurve(e))) return invalid(`Curve ${along.curve} does not exist.`);
        const changed = (e: SketchEntity): SketchEntity => {
          if (e.kind !== 'text') return e;
          const { font: _font, along: _along, ...rest } = e;
          return { ...rest, text, height, weight, angle, ...(font ? { font } : {}), ...(along ? { along } : {}) };
        };
        return ok({ ...s, entities: s.entities.map((e) => (e === target ? changed(e) : e)) });
      });
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
    case 'delete-item': {
      const index = document.timeline.findIndex((item) => item.id === command.itemId);
      if (index < 0) return invalid(`Item ${command.itemId} does not exist.`);
      const rolledBack = index >= document.timeline.length - document.rollbackIndex;
      const timeline = document.timeline.filter((item) => item.id !== command.itemId);
      return ok({
        document: withFolders(
          { ...document, timeline, rollbackIndex: document.rollbackIndex - (rolledBack ? 1 : 0) },
          refolded(document.folders, document.timeline, timeline, [command.itemId]),
        ),
      });
    }
    case 'reorder-item': {
      const item = document.timeline.find((i) => i.id === command.itemId);
      if (!item) return invalid(`Item ${command.itemId} does not exist.`);
      const rest = document.timeline.filter((i) => i !== item);
      if (!Number.isInteger(command.index) || command.index < 0 || command.index > rest.length) return invalid('That place is outside the timeline.');
      const timeline = [...rest.slice(0, command.index), item, ...rest.slice(command.index)];
      const problem = orderProblem(timeline);
      if (problem) return invalid(problem);
      return ok({ document: withFolders({ ...document, timeline }, refolded(document.folders, document.timeline, timeline, [item.id])), target: item.id });
    }
    case 'replace-reference': {
      if (!document.timeline.some((item) => item.id === command.itemId)) return invalid(`Item ${command.itemId} does not exist.`);
      if (command.from.kind !== command.to.kind) return invalid(`Replace a ${command.from.kind} with a ${command.from.kind}.`);
      const timeline = document.timeline.map((item) => (item.id === command.itemId ? replaceReference(item, command.from, command.to) : item));
      return ok({ document: { ...document, timeline } });
    }
    case 'set-note': {
      if (!document.timeline.some((item) => item.id === command.itemId)) return invalid(`Item ${command.itemId} does not exist.`);
      const note = command.note.trim();
      const timeline = document.timeline.map((item) => {
        if (item.id !== command.itemId) return item;
        const { note: _old, ...rest } = item;
        return (note ? { ...rest, note } : rest) as TimelineItem;
      });
      return ok({ document: { ...document, timeline } });
    }
    case 'set-folder': {
      const { folder } = command;
      const items = folderItems(folder, document.timeline);
      if (!items.length) return invalid('A folder runs from an item to the same or a later one.');
      // Folders nest (CAD-157): another folder is apart from this one, holds it, or is held by it.
      const others = (document.folders ?? []).filter((f) => f.id !== folder.id);
      const mine = new Set(items);
      const crossed = others.find((f) => {
        const theirs = folderItems(f, document.timeline);
        const shared = theirs.filter((id) => mine.has(id)).length;
        return shared > 0 && shared < theirs.length && shared < items.length;
      });
      if (crossed) return invalid(`A folder holds whole folders or none of them: this one would hold part of ${crossed.name}.`);
      const existing = document.folders?.find((f) => f.id === folder.id);
      const name = folder.name.trim() || existing?.name || nextFolderName(document);
      if (name.length > 80) return fail({ code: 'invalid-name', message: 'Names need 1 to 80 characters.' });
      const note = folder.note?.trim();
      const { note: _old, ...rest } = folder;
      const changed: TimelineFolder = { ...rest, name, ...(note ? { note } : {}) };
      const folders = existing ? (document.folders ?? []).map((f) => (f.id === folder.id ? changed : f)) : [...(document.folders ?? []), changed];
      return ok({ document: withFolders(document, folders) });
    }
    case 'move-folder': {
      const folder = document.folders?.find((f) => f.id === command.folderId);
      if (!folder) return invalid('That folder does not exist.');
      const ids = folderItems(folder, document.timeline);
      const moving = new Set(ids);
      const block = document.timeline.filter((i) => moving.has(i.id));
      const rest = document.timeline.filter((i) => !moving.has(i.id));
      if (!block.length) return invalid('That folder has no items.');
      if (!Number.isInteger(command.index) || command.index < 0 || command.index > rest.length) return invalid('That place is outside the timeline.');
      const timeline = [...rest.slice(0, command.index), ...block, ...rest.slice(command.index)];
      const problem = orderProblem(timeline);
      if (problem) return invalid(problem);
      // The folder and those in it go along with their items.
      const carried = new Set((document.folders ?? []).filter((f) => folderItems(f, document.timeline).every((id) => moving.has(id))).map((f) => f.id));
      return ok({ document: withFolders({ ...document, timeline }, refolded(document.folders, document.timeline, timeline, ids, carried)) });
    }
    case 'delete-folder':
      if (!document.folders?.some((f) => f.id === command.folderId)) return invalid('That folder does not exist.');
      return ok({ document: withFolders(document, document.folders.filter((f) => f.id !== command.folderId)) });
    case 'suppress-folder': {
      const folder = document.folders?.find((f) => f.id === command.folderId);
      if (!folder) return invalid('That folder does not exist.');
      const items = new Set(folderItems(folder, document.timeline));
      return ok({
        document: { ...document, timeline: document.timeline.map((item) => (items.has(item.id) ? { ...item, suppressed: command.suppressed } : item)) },
      });
    }
    case 'roll-to': {
      const { position } = command;
      if (!Number.isInteger(position) || position < 0 || position > document.timeline.length) return invalid('That place is outside the timeline.');
      return ok({ document: { ...document, rollbackIndex: document.timeline.length - position } });
    }
    case 'add-feature': {
      if (document.timeline.some((item) => item.id === command.feature.id)) return invalid(`Id ${command.feature.id} is already in use.`);
      const name = command.feature.name.trim() || nextName(document, featureLabels[command.feature.type]);
      const feature = { ...command.feature, name } as Feature;
      return ok({ document: insertAtMarker(document, feature), target: feature.id });
    }
    case 'edit-feature': {
      const existing = document.timeline.find((item) => item.id === command.feature.id);
      if (!existing) return invalid(`Feature ${command.feature.id} does not exist.`);
      if (isSketch(existing)) return invalid(`${command.feature.id} is a sketch, not a feature.`);
      // A feature may become another kind (an extruded boss a revolved one); references by id stay (CAD-118).
      const name = command.feature.name.trim() || (existing.type === command.feature.type ? existing.name : nextName(document, featureLabels[command.feature.type]));
      const feature = { ...command.feature, name } as Feature;
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
    case 'set-configurations': {
      const names = command.configurations.map((c) => c.name.trim());
      if (names.some((n) => !n)) return invalid('Every configuration needs a name.');
      if (new Set(names).size < names.length || new Set(command.configurations.map((c) => c.id)).size < names.length) return invalid('Configuration names must differ.');
      const active = document.configuration && command.configurations.some((c) => c.id === document.configuration) ? document.configuration : undefined;
      return ok({ document: withConfiguration({ ...document, configurations: command.configurations }, active), parameters: true });
    }
    case 'activate-configuration':
      if (command.configuration && !document.configurations?.some((c) => c.id === command.configuration)) return invalid('That configuration does not exist.');
      return ok({ document: withConfiguration(document, command.configuration), parameters: true });
    case 'set-units':
      if (!(command.units in lengthUnitSize)) return invalid(`${command.units} is not a unit lengths can be shown in.`);
      return ok({ document: { ...document, units: command.units } });
    case 'set-material':
      if (!command.material.name.trim() || !(command.material.density > 0)) return invalid('A material needs a name and a density above zero.');
      return ok({ document: { ...document, material: command.material } });
    case 'set-body-material': {
      const { material, body } = command;
      if (material && (!material.name.trim() || !(material.density > 0))) return invalid('A material needs a name and a density above zero.');
      const { [body]: _old, ...others } = document.bodyMaterials ?? {};
      const bodyMaterials = material ? { ...others, [body]: material } : others;
      const { bodyMaterials: _all, ...rest } = document;
      return ok({ document: Object.keys(bodyMaterials).length ? { ...rest, bodyMaterials } : rest });
    }
    case 'set-appearance': {
      const problem = appearanceProblem(command.appearance);
      if (problem) return invalid(problem);
      const others = Object.entries(document.appearances ?? {}).filter(([body]) => body !== command.body);
      const appearances = Object.fromEntries(isDefaultAppearance(command.appearance) ? others : [...others, [command.body, command.appearance]]);
      return ok({ document: { ...document, appearances } });
    }
    case 'set-simulation': {
      const { setup } = command;
      if (setup.size !== undefined && !(setup.size > 0)) return invalid('The element size must be above zero.');
      for (const load of setup.loads) {
        if (load.kind === 'force' && !(Math.hypot(...load.direction) > 0)) return invalid('A force needs a direction.');
        if (!Number.isFinite(load.kind === 'force' ? load.force : load.pressure)) return invalid('A load needs a size.');
      }
      const empty = !setup.fixed.length && !setup.loads.length;
      const { simulation: _old, ...rest } = document;
      return ok({ document: empty ? rest : { ...document, simulation: setup } });
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
