import type { Measurement, Vec3 } from '@core/contracts';
import { type Edge, type Face, getOC, measureArea, measureLength } from 'replicad';

type Element = Face | Edge;

const isFace = (element: Element): element is Face => 'normalAt' in element;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** Everything that can be measured on the picked elements: totals for one or many, relations for two. */
export function measureElements(elements: readonly Element[]): Measurement {
  const faces = elements.filter(isFace);
  const edges = elements.filter((e): e is Edge => !isFace(e));
  const [first, second] = elements;
  const radius = elements.length === 1 && first ? radiusOf(first) : undefined;
  const between = elements.length === 2 && first && second ? relation(first, second) : {};
  return {
    ...(faces.length ? { area: faces.reduce((sum, f) => sum + measureArea(f), 0) } : {}),
    ...(edges.length ? { length: edges.reduce((sum, e) => sum + measureLength(e), 0) } : {}),
    ...(radius === undefined ? {} : { radius }),
    ...between,
  };
}

function radiusOf(element: Element): number | undefined {
  const oc = getOC();
  if (isFace(element)) {
    if (element.geomType !== 'CYLINDRE' && element.geomType !== 'SPHERE') return undefined;
    const surface = new oc.BRepAdaptor_Surface(element.wrapped, false);
    try {
      return element.geomType === 'CYLINDRE' ? surface.Cylinder().Radius() : surface.Sphere().Radius();
    } finally {
      surface.delete();
    }
  }
  if (element.geomType !== 'CIRCLE') return undefined;
  const curve = new oc.BRepAdaptor_Curve(element.wrapped);
  try {
    return curve.Circle().Radius();
  } finally {
    curve.delete();
  }
}

/** Shortest distance with its closest points, and the angle when both have a direction. */
function relation(a: Element, b: Element): Pick<Measurement, 'distance' | 'points' | 'angle'> {
  const tool = new (getOC().BRepExtrema_DistShapeShape)();
  let distance: Pick<Measurement, 'distance' | 'points'> = {};
  try {
    tool.LoadS1(a.wrapped);
    tool.LoadS2(b.wrapped);
    tool.Perform();
    if (tool.IsDone() && tool.NbSolution() > 0) {
      const p = tool.PointOnShape1(1);
      const q = tool.PointOnShape2(1);
      distance = { distance: tool.Value(), points: [[p.X(), p.Y(), p.Z()], [q.X(), q.Y(), q.Z()]] };
      p.delete();
      q.delete();
    }
  } finally {
    tool.delete();
  }
  const da = directionOf(a);
  const db = directionOf(b);
  if (!da || !db) return distance;
  // Two normals or two lines: the angle between them; a normal and a line: the line's angle to the plane.
  const cosine = Math.min(1, Math.abs(dot(da.vector, db.vector)));
  const angle = da.kind === db.kind ? Math.acos(cosine) : Math.asin(cosine);
  return { ...distance, angle };
}

function directionOf(element: Element): { kind: 'normal' | 'line'; vector: Vec3 } | undefined {
  if (isFace(element)) {
    return element.geomType === 'PLANE' ? { kind: 'normal', vector: unit(element.normalAt(element.center).toTuple() as Vec3) } : undefined;
  }
  return element.geomType === 'LINE' ? { kind: 'line', vector: unit(element.tangentAt(0).toTuple() as Vec3) } : undefined;
}
