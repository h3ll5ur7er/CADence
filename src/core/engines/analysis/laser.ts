import type { Check, LaserProfile, Vec2 } from '@core/contracts';
import { offsetLoop } from '@core/utilities/math';
import type { SolvedSketch } from './index';
import type { LoadedBody } from './printing';
import { describeSize, fitsBed, format, plural } from './reporting';

/** The checks for laser cutting: sheet thickness of the bodies, and the sketches that get cut. */
export function laserChecks(bodies: readonly LoadedBody[], sketches: readonly SolvedSketch[], profile: LaserProfile): Check[] {
  const parts = sketches.filter((s) => s.sketch.entities.some(isCut));
  if (parts.length === 0 && bodies.length === 0) {
    return [{ id: 'sketches', title: 'Sketches', status: 'fail', message: 'There is nothing to cut yet.' }];
  }
  return [
    ...(bodies.length ? [sheetCheck(bodies, profile)] : []),
    ...(parts.length ? [closedCheck(parts), bedCheck(parts, profile), kerfCheck(parts, profile)] : []),
  ];
}

const isCut = (e: SolvedSketch['sketch']['entities'][number]) => e.kind !== 'point' && e.kind !== 'picture' && !e.construction;

/** Laser-cut parts are flat: each body should be exactly one sheet thick. */
function sheetCheck(bodies: readonly LoadedBody[], profile: LaserProfile): Check {
  const wrong = bodies.flatMap((b) => {
    const box = b.named.shape.boundingBox;
    const thickness = Math.min(box.width, box.height, box.depth);
    return Math.abs(thickness - profile.thickness) > 0.01 ? [`${b.body.name} is ${format(thickness)} mm thick`] : [];
  });
  const title = 'Sheet thickness';
  if (wrong.length === 0) return { id: 'sheet', title, status: 'pass', message: `Every body is ${format(profile.thickness)} mm thick, like the sheet.` };
  return { id: 'sheet', title, status: 'warning', message: `${wrong.join(', ')}; the sheet is ${format(profile.thickness)} mm.` };
}

/** Curves that bound no region cut a line but free no part (fine for engraving, often a gap by mistake). */
function closedCheck(sketches: readonly SolvedSketch[]): Check {
  const open = sketches.flatMap(({ sketch, profiles }) => {
    const bounding = new Set(profiles.flatMap((p) => [p.outer, ...p.holes]).flatMap((loop) => loop.edges.map((e) => e.source)));
    const loose = sketch.entities.filter((e) => isCut(e) && !bounding.has(e.id)).length;
    return loose ? [`${sketch.name} has ${plural(loose, 'open curve')}`] : [];
  });
  const title = 'Closed outlines';
  if (open.length === 0) return { id: 'outlines', title, status: 'pass', message: 'Every curve is part of a closed outline.' };
  return { id: 'outlines', title, status: 'warning', message: `${open.join('; ')}: they cut as lines but free no part.` };
}

function bedCheck(sketches: readonly SolvedSketch[], profile: LaserProfile): Check {
  const title = 'Laser bed';
  const bed = describeSize(profile.bed);
  const results = sketches.flatMap(({ sketch, profiles }) => {
    const points = profiles.flatMap((p) => p.outer.polygon);
    if (points.length === 0) return [];
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const size: Vec2 = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    return [{ name: sketch.name, size, fit: fitsBed(size, profile.bed) }];
  });
  const tooBig = results.filter((r) => r.fit === 'no');
  if (tooBig.length) return { id: 'bed', title, status: 'fail', message: `${tooBig.map((r) => `${r.name} (${describeSize(r.size)})`).join(', ')} does not fit the ${bed} bed.` };
  const turned = results.filter((r) => r.fit === 'rotated');
  if (turned.length) return { id: 'bed', title, status: 'warning', message: `${turned.map((r) => r.name).join(', ')} only fits the ${bed} bed turned by 90°.` };
  return { id: 'bed', title, status: 'pass', message: `Everything fits the ${bed} bed.` };
}

/** Kerf compensation moves every outline half a kerf away from the part; details smaller than that vanish. */
function kerfCheck(sketches: readonly SolvedSketch[], profile: LaserProfile): Check {
  const half = profile.kerf / 2;
  const failing = sketches
    .filter(({ profiles }) => profiles.some((p) => [p.outer, ...p.holes].some((loop) => !offsetLoop(loop.edges, half))))
    .map((s) => s.sketch.name);
  const title = 'Kerf compensation';
  if (failing.length) return { id: 'kerf', title, status: 'fail', message: `${failing.join(', ')} has details smaller than the ${format(profile.kerf)} mm kerf.` };
  return { id: 'kerf', title, status: 'pass', message: `Outlines can be compensated for the ${format(profile.kerf)} mm kerf (${format(half)} mm per side) on export.` };
}
