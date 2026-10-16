import { edgesOf, facesOf } from '@core/access/shape';
import type { NamedShape } from '@core/access/shape';
import type { BodyOperation } from '@core/contracts';
import { measureVolume, type Shape3D } from 'replicad';
import type { BodyState } from './modeling-engine';
import { nameShape, namedSurfaces } from './naming';
import { cut, fuse, intersect } from './booleans';

/** A body with its shape loaded from Shape Access. */
export interface LoadedBody {
  readonly state: BodyState;
  readonly named: NamedShape;
}

export interface Combined {
  readonly bodies: BodyState[];
  /** New shapes to store, by key. */
  readonly stored: [string, NamedShape][];
}

const emptyVolume = 1e-9;
const isEmpty = (shape: Shape3D) => facesOf(shape).length === 0 || measureVolume(shape) < emptyVolume;

function overlaps(a: Shape3D, b: Shape3D): boolean {
  return !a.boundingBox.isOut(b.boundingBox);
}

/** The feature's id for its first new body, then `<feature>:2`, `:3`, … without gaps (CAD-104). */
function freeId(bodies: readonly LoadedBody[], feature: string): string {
  const taken = new Set(bodies.map((b) => b.state.id));
  if (!taken.has(feature)) return feature;
  let n = 2;
  while (taken.has(`${feature}:${n}`)) n++;
  return `${feature}:${n}`;
}

/** Copies a named shape's names onto a transformed copy (transforms keep the topology order). */
export function renameCopy(source: NamedShape, copy: Shape3D, suffix: string): NamedShape {
  const map = (from: readonly { hashCode: number }[], to: readonly { hashCode: number }[], names: ReadonlyMap<number, string>) =>
    new Map(to.flatMap((element, i): [number, string][] => {
      const name = names.get((from[i] as { hashCode: number }).hashCode);
      return name ? [[element.hashCode, `${name}${suffix}`]] : [];
    }));
  return { shape: copy, faces: map(facesOf(source.shape), facesOf(copy), source.faces), edges: map(edgesOf(source.shape), edgesOf(copy), source.edges) };
}

/**
 * Combines a tool solid with the bodies it touches: a new body, joined into the first touched body,
 * cut from or intersected with every touched body. A join that touches nothing starts a new body.
 */
export function combine(bodies: readonly LoadedBody[], tool: NamedShape, operation: BodyOperation, feature: string, key: string): Combined {
  const touched = bodies.filter((b) => overlaps(b.named.shape, tool.shape));
  const keep = (b: LoadedBody) => b.state;
  const toolSurfaces = namedSurfaces(tool, 'tool');

  if (operation === 'new-body' || (operation === 'join' && touched.length === 0)) {
    const id = freeId(bodies, feature);
    const named = renameCopy(tool, tool.shape.clone(), '');
    const state = { id, key: `${key}:${id}` };
    return { bodies: [...bodies.map(keep), state], stored: [[state.key, named]] };
  }

  if (operation === 'join') {
    const [first, ...others] = touched as [LoadedBody, ...LoadedBody[]];
    let shape = fuse(first.named.shape, tool.shape);
    for (const other of others) shape = fuse(shape, other.named.shape);
    const candidates = [...touched.flatMap((b) => namedSurfaces(b.named)), ...toolSurfaces];
    const state = { id: first.state.id, key: `${key}:${first.state.id}` };
    const order = bodies.filter((b) => !others.includes(b)).map((b) => (b === first ? state : b.state));
    return { bodies: order, stored: [[state.key, nameShape(shape, candidates, () => undefined, feature)]] };
  }

  const stored: [string, NamedShape][] = [];
  const result: BodyState[] = [];
  for (const body of bodies) {
    if (!touched.includes(body)) {
      result.push(body.state);
      continue;
    }
    const shape = operation === 'cut' ? cut(body.named.shape, tool.shape) : intersect(body.named.shape, tool.shape);
    if (isEmpty(shape)) continue; // the whole body was removed
    const state = { id: body.state.id, key: `${key}:${body.state.id}` };
    stored.push([state.key, nameShape(shape, [...namedSurfaces(body.named), ...toolSurfaces], () => undefined, feature)]);
    result.push(state);
  }
  return { bodies: result, stored };
}
