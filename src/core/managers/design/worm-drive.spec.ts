import { type PartSpec, wormMesh } from '@core/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { partSession, unwrap } from './testing';

/** A worm and its wheel, built by the kernel (CAD-160): its own spec, so it has a kernel of its own. */
describe('worm drive', () => {
  let t: Awaited<ReturnType<typeof partSession>>;
  beforeEach(async () => {
    t = await partSession();
  });

  it('meshes a worm with its wheel without interference (CAD-160)', async () => {
    const wheel: PartSpec = { kind: 'worm-wheel', module: '1.5 mm', teeth: '30', starts: '1', leadAngle: '6 deg', width: '8 mm', bore: '6 mm', pressureAngle: '20 deg' };
    await t.part('wheel', wheel);
    const { distance } = wormMesh(1.5, 1, Math.PI / 30, 30);
    const worm: PartSpec = { kind: 'worm', module: '1.5 mm', starts: '1', leadAngle: '6 deg', length: '16 mm', bore: '0 mm', pressureAngle: '20 deg' };
    // The worm across the wheel, its point along −X and halfway up, in a sketch through the wheel's axis.
    expect(await t.overlap('worm', worm, { plane: 'XZ', at: [-distance, 4] })).toBeLessThan(0.01);
    // Its thread reaches into the teeth: a blank of the wheel's tip diameter overlaps it.
    // (Overlapping worm and wheel flanks are more than the kernel's booleans can cut.)
    unwrap(await t.session.execute({ type: 'delete-item', itemId: 'wheel' }));
    await t.part('blank', { kind: 'magnet', diameter: '48 mm', height: '8 mm' });
    expect(await t.overlap('worm', worm, { plane: 'XZ', at: [-distance, 4] })).toBeGreaterThan(5);
  }, 120_000);
});
