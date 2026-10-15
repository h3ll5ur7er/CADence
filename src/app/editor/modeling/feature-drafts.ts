import {
  type Feature,
  type FeatureType,
  isSketch,
  isToolFeature,
  type PlaneRef,
  type Profile,
  type ProfileLoop,
  type TopologyRef,
} from '@core/contracts';
import type { DesignState } from '@core/managers/design';
import type { Pick, PickKind } from '../../viewport/picking';

/** Which kind of pick the dialog is waiting for, beyond its main selection. */
export type PickTarget = 'axis' | 'plane';

/** A feature being created or edited in the dialog. */
export interface FeatureDraft {
  readonly mode: 'create' | 'edit';
  readonly feature: Feature;
  readonly target?: PickTarget;
}

export const featureLabels: Readonly<Record<FeatureType, string>> = {
  insert: 'Insert body',
  extrude: 'Extrude',
  revolve: 'Revolve',
  fillet: 'Fillet',
  chamfer: 'Chamfer',
  shell: 'Shell',
  plane: 'Construction plane',
  'linear-pattern': 'Linear pattern',
  'circular-pattern': 'Circular pattern',
  mirror: 'Mirror',
};

/** A loop by its pieces, whichever way round it runs: the curve each comes from and where it ends (a text's letters share one source). */
const loopKey = (loop: ProfileLoop) =>
  loop.edges
    .map((e) => `${e.source}@${[e.start, e.end].map((p) => p.map((v) => v.toFixed(3)).join(',')).sort().join(';')}`)
    .sort()
    .join('|');

/** All profiles except those that exactly fill a hole of another: a plate keeps its holes. */
export function solidProfiles(profiles: readonly Profile[]): string[] {
  const holes = new Set(profiles.flatMap((p) => p.holes.map(loopKey)));
  return profiles.filter((p) => !holes.has(loopKey(p.outer))).map((p) => p.id);
}

/** Sensible starting values: the latest sketch's profiles, the latest extrude/revolve to repeat, the first imported model, and so on. */
export function defaultFeature(type: FeatureType, id: string, state: DesignState, importedModels: readonly string[] = []): Feature {
  const base = { id, name: '', suppressed: false };
  const sketches = state.document.timeline.filter(isSketch).filter((s) => (state.sketches.get(s.id)?.profiles.length ?? 0) > 0);
  const sketch = sketches.at(-1);
  const profiles = sketch ? solidProfiles(state.sketches.get(sketch.id)?.profiles ?? []) : [];
  const operation = state.bodies.length ? ('join' as const) : ('new-body' as const);
  const lastTool = state.document.timeline.filter(isToolFeature).at(-1);
  const tools = lastTool ? [lastTool.id] : [];
  switch (type) {
    case 'insert':
      return { ...base, type, document: importedModels[0] ?? '' };
    case 'extrude':
      return { ...base, type, sketch: sketch?.id ?? '', profiles, distance: '10', direction: 'normal', operation };
    case 'revolve': {
      const axisLine = sketch?.entities.find((e) => e.kind === 'line' && e.construction);
      const axis = sketch && axisLine ? { kind: 'sketch-line' as const, sketch: sketch.id, line: axisLine.id } : { kind: 'origin' as const, axis: 'Y' as const };
      return { ...base, type, sketch: sketch?.id ?? '', profiles, axis, angle: '360 deg', operation };
    }
    case 'fillet':
    case 'chamfer':
      return { ...base, type, edges: [], size: '1' };
    case 'shell':
      return { ...base, type, faces: [], thickness: '2' };
    case 'plane':
      return { ...base, type, base: 'XY', offset: '10' };
    case 'linear-pattern':
      return { ...base, type, features: tools, direction: { kind: 'origin', axis: 'X' }, count: '3', spacing: '10' };
    case 'circular-pattern':
      return { ...base, type, features: tools, axis: { kind: 'origin', axis: 'Z' }, count: '4', angle: '360 deg' };
    case 'mirror':
      return { ...base, type, features: tools, plane: 'YZ' };
  }
}

