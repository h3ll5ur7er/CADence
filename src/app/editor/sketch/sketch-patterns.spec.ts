import type { SketchPoint } from '@core/contracts';
import { SketchBuilder } from '@core/contracts/testing/sketch-builder';
import { circularPatternCommand, linearPatternCommand, mirrorCommand } from './sketch-patterns';

const ids = () => {
  let n = 0;
  return () => `n${++n}`;
};

describe('sketch patterns', () => {
  it('mirrors across a line: twins held by symmetric relations, points on the line shared, arcs turned round', () => {
    const b = new SketchBuilder();
    const axis = b.line(b.point(0, -20), b.point(0, 20));
    const onAxis = b.point(0, 5);
    const corner = b.point(10, 5);
    const side = b.line(onAxis, corner);
    const arc = b.arc(b.point(10, 0), b.point(15, 0), corner);
    const command = mirrorCommand(b.build(), [side, arc, axis], axis, ids());
    const points = command?.entities.filter((e): e is SketchPoint => e.kind === 'point') ?? [];
    expect(points.map((p) => [p.x, p.y]).sort()).toEqual([[-10, 0], [-10, 5], [-15, 0]].sort());
    const mirroredSide = command?.entities.find((e) => e.kind === 'line');
    expect(mirroredSide?.kind === 'line' && mirroredSide.start).toBe(onAxis);
    expect(command?.constraints.filter((c) => c.kind === 'symmetric')).toHaveLength(3);
    const mirroredArc = command?.entities.find((e) => e.kind === 'arc');
    const at = (id: string) => points.find((p) => p.id === id);
    // The original runs counter-clockwise from (15, 0) to (10, 5); the image from (-10, 5) to (-15, 0).
    expect(mirroredArc?.kind === 'arc' && [at(mirroredArc.start)?.x, at(mirroredArc.end)?.x]).toEqual([-10, -15]);
  });

  it('repeats in a row, each copy keeping its relations and placed by dimensions', () => {
    const b = new SketchBuilder();
    const sides = b.polygon([0, 0], [4, 0], [4, 4], [0, 4]);
    b.constrain({ id: 'h', kind: 'horizontal', line: sides[0] as string });
    const command = linearPatternCommand(b.build(), sides, 3, [10, 0], ids());
    expect(command?.entities.filter((e) => e.kind === 'line')).toHaveLength(8);
    expect(command?.constraints.filter((c) => c.kind === 'horizontal')).toHaveLength(2);
    const placing = command?.constraints.filter((c) => c.kind === 'horizontal-distance').map((c) => c.kind === 'horizontal-distance' && c.expression);
    expect(placing).toEqual(['10', '20']);
    const xs = command?.entities.flatMap((e) => (e.kind === 'point' ? [e.x] : [])) ?? [];
    expect(Math.max(...xs)).toBe(24);
  });

  it('repeats around a centre: construction spokes at the pattern angle place the copies', () => {
    const b = new SketchBuilder();
    const center = b.point(0, 0);
    const hole = b.circle(b.point(10, 0), 2);
    const command = circularPatternCommand(b.build(), [hole], 4, center, ids());
    expect(command?.entities.filter((e) => e.kind === 'circle')).toHaveLength(3);
    expect(command?.constraints.filter((c) => c.kind === 'angle').map((c) => c.kind === 'angle' && c.expression)).toEqual(['90 deg', '180 deg', '270 deg']);
    const centres = command?.entities.flatMap((e) => (e.kind === 'point' ? [[Math.round(e.x * 1e9) / 1e9 + 0, Math.round(e.y * 1e9) / 1e9 + 0]] : []));
    expect(centres).toEqual([[0, 10], [-10, 0], [0, -10]]);
  });
});
