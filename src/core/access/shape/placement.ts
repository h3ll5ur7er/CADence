import type { Matrix4 } from '@core/contracts';
import { getOC, type Shape3D } from 'replicad';
import { adopt } from './topology';

/**
 * The shape moved by a rigid transform (column-major 4 × 4); the original stays as it is. A move
 * becomes a location on the same geometry, a mirror a transformed copy. The builder is freed here:
 * replicad's `Transformation.transform` keeps it, with a copy of the geometry, in the kernel's memory,
 * which filled it during collision checks of large assemblies (CAD-114).
 */
export function place(shape: Shape3D, transform: Matrix4): Shape3D {
  const oc = getOC();
  const m = (i: number) => transform[i] as number;
  const trsf = new oc.gp_Trsf();
  trsf.SetValues(m(0), m(4), m(8), m(12), m(1), m(5), m(9), m(13), m(2), m(6), m(10), m(14));
  const builder = new oc.BRepBuilderAPI_Transform(shape.wrapped, trsf, false, false);
  try {
    return adopt(builder.Shape()) as Shape3D;
  } finally {
    builder.delete();
    trsf.delete();
  }
}
