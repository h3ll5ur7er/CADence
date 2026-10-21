import { describe, expect, it } from 'vitest';
import { flangeSection, neutralAway } from './flange';

const near = (v: number) => expect.closeTo(v, 9);

describe('flange sections', () => {
  it('walks a bend up and a straight piece: both surfaces, the flat length and the bend line', () => {
    const section = flangeSection([{ angle: Math.PI / 2, radius: 2, length: 10 }], 2, 0.5);
    // The inside surface turns round (0, 2) to (2, 2), then goes up 10; the outside one round the same centre, 2 further out.
    expect(section.top.at(-1)).toEqual({ kind: 'line', start: [near(2), near(2)], end: [near(2), near(12)] });
    expect(section.bottom.at(-1)).toEqual({ kind: 'line', start: [near(4), near(2)], end: [near(4), near(12)] });
    const allowance = (Math.PI / 2) * (2 + 0.5 * 2);
    expect(section.width).toBeCloseTo(allowance + 10);
    expect(section.bendLines).toEqual([near(allowance / 2)]);
    expect(section.straights).toEqual([{ start: [near(2), near(2)], direction: [near(0), near(1)], length: 10, flat: near(allowance) }]);
    // The neutral layer stands r + K·t = 3 away from the edge once the bend is done.
    expect(neutralAway(section, 0)).toBeCloseTo(0);
    expect(neutralAway(section, section.width)).toBeCloseTo(3);
  });

  it('turns the other way round the other surface, and folds back with no radius', () => {
    // Up, then a turn to the right: the centre lies beside the outside surface, the inside radius on that side.
    const section = flangeSection(
      [
        { angle: Math.PI / 2, radius: 1, length: 5 },
        { angle: -Math.PI / 2, radius: 1, length: 3 },
      ],
      1,
    );
    expect(section.top.at(-1)?.end).toEqual([near(1 + 2 + 3), near(1 + 5 + 2)]);
    expect(section.bottom.at(-1)?.end).toEqual([near(6), near(7)]);
    // A closed hem: half a turn round the edge itself, lying back over the sheet.
    const hem = flangeSection([{ angle: Math.PI, radius: 0, length: 6 }], 1);
    expect(hem.top).toEqual([{ kind: 'line', start: [0, 0], end: [near(-6), near(0)] }]);
    expect(hem.bottom[0]).toMatchObject({ kind: 'arc', start: [0, -1], mid: [near(1), near(0)], end: [near(0), near(1)] });
  });
});
