import type { SketchEntity, SketchPoint } from '@core/contracts';
import {
  centerRectangleCommand,
  circleThrough,
  ellipseCommand,
  polygonCommand,
  slotCommand,
  splineCommand,
  threePointArcCommand,
} from './shape-tools';

const ids = () => {
  let n = 0;
  return () => `n${++n}`;
};
const kinds = (entities: readonly SketchEntity[]) => entities.map((e) => e.kind).sort();
const at = (entities: readonly SketchEntity[], id: string) => {
  const p = entities.find((e): e is SketchPoint => e.id === id && e.kind === 'point');
  return p && [Math.round(p.x * 1e6) / 1e6 + 0, Math.round(p.y * 1e6) / 1e6 + 0];
};

describe('shape tools', () => {
  it('draws a slot: two equal tangent ends and two sides', () => {
    const command = slotCommand('s', { at: [0, 0] }, { at: [20, 0] }, [10, 5], ids());
    expect(kinds(command?.entities ?? [])).toEqual(['arc', 'arc', 'line', 'line', 'point', 'point', 'point', 'point', 'point', 'point']);
    expect(command?.constraints.map((c) => c.kind).sort()).toEqual(['equal', 'tangent', 'tangent', 'tangent', 'tangent']);
    const arcs = command?.entities.filter((e) => e.kind === 'arc') ?? [];
    // The far end runs counter-clockwise from below the centre line to above it.
    const far = arcs.find((a) => a.kind === 'arc' && at(command?.entities ?? [], a.center)?.[0] === 20);
    expect(far?.kind === 'arc' && [at(command?.entities ?? [], far.start), at(command?.entities ?? [], far.end)]).toEqual([[20, -5], [20, 5]]);
    expect(slotCommand('s', { at: [0, 0] }, { at: [20, 0] }, [10, 0], ids())).toBeUndefined();
  });

  it('draws regular polygons on a construction circle', () => {
    const command = polygonCommand('s', { id: 'c', at: [0, 0] }, [10, 0], 6, ids());
    const entities = command?.entities ?? [];
    expect(entities.filter((e) => e.kind === 'line')).toHaveLength(6);
    expect(entities.find((e) => e.kind === 'circle')).toMatchObject({ center: 'c', radius: 10, construction: true });
    expect(command?.constraints.filter((c) => c.kind === 'point-on')).toHaveLength(6);
    expect(command?.constraints.filter((c) => c.kind === 'equal')).toHaveLength(5);
    const corners = entities.filter((e): e is SketchPoint => e.kind === 'point');
    expect(corners.every((p) => Math.abs(Math.hypot(p.x, p.y) - 10) < 1e-9)).toBe(true);
  });

  it('draws a rectangle around its centre', () => {
    const command = centerRectangleCommand('s', { at: [10, 10] }, [16, 13], ids());
    const entities = command?.entities ?? [];
    expect(entities.filter((e) => e.kind === 'line' && !e.construction)).toHaveLength(4);
    expect(entities.filter((e) => e.kind === 'line' && e.construction)).toHaveLength(1);
    expect(command?.constraints.map((c) => c.kind).sort()).toEqual(['horizontal', 'horizontal', 'midpoint', 'vertical', 'vertical']);
    const xs = entities.filter((e): e is SketchPoint => e.kind === 'point').map((p) => p.x);
    expect(Math.min(...xs)).toBe(4);
    expect(Math.max(...xs)).toBe(16);
  });

  it('finds the circle through three points and draws the arc the right way round', () => {
    expect(circleThrough([10, 0], [0, 10], [-10, 0])).toEqual([expect.closeTo(0, 9), expect.closeTo(0, 9)]);
    expect(circleThrough([0, 0], [1, 1], [2, 2])).toBeUndefined();
    // Through the top: counter-clockwise from (10, 0) to (-10, 0).
    const upper = threePointArcCommand('s', { at: [10, 0] }, { at: [-10, 0] }, [0, 10], ids());
    const arc = upper?.entities.find((e) => e.kind === 'arc');
    expect(arc?.kind === 'arc' && [at(upper?.entities ?? [], arc.start), at(upper?.entities ?? [], arc.end)]).toEqual([[10, 0], [-10, 0]]);
    // Through the bottom: the same ends, stored the other way round.
    const lower = threePointArcCommand('s', { at: [10, 0] }, { at: [-10, 0] }, [0, -10], ids());
    const other = lower?.entities.find((e) => e.kind === 'arc');
    expect(other?.kind === 'arc' && [at(lower?.entities ?? [], other.start), at(lower?.entities ?? [], other.end)]).toEqual([[-10, 0], [10, 0]]);
  });

  it('draws ellipses from centre, axis end and width', () => {
    const command = ellipseCommand('s', { at: [0, 0] }, { at: [0, 20] }, [6, 7], ids());
    expect(command?.entities.find((e) => e.kind === 'ellipse')).toMatchObject({ minorRadius: 6 });
  });

  it('draws splines through the clicks, closed when they end on the first point', () => {
    const open = splineCommand('s', [{ at: [0, 0] }, { at: [10, 5] }, { at: [20, 0] }], ids());
    expect(open?.entities.find((e) => e.kind === 'spline')).toMatchObject({ points: ['n1', 'n2', 'n3'], closed: false });
    const first = { id: 'p', at: [0, 0] as const };
    const closed = splineCommand('s', [first, { at: [10, 0] }, { at: [10, 10] }, { at: [0, 10] }, first], ids());
    expect(closed?.entities.find((e) => e.kind === 'spline')).toMatchObject({ points: ['p', 'n1', 'n2', 'n3'], closed: true });
    expect(splineCommand('s', [{ at: [0, 0] }], ids())).toBeUndefined();
  });
});
