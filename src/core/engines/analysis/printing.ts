import { facesOf } from '@core/access/shape';
import type { NamedShape } from '@core/access/shape';
import type { Check, PrintProfile, TopologyRef, Vec3 } from '@core/contracts';
import { getOC, iterTopo, type Shape3D } from 'replicad';
import type { NamedBody } from './index';
import { RayCaster } from './ray-caster';
import { describeSize, fitsBed, format, plural } from './reporting';

/** A body loaded from Shape Access. */
export interface LoadedBody {
  readonly body: NamedBody;
  readonly named: NamedShape;
}

/** The checks for 3D printing, in the order the panel shows them; `meshOf` gives (cached) fine meshes. */
export function printChecks(bodies: readonly LoadedBody[], profile: PrintProfile, meshOf: (body: LoadedBody) => Triangles): Check[] {
  if (bodies.length === 0) return [{ id: 'bodies', title: 'Bodies', status: 'fail', message: 'There is nothing to print yet.' }];
  const meshes = bodies.map((b) => ({ ...b, mesh: meshOf(b) }));
  return [closedCheck(bodies), bedCheck(bodies, profile), overhangCheck(meshes, profile), wallCheck(meshes, profile)];
}

function closedCheck(bodies: readonly LoadedBody[]): Check {
  const open = bodies.filter((b) => !isClosedSolid(b.named.shape)).map((b) => b.body.name);
  return {
    id: 'closed',
    title: 'Closed solid',
    status: open.length ? 'fail' : 'pass',
    message: open.length ? `${open.join(', ')} ${open.length > 1 ? 'are' : 'is'} not closed; slicers cannot fill it.` : 'Every body is a closed, valid solid.',
  };
}

/** At least one solid, every shell closed, and valid for OpenCascade's checker. */
function isClosedSolid(shape: Shape3D): boolean {
  const oc = getOC();
  const solids = [...iterTopo(shape.wrapped, 'solid')];
  const shells = [...iterTopo(shape.wrapped, 'shell')];
  const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false);
  try {
    return solids.length > 0 && shells.every((s) => oc.BRep_Tool.IsClosed(s)) && analyzer.IsValid();
  } finally {
    for (const item of [...solids, ...shells, analyzer]) item.delete();
  }
}

function bedCheck(bodies: readonly LoadedBody[], profile: PrintProfile): Check {
  const [bx, by, bz] = profile.bed;
  const results = bodies.map((b) => {
    const box = b.named.shape.boundingBox;
    const size: Vec3 = [box.width, box.height, box.depth];
    return { name: b.body.name, size, fit: size[2] <= bz + 1e-6 ? fitsBed([size[0], size[1]], [bx, by]) : 'no' };
  });
  const tooBig = results.filter((r) => r.fit === 'no');
  const turned = results.filter((r) => r.fit === 'rotated');
  const volume = describeSize(profile.bed);
  if (tooBig.length) {
    return { id: 'bed', title: 'Build volume', status: 'fail', message: `${tooBig.map((r) => `${r.name} (${describeSize(r.size)})`).join(', ')} ${tooBig.length > 1 ? 'do' : 'does'} not fit the ${volume} build volume.` };
  }
  if (turned.length) {
    return { id: 'bed', title: 'Build volume', status: 'warning', message: `${turned.map((r) => r.name).join(', ')} only ${turned.length > 1 ? 'fit' : 'fits'} the ${volume} build volume turned by 90°.` };
  }
  return { id: 'bed', title: 'Build volume', status: 'pass', message: `Everything fits the ${volume} build volume.` };
}

export interface Triangles {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly faces: readonly { readonly name: string; readonly center: Vec3; readonly start: number; readonly count: number }[];
}

/** A fine mesh of the body; its triangles stay grouped by face. */
export function triangles(named: NamedShape): Triangles {
  const { shape } = named;
  const box = shape.boundingBox;
  const tolerance = Math.max(0.01, Math.hypot(box.width, box.height, box.depth) / 2000);
  const mesh = shape.mesh({ tolerance, angularTolerance: 0.2 });
  const centers = new Map(facesOf(shape).map((f) => [f.hashCode, f.center.toTuple() as Vec3]));
  return {
    positions: Float32Array.from(mesh.vertices),
    normals: Float32Array.from(mesh.normals),
    indices: Uint32Array.from(mesh.triangles),
    faces: mesh.faceGroups.map((g) => ({
      name: named.faces.get(g.faceId) ?? `unnamed-${g.faceId}`,
      center: centers.get(g.faceId) ?? [0, 0, 0],
      start: g.start,
      count: g.count,
    })),
  };
}

type MeshedBody = LoadedBody & { readonly mesh: Triangles };

