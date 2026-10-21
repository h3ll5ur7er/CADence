import { readFileSync } from 'node:fs';
import { createShapeAccess } from '@core/access/shape';
import { makeBox, measureVolume, type Shape3D } from 'replicad';
import { describe, expect, it } from 'vitest';
import { createInterchangeEngine } from './index';
import { chainLoops, modelNames, parseSexp, readKicadBoard } from './kicad';

const fixture = new Uint8Array(readFileSync(new URL('../../../../e2e/fixtures/sensor-board.kicad_pcb', import.meta.url)));
const ok = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

/** The board's area: 60 × 40 with 2 mm round corners, less an 8 × 6 cut-out, four M3 holes, four pins and a 3 × 1.2 slot. */
const area = 2400 - (4 - Math.PI) * 4 - 48 - 4 * Math.PI * 1.6 ** 2 - 4 * Math.PI * 0.5 ** 2 - (1.8 * 1.2 + Math.PI * 0.6 ** 2);

describe('KiCad boards (CAD-170)', () => {
  it('reads S-expressions, skipping tracks, vias and zones', () => {
    const root = parseSexp(new TextDecoder().decode(fixture)) as unknown[];
    expect(root[0]).toBe('kicad_pcb');
    const heads = root.filter(Array.isArray).map((e) => (e as string[])[0]);
    expect(heads).toContain('footprint');
    expect(heads).not.toContain('zone');
    expect(heads).not.toContain('segment');
    expect(heads).not.toContain('via');
    expect(parseSexp('(a "b \\"c\\"" (d 1))')).toEqual(['a', 'b "c"', ['d', '1']]);
  });

  it('chains outline pieces given in any order and direction into loops', () => {
    const loops = chainLoops([
      { kind: 'line', start: [0, 0], end: [10, 0] },
      { kind: 'line', start: [0, 10], end: [10, 10] },
      { kind: 'line', start: [10, 10.0004], end: [10, 0] },
      { kind: 'line', start: [0, 10], end: [0, 0] },
      { kind: 'line', start: [20, 0], end: [30, 0] },
      { kind: 'circle', center: [5, 5], radius: 1 },
    ]);
    expect(loops.map((l) => l.length).sort()).toEqual([1, 4]);
  });

  it('reads the outline, holes, parts and mounting holes of a board, with Y up', () => {
    const board = readKicadBoard(fixture);
    expect(board.thickness).toBe(1.6);
    expect(board.outline).toHaveLength(8);
    expect(board.cutouts).toHaveLength(1);
    expect(board.holes.map((h) => h.name).sort()).toEqual(['hole:H1', 'hole:H2', 'hole:H3', 'hole:H4', 'hole:J1:1', 'hole:J1:2', 'hole:J1:3', 'hole:J1:4', 'hole:SW1']);
    expect(board.mountingHoles).toEqual(['hole:H1', 'hole:H2', 'hole:H3', 'hole:H4']);
    const hole = (name: string) => board.holes.find((h) => h.name === name);
    expect(hole('hole:H1')).toMatchObject({ center: [104, -104], diameter: 3.2 });
    // The header turned by 90°: its pins run along +x from where it is.
    expect(hole('hole:J1:4')?.center[0]).toBeCloseTo(119.62, 6);
    expect(hole('hole:J1:4')?.center[1]).toBeCloseTo(-120, 6);
    expect(hole('hole:SW1')).toMatchObject({ diameter: 1.2, slot: { length: 3, angle: 0 } });

    expect(board.parts.map((p) => [p.reference, p.side, p.height]).sort()).toEqual([
      ['C1', 'bottom', 1.25],
      ['J1', 'top', 8.5],
      ['SW1', 'top', undefined],
      ['U1', 'top', undefined],
    ]);
    const header = board.parts.find((p) => p.reference === 'J1');
    const xs = header?.outline.map((p) => p[0]) ?? [];
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([expect.closeTo(110.2, 6), expect.closeTo(121.4, 6)]);
    expect(board.parts.find((p) => p.reference === 'U1')?.models).toEqual([{ name: 'soic-8_3.9x4.9mm_p1.27mm', offset: [0, 0, 0], rotate: [0, 0, 0], scale: [1, 1, 1] }]);
    expect(modelNames(new TextDecoder().decode(fixture))).toEqual(['soic-8_3.9x4.9mm_p1.27mm']);
    expect(modelNames('(model "C:\\\\My parts\\\\Big Relay.STEP") (model ${X}/a.wrl)')).toEqual(['big relay', 'a']);
  });

  it('refuses files that are no boards, or boards without an outline', () => {
    expect(() => readKicadBoard(new TextEncoder().encode('(kicad_sch (version 1))'))).toThrow('not a KiCad board');
    expect(() => readKicadBoard(new TextEncoder().encode('(kicad_pcb (version 20240108))'))).toThrow('no closed outline');
  });

  describe('as solids', () => {
    const shapes = createShapeAccess();
    const engine = createInterchangeEngine(shapes);

    it('makes the board with its holes named, and its parts as boxes, from the lower left corner', async () => {
      const [board, parts] = ok(await engine.readSolids(fixture, 'kicad_pcb', 'board-1'));
      const named = shapes.get(board as string);
      expect(measureVolume(named?.shape as Shape3D)).toBeCloseTo(area * 1.6, 3);
      expect(named?.shape.boundingBox.bounds).toEqual([
        [expect.closeTo(0, 6), expect.closeTo(0, 6), expect.closeTo(0, 6)],
        [expect.closeTo(60, 6), expect.closeTo(40, 6), expect.closeTo(1.6, 6)],
      ]);
      const names = [...(named?.faces.values() ?? [])].sort();
      expect(names).toEqual(['board:bottom', 'board:top', 'hole:H1', 'hole:H2', 'hole:H3', 'hole:H4', 'hole:J1:1', 'hole:J1:2', 'hole:J1:3', 'hole:J1:4', 'hole:SW1', 'hole:SW1']);
      // Parts: the header 8.5 tall over the board, the capacitor 1.25 under it, the others 3 tall.
      const box = (shapes.get(parts as string)?.shape as Shape3D).boundingBox.bounds;
      expect(box[1][2]).toBeCloseTo(1.6 + 8.5, 6);
      expect(box[0][2]).toBeCloseTo(-1.25, 6);
    });

    it('shows a board with what was made of it, and its parts as their STEP models when there', async () => {
      await shapes.ready();
      shapes.put('soic', { shape: makeBox([-2.45, -1.95, 0], [2.45, 1.95, 1.75]) as Shape3D, faces: new Map(), edges: new Map() });
      const step = await engine.exportBodies([{ name: 'SOIC', key: 'soic' }], 'step');
      const plain = ok(await engine.readMesh(fixture, 'kicad_pcb', 'preview-1'));
      expect(plain.board).toEqual({ thickness: 1.6, holes: 9, mountingHoles: ['hole:H1', 'hole:H2', 'hole:H3', 'hole:H4'], parts: 4, models: 0 });
      expect(plain.meshes.map((m) => m.faces[0]?.name)).toEqual(['Board', 'Parts']);
      expect(await engine.partFiles(fixture, 'kicad_pcb')).toEqual(['soic-8_3.9x4.9mm_p1.27mm']);
      const withModel = ok(await engine.readMesh(fixture, 'kicad_pcb', 'preview-2', new Map([['soic-8_3.9x4.9mm_p1.27mm', step]])));
      expect(withModel.board?.models).toBe(1);
      // The chip is its model now: 1.75 tall where the box was 3.
      const [keys] = [ok(await engine.readSolids(fixture, 'kicad_pcb', 'board-2', new Map([['soic-8_3.9x4.9mm_p1.27mm', step]])))];
      const parts = shapes.get(keys[1] as string)?.shape as Shape3D;
      const chip = parts.boundingBox.bounds;
      expect(chip[1][2]).toBeCloseTo(1.6 + 8.5, 6);
      expect(measureVolume(parts)).toBeLessThan(measureVolume(shapes.get(`board-1:1`)?.shape as Shape3D));
    });

    it('converts a board to STEP', async () => {
      const step = ok(await engine.convert(fixture, 'kicad_pcb', 'step'));
      expect(new TextDecoder().decode(step.slice(0, 200))).toContain('ISO-10303-21');
      expect(await engine.convert(fixture, 'step', 'kicad_pcb')).toMatchObject({ ok: false });
    });
  });
});
