import { facesOf } from '@core/access/shape';
import type { NamedShape } from '@core/access/shape';
import type { PlaneFrame, Vec3 } from '@core/contracts';
import { drawRectangle, measureVolume, type Shape3D } from 'replicad';
import { type Combined, type LoadedBody, renameCopy } from './bodies';
import { length3, sub3, toPlane } from './geometry';
import { nameShape, namedSurfaces } from './naming';
import { cut, fuse, intersect } from './booleans';

/** A failure the user can act on, reported as the feature's error. */
export class BodyOperationError extends Error {}

const emptyVolume = 1e-9;
const isEmpty = (shape: Shape3D) => facesOf(shape).length === 0 || measureVolume(shape) < emptyVolume;

function find(bodies: readonly LoadedBody[], id: string): LoadedBody {
  const body = bodies.find((b) => b.state.id === id);
  if (!body) throw new BodyOperationError(`Body ${id} is missing at this point of the timeline.`);
  return body;
}

/**
 * Joins tool bodies into a target body, or cuts them from it, or keeps only where they overlap it. The
 * tools are used up unless `keepTools`. Faces keep the names of the bodies they come from.
 */
export function combineBodies(
  bodies: readonly LoadedBody[],
  targetId: string,
  toolIds: readonly string[],
  operation: 'join' | 'cut' | 'intersect',
  keepTools: boolean,
  feature: string,
  key: string,
): Combined {
  const target = find(bodies, targetId);
  const tools = toolIds.filter((id) => id !== targetId).map((id) => find(bodies, id));
  if (!tools.length) throw new BodyOperationError('Select at least one body to combine with the target.');
  let shape = target.named.shape;
  for (const tool of tools) {
    shape = operation === 'join' ? fuse(shape, tool.named.shape) : operation === 'cut' ? cut(shape, tool.named.shape) : intersect(shape, tool.named.shape);
  }
  if (isEmpty(shape)) throw new BodyOperationError('Nothing of the target would be left.');
  const candidates = [target, ...tools].flatMap((b) => namedSurfaces(b.named));
  const state = { id: target.state.id, key: `${key}:${target.state.id}` };
  const used = new Set(keepTools ? [] : tools);
  return {
    bodies: bodies.filter((b) => !used.has(b)).map((b) => (b === target ? state : b.state)),
    stored: [[state.key, nameShape(shape, candidates, () => undefined, feature)]],
  };
}

/**
 * Splits a body by a plane: the piece on the side the plane's normal points to keeps the body's id,
 * the other becomes a new body named after the feature. The cut faces are `f:<feature>:split`.
 */
export function splitBody(bodies: readonly LoadedBody[], bodyId: string, frame: PlaneFrame, feature: string, key: string): Combined {
  const body = find(bodies, bodyId);
  const shape = body.named.shape;
  const [low, high] = shape.boundingBox.bounds as [Vec3, Vec3];
  const center: Vec3 = [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2];
  // A box on the normal side of the plane, large enough to hold the whole body.
  const size = 2 * (length3(sub3(high, low)) + length3(sub3(center, frame.origin))) + 10;
  const half = drawRectangle(size, size).sketchOnPlane(toPlane(frame)).extrude(size) as Shape3D;
  const front = intersect(shape, half);
  const back = cut(shape, half);
  if (isEmpty(front) || isEmpty(back)) throw new BodyOperationError('The plane does not cut through the body.');
  const candidates = namedSurfaces(body.named);
  const name = (piece: Shape3D) => nameShape(piece, candidates, () => `f:${feature}:split`, feature);
  const kept = { id: body.state.id, key: `${key}:${body.state.id}` };
  const added = { id: feature, key: `${key}:${feature}` };
  const result = bodies.flatMap((b) => (b === body ? [kept, added] : [b.state]));
  return { bodies: result, stored: [[kept.key, name(front)], [added.key, name(back)]] };
}

/**
 * Moves (or copies) bodies by a transform that keeps their shape. Faces keep their names: the body
 * moves as a whole. Copies become new bodies `<feature>`, `<feature>:2`, …
 */
export function transformBodies(
  bodies: readonly LoadedBody[],
  ids: readonly string[],
  transform: (shape: Shape3D) => Shape3D,
  copy: boolean,
  feature: string,
  key: string,
): Combined {
  const chosen = ids.map((id) => find(bodies, id));
  if (!chosen.length) throw new BodyOperationError('Select at least one body.');
  const stored: [string, NamedShape][] = [];
  const moved = new Map<LoadedBody, { id: string; key: string }>();
  chosen.forEach((body, i) => {
    const id = copy ? (i === 0 ? feature : `${feature}:${i + 1}`) : body.state.id;
    const state = { id, key: `${key}:${id}` };
    stored.push([state.key, renameCopy(body.named, transform(body.named.shape.clone()), '')]);
    moved.set(body, state);
  });
  const result = copy ? [...bodies.map((b) => b.state), ...moved.values()] : bodies.map((b) => moved.get(b) ?? b.state);
  return { bodies: result, stored };
}
