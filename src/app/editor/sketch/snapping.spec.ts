import { SketchBuilder } from '@core/contracts/testing/sketch-builder';
import { lineCommand } from './sketch-tools';
import { snap } from './snapping';

describe('snapping', () => {
  const sketch = () => {
    const b = new SketchBuilder();
    const line = b.line(b.point(5, 0), b.point(25, 0));
    const circle = b.circle(b.point(50, 0), 10);
    return { sketch: b.build(), line, circle };
  };

  it('shares existing points, then takes line middles, then lands on curves', () => {
    const { sketch: s, line, circle } = sketch();
    expect(snap(s, [5.3, 0.2], 1, 0.5)).toEqual({ id: 'p1', at: [5, 0] });
    expect(snap(s, [15.4, 0.3], 1, 0.5)).toEqual({ at: [15, 0], on: { kind: 'midpoint', id: line } });
    expect(snap(s, [20, 0.4], 1, 0.5)).toEqual({ at: [20, 0], on: { kind: 'curve', id: line } });
    const onCircle = snap(s, [50, 10.3], 1, 0.5);
    expect(onCircle.on).toEqual({ kind: 'curve', id: circle });
    expect(onCircle.at[1]).toBeCloseTo(10, 9);
    expect(snap(s, [30, 5], 1, 0.5)).toEqual({ at: [30, 5] });
  });

  it('gives the new point the relation it snapped to', () => {
    const { sketch: s, line } = sketch();
    let n = 0;
    const { command } = lineCommand('s', snap(s, [20, 0.4], 1, 0.5), { at: [20, 10] }, () => `n${++n}`);
    expect(command.constraints).toContainEqual({ id: expect.any(String), kind: 'point-on', point: 'n1', curve: line });
    const mid = lineCommand('s', snap(s, [15.2, 0.2], 1, 0.5), { at: [15, 10] }, () => `m${++n}`).command;
    expect(mid.constraints).toContainEqual({ id: expect.any(String), kind: 'midpoint', point: expect.any(String), line });
  });
});
