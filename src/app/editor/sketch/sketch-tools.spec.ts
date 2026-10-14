import type { SketchEntity } from '@core/contracts';
import { SketchBuilder } from '@core/contracts/testing/sketch-builder';
import {
  arcCommand,
  constraintFor,
  dimensionFor,
  inferAxis,
  lineCommand,
  rectangleCommand,
} from './sketch-tools';

const ids = () => {
  let n = 0;
  return () => `n${++n}`;
};

describe('sketch tools', () => {
  it('infers horizontal and vertical lines within 3 degrees', () => {
    expect(inferAxis([0, 0], [10, 0.4])).toBe('horizontal');
    expect(inferAxis([0, 0], [-0.3, 10])).toBe('vertical');
    expect(inferAxis([0, 0], [10, 3])).toBeUndefined();
  });

  it('draws lines from existing or new points', () => {
    const { command, end } = lineCommand('s', { id: 'p1', at: [0, 0] }, { at: [20, 0.2] }, ids());
    expect(command.entities).toEqual([
      { id: 'n1', kind: 'point', x: 20, y: 0.2 },
      { id: 'n2', kind: 'line', start: 'p1', end: 'n1', construction: false },
    ]);
    expect(command.constraints).toEqual([{ id: 'n3', kind: 'horizontal', line: 'n2' }]);
    expect(end).toBe('n1');
  });

  it('draws rectangles with four corners and axis relations', () => {
    const command = rectangleCommand('s', { at: [0, 0] }, { at: [40, 20] }, ids());
    expect(command.entities.filter((e) => e.kind === 'point').map((e) => e.kind === 'point' && [e.x, e.y])).toEqual([
      [0, 0],
      [40, 0],
      [40, 20],
      [0, 20],
    ]);
    expect(command.constraints.map((c) => c.kind).sort()).toEqual(['horizontal', 'horizontal', 'vertical', 'vertical']);
  });

  it('projects the arc end onto the radius', () => {
    const command = arcCommand('s', { at: [0, 0] }, [10, 0], [0, 30], ids());
    const end = command.entities.find((e) => e.id === 'n3');
    expect(end).toMatchObject({ x: expect.closeTo(0), y: expect.closeTo(10) });
  });

  describe('constraints from a selection', () => {
    const b = new SketchBuilder();
    const l1 = b.line(b.point(0, 0), b.point(10, 0));
    const l2 = b.line(b.point(0, 5), b.point(10, 6));
    const c = b.circle(b.point(20, 0), 3);
    const sketch = b.build();
    const get = (id: string) => sketch.entities.find((e) => e.id === id) as SketchEntity;

    it.each([
      ['parallel', [l1, l2], 'parallel'],
      ['equal', [l1, l2], 'equal'],
      ['tangent', [l1, c], 'tangent'],
      ['coincident', ['p1', 'p4'], 'coincident'],
      ['coincident', ['p1', c], 'point-on'],
      ['midpoint', ['p4', l1], 'midpoint'],
      ['horizontal', [l2], 'horizontal'],
      ['fix', ['p1'], 'fix'],
    ] as const)('%s on %j makes %s', (tool, selection, kind) => {
      expect(constraintFor(tool, selection.map(get), 'x', sketch)?.kind).toBe(kind);
    });

    it.each([
      ['parallel', [l1]],
      ['horizontal', [c]],
      ['tangent', [l1, l2]],
      ['fix', [l1]],
    ] as const)('%s does not apply to %j', (tool, selection) => {
      expect(constraintFor(tool, selection.map(get), 'x', sketch)).toBeUndefined();
    });

    it('starts dimensions at the current value', () => {
      expect(dimensionFor([get(l1)], 'd', sketch)).toMatchObject({ kind: 'distance', expression: '10' });
      expect(dimensionFor([get(c)], 'd', sketch)).toMatchObject({ kind: 'diameter', expression: '6' });
      expect(dimensionFor([get(l1), get(l2)], 'd', sketch)).toMatchObject({ kind: 'angle', expression: '5.71 deg' });
      expect(dimensionFor([get('p4'), get(l1)], 'd', sketch)).toMatchObject({ kind: 'point-line-distance', expression: '5' });
    });
  });
});
