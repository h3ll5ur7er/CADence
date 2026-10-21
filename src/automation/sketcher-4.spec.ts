import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeCore } from '@core/composition/node';
import { afterAll, describe, expect, it } from 'vitest';
import { Cadence, type ComponentChanges, type ComponentSummary } from './api';
import { McpServer } from './mcp';

const folders: string[] = [];
afterAll(() => folders.forEach((path) => rmSync(path, { recursive: true, force: true })));

const text = (result: unknown) => ((result as { result: { content: { text: string }[] } }).result.content[0] as { text: string }).text;

describe('Sketcher IV for agents (CAD-153, CAD-154, CAD-155)', () => {
  it('measures with a reference dimension, places a block twice and engraves a wrapped scale', { timeout: 180_000 }, async () => {
    const exports = mkdtempSync(join(tmpdir(), 'cadence-sketcher-4-'));
    folders.push(exports);
    const core = createNodeCore({ exports });
    const server = new McpServer(new Cadence(core, core.exports), { commands: '// the types' }, '1.2.3');
    let id = 0;
    const call = async (name: string, args: Record<string, unknown> = {}) => server.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const document = (JSON.parse(text(await call('create_project', { name: 'Knob' }))) as { component: { id: string } }).component.id;

    // A 60 x 30 rectangle whose diagonal is measured, not driven.
    const measured = JSON.parse(
      text(
        await call('edit_component', {
          document,
          commands: [
            { type: 'create-sketch', id: 's1', plane: 'XY' },
            { type: 'add-rectangle', sketchId: 's1', id: 'r', x: 0, y: 0, width: 60, height: 30 },
            { type: 'add-constraint', sketchId: 's1', constraint: { id: 'diag', kind: 'distance', points: ['r:p1', 'r:p3'], expression: '', reference: true, name: 'diagonal' } },
          ],
        }),
      ),
    ) as ComponentChanges;
    expect(measured.sketches[0]).toMatchObject({ status: 'fully-constrained', references: [{ id: 'diag', name: 'diagonal', value: 67.082 }] });

    // A block of a tick, placed twice by a point, an angle and a scale.
    const blocks = JSON.parse(
      text(
        await call('edit_component', {
          document,
          commands: [
            { type: 'create-sketch', id: 's2', plane: 'XY' },
            { type: 'add-rectangle', sketchId: 's2', id: 't', x: 100, y: 0, width: 1, height: 5 },
            { type: 'make-block', sketchId: 's2', block: 'tick', name: 'Tick', ids: ['t:bottom', 't:right', 't:top', 't:left'], base: [100, 0], insertion: 'a' },
            {
              type: 'add-sketch-geometry',
              sketchId: 's2',
              entities: [
                { id: 'at', kind: 'point', x: 110, y: 0 },
                { id: 'b', kind: 'block', block: 'tick', origin: 'at', angle: '0 deg', scale: '2', construction: false },
              ],
              constraints: [],
            },
          ],
        }),
      ),
    ) as ComponentChanges;
    const s2 = blocks.sketches.find((s) => s.id === 's2');
    expect(s2?.profiles.map((p) => p.area).sort((x, y) => x - y)).toEqual([5, 20]);

    // A cylinder, and a scale wrapped round it, engraved.
    const knob = JSON.parse(
      text(
        await call('edit_component', {
          document,
          commands: [
            { type: 'create-sketch', id: 'base', plane: 'XY' },
            { type: 'add-circle', sketchId: 'base', id: 'rim', x: 0, y: 0, diameter: 24 },
          ],
        }),
      ),
    ) as ComponentChanges;
    const rim = knob.sketches.find((s) => s.id === 'base')?.profiles[0]?.id as string;
    unwrapOk(await call('edit_component', { document, commands: [{ type: 'add-feature', feature: { type: 'extrude', id: 'e1', name: '', suppressed: false, sketch: 'base', profiles: [rim], distance: '20 mm', direction: 'normal', operation: 'new-body' } }] }));
    const scale = JSON.parse(
      text(
        await call('edit_component', {
          document,
          commands: [
            { type: 'create-sketch', id: 'ticks', plane: 'XZ' },
            ...Array.from({ length: 8 }, (_, i) => ({ type: 'add-rectangle', sketchId: 'ticks', id: `k${i}`, x: i * 4 - 0.3, y: 8, width: 0.6, height: i % 4 === 0 ? 6 : 4 })),
          ],
        }),
      ),
    ) as ComponentChanges;
    const ticks = scale.sketches.find((s) => s.id === 'ticks')?.profiles.map((p) => p.id) ?? [];
    expect(ticks).toHaveLength(8);
    const summary = JSON.parse(text(await call('get_component', { document, only: ['faces'] }))) as ComponentSummary;
    const side = summary.bodies?.[0]?.faces?.find((f) => f.name.startsWith('f:e1:side:rim'))?.name as string;
    const before = await volume(call, document);
    const wrapped = JSON.parse(
      text(
        await call('edit_component', {
          document,
          commands: [{ type: 'add-feature', feature: { type: 'wrap', id: 'w1', name: '', suppressed: false, sketch: 'ticks', profiles: ticks, face: { kind: 'face', body: 'e1', name: side }, method: 'wrap', depth: '0.4 mm', operation: 'engrave' } }],
        }),
      ),
    ) as ComponentChanges;
    expect(wrapped.timeline?.find((item) => item.id === 'w1')).toMatchObject({ state: 'ok' });
    const cut = before - (await volume(call, document));
    // Two long ticks and six short ones, 0.6 mm wide, cut 0.4 mm deep.
    expect(cut).toBeGreaterThan((2 * 6 + 6 * 4) * 0.6 * 0.4 * 0.95);
    expect(cut).toBeLessThan((2 * 6 + 6 * 4) * 0.6 * 0.4);
  });
});

function unwrapOk(response: unknown): void {
  const result = (response as { result: { isError?: boolean; content: { text: string }[] } }).result;
  if (result.isError) throw new Error(result.content[0]?.text);
}

async function volume(call: (name: string, args: Record<string, unknown>) => Promise<unknown>, document: string): Promise<number> {
  const properties = JSON.parse(text(await call('component_properties', { document }))) as { bodies?: { volume: number }[] } | { volume: number }[];
  const list = Array.isArray(properties) ? properties : (properties.bodies ?? []);
  return list.reduce((sum, b) => sum + b.volume, 0);
}
