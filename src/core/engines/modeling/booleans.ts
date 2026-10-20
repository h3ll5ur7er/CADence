import { adopt } from '@core/access/shape';
import { getOC, makeCompound, measureVolume, type Shape3D } from 'replicad';

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
export function solidsOf(shape: Shape3D): Shape3D[] {
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

/** A solid of less (mm³) is a sliver a boolean left where faces nearly touch, not something made (CAD-141). */
const sliver = 1e-4;

/**
 * The shape without the slivers beside it, or undefined when it has none. A cut that grazes an edge
 * can leave solids of no volume next to the result, and one of them may be invalid (CAD-141).
 */
export function withoutSlivers(shape: Shape3D): Shape3D | undefined {
  if (shape.wrapped.ShapeType() !== getOC().TopAbs_ShapeEnum.TopAbs_COMPOUND) return undefined;
  const solids = solidsOf(shape);
  const kept = solids.filter((solid) => Math.abs(measureVolume(solid)) > sliver);
  if (kept.length === solids.length || !kept.length) {
    for (const solid of solids) if (solid !== shape) solid.delete();
    return undefined;
  }
  for (const solid of solids) if (!kept.includes(solid)) solid.delete();
  return kept.length === 1 ? kept[0] : (makeCompound(kept) as unknown as Shape3D);
}

/** Tolerances (mm) for a second and third try, when touching faces leave the exact result invalid. */
const fuzzyValues = [0, 1e-5, 1e-4];

/** The simplified and the raw result of one boolean, then each without slivers; nothing when the kernel failed. */
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
    const results = [adopt(builder.Shape()) as Shape3D, raw];
    return [...results, ...results.flatMap((result) => withoutSlivers(result) ?? [])];
  } finally {
    builder.delete();
    objects.delete();
    others.delete();
  }
}

/**
 * Whether a result's volume fits the operation: 'doubtful' when it may be right but likely is not.
 * Touching faces can also give a valid solid that is wrong: a pad tangent to two faces of a drum fused
 * into a third of the drum.
 */
function plausibleVolume(operation: Operation, shape: Shape3D, tools: readonly Shape3D[]): (result: Shape3D) => boolean | 'doubtful' {
  const before = measureVolume(shape);
  const added = tools.reduce((sum, tool) => sum + measureVolume(tool), 0);
  const slack = 1e-6 * (before + added) + 1e-9;
  // Bodies whose boxes overlap deeply mostly share something: an empty common of them can be the
  // kernel failing on faces that lie on one surface (a gear's tips on a cylinder of the tip diameter,
  // CAD-137), which a fuzzy tolerance gets right; or it is right (a planet's teeth in a ring's spaces).
  const overlap = operation === 'common' && tools.every((tool) => boxesOverlap(shape, tool));
  return (result) => {
    const after = measureVolume(result);
    if (operation === 'fuse') return after >= before - slack && after <= before + added + slack;
    if (operation === 'cut') return after <= before + slack && after >= before - added - slack;
    if (after > Math.min(before, added) + slack) return false;
    return overlap && after <= slack ? 'doubtful' : true;
  };
}

/** Whether two shapes' boxes overlap by more than a tenth of the smaller one in every direction. */
function boxesOverlap(a: Shape3D, b: Shape3D): boolean {
  const [[al, ah], [bl, bh]] = [a.boundingBox.bounds, b.boundingBox.bounds] as [[number[], number[]], [number[], number[]]];
  return [0, 1, 2].every((i) => {
    const shared = Math.min(ah[i] as number, bh[i] as number) - Math.max(al[i] as number, bl[i] as number);
    return shared > 0.1 * Math.min((ah[i] as number) - (al[i] as number), (bh[i] as number) - (bl[i] as number));
  });
}

/**
 * A boolean of a solid with tools, simplified (faces and edges on one surface merged) when that keeps
 * the solid valid. replicad always simplifies, and merging can break a valid result: a pad whose end
 * touches a revolved body's cylinder came out "not a valid solid" for some diameters (CAD-103). When
 * no result is right, the boolean is tried again with a small fuzzy tolerance, then tool by tool; a
 * doubtful result is taken only when no try gives a better one.
 */
function boolean(operation: Operation, shape: Shape3D, given: readonly Shape3D[]): Shape3D {
  // A compound of tools (pattern copies) counts as its solids, so they can be tried one by one too.
  const tools = given.flatMap(solidsOf);
  const plausible = plausibleVolume(operation, shape, tools);
  let doubtful: Shape3D | undefined;
  for (const fuzzy of fuzzyValues) {
    const built = build(operation, shape, tools, fuzzy);
    const results = built.filter(valid);
    const found = results.find((result) => plausible(result) === true);
    doubtful ??= found ? undefined : results.find((result) => plausible(result) === 'doubtful');
    for (const result of built) if (result !== found && result !== doubtful) result.delete();
    if (found) {
      doubtful?.delete();
      return found;
    }
  }
  if (doubtful) return doubtful;
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
