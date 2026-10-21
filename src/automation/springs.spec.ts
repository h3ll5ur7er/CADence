import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeCore } from '@core/composition/node';
import { afterAll, describe, expect, it } from 'vitest';
import { Cadence } from './api';
import { McpServer } from './mcp';

const folders: string[] = [];
const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'cadence-springs-'));
  folders.push(path);
  return path;
};
afterAll(() => folders.forEach((path) => rmSync(path, { recursive: true, force: true })));

const text = (result: unknown) => ((result as { result: { content: { text: string }[] } }).result.content[0] as { text: string }).text;

describe('gears and springs for agents (phase 37)', () => {
  it('adds a spring and a helix with edit_component and reads the spring rate in component_properties (CAD-161)', { timeout: 120_000 }, async () => {
    const core = createNodeCore({ exports: folder() });
    const server = new McpServer(new Cadence(core, core.exports), { commands: '// the types' }, '1.2.3');
    let id = 0;
    const call = async (name: string, args: Record<string, unknown> = {}) => server.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const created = JSON.parse(text(await call('create_project', { name: 'Springs' }))) as { component: { id: string } };
    const part = created.component.id;
    const answer = text(
      await call('edit_component', {
        document: part,
        commands: [
          { type: 'set-material', material: { name: 'Steel', density: 7.85, youngsModulus: 200000, poisson: 0.3, yieldStrength: 250 } },
          { type: 'create-sketch', id: 's', plane: 'XY' },
          { type: 'add-sketch-geometry', sketchId: 's', entities: [{ id: 'p', kind: 'point', x: 0, y: 0 }], constraints: [] },
          { type: 'add-feature', feature: { type: 'part', id: 'spring', name: 'Spring', suppressed: false, sketch: 's', points: ['p'], angle: '0 deg', flip: false, operation: 'new-body', part: { kind: 'compression-spring', wire: '1 mm', outside: '10 mm', pitch: '3 mm', turns: '8', ends: 'ground' } } },
          { type: 'add-feature', feature: { type: 'helix', id: 'h', name: '', suppressed: false, plane: 'XY', diameter: '30 mm', pitch: '4 mm', extent: 'turns', turns: '2', height: '', taper: '0 deg', leftHanded: false } },
        ],
      }),
    );
    expect(answer).not.toContain('error');
    const [spring] = JSON.parse(text(await call('component_properties', { document: part }))) as { spring?: { rate: number; freeLength: number; activeTurns: number } }[];
    // 6 active turns of ⌀1 steel wire on a ⌀9 mean coil: about 2.2 N/mm, 20 mm long.
    expect(spring?.spring).toMatchObject({ activeTurns: 6, freeLength: 20 });
    expect(spring?.spring?.rate).toBeCloseTo(2.198, 3);
    const summary = JSON.parse(text(await call('get_component', { document: part, only: ['timeline'] }))) as { timeline: { id: string; state: string }[] };
    expect(summary.timeline.find((t) => t.id === 'h')).toMatchObject({ state: 'ok' });
  });
});