const refOf = (pick: Extract<Pick, { kind: 'face' | 'edge' }>): TopologyRef => ({ kind: pick.kind, body: pick.body, name: pick.name, hint: pick.hint });
const pickOf = (ref: TopologyRef): Pick =>
  ref.kind === 'face'
    ? { kind: 'face', body: ref.body, name: ref.name, hint: ref.hint ?? [0, 0, 0], planar: true }
    : { kind: 'edge', body: ref.body, name: ref.name, hint: ref.hint ?? [0, 0, 0] };
const toggle = <T>(list: readonly T[], item: T, same: (a: T, b: T) => boolean): T[] =>
  list.some((x) => same(x, item)) ? list.filter((x) => !same(x, item)) : [...list, item];
const sameRef = (a: TopologyRef, b: TopologyRef) => a.body === b.body && a.name === b.name;

/** What clicks in the 3D view may pick while this draft is open. */
export function pickableFor(draft: FeatureDraft | undefined): ReadonlySet<PickKind> {
  if (!draft) return new Set<PickKind>(['face']);
  const f = draft.feature;
  if (draft.target === 'axis') return new Set<PickKind>(['edge']);
  if (draft.target === 'plane') return new Set<PickKind>(['face']);
  switch (f.type) {
    case 'extrude':
    case 'revolve':
      return new Set<PickKind>(['profile']);
    case 'fillet':
    case 'chamfer':
      return new Set<PickKind>(['edge']);
    case 'shell':
      return new Set<PickKind>(['face']);
    default:
      return new Set<PickKind>();
  }
}

/** The draft's references, shown as the selection in the 3D view. */
export function selectionOf(draft: FeatureDraft): Pick[] {
  const f = draft.feature;
  const planeFace = (ref: PlaneRef): Pick[] => (typeof ref === 'object' && 'face' in ref ? [pickOf(ref.face)] : []);
  switch (f.type) {
    case 'extrude':
    case 'revolve': {
      const axis = f.type === 'revolve' && f.axis.kind === 'edge' ? [pickOf(f.axis.edge)] : [];
      return [...f.profiles.map((profile): Pick => ({ kind: 'profile', sketch: f.sketch, profile })), ...axis];
    }
    case 'fillet':
    case 'chamfer':
      return f.edges.map(pickOf);
    case 'shell':
      return f.faces.map(pickOf);
    case 'plane':
      return planeFace(f.base);
    case 'mirror':
      return planeFace(f.plane);
    case 'linear-pattern':
      return f.direction.kind === 'edge' ? [pickOf(f.direction.edge)] : [];
    case 'circular-pattern':
      return f.axis.kind === 'edge' ? [pickOf(f.axis.edge)] : [];
    case 'insert':
      return [];
  }
}

/** The draft after a click in the 3D view. */
export function applyPick(draft: FeatureDraft, pick: Pick): FeatureDraft {
  const f = draft.feature;
  if (draft.target === 'axis' && pick.kind === 'edge') {
    const edge = { kind: 'edge' as const, edge: refOf(pick) };
    if (f.type === 'revolve') return { mode: draft.mode, feature: { ...f, axis: edge } };
    if (f.type === 'circular-pattern') return { mode: draft.mode, feature: { ...f, axis: edge } };
    if (f.type === 'linear-pattern') return { mode: draft.mode, feature: { ...f, direction: edge } };
  }
  if (draft.target === 'plane' && pick.kind === 'face' && pick.planar) {
    const face = { face: refOf(pick) };
    if (f.type === 'plane') return { mode: draft.mode, feature: { ...f, base: face } };
    if (f.type === 'mirror') return { mode: draft.mode, feature: { ...f, plane: face } };
  }
  switch (f.type) {
    case 'extrude':
    case 'revolve': {
      if (pick.kind !== 'profile') return draft;
      const profiles = pick.sketch === f.sketch ? toggle(f.profiles, pick.profile, (a, b) => a === b) : [pick.profile];
      return { ...draft, feature: { ...f, sketch: pick.sketch, profiles } };
    }
    case 'fillet':
    case 'chamfer':
      return pick.kind === 'edge' ? { ...draft, feature: { ...f, edges: toggle(f.edges, refOf(pick), sameRef) } } : draft;
    case 'shell':
      return pick.kind === 'face' ? { ...draft, feature: { ...f, faces: toggle(f.faces, refOf(pick), sameRef) } } : draft;
    default:
      return draft;
  }
}
