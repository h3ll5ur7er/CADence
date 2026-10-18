import { createShapeAccess } from '@core/access/shape';
import { originFrames } from '@core/contracts';
import { circleLoop, profile, rectangleLoop } from '@core/contracts/testing/profiles';
import { describe, expect, it } from 'vitest';
import { createModelingEngine } from './index';
import type { ProjectedCurve } from './modeling-engine';

const engine = createModelingEngine(createShapeAccess());

/** A 60 × 30 × 10 plate with a ⌀10 hole at (20, 15). */
async function plate() {
  const outcome = await engine.apply({
    type: 'extrude',
    feature: 'e1',
    key: 'drawing-plate',
    bodies: [],
    frame: originFrames.XY,
    profiles: [profile(rectangleLoop(0, 0, 60, 30, 'plate'), [circleLoop(20, 15, 5, 'hole', false)])],
    distance: 10,
    direction: 'normal',
    operation: 'new-body',
  });
  return outcome.bodies;
}

const top = { frame: { origin: [0, 0, 0] as const, u: [1, 0, 0] as const, v: [0, 1, 0] as const }, hidden: true };
const front = { frame: { origin: [0, 0, 0] as const, u: [1, 0, 0] as const, v: [0, 0, 1] as const }, hidden: true };
/** Circles and arcs as [centre x, centre y, radius], rounded. */
const round = (curves: readonly ProjectedCurve[]) =>
  curves.flatMap((c) => (c.kind === 'line' ? [] : [[Math.round(c.center[0]), Math.round(c.center[1]), Math.round(c.kind === 'circle' ? c.radius : Math.hypot(c.start[0] - c.center[0], c.start[1] - c.center[1]))]]));

