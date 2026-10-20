import type { ConflictChoice, DocumentChange, ItemConflict } from '@core/contracts';

/** A document (or a project's settings) as plain JSON. */
type Record_ = Readonly<Record<string, unknown>>;

/**
 * How a part of a document is made: its lists of items with an identity (by id or name), each
 * merged and compared item by item; every other field is one value.
 */
interface Shape {
  readonly lists: Readonly<Record<string, ListShape>>;
}

interface ListShape {
  /** What identifies an item: its id, or (parameters) its name. */
  readonly key: 'id' | 'name';
  /** Whether the order of the items means something (the timeline). */
  readonly ordered: boolean;
  /** A map by key instead of a list (a component's appearances, by body). */
  readonly map?: boolean;
  /** What one item is called when it has no name: "instance", "joint". */
  readonly singular: string;
  /** Items made of lists of their own (sketches), merged and compared inside. */
  readonly nested?: (item: Record_) => Shape | undefined;
}

const sketchShape: Shape = {
  lists: {
    entities: { key: 'id', ordered: true, singular: 'element' },
    constraints: { key: 'id', ordered: true, singular: 'constraint' },
  },
};

const parameters: ListShape = { key: 'name', ordered: true, singular: 'parameter' };

/** The documents' lists (docs/Architecture/Document-model.md); fields not listed are single values. */
const shapes: Readonly<Record<string, Shape>> = {
  component: {
    lists: {
      parameters,
      timeline: { key: 'id', ordered: true, singular: 'item', nested: (item) => (item['type'] === 'sketch' ? sketchShape : undefined) },
      folders: { key: 'id', ordered: false, singular: 'folder' },
      configurations: { key: 'id', ordered: true, singular: 'configuration' },
      appearances: { key: 'id', ordered: false, map: true, singular: 'appearance of' },
    },
  },
  assembly: {
    lists: {
      instances: { key: 'id', ordered: true, singular: 'instance' },
      joints: { key: 'id', ordered: true, singular: 'joint' },
      motionStudies: { key: 'id', ordered: true, singular: 'motion study' },
      patterns: { key: 'id', ordered: true, singular: 'pattern' },
      links: { key: 'id', ordered: true, singular: 'link' },
      explodedViews: { key: 'id', ordered: true, singular: 'exploded view' },
    },
  },
  drawing: {
    lists: {
      views: { key: 'id', ordered: true, singular: 'view' },
      annotations: { key: 'id', ordered: true, singular: 'annotation' },
    },
  },
  imported: { lists: {} },
  /** A project's settings (`project.json` of a version): its name and parameters. */
  settings: { lists: { parameters } },
};

/** Fields that say which document it is and when it was saved, not what it holds. */
const bookkeeping = new Set(['id', 'projectId', 'kind', 'schemaVersion', 'createdAt', 'modifiedAt']);

const fieldLabels: Readonly<Record<string, string>> = {
  name: 'Name',
  units: 'Units',
  material: 'Material',
  process: 'Process',
  rollbackIndex: 'Rollback marker',
  configuration: 'Shown configuration',
  simulation: 'Strength check setup',
  sheet: 'Sheet',
  titleBlock: 'Title block',
  fileName: 'File',
  assetId: 'Original file',
  byteLength: 'File size',
  format: 'Format',
};

const shapeOf = (document: Record_): Shape => shapes[typeof document['kind'] === 'string' ? document['kind'] : 'settings'] ?? { lists: {} };

/** JSON with its keys sorted, so equal values compare equal whatever order their keys were written in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record_).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

const same = (a: unknown, b: unknown) => a === b || (a !== undefined && b !== undefined && canonical(a) === canonical(b));

/** A value in a few words: strings as they are, numbers rounded, others as short JSON. */
function words(value: unknown): string {
  if (value === undefined || value === null) return 'none';
  if (typeof value === 'string') return value.length > 48 ? `${value.slice(0, 47)}…` : value || '""';
  if (typeof value === 'number') return String(Math.round(value * 1e4) / 1e4);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  const json = canonical(value);
  return json.length > 48 ? `${json.slice(0, 47)}…` : json;
}

/** The fields in which two items differ, as "field before → after". */
function fieldChanges(before: Record_, after: Record_, skip: ReadonlySet<string> = new Set()): string[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !skip.has(k));
  return keys.filter((k) => !same(before[k], after[k])).map((k) => `${k} ${words(before[k])} → ${words(after[k])}`);
}

