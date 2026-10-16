import {
  defaultPart,
  type Feature,
  type FeatureType,
  generatorOf,
  isCurve,
  isRepeatable,
  isSketch,
  type PlaneRef,
  type Profile,
  type Sketch,
  type ProfileLoop,
  type TopologyRef,
} from '@core/contracts';
import type { DesignState } from '@core/managers/design';
import type { Pick, PickKind } from '../../viewport/picking';

/** Which kind of pick the dialog is waiting for, beyond its main selection. */
export type PickTarget = 'axis' | 'plane' | 'second';

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
  combine: 'Combine bodies',
  split: 'Split body',
  move: 'Move or copy bodies',
  scale: 'Scale bodies',
  loft: 'Loft',
  sweep: 'Sweep',
  'path-pattern': 'Pattern along a path',
  hole: 'Hole',
  part: 'Part',
  thread: 'Thread',
  draft: 'Draft',
  rib: 'Rib',
  'base-flange': 'Base flange',
  'edge-flange': 'Edge flange',
};

/** Points of a sketch that no curve uses: where holes go. */
export function holePoints(sketch: Sketch | undefined): string[] {
  if (!sketch) return [];
  const used = new Set(sketch.entities.flatMap((e) => (isCurve(e) ? references(e) : e.kind === 'text' ? [e.anchor] : e.kind === 'drawing' ? [e.origin, e.handle] : [])));
  return sketch.entities.filter((e) => e.kind === 'point' && !used.has(e.id) && !generatorOf(sketch, e.id)).map((e) => e.id);
}

const references = (e: Exclude<Sketch['entities'][number], { kind: 'point' }>): string[] => {
  switch (e.kind) {
    case 'line':
      return [e.start, e.end];
    case 'circle':
      return [e.center];
    case 'arc':
      return [e.center, e.start, e.end];
    case 'ellipse':
      return [e.center, e.major];
    case 'spline':
      return [...e.points];
    default:
      return [];
  }
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
  // New features go in at the rollback marker: only what comes before it can be used.
  const { timeline, rollbackIndex } = state.document;
  const active = timeline.slice(0, timeline.length - rollbackIndex);
  const sketches = active.filter(isSketch).filter((s) => (state.sketches.get(s.id)?.profiles.length ?? 0) > 0);
  const sketch = sketches.at(-1);
  const profiles = sketch ? solidProfiles(state.sketches.get(sketch.id)?.profiles ?? []) : [];
  const operation = state.bodies.length ? ('join' as const) : ('new-body' as const);
  const lastTool = active.filter(isRepeatable).at(-1);
  const bodyIds = state.bodies.map((b) => b.body);
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
    case 'combine':
      return { ...base, type, target: bodyIds[0] ?? '', tools: bodyIds.slice(1, 2), operation: 'join', keepTools: false };
    case 'split':
      return { ...base, type, body: bodyIds[0] ?? '', plane: 'XY' };
    case 'move':
      return { ...base, type, bodies: bodyIds.slice(-1), translate: ['10', '0', '0'], axis: { kind: 'origin', axis: 'Z' }, angle: '0 deg', copy: false };
    case 'scale':
      return { ...base, type, bodies: bodyIds.slice(-1), factor: '2' };
    case 'loft': {
      // The first outline of each of the two latest sketches.
      const sections = sketches.slice(-2).map((s) => ({ sketch: s.id, profile: solidProfiles(state.sketches.get(s.id)?.profiles ?? [])[0] ?? '' }));
      return { ...base, type, sections, ruled: false, operation };
    }
    case 'sweep': {
      // The profiles of the latest sketch with profiles, along the curves of the latest other sketch.
      const path = active.filter(isSketch).filter((s) => s.id !== sketch?.id).at(-1);
      return { ...base, type, sketch: sketch?.id ?? '', profiles, path: path?.id ?? '', operation };
    }
    case 'path-pattern': {
      const path = active.filter(isSketch).at(-1);
      return { ...base, type, features: tools, path: path?.id ?? '', count: '4', align: false };
    }
    case 'hole': {
      // The latest sketch with points of their own.
      const holeSketch = active.filter(isSketch).filter((s) => holePoints(state.sketches.get(s.id)?.sketch).length > 0).at(-1);
      const points = holePoints(holeSketch && state.sketches.get(holeSketch.id)?.sketch);
      return {
        ...base,
        type,
        sketch: holeSketch?.id ?? '',
        points,
        kind: 'simple',
        diameter: '5',
        extent: 'through',
        depth: '10',
        boreDiameter: '9',
        boreDepth: '3',
        sinkDiameter: '10',
        sinkAngle: '90 deg',
        teardrop: false,
        bridge: false,
      };
    }
    case 'part': {
      // Like holes: at the points of the latest sketch with points of their own.
      const partSketch = active.filter(isSketch).filter((s) => holePoints(state.sketches.get(s.id)?.sketch).length > 0).at(-1);
      const points = holePoints(partSketch && state.sketches.get(partSketch.id)?.sketch);
      return { ...base, type, part: defaultPart('screw'), sketch: partSketch?.id ?? '', points, angle: '0 deg', flip: false, operation: state.bodies.length ? 'join' : 'new-body' };
    }
    case 'thread':
      return { ...base, type, face: { kind: 'face', body: '', name: '' }, size: 'M6', length: '', modelled: false, flip: false };
    case 'draft':
      return { ...base, type, faces: [], plane: 'XY', angle: '3 deg' };
    case 'base-flange':
      return { ...base, type, sketch: sketch?.id ?? '', profiles, direction: 'normal', thickness: '2 mm', bendRadius: '2 mm', kFactor: '0.44' };
    case 'edge-flange':
      return { ...base, type, edges: [], length: '20', angle: '90 deg' };
    case 'rib': {
      const ribSketch = active.filter(isSketch).at(-1);
      return { ...base, type, sketch: ribSketch?.id ?? '', thickness: '2', depth: '10', direction: 'normal' };
    }
  }
}

