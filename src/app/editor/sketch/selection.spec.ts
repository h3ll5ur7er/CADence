import { sketchOriginId } from '@core/contracts';
import { SketchBuilder } from '@core/contracts/testing/sketch-builder';
import { boxSelect, copySelection, pasted } from './selection';

/** A 10 × 10 square at the origin (dimensioned, anchored) and a circle at (30, 5). */
function sketch() {
  const b = new SketchBuilder();
  const sides = b.polygon([0, 0], [10, 0], [10, 10], [0, 10]);
  b.constrain({ id: 'h', kind: 'horizontal', line: sides[0] as string });
  b.constrain({ id: 'w', kind: 'distance', points: ['p1', 'p2'], expression: 'width' });
  b.constrain({ id: 'o', kind: 'coincident', points: ['p1', sketchOriginId] });
  const circle = b.circle(b.point(30, 5), 3);
  return { sketch: b.build(), sides, circle };
}

describe('sketch selection', () => {
  it('selects what lies inside a box dragged to the right, and what it touches dragged to the left', () => {
    const { sketch: s, sides, circle } = sketch();
    const inside = boxSelect(s, [-1, -1], [11, 11]);
    expect(inside).toEqual(expect.arrayContaining([...sides, 'p1', 'p2', 'p3', 'p4']));
    expect(inside).not.toContain(circle);
    const touching = boxSelect(s, [32, 4], [8, 6]);
    expect(touching).toEqual(expect.arrayContaining([sides[1], circle]));
    expect(touching).not.toContain(sides[3]);
    expect(touching).not.toContain(sides[0]);
  });

  it('copies curves with their points and the relations among them, not those to the outside', () => {
    const { sketch: s, sides } = sketch();
    const clipboard = copySelection(s, sides);
    expect(clipboard?.entities).toHaveLength(8);
    expect(clipboard?.constraints.map((c) => c.id).sort()).toEqual(['h', 'w']);
  });

  it('pastes with new ids, centred where asked, dimensions keeping their expressions', () => {
    const { sketch: s, sides } = sketch();
    let n = 0;
    const copy = pasted(copySelection(s, sides) as NonNullable<ReturnType<typeof copySelection>>, [50, 50], () => `c${++n}`);
    const xs = copy.entities.flatMap((e) => (e.kind === 'point' ? [e.x] : []));
    expect(Math.min(...xs)).toBe(45);
    expect(Math.max(...xs)).toBe(55);
    const ids = new Set(copy.entities.map((e) => e.id));
    expect(copy.entities.every((e) => e.id.startsWith('c'))).toBe(true);
    const width = copy.constraints.find((c) => c.kind === 'distance');
    expect(width).toMatchObject({ expression: 'width' });
    expect(width?.kind === 'distance' && width.points.every((p) => ids.has(p))).toBe(true);
  });
});