/** One side of a conflict in words: the fields in which it differs from the other side (or, when that deleted it, from before). */
function sideInWords(side: unknown, other: unknown): string {
  if (side === undefined) return 'deleted';
  if (!isRecord(side) || !isRecord(other)) return words(side);
  const keys = [...new Set([...Object.keys(side), ...Object.keys(other)])].filter((k) => !same(side[k], other[k]));
  return keys.map((k) => `${k} ${words(side[k])}`).join(', ') || 'unchanged';
}

const isRecord = (value: unknown): value is Record_ => !!value && typeof value === 'object' && !Array.isArray(value);

/** A list's items by key, in their order. */
function itemsOf(value: unknown, list: ListShape): Map<string, Record_> {
  if (list.map) return new Map(isRecord(value) ? Object.entries(value).map(([k, v]) => [k, (isRecord(v) ? v : { value: v }) as Record_]) : []);
  return new Map(Array.isArray(value) ? value.filter(isRecord).map((item) => [String(item[list.key]), item]) : []);
}

/** What an item is called: its name, else its kind and id. */
function itemLabel(item: Record_ | undefined, key: string, list: ListShape, parent?: string): string {
  if (list.map) return `${list.singular} ${key}`;
  if (list === parameters) return `Parameter ${key}`;
  const kind = typeof item?.['kind'] === 'string' ? item['kind'] : list.singular;
  const name = typeof item?.['name'] === 'string' && item['name'] ? item['name'] : undefined;
  const own = name ?? `${kind} ${key}`;
  return parent ? `${parent}: ${own}` : own.charAt(0).toUpperCase() + own.slice(1);
}

/** Positions of `ids` in the longest run they share in order with `reference`; the others moved. */
function inOrder(ids: readonly string[], reference: readonly string[]): Set<string> {
  // Longest common subsequence, small lists: quadratic is fine.
  const n = ids.length;
  const m = reference.length;
  const table = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = table[i] as number[];
      row[j] = ids[i] === reference[j] ? ((table[i + 1] as number[])[j + 1] as number) + 1 : Math.max((table[i + 1] as number[])[j] as number, row[j + 1] as number);
    }
  }
  const kept = new Set<string>();
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (ids[i] === reference[j]) {
      kept.add(ids[i] as string);
      i++;
      j++;
    } else if (((table[i + 1] as number[])[j] as number) >= ((table[i] as number[])[j + 1] as number)) i++;
    else j++;
  }
  return kept;
}

/** What changed from one version of a document (or of a project's settings) to another. */
export function compareDocuments(before: Record_, after: Record_): DocumentChange[] {
  return compareObject(before, after, shapeOf(after), '', undefined);
}

function compareObject(before: Record_, after: Record_, shape: Shape, path: string, parent: string | undefined): DocumentChange[] {
  const changes: DocumentChange[] = [];
  const top = path === '';
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !(top && bookkeeping.has(k)) && !(k in shape.lists));
  if (top) {
    for (const field of fields.filter((f) => !same(before[f], after[f]))) {
      changes.push({ kind: 'changed', path: field, label: fieldLabels[field] ?? field, area: 'settings', details: [`${words(before[field])} → ${words(after[field])}`] });
    }
  }
  for (const [name, list] of Object.entries(shape.lists)) {
    changes.push(...compareList(before[name], after[name], list, `${path}${name}`, top ? name : 'sketch', parent));
  }
  return changes;
}

function compareList(before: unknown, after: unknown, list: ListShape, path: string, area: string, parent: string | undefined): DocumentChange[] {
  const [old, now] = [itemsOf(before, list), itemsOf(after, list)];
  const changes: DocumentChange[] = [];
  const moved = list.ordered ? movedKeys([...old.keys()].filter((k) => now.has(k)), [...now.keys()].filter((k) => old.has(k))) : new Set<string>();
  for (const [key, item] of old) if (!now.has(key)) changes.push({ kind: 'removed', path: `${path}/${key}`, label: itemLabel(item, key, list, parent), area });
  for (const [key, item] of now) {
    const was = old.get(key);
    const label = itemLabel(item, key, list, parent);
    const at = `${path}/${key}`;
    if (!was) {
      changes.push({ kind: 'added', path: at, label, area });
      continue;
    }
    if (moved.has(key)) changes.push({ kind: 'moved', path: at, label, area });
    if (same(was, item)) continue;
    const nested = list.nested?.(item);
    if (nested && list.nested?.(was) === nested) {
      const details = fieldChanges(was, item, new Set(Object.keys(nested.lists)));
      if (details.length) changes.push({ kind: 'changed', path: at, label, area, details });
      changes.push(...compareObject(was, item, nested, `${at}/`, label));
    } else {
      changes.push({ kind: 'changed', path: at, label, area, details: fieldChanges(was, item, new Set([list.key])) });
    }
  }
  return changes;
}

