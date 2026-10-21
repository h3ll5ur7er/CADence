import { bevelMesh, centreDistance, type PartSpec } from '@core/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { partSession } from './testing';

/** Gears as parts, built by the kernel: ring gears with root fillets, shifted profiles (CAD-159) and bevel pairs (CAD-160). */
describe('gear parts', () => {
  let t: Awaited<ReturnType<typeof partSession>>;
  beforeEach(async () => {
    t = await partSession();
  });

  it('gives ring gears root fillets beyond the planets\' reach (CAD-159)', async () => {
    const ringGear: PartSpec = { kind: 'ring-gear', module: '2 mm', teeth: '60', width: '6 mm', outside: '140 mm', pressureAngle: '20 deg', helixAngle: '0 deg' };
    await t.part('ring', ringGear);
    // Two root fillets per tooth space: more faces than flanks, roots and tips alone.
    expect(t.session.state().bodies[0]?.faces.length).toBeGreaterThanOrEqual(60 * 6 + 3);
    const planet: PartSpec = { kind: 'gear', module: '2 mm', teeth: '18', width: '6 mm', bore: '0 mm', pressureAngle: '20 deg', helixAngle: '0 deg' };
    // Still at 2 × (60 − 18) / 2 = 42 mm the planet's teeth sit in the ring's spaces, clear of the fillets.
    expect(await t.overlap('planet', planet, { at: [42, 0] })).toBeLessThan(0.5);
  }, 60_000);

  it('shifts the profile of a gear of few teeth and meshes it at the shifted centre distance (CAD-159)', async () => {
    const pinion: PartSpec = { kind: 'gear', module: '2 mm', teeth: '8', width: '5 mm', bore: '0 mm', pressureAngle: '20 deg', helixAngle: '0 deg', shift: '0.55' };
    await t.part('pinion', pinion);
    const gear: PartSpec = { kind: 'gear', module: '2 mm', teeth: '20', width: '5 mm', bore: '0 mm', pressureAngle: '20 deg', helixAngle: '0 deg' };
    // 20 teeth: a tooth faces the pinion's; turned by half a tooth, a space does.
    const distance = centreDistance(2, 8, 20, 0.55, 0, Math.PI / 9);
    expect(distance).toBeGreaterThan(28);
    expect(await t.overlap('gear', gear, { at: [distance, 0], angle: '9 deg' })).toBeLessThan(0.5);
    // At the unshifted distance the shifted teeth bite.
    expect(await t.overlap('gear', gear, { at: [28, 0], angle: '9 deg' })).toBeGreaterThan(1);
  }, 60_000);

  it('meshes a bevel pair at right angles without interference (CAD-160)', async () => {
    const bevel: PartSpec = { kind: 'bevel-gear', module: '2 mm', teeth: '20', mateTeeth: '30', shaftAngle: '90 deg', faceWidth: '8 mm', bore: '6 mm', pressureAngle: '20 deg' };
    await t.part('pinion', bevel);
    const pinion = await t.volume();
    expect(pinion).toBeGreaterThan(1000);
    const mesh = bevelMesh(2, 20, 30, Math.PI / 2);
    expect((mesh.pitchAngle * 180) / Math.PI).toBeCloseTo(33.69, 2);
    // The mate: its large end on a plane parallel to YZ at x, facing back (flipped), its point z up.
    await t.add({ id: 'side', type: 'plane', name: '', suppressed: false, base: 'YZ', offset: `${mesh.mate[0]} mm` });
    const mate: PartSpec = { ...bevel, teeth: '30', mateTeeth: '20' };
    const placed = { plane: { plane: 'side' }, at: [0, mesh.mate[1]] as [number, number], flip: true };
    expect(await t.overlap('wheel', mate, { ...placed, angle: `${mesh.turn} deg` })).toBeLessThan(0.1);
    // A quarter of a tooth off, the teeth bite.
    expect(await t.overlap('wheel', mate, { ...placed, angle: `${mesh.turn + 3} deg` })).toBeGreaterThan(20);
  }, 120_000);
});
