import { materials, springProperties } from '@core/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { partSession, unwrap } from './testing';

/** Springs as parts and helices as sweep paths, built by the kernel (CAD-161). */
describe('springs and helices', () => {
  let t: Awaited<ReturnType<typeof partSession>>;
  beforeEach(async () => {
    t = await partSession();
  });

  it('makes a compression spring of 8 turns: its length and its rate (CAD-161)', async () => {
    unwrap(await t.session.execute({ type: 'set-material', material: materials.find((m) => m.name === 'Steel') as (typeof materials)[number] }));
    await t.part('spring', { kind: 'compression-spring', wire: '1 mm', outside: '10 mm', pitch: '3 mm', turns: '8', ends: 'ground' });
    const [body] = await t.session.properties();
    // Closed and ground: 6 active turns, 3 × 6 + 2 × 1 = 20 mm free, 8 mm solid.
    expect(body?.box.max[2]).toBeCloseTo(20, 1);
    expect(body?.box.min[2]).toBeCloseTo(0, 3);
    expect((body?.box.max[0] ?? 0) - (body?.box.min[0] ?? 0)).toBeCloseTo(10, 1);
    // k = G d⁴ / (8 D³ n): G = 200 000 / 2.6 MPa, D = 9 mm, n = 6.
    expect(body?.spring).toMatchObject({ kind: 'compression', activeTurns: 6, freeLength: 20, solidLength: 8 });
    expect(body?.spring?.rate).toBeCloseTo(200_000 / 2.6 / (8 * 9 ** 3 * 6), 6);
    // The wire: about π · 9 · 8 turns long, π/4 mm² round, less the ground ends.
    expect(body?.volume).toBeGreaterThan(0.85 * Math.PI * 9 * 8 * (Math.PI / 4));
    expect(body?.volume).toBeLessThan(1.02 * Math.PI * 9 * 8 * (Math.PI / 4));
  }, 60_000);

  it('makes extension and torsion springs with their rates (CAD-161)', async () => {
    await t.part('pull', { kind: 'extension-spring', wire: '1 mm', outside: '8 mm', turns: '10' });
    await t.part('twist', { kind: 'torsion-spring', wire: '1 mm', outside: '10 mm', pitch: '1.2 mm', turns: '4', legs: '12 mm' }, { at: [30, 0] });
    const [pull, twist] = await t.session.properties();
    const pla = materials[0] as (typeof materials)[number];
    expect(pull?.spring).toEqual(springProperties({ kind: 'extension', wire: 1, mean: 7, turns: 10 }, pla));
    // Inside the hooks: 9 wires and twice the coil's mean diameter (a loop at each end).
    expect(pull?.spring?.freeLength).toBeCloseTo(23, 6);
    expect((pull?.box.max[2] ?? 0) - (pull?.box.min[2] ?? 0) - 2).toBeCloseTo(23, 0);
    expect(pull?.volume).toBeCloseTo(Math.PI * 7 * (10 + 2 * (300 / 360)) * (Math.PI / 4), -1);
    expect(twist?.spring?.kind).toBe('torsion');
    expect(twist?.spring?.activeTurns).toBeCloseTo(4 + 24 / (3 * Math.PI * 9), 9);
    // The legs reach out beyond the coil.
    expect((twist?.box.max[1] ?? 0) - (twist?.box.min[1] ?? 0)).toBeGreaterThan(2 * 12);
  }, 60_000);

  it('sweeps a profile along a helix feature, tapered too (CAD-161)', async () => {
    await t.add({ id: 'h', type: 'helix', name: '', suppressed: false, plane: 'XY', diameter: '20 mm', pitch: '5 mm', extent: 'turns', turns: '3', height: '', taper: '0 deg', leftHanded: false });
    expect(t.session.state().items.get('h')).toEqual({ state: 'ok' });
    expect(t.session.state().helices).toMatchObject([{ feature: 'h', radius: 10, pitch: 5, height: 15 }]);
    expect(t.session.state().bodies).toHaveLength(0);
    // A ⌀2 circle where the helix starts, across it (on XZ).
    unwrap(await t.session.execute({ type: 'create-sketch', id: 'p', plane: 'XZ' }));
    unwrap(await t.session.execute({ type: 'add-sketch-geometry', sketchId: 'p', entities: [{ id: 'c0', kind: 'point', x: 10, y: 0 }, { id: 'c', kind: 'circle', center: 'c0', radius: 1, construction: false }], constraints: [] }));
    const profile = t.session.state().sketches.get('p')?.profiles[0]?.id as string;
    await t.add({ id: 'coil', type: 'sweep', name: '', suppressed: false, sketch: 'p', profiles: [profile], path: 'h', operation: 'new-body' });
    expect(t.session.state().items.get('coil')).toEqual({ state: 'ok' });
    // π · 1² along 3 turns of √((π · 20)² + 5²).
    const wire = Math.PI * 3 * Math.hypot(Math.PI * 20, 5);
    expect(await t.volume()).toBeCloseTo(wire, -1);
    const [body] = await t.session.properties();
    expect(body?.box.max[2]).toBeCloseTo(16, 0);
    // Tapered 10° outwards: wider at the top.
    unwrap(await t.session.execute({ type: 'edit-feature', feature: { id: 'h', type: 'helix', name: 'Helix 1', suppressed: false, plane: 'XY', diameter: '20 mm', pitch: '5 mm', extent: 'height', turns: '', height: '15 mm', taper: '10 deg', leftHanded: false } }));
    expect(t.session.state().items.get('coil')).toEqual({ state: 'ok' });
    const [wider] = await t.session.properties();
    expect((wider?.box.max[0] ?? 0) - (wider?.box.min[0] ?? 0)).toBeGreaterThan(22 + 2 * 15 * Math.tan(Math.PI / 18) - 2);
    // Patterns run along sketches only.
    expect(await t.session.execute({ type: 'add-feature', feature: { id: 'pp', type: 'path-pattern', name: '', suppressed: false, features: ['coil'], path: 'h', count: '3', align: false } })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('A pattern runs along the curves of a sketch, not a helix.') },
    });
  }, 60_000);
});
