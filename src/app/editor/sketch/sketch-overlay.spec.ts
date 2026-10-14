import { SketchBuilder } from '@core/contracts/testing/sketch-builder';
import { hitTest } from './sketch-overlay';

describe('sketch hit testing', () => {
  const b = new SketchBuilder();
  const line = b.line(b.point(2, 0), b.point(10, 0));
  const circle = b.circle(b.point(30, 0), 5);
  const arc = b.arc(b.point(60, 0), b.point(65, 0), b.point(60, 5));
  const sketch = b.build();

  it('prefers points, then the nearest curve within the tolerance', () => {
    expect(hitTest(sketch, [2.2, 0.1], 0.5)).toEqual({ id: 'p1', kind: 'point' });
    expect(hitTest(sketch, [0.1, 0.1], 0.5)).toEqual({ id: 'origin', kind: 'point' });
    expect(hitTest(sketch, [5, 0.3], 0.5)).toEqual({ id: line, kind: 'curve' });
    expect(hitTest(sketch, [35.2, 0], 0.5)).toEqual({ id: circle, kind: 'curve' });
    expect(hitTest(sketch, [5, 2], 0.5)).toBeUndefined();
  });

  it('hits arcs only along their sweep', () => {
    const onArc = [60 + 5 * Math.SQRT1_2, 5 * Math.SQRT1_2] as const;
    expect(hitTest(sketch, onArc, 0.3)).toEqual({ id: arc, kind: 'curve' });
    expect(hitTest(sketch, [55, 0], 0.3)).toBeUndefined();
  });
});
