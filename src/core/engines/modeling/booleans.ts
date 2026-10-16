import { adopt } from '@core/access/shape';
import { getOC, measureVolume, type Shape3D } from 'replicad';

type Operation = 'fuse' | 'cut' | 'common';

/** OpenCascade's topology and geometry check. */
export function valid(shape: Shape3D): boolean {
  const analyzer = new (getOC().BRepCheck_Analyzer)(shape.wrapped, true, false);
  try {
    return analyzer.IsValid();
  } finally {
    analyzer.delete();
  }
}

/** A boolean the kernel could not do right, in words for the user. */
export class BooleanError extends Error {}

/** The solids of a shape: itself, or those of a compound. */
function solidsOf(shape: Shape3D): Shape3D[] {
  const oc = getOC();
  if (shape.wrapped.ShapeType() !== oc.TopAbs_ShapeEnum.TopAbs_COMPOUND) return [shape];
  const solids: Shape3D[] = [];
  const explorer = new oc.TopExp_Explorer(shape.wrapped, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    for (; explorer.More(); explorer.Next()) solids.push(adopt(explorer.Current()) as Shape3D);
  } finally {
    explorer.delete();
  }
  return solids.length ? solids : [shape];
}

/** Tolerances (mm) for a second and third try, when touching faces leave the exact result invalid. */
const fuzzyValues = [0, 1e-5, 1e-4];

/** The raw and the simplified result of one boolean, or nothing when the kernel failed. */
function build(operation: Operation, shape: Shape3D, tools: readonly Shape3D[], fuzzy: number): Shape3D[] {
  const oc = getOC();
  const builder = operation === 'fuse' ? new oc.BRepAlgoAPI_Fuse() : operation === 'cut' ? new oc.BRepAlgoAPI_Cut() : new oc.BRepAlgoAPI_Common();
  const objects = new oc.NCollection_List_TopoDS_Shape([shape.wrapped]);
  const others = new oc.NCollection_List_TopoDS_Shape(tools.map((t) => t.wrapped));
  try {
    builder.SetArguments(objects);
    builder.SetTools(others);
    if (fuzzy) builder.SetFuzzyValue(fuzzy);
    builder.Build();
    if (!builder.IsDone() || builder.HasErrors()) return [];
    const raw = adopt(builder.Shape()) as Shape3D;
    builder.SimplifyResult(true, true, 0.001);
    return [adopt(builder.Shape()) as Shape3D, raw];
  } finally {
    builder.delete();
    objects.delete();
    others.delete();
  }
}

/**
 * Whether a result's volume fits the operation. Touching faces can also give a valid solid that is
 * wrong: a pad tangent to two faces of a drum fused into a third of the drum.
 */
function plausibleVolume(operation: Operation, shape: Shape3D, tools: readonly Shape3D[]): (result: Shape3D) => boolean {
  const before = measureVolume(shape);
  const added = tools.reduce((sum, tool) => sum + measureVolume(tool), 0);
  const slack = 1e-6 * (before + added) + 1e-9;
  return (result) => {
    const after = measureVolume(result);
    if (operation === 'fuse') return after >= before - slack && after <= before + added + slack;
    if (operation === 'cut') return after <= before + slack && after >= before - added - slack;
    return after <= Math.min(before, added) + slack;
  };
}

/**
 * A boolean of a solid with tools, simplified (faces and edges on one surface merged) when that keeps
 * the solid valid. replicad always simplifies, and merging can break a valid result: a pad whose end
 * touches a revolved body's cylinder came out "not a valid solid" for some diameters (CAD-103). When
 * no result is right, the boolean is tried again with a small fuzzy tolerance, then tool by tool.
 */
function boolean(operation: Operation, shape: Shape3D, given: readonly Shape3D[]): Shape3D {
  // A compound of tools (pattern copies) counts as its solids, so they can be tried one by one too.
  const tools = given.flatMap(solidsOf);
  const plausible = plausibleVolume(operation, shape, tools);
  for (const fuzzy of fuzzyValues) {
    const results = build(operation, shape, tools, fuzzy);
    const found = results.find((result) => valid(result) && plausible(result));
    for (const result of results) if (result !== found) result.delete();
    if (found) return found;
  }
  // Several tools at once can fail where one after the other works, and the other way round.
  if (tools.length > 1 && operation !== 'common') {
    return tools.reduce((current, tool) => {
      const next = boolean(operation, current, [tool]);
      if (current !== shape) current.delete();
      return next;
    }, shape);
  }
  throw new BooleanError('The result is not a valid solid. Try other values or references.');
}

export const fuse = (shape: Shape3D, ...tools: Shape3D[]): Shape3D => boolean('fuse', shape, tools);
export const cut = (shape: Shape3D, ...tools: Shape3D[]): Shape3D => boolean('cut', shape, tools);
export const intersect = (shape: Shape3D, tool: Shape3D): Shape3D => boolean('common', shape, [tool]);