/** Items of an ordered list whose place among the others changed. */
function movedKeys(before: readonly string[], after: readonly string[]): Set<string> {
  const kept = inOrder(after, before);
  return new Set(after.filter((k) => !kept.has(k)));
}

/** A three-way merge's result: the merged document, or the items to choose a side for. */
export interface MergeOutcome {
  /** Merged; where conflicts are left, it holds our side of them. */
  readonly document: Record_;
  readonly conflicts: readonly ItemConflict[];
}

export interface MergeOptions {
  /** The side to keep for conflicts, by their paths. */
  readonly resolutions?: Readonly<Record<string, ConflictChoice>>;
  /** When the merge is made: the merged document's `modifiedAt`, so results made from either side are stale. */
  readonly time?: string;
}

/**
 * Combines two versions of a document changed from a common one (CAD-176): timeline items by id,
 * sketch elements by id, parameters by name, every other field on its own. What only one side
 * changed is taken from it; what both changed alike is taken once; items both changed differently
 * are conflicts, decided by `resolutions` (by path) or reported. Items one side added keep their
 * place after the item they followed; sketch elements and relations left referring to elements the
 * other side deleted go too, as deleting them in the sketch would.
 */
export function mergeDocuments(base: Record_ | undefined, mine: Record_, theirs: Record_, options: MergeOptions = {}): MergeOutcome {
  const conflicts: ItemConflict[] = [];
  const merged = mergeObject(base ?? {}, mine, theirs, shapeOf(mine), '', undefined, options.resolutions ?? {}, conflicts);
  const kept: Record<string, unknown> = { ...merged };
  for (const field of bookkeeping) if (mine[field] !== undefined) kept[field] = mine[field];
  const version = Math.max(Number(mine['schemaVersion'] ?? 0), Number(theirs['schemaVersion'] ?? 0));
  if (version) kept['schemaVersion'] = version;
  if (options.time && mine['modifiedAt'] !== undefined) kept['modifiedAt'] = options.time;
  return { document: kept, conflicts };
}

function mergeObject(
  base: Record_,
  mine: Record_,
  theirs: Record_,
  shape: Shape,
  path: string,
  parent: string | undefined,
  resolutions: Readonly<Record<string, ConflictChoice>>,
  conflicts: ItemConflict[],
): Record_ {
  const top = path === '';
  const result: Record<string, unknown> = {};
  const keys = [...new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base)])];
  for (const key of keys) {
    if (top && bookkeeping.has(key)) continue;
    const list = shape.lists[key];
    const value = list
      ? mergeList(base[key], mine[key], theirs[key], list, `${path}${key}`, parent, resolutions, conflicts)
      : mergeValue(base[key], mine[key], theirs[key], `${path}${key}`, top ? (fieldLabels[key] ?? key) : `${parent}: ${key}`, resolutions, conflicts);
    if (value !== undefined) result[key] = value;
  }
  return shape === sketchShape ? withoutDangling(result, [base, mine, theirs]) : result;
}

/** One value merged three ways; both changed differently: a conflict. */
function mergeValue(
  base: unknown,
  mine: unknown,
  theirs: unknown,
  path: string,
  label: string,
  resolutions: Readonly<Record<string, ConflictChoice>>,
  conflicts: ItemConflict[],
): unknown {
  if (same(mine, theirs) || same(theirs, base)) return mine;
  if (same(mine, base)) return theirs;
  const chosen = resolutions[path];
  if (chosen) return chosen === 'mine' ? mine : theirs;
  conflicts.push({ path, label, mine: sideInWords(mine, theirs), theirs: sideInWords(theirs, mine) });
  return mine;
}