const refOf = (pick: Extract<Pick, { kind: 'face' | 'edge' | 'vertex' }>): TopologyRef => ({ kind: pick.kind, body: pick.body, name: pick.name, hint: pick.hint });
const pickOf = (ref: TopologyRef): Pick =>
  ref.kind === 'face'
    ? { kind: 'face', body: ref.body, name: ref.name, hint: ref.hint ?? [0, 0, 0], planar: true }
    : { kind: ref.kind, body: ref.body, name: ref.name, hint: ref.hint ?? [0, 0, 0] };
const toggle = <T>(list: readonly T[], item: T, same: (a: T, b: T) => boolean): T[] =>
  list.some((x) => same(x, item)) ? list.filter((x) => !same(x, item)) : [...list, item];
const sameRef = (a: TopologyRef, b: TopologyRef) => a.body === b.body && a.name === b.name;

/** What clicks in the 3D view may pick while this draft is open. */
export function pickableFor(draft: FeatureDraft | undefined): ReadonlySet<PickKind> {
  if (!draft) return new Set<PickKind>(['face']);
  const f = draft.feature;
  if (draft.target === 'axis') return new Set<PickKind>(['edge']);
  if (draft.target === 'plane' || draft.target === 'second') return new Set<PickKind>(['face']);
  if (f.type === 'plane' && f.mode === 'points') return new Set<PickKind>(['vertex']);
  switch (f.type) {
    case 'extrude':
    case 'revolve':
    case 'loft':
    case 'sweep':
    case 'base-flange':
      return new Set<PickKind>(['profile']);
    case 'edge-flange':
      return new Set<PickKind>(['edge']);
    case 'fillet':
    case 'chamfer':
      return new Set<PickKind>(['edge']);
    case 'shell':
    case 'draft':
    case 'thread':
    case 'combine':
    case 'split':
    case 'move':
    case 'scale':
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
      if (f.mode === 'points') return f.points.map(pickOf);
      return [...planeFace(f.base), ...(f.mode === 'midplane' ? planeFace(f.second) : []), ...(f.mode === 'angle' && f.axis.kind === 'edge' ? [pickOf(f.axis.edge)] : [])];
    case 'mirror':
      return planeFace(f.plane);
    case 'linear-pattern':
      return f.direction.kind === 'edge' ? [pickOf(f.direction.edge)] : [];
    case 'circular-pattern':
      return f.axis.kind === 'edge' ? [pickOf(f.axis.edge)] : [];
    case 'split':
      return planeFace(f.plane);
    case 'move':
      return f.axis.kind === 'edge' ? [pickOf(f.axis.edge)] : [];
    case 'base-flange':
      return f.profiles.map((profile): Pick => ({ kind: 'profile', sketch: f.sketch, profile }));
    case 'edge-flange':
      return f.edges.map(pickOf);
    case 'loft':
      return f.sections.map((s): Pick => ({ kind: 'profile', sketch: s.sketch, profile: s.profile }));
    case 'sweep':
      return f.profiles.map((profile): Pick => ({ kind: 'profile', sketch: f.sketch, profile }));
    case 'thread':
      return f.face.name ? [pickOf(f.face)] : [];
    case 'draft':
      return [...f.faces.map(pickOf), ...planeFace(f.plane)];
    case 'rib':
      return [];
    case 'insert':
    case 'combine':
    case 'scale':
    case 'path-pattern':
    case 'hole':
    case 'part':
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
    if (f.type === 'move') return { mode: draft.mode, feature: { ...f, axis: edge } };
    if (f.type === 'plane' && f.mode === 'angle') return { mode: draft.mode, feature: { ...f, axis: edge } };
  }
  if (draft.target === 'second' && pick.kind === 'face' && pick.planar && f.type === 'plane' && f.mode === 'midplane') {
    return { mode: draft.mode, feature: { ...f, second: { face: refOf(pick) } } };
  }
  if (draft.target === 'plane' && pick.kind === 'face' && pick.planar) {
    const face = { face: refOf(pick) };
    if (f.type === 'plane' && f.mode !== 'points') return { mode: draft.mode, feature: { ...f, base: face } };
    if (f.type === 'mirror') return { mode: draft.mode, feature: { ...f, plane: face } };
    if (f.type === 'split') return { mode: draft.mode, feature: { ...f, plane: face } };
    if (f.type === 'draft') return { mode: draft.mode, feature: { ...f, plane: face } };
  }
  switch (f.type) {
    case 'extrude':
    case 'revolve': {
      if (pick.kind !== 'profile') return draft;
      const profiles = pick.sketch === f.sketch ? toggle(f.profiles, pick.profile, (a, b) => a === b) : [pick.profile];
      return { ...draft, feature: { ...f, sketch: pick.sketch, profiles } };
    }
    case 'edge-flange':
      return pick.kind === 'edge' ? { ...draft, feature: { ...f, edges: toggle(f.edges, refOf(pick), sameRef) } } : draft;
    case 'base-flange':
    case 'sweep': {
      if (pick.kind !== 'profile') return draft;
      const profiles = pick.sketch === f.sketch ? toggle(f.profiles, pick.profile, (a, b) => a === b) : [pick.profile];
      return { ...draft, feature: { ...f, sketch: pick.sketch, profiles } };
    }
    case 'loft': {
      // One section per sketch: picking a profile of a sketch already in the loft swaps it, or removes it when it is the same.
      if (pick.kind !== 'profile') return draft;
      const index = f.sections.findIndex((s) => s.sketch === pick.sketch);
      const section = { sketch: pick.sketch, profile: pick.profile };
      const sections =
        index < 0
          ? [...f.sections, section]
          : f.sections[index]?.profile === pick.profile
            ? f.sections.filter((_, i) => i !== index)
            : f.sections.map((s, i) => (i === index ? section : s));
      return { ...draft, feature: { ...f, sections } };
    }
    case 'fillet':
    case 'chamfer':
      return pick.kind === 'edge' ? { ...draft, feature: { ...f, edges: toggle(f.edges, refOf(pick), sameRef) } } : draft;
    case 'shell':
      return pick.kind === 'face' ? { ...draft, feature: { ...f, faces: toggle(f.faces, refOf(pick), sameRef) } } : draft;
    case 'plane': {
      if (f.mode !== 'points' || pick.kind !== 'vertex') return draft;
      const points = toggle(f.points, refOf(pick), sameRef);
      return points.length <= 3 ? { ...draft, feature: { ...f, points } } : draft;
    }
    case 'thread':
      return pick.kind === 'face' ? { ...draft, feature: { ...f, face: refOf(pick) } } : draft;
    case 'draft':
      return pick.kind === 'face' ? { ...draft, feature: { ...f, faces: toggle(f.faces, refOf(pick), sameRef) } } : draft;
    // Clicking a body picks it: the body to split, or one more (or one less) to combine, move or scale.
    case 'split':
      return pick.kind === 'face' ? { ...draft, feature: { ...f, body: pick.body } } : draft;
    case 'combine':
      return pick.kind === 'face' && pick.body !== f.target ? { ...draft, feature: { ...f, tools: toggle(f.tools, pick.body, (a, b) => a === b) } } : draft;
    case 'move':
    case 'scale':
      return pick.kind === 'face' ? { ...draft, feature: { ...f, bodies: toggle(f.bodies, pick.body, (a, b) => a === b) } } : draft;
    default:
      return draft;
  }
}
