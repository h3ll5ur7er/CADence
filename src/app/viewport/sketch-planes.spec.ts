import { affineScale, applyAffine, invertAffine } from './sketch-planes';

describe('sketch plane affine maps', () => {
  // 4 px per mm, Y flipped (screen Y points down), origin at (100, 300).
  const m = { a: 4, b: 0, c: 0, d: -4, e: 100, f: 300 };

  it('maps plane millimetres to pixels', () => {
    expect(applyAffine(m, 10, 5)).toEqual([140, 280]);
    expect(affineScale(m)).toBe(4);
  });

  it('inverts exactly', () => {
    const [x, y] = applyAffine(invertAffine(m), 140, 280);
    expect(x).toBeCloseTo(10);
    expect(y).toBeCloseTo(5);
  });
});