function mergeList(
  base: unknown,
  mine: unknown,
  theirs: unknown,
  list: ListShape,
  path: string,
  parent: string | undefined,
  resolutions: Readonly<Record<string, ConflictChoice>>,
  conflicts: ItemConflict[],
): unknown {
  if (mine === undefined && theirs === undefined) return undefined;
  const [b, m, t] = [itemsOf(base, list), itemsOf(mine, list), itemsOf(theirs, list)];
  const kept = new Map<string, Record_>();
  for (const key of new Set([...m.keys(), ...t.keys(), ...b.keys()])) {
    const [was, ours, other] = [b.get(key), m.get(key), t.get(key)];
    const at = `${path}/${key}`;
    let chosen: Record_ | undefined;
    if (same(ours, other) || same(other, was)) chosen = ours;
    else if (same(ours, was)) chosen = other;
    else if (ours && other && list.nested?.(ours) && list.nested(ours) === list.nested(other)) {
      // A sketch both changed: merged element by element, its own fields one by one.
      const nested = list.nested(ours) as Shape;
      chosen = { ...mergeObject(was ?? {}, ours, other, nested, `${at}/`, itemLabel(ours, key, list, parent), resolutions, conflicts) };
    } else if (resolutions[at]) chosen = resolutions[at] === 'mine' ? ours : other;
    else {
      conflicts.push({ path: at, label: itemLabel(ours ?? other, key, list, parent), mine: sideInWords(ours, other ?? was), theirs: sideInWords(other, ours ?? was) });
      chosen = ours;
    }
    if (chosen) kept.set(key, chosen);
  }
  const order = list.ordered ? mergedOrder([...b.keys()], [...m.keys()], [...t.keys()], kept) : [...new Set([...m.keys(), ...t.keys()])].filter((k) => kept.has(k));
  if (list.map) return Object.fromEntries(order.map((k) => [k, kept.get(k)]));
  return order.map((k) => kept.get(k));
}

/**
 * The order of a merged list: the items both have in the order of the side that reordered them (ours
 * when both did), then each side's new items after the item they follow on that side, ours first.
 */
function mergedOrder(base: readonly string[], mine: readonly string[], theirs: readonly string[], kept: ReadonlyMap<string, unknown>): string[] {
  const shared = (side: readonly string[], other: readonly string[]) => side.filter((k) => other.includes(k) && kept.has(k));
  const mineShared = shared(mine, theirs);
  const baseOrder = base.filter((k) => mineShared.includes(k));
  const result = mineShared.join('\n') === baseOrder.join('\n') && baseOrder.length === mineShared.length ? shared(theirs, mine) : mineShared;
  const ours = new Set<string>();
  const insert = (side: readonly string[], own: Set<string>, skip: ReadonlySet<string>) => {
    side.forEach((key, index) => {
      if (result.includes(key) || !kept.has(key)) return;
      const before = side.slice(0, index).reverse().find((k) => result.includes(k));
      let at = before === undefined ? 0 : result.indexOf(before) + 1;
      while (at < result.length && skip.has(result[at] as string)) at++;
      result.splice(at, 0, key);
      own.add(key);
    });
  };
  insert(mine, ours, new Set());
  insert(theirs, new Set(), ours);
  return result;
}

/** Ids an element or relation refers to: its string fields and lists of strings, apart from its own. */
function referencesOf(item: Record_): string[] {
  return Object.entries(item).flatMap(([field, value]) => {
    if (field === 'id' || field === 'kind' || field === 'expression' || field === 'name' || field === 'text') return [];
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
    return [];
  });
}

/** A merged sketch without what refers to elements no side kept (deleted on one side, used on the other). */
function withoutDangling(sketch: Record<string, unknown>, sides: readonly Record_[]): Record_ {
  const known = new Set(sides.flatMap((side) => (Array.isArray(side['entities']) ? (side['entities'] as Record_[]).map((e) => String(e['id'])) : [])));
  let entities = (sketch['entities'] as Record_[] | undefined) ?? [];
  let constraints = (sketch['constraints'] as Record_[] | undefined) ?? [];
  for (;;) {
    const present = new Set(entities.map((e) => String(e['id'])));
    const gone = (item: Record_) => referencesOf(item).some((id) => known.has(id) && !present.has(id));
    const next = entities.filter((e) => !gone(e));
    constraints = constraints.filter((c) => !gone(c));
    if (next.length === entities.length) break;
    entities = next;
  }
  return { ...sketch, ...(sketch['entities'] ? { entities } : {}), ...(sketch['constraints'] ? { constraints } : {}) };
}