describe('drawing views', () => {
  it('sees the plate from above: its outline and the hole as a circle, with the names to dimension', async () => {
    const bodies = await plate();
    const view = await engine.drawView(bodies, top);
    if (!view.ok) throw new Error(view.error.message);
    const { visible, hidden, box, points, circles: named } = view.value;
    expect(box.min.map((v) => Math.round(v))).toEqual([0, 0]);
    expect(box.max.map((v) => Math.round(v))).toEqual([60, 30]);
    // The hole: two half circles (its wall is two half cylinders).
    expect(round(visible)).toContainEqual([20, 15, 5]);
    expect(hidden.filter((c) => c.kind !== 'line')).toHaveLength(0); // the bottom of the hole lies under its top
    expect(points.length).toBeGreaterThanOrEqual(8);
    expect(named.some((c) => Math.abs(c.radius - 5) < 1e-6 && c.name.includes('hole'))).toBe(true);
  });

  it('shows the hole as hidden lines from the front, and its cut in a section', async () => {
    const bodies = await plate();
    const view = await engine.drawView(bodies, front);
    if (!view.ok) throw new Error(view.error.message);
    // The hole's walls at x = 15 and x = 25, from z = 0 to 10, dashed.
    const xs = view.value.hidden.flatMap((c) => (c.kind === 'line' && Math.abs(c.start[0] - c.end[0]) < 1e-6 ? [Math.round(c.start[0])] : []));
    expect(xs).toContain(15);
    expect(xs).toContain(25);
    // Cut through the hole's middle (y = 15): the cut is two rectangles beside the hole, hatched.
    const section = await engine.drawView(bodies, { ...front, cut: { offset: 0 } });
    if (!section.ok) throw new Error(section.error.message);
    expect(section.value.cut.length).toBeGreaterThanOrEqual(8);
    // The hole's walls are now seen, not hidden.
    expect(section.value.hidden.filter((c) => c.kind === 'line' && [15, 25].includes(Math.round(c.start[0])) && Math.abs(c.start[0] - c.end[0]) < 1e-6)).toHaveLength(0);
    // Where the plane cuts, for the cutting-plane line on other views: the plate's middle.
    expect(section.value.cutAt?.map((c) => Math.round(c * 1000) / 1000)).toEqual([30, 15, 5]);
  });

  it('says which named geometry the view cannot see, and offers the outermost points seen (CAD-127)', async () => {
    // A blind ⌀8 pocket from below, 5 deep: from above, its circles lie behind the plate's top.
    const pocketed = await engine.apply({
      type: 'extrude',
      feature: 'e2',
      key: 'drawing-pocket',
      bodies: await plate(),
      frame: originFrames.XY,
      profiles: [profile(circleLoop(45, 15, 4, 'pocket'))],
      distance: 5,
      direction: 'normal',
      operation: 'cut',
    });
    const view = await engine.drawView(pocketed.bodies, { ...top, hidden: false });
    if (!view.ok) throw new Error(view.error.message);
    const { circles, points } = view.value;
    const pocket = circles.filter((c) => Math.abs(c.radius - 4) < 1e-6);
    expect(pocket.length).toBeGreaterThan(0);
    expect(pocket.every((c) => c.hidden)).toBe(true);
    expect(circles.filter((c) => Math.abs(c.radius - 5) < 1e-6).some((c) => !c.hidden)).toBe(true);
    // Each circle knows its centre in the model.
    expect(pocket[0]?.model?.map(Math.round).slice(0, 2)).toEqual([45, 15]);
    const extreme = (side: string) => points.find((p) => p.name === `extreme:${side}`)?.at;
    expect(extreme('left')?.[0]).toBeCloseTo(0, 6);
    expect(extreme('right')?.[0]).toBeCloseTo(60, 6);
    expect(extreme('top')?.[1]).toBeCloseTo(30, 6);
  });

  it('outlines a cylinder seen from its side with lines to dimension its diameter (CAD-127)', async () => {
    const rod = await engine.apply({ type: 'extrude', feature: 'rod', key: 'drawing-rod', bodies: [], frame: originFrames.XY, profiles: [profile(circleLoop(0, 0, 10, 'rod'))], distance: 40, direction: 'normal', operation: 'new-body' });
    // From the right: the rod's two half cylinders (split at x = ±10) each show one outline.
    const side = await engine.drawView(rod.bodies, { frame: { origin: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1] }, hidden: true });
    if (!side.ok) throw new Error(side.error.message);
    const outlines = side.value.lines.filter((l) => l.name.startsWith('s:'));
    expect(outlines.map((l) => Math.round(l.start[0])).sort((a, b) => a - b)).toEqual([-10, 10]);
    expect(outlines.every((l) => Math.abs(Math.abs(l.end[1] - l.start[1]) - 40) < 1e-6 && !l.hidden)).toBe(true);
    // Their ends are points: a length along the rod or across it.
    expect(side.value.points.filter((p) => p.name.startsWith(`${outlines[0]?.name}:`))).toHaveLength(2);
    // Along its axis, a cylinder shows circles, no outlines.
    const end = await engine.drawView(rod.bodies, top);
    if (!end.ok) throw new Error(end.error.message);
    expect(end.value.lines.filter((l) => l.name.startsWith('s:'))).toHaveLength(0);
  });

  it('draws from the triangles when asked, for shapes the exact projection takes too long on (CAD-125)', async () => {
    const bodies = await plate();
    const exact = await engine.drawView(bodies, front);
    const mesh = await engine.drawView(bodies, { ...front, method: 'mesh' });
    if (!exact.ok || !mesh.ok) throw new Error('not drawn');
    expect(mesh.value.approximate).toBe(true);
    expect(mesh.value.box.min.map(Math.round)).toEqual(exact.value.box.min.map(Math.round));
    expect(mesh.value.box.max.map(Math.round)).toEqual(exact.value.box.max.map(Math.round));
    // The hole's walls are hidden from the front, its outline is seen from above.
    const xs = mesh.value.hidden.flatMap((c) => (c.kind === 'line' && Math.abs(c.start[0] - c.end[0]) < 1e-6 ? [Math.round(c.start[0])] : []));
    expect(xs).toContain(15);
    expect(xs).toContain(25);
    expect(mesh.value.visible.some((c) => c.kind === 'line' && [15, 25].includes(Math.round(c.start[0])) && Math.abs(c.start[0] - c.end[0]) < 1e-6)).toBe(false);
    const above = await engine.drawView(bodies, { ...top, method: 'mesh' });
    if (!above.ok) throw new Error(above.error.message);
    expect(round(above.value.visible)).toContainEqual([20, 15, 5]);
    expect(above.value.circles.filter((c) => Math.abs(c.radius - 5) < 1e-6).some((c) => !c.hidden)).toBe(true);
  });

  it('places copies of bodies for an assembly result', async () => {
    const [body] = await plate();
    const snapshot = await engine.snapshotPlaced([{ id: 'a1', body: body as NonNullable<typeof body>, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1] }]);
    const placed = await engine.restore(snapshot, 'placed-result');
    const view = await engine.drawView(placed, top);
    if (!view.ok) throw new Error(view.error.message);
    expect(Math.round(view.value.box.min[0])).toBe(100);
    expect(view.value.bodies).toEqual([{ id: 'a1', at: [130, 15] }]);
  });
});
