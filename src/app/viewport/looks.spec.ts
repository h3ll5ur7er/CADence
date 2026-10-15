import { lookOf, sectionPlane } from './looks';

describe('looks', () => {
  it('takes the theme colour, then the body, then the instance', () => {
    expect(lookOf('#aaaaaa')).toEqual({ color: '#aaaaaa', opacity: 1 });
    expect(lookOf('#aaaaaa', { color: '#ff0000' })).toEqual({ color: '#ff0000', opacity: 1 });
    expect(lookOf('#aaaaaa', { color: '#ff0000', opacity: 0.5 }, { color: '#00ff00' })).toEqual({ color: '#00ff00', opacity: 0.5 });
  });

  it('hides a body when its own appearance or its instance hides it', () => {
    expect(lookOf('#aaaaaa', { hidden: true })).toBeUndefined();
    expect(lookOf('#aaaaaa', undefined, { hidden: true })).toBeUndefined();
  });
});

describe('section planes', () => {
  it('cuts at the offset along the axis, away the side its standard view looks from', () => {
    expect(sectionPlane({ plane: 'XY', offset: 3, flipped: false })).toEqual({ normal: [0, 0, 1], point: [0, 0, 3] });
    expect(sectionPlane({ plane: 'XZ', offset: -2, flipped: false })).toEqual({ normal: [0, -1, 0], point: [0, -2, 0] });
    expect(sectionPlane({ plane: 'YZ', offset: 5, flipped: true })).toEqual({ normal: [-1, 0, 0], point: [5, 0, 0] });
  });

  it('cuts parallel to a picked face', () => {
    const n = [0, Math.SQRT1_2, Math.SQRT1_2] as const;
    expect(sectionPlane({ plane: 'face', normal: n, offset: 10, flipped: false })).toEqual({ normal: n, point: [0, 10 * n[1], 10 * n[2]] });
  });
});
