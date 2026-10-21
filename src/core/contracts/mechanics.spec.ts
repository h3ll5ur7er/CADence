import { describe, expect, it } from 'vitest';
import { materials } from './analysis';
import { springProperties } from './mechanics';

const steel = materials.find((m) => m.name === 'Steel') as (typeof materials)[number];

describe('springs (CAD-161)', () => {
  it('give the rate and lengths of a compression spring of 8 turns by its ends', () => {
    // ⌀1 wire, ⌀10 outside (D = 9), pitch 3: k = G d⁴ / (8 D³ nₐ), G = E / 2.6.
    const size = { kind: 'compression', wire: 1, mean: 9, pitch: 3, turns: 8 } as const;
    const rate = (active: number) => 200_000 / 2.6 / (8 * 729 * active);
    expect(springProperties({ ...size, ends: 'ground' }, steel)).toEqual({ kind: 'compression', rate: expect.closeTo(rate(6), 12), activeTurns: 6, freeLength: 20, solidLength: 8 });
    expect(springProperties({ ...size, ends: 'closed' }, steel)).toMatchObject({ activeTurns: 6, freeLength: 21, solidLength: 9 });
    expect(springProperties({ ...size, ends: 'open' }, steel)).toMatchObject({ rate: expect.closeTo(rate(8), 12), activeTurns: 8, freeLength: 25, solidLength: 9 });
    // About 2.2 N/mm: 22 N pushes it 10 mm.
    expect(springProperties({ ...size, ends: 'ground' }, steel).rate).toBeCloseTo(2.198, 3);
    // Stiffer in steel than in PLA by their shear moduli.
    const pla = springProperties({ ...size, ends: 'ground' }, materials[0] as (typeof materials)[number]).rate;
    expect(pla).toBeCloseTo((3500 / (2 * 1.36) / 8 / 729 / 6) * 1, 9);
  });

  it('give extension and torsion springs their rates', () => {
    expect(springProperties({ kind: 'extension', wire: 1, mean: 7, turns: 10 }, steel)).toEqual({ kind: 'extension', rate: expect.closeTo(200_000 / 2.6 / (8 * 343 * 10), 12), activeTurns: 10, freeLength: 23 });
    // N·mm per degree: E d⁴ / (64 D nₐ) · π / 180, the legs adding (l₁ + l₂) / (3π D) turns.
    const torsion = springProperties({ kind: 'torsion', wire: 1, mean: 9, pitch: 1.2, turns: 4, legs: 12 }, steel);
    const active = 4 + 24 / (27 * Math.PI);
    expect(torsion).toEqual({ kind: 'torsion', rate: expect.closeTo(((200_000 / (64 * 9 * active)) * Math.PI) / 180, 12), activeTurns: expect.closeTo(active, 12), freeLength: 5.8 });
  });
});
