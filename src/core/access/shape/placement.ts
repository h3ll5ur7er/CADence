import type { Matrix4 } from '@core/contracts';
import { cast, getOC, type Shape3D, Transformation } from 'replicad';

/** A copy of the shape moved by a rigid transform (column-major 4 × 4); the original stays as it is. */
export function place(shape: Shape3D, transform: Matrix4): Shape3D {
  const m = (i: number) => transform[i] as number;
  const trsf = new (getOC().gp_Trsf)();
  trsf.SetValues(m(0), m(4), m(8), m(12), m(1), m(5), m(9), m(13), m(2), m(6), m(10), m(14));
  const transformation = new Transformation(trsf);
  try {
    return cast(transformation.transform(shape.wrapped)) as Shape3D;
  } finally {
    transformation.delete();
  }
}
