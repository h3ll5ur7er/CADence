import { type AnyShape, cast, type Edge, type Face, getOC } from 'replicad';

const hashBound = 2147483647;

/**
 * The faces or edges of a shape, each once, in the kernel's topological order: the same as replicad's
 * `shape.faces` and `shape.edges`. Those compare every element with all before it, which is quadratic
 * and took seconds on parts with hundreds of holes; this one compares only elements of equal hash (CAD-94).
 */
function unique(shape: AnyShape, kind: 'face' | 'edge'): AnyShape[] {
  const oc = getOC();
  const types = oc.TopAbs_ShapeEnum;
  const explorer = new oc.TopExp_Explorer(shape.wrapped, kind === 'face' ? types.TopAbs_FACE : types.TopAbs_EDGE, types.TopAbs_SHAPE);
  const seen = new Map<number, (typeof shape.wrapped)[]>();
  const found: AnyShape[] = [];
  try {
    while (explorer.More()) {
      const item = explorer.Current();
      const hash = oc.ReplicadShapeHasher.HashCode(item, hashBound);
      const bucket = seen.get(hash);
      if (!bucket?.some((s) => s.IsSame(item))) {
        if (bucket) bucket.push(item);
        else seen.set(hash, [item]);
        found.push(cast(item));
      }
      explorer.Next();
    }
  } finally {
    explorer.delete();
  }
  return found;
}

export const facesOf = (shape: AnyShape): Face[] => unique(shape, 'face') as Face[];
export const edgesOf = (shape: AnyShape): Edge[] => unique(shape, 'edge') as Edge[];
