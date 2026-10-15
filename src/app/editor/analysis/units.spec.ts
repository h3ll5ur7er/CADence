import { describe, expect, it } from 'vitest';
import { degrees, grams, millimetres, point } from './units';

describe('measurement formats', () => {
  it('shows lengths, areas and volumes without float noise', () => {
    expect(millimetres(10.000000001)).toBe('10 mm');
    expect(millimetres(12.34567)).toBe('12.346 mm');
    expect(millimetres(749.734517, 2)).toBe('749.73 mm²');
    expect(millimetres(45720, 3)).toBe('45,720 mm³');
  });

  it('shows angles in degrees, masses in g or kg, and points', () => {
    expect(degrees(Math.PI / 2)).toBe('90°');
    expect(grams(13.392)).toBe('13.39 g');
    expect(grams(2512.5)).toBe('2.513 kg');
    expect(point([0, -0.0000001, 5])).toBe('0, 0, 5');
  });
});
