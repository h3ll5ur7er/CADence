import { describe, expect, it } from 'vitest';
import { fitDeviations, fitOf } from './fits';

describe('ISO 286 fits (CAD-165)', () => {
  const µm = (fit: string, size: number) => {
    const found = fitDeviations(fit, size);
    if ('error' in found) throw new Error(found.error);
    return [Math.round(found.upper * 1e4) / 10, Math.round(found.lower * 1e4) / 10];
  };

  it('gives the deviations of holes and shafts from the standard tables', () => {
    expect(µm('H7', 20)).toEqual([21, 0]);
    expect(µm('g6', 20)).toEqual([-7, -20]);
    expect(µm('h7', 50)).toEqual([0, -25]);
    expect(µm('f7', 40)).toEqual([-25, -50]);
    expect(µm('js6', 10)).toEqual([4.5, -4.5]);
    expect(µm('k6', 25)).toEqual([15, 2]);
    expect(µm('p6', 25)).toEqual([35, 22]);
    // Holes K to P take the step between grades (Δ), except up to 3 mm.
    expect(µm('K7', 25)).toEqual([6, -15]);
    expect(µm('M7', 25)).toEqual([0, -21]);
    expect(µm('N7', 25)).toEqual([-7, -28]);
    expect(µm('P7', 25)).toEqual([-14, -35]);
    expect(µm('M7', 2)).toEqual([-2, -12]);
    expect(µm('F8', 10)).toEqual([35, 13]);
  });

  it('reads fits of a hole and a shaft, and says what it does not know', () => {
    expect(fitOf('H7/g6', 20)).toEqual({ text: 'H7/g6', deviations: [{ upper: 0.021, lower: 0 }, { upper: -0.007, lower: -0.02 }] });
    expect(fitOf('s6', 20)).toEqual({ error: 'Shafts d to p and js are known; not s6.' });
    expect(fitOf('H7', 600)).toEqual({ error: 'ISO 286 fits go from 0 to 500 mm.' });
    expect(fitOf('H', 20)).toEqual({ error: 'H is not a tolerance class such as H7 or g6.' });
    expect(fitOf('H13', 20)).toEqual({ error: 'Grades IT5 to IT12 are known; H13 is IT13.' });
  });
});
