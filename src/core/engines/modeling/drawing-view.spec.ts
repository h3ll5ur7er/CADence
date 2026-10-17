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
