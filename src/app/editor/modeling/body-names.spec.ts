import { bodyNames } from './body-names';

describe('body names', () => {
  const timeline = [
    { id: 'e1', name: 'Extrude 1' },
    { id: 'p1', name: 'Circular pattern 1' },
  ];

  it('names a body after the feature that made it, numbering further bodies of that feature', () => {
    const names = bodyNames(['e1', 'p1', 'p1:3', 'p1:4'], timeline);
    expect([...names.values()]).toEqual(['Extrude 1', 'Circular pattern 1', 'Circular pattern 1 (2)', 'Circular pattern 1 (3)']);
  });

  it('numbers bodies whose feature made no body of its own id', () => {
    expect(bodyNames(['e1:1', 'e1:2'], timeline).get('e1:2')).toBe('Extrude 1 (2)');
  });

  it('falls back to the id for bodies of unknown features', () => {
    expect(bodyNames(['x'], timeline).get('x')).toBe('x');
  });
});