/** Calls `visit` with each triangle's corners, (outward) normal, centre and area, face by face. */
function eachTriangle(
  mesh: Triangles,
  visit: (face: Triangles['faces'][number], corners: [Vec3, Vec3, Vec3], normal: Vec3, center: Vec3, area: number) => void,
): void {
  const point = (i: number, array: Float32Array): Vec3 => [array[i * 3] as number, array[i * 3 + 1] as number, array[i * 3 + 2] as number];
  for (const face of mesh.faces) {
    for (let k = face.start; k < face.start + face.count; k += 3) {
      const ids = [mesh.indices[k], mesh.indices[k + 1], mesh.indices[k + 2]] as [number, number, number];
      const [a, b, c] = ids.map((i) => point(i, mesh.positions)) as [Vec3, Vec3, Vec3];
      const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
      if (area < 1e-9) continue;
      // Vertex normals follow the face's orientation; the triangle winding does not always.
      const [na, nb, nc] = ids.map((i) => point(i, mesh.normals)) as [Vec3, Vec3, Vec3];
      const sum: Vec3 = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
      const length = Math.hypot(...sum) || 1;
      const center: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      visit(face, [a, b, c], [sum[0] / length, sum[1] / length, sum[2] / length], center, area);
    }
  }
}

/** Faces pointing down more steeply than the printer can bridge or overhang; the bottom on the bed is fine. */
function overhangCheck(bodies: readonly MeshedBody[], profile: PrintProfile): Check {
  const limit = Math.sin((profile.maxOverhang * Math.PI) / 180);
  const flagged: { ref: TopologyRef; area: number }[] = [];
  for (const { body, mesh, named } of bodies) {
    const floor = named.shape.boundingBox.bounds[0][2] + 1e-3;
    const areas = new Map<string, { area: number; center: Vec3 }>();
    eachTriangle(mesh, (face, corners, normal, _center, area) => {
      if (corners.every((c) => c[2] <= floor)) return;
      if (-normal[2] <= limit + 1e-6) return;
      const entry = areas.get(face.name) ?? { area: 0, center: face.center };
      entry.area += area;
      areas.set(face.name, entry);
    });
    for (const [name, { area, center }] of areas) if (area > 0.01) flagged.push({ ref: { kind: 'face', body: body.id, name, hint: center }, area });
  }
  const title = `Overhangs over ${format(profile.maxOverhang)}°`;
  if (flagged.length === 0) return { id: 'overhang', title, status: 'pass', message: 'Nothing needs supports.' };
  const area = flagged.reduce((s, f) => s + f.area, 0);
  return {
    id: 'overhang',
    title,
    status: 'warning',
    message: `${plural(flagged.length, 'face')} (${format(area, 1)} mm²) ${flagged.length > 1 ? 'need' : 'needs'} supports or bridging.`,
    faces: flagged.map((f) => f.ref),
  };
}

/**
 * Wall thickness: from every triangle a ray goes into the material; where it leaves again is the
 * thickness there. Thinner than the nozzle does not print; thinner than two lines prints weakly.
 */
function wallCheck(bodies: readonly MeshedBody[], profile: PrintProfile): Check {
  const weak = 2 * profile.nozzle;
  const thin: { ref: TopologyRef; thickness: number }[] = [];
  for (const { body, mesh } of bodies) {
    const caster = new RayCaster(mesh.positions, mesh.indices);
    const thinnest = new Map<string, { thickness: number; at: Vec3 }>();
    eachTriangle(mesh, (face, _corners, normal, center) => {
      const inward: Vec3 = [-normal[0], -normal[1], -normal[2]];
      const thickness = caster.cast(center, inward, 1e-4);
      if (thickness === undefined || thickness >= weak - 1e-3) return;
      const known = thinnest.get(face.name);
      if (!known || thickness < known.thickness) thinnest.set(face.name, { thickness, at: center });
    });
    for (const [name, { thickness, at }] of thinnest) thin.push({ ref: { kind: 'face', body: body.id, name, hint: at }, thickness });
  }
  const title = 'Wall thickness';
  if (thin.length === 0) return { id: 'walls', title, status: 'pass', message: `All walls are at least ${format(weak)} mm (two ${format(profile.nozzle)} mm lines).` };
  const min = Math.min(...thin.map((t) => t.thickness));
  const failing = min < profile.nozzle - 1e-3;
  return {
    id: 'walls',
    title,
    status: failing ? 'fail' : 'warning',
    message: failing
      ? `Walls down to ${format(min)} mm are thinner than the ${format(profile.nozzle)} mm nozzle and will not print.`
      : `Walls down to ${format(min)} mm are thinner than two nozzle lines (${format(weak)} mm) and print weakly.`,
    faces: thin.map((t) => t.ref),
  };
}
