import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeCore } from '@core/composition/node';
import { afterAll, describe, expect, it } from 'vitest';
import { Cadence, type ComponentSummary } from './api';
import { McpServer } from './mcp';

const folders: string[] = [];
const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'cadence-libraries-'));
  folders.push(path);
  return path;
};
afterAll(() => folders.forEach((path) => rmSync(path, { recursive: true, force: true })));

const text = (result: unknown) => ((result as { result: { content: { text: string }[] } }).result.content[0] as { text: string }).text;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** An MCP server over projects in a folder, and a way to call its tools. */
function server() {
  const exports = folder();
  const core = createNodeCore({ projects: folder(), exports });
  const mcp = new McpServer(new Cadence(core, core.exports), { commands: '// the types' }, '1.2.3');
  let id = 0;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const answer = text(await mcp.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }));
    try {
      return JSON.parse(answer) as unknown;
    } catch {
      return answer;
    }
  };
  return { call, exports };
}

/** A 60 × 30 × 6 plate with ⌀3.4 holes at (15, 15) and (45, 15). */
async function plate(call: ReturnType<typeof server>['call'], document: string): Promise<string> {
  await call('edit_component', {
    document,
    commands: [
      { type: 'create-sketch', id: 's', plane: 'XY' },
      { type: 'add-rectangle', sketchId: 's', id: 'r', x: 0, y: 0, width: 60, height: 30 },
      { type: 'add-circle', sketchId: 's', id: 'a', x: 15, y: 15, diameter: 3.4 },
      { type: 'add-circle', sketchId: 's', id: 'b', x: 45, y: 15, diameter: 3.4 },
    ],
  });
  const profile = ((await call('get_component', { document, only: ['sketches'] })) as ComponentSummary).sketches[0]?.profiles.find((p) => p.holes === 2)?.id;
  await call('edit_component', { document, commands: [{ type: 'add-feature', feature: { type: 'extrude', id: 'e', name: '', suppressed: false, sketch: 's', profiles: [profile], distance: '6 mm', direction: 'normal', operation: 'new-body' } }] });
  return profile as string;
}

describe('standard parts in assemblies, for agents (CAD-152)', () => {
  it('screws two ISO 4762 screws into a plate’s holes and lists them in the bill of materials', { timeout: 240_000 }, async () => {
    const { call } = server();
    const created = (await call('create_project', { name: 'Bracket' })) as { project: { id: string }; component: { id: string } };
    await plate(call, created.component.id);
    // The holes' top edges: the circles where the hole walls meet the end face, at z 6.
    const edges = ((await call('get_component', { document: created.component.id, only: ['edges'] })) as ComponentSummary).bodies[0]?.edges ?? [];
    const edgeOf = (hole: string) => edges.find((e) => e.name.includes(`side:${hole}`) && e.name.includes(':end'))?.name;
    expect(edgeOf('a')).toBeDefined();

    expect(((await call('list_libraries', { library: 'standard', match: 'M3 ×' })) as { name: string }[]).map((p) => p.name)).toContain('ISO 4762 M3 × 12');
    const assembly = ((await call('create_document', { project: created.project.id, kind: 'assembly', name: 'Bracket assembly' })) as { id: string }).id;
    await call('edit_assembly', { document: assembly, commands: [{ type: 'insert-instance', instance: { id: 'plate', component: created.component.id, name: '', transform: identity, grounded: true } }] });
    for (const hole of ['a', 'b']) {
      const answer = await call('insert_library_part', { document: assembly, part: 'ISO 4762 M3 x 12', at: { instance: 'plate', ref: { kind: 'edge', body: 'e', name: edgeOf(hole) } } });
      expect(answer).toMatchObject({ part: { name: 'ISO 4762 M3 × 12', library: 'Standard parts' } });
    }
    const listed = (await call('get_assembly', { document: assembly })) as { instances: { id: string; origin: number[]; placed: boolean }[]; joints: { error?: string }[] };
    const screws = listed.instances.filter((i) => i.id.startsWith('screw-M3-12'));
    expect(screws.map((s) => s.placed)).toEqual([true, true]);
    // Each screw's origin, its head's underside, sits on its hole's top edge.
    expect(screws.map((s) => s.origin.map((v) => Math.round(v)))).toEqual([
      [15, 15, 6],
      [45, 15, 6],
    ]);
    expect(listed.joints.every((j) => !j.error)).toBe(true);
    // Both screws are one document of the project.
    expect(((await call('list_documents', { project: created.project.id })) as { name: string }[]).filter((d) => d.name === 'ISO 4762 M3 × 12')).toHaveLength(1);

    const properties = (await call('assembly_properties', { document: assembly })) as { billOfMaterials: { component: string; count: number; material: string; mass: number }[] };
    const line = properties.billOfMaterials.find((l) => l.component === 'ISO 4762 M3 × 12');
    expect(line).toMatchObject({ count: 2, material: 'Steel' });
    // About a gram: a 12 mm M3 shank and a ⌀5.5 × 3 head of steel.
    expect(line?.mass).toBeGreaterThan(0.5);
    expect(line?.mass).toBeLessThan(2);
  });
});

describe('libraries shared between projects, for agents (CAD-151)', () => {
  it('inserts a library part; the assembly follows when the library changes and the part is updated', { timeout: 240_000 }, async () => {
    const { call } = server();
    const library = (await call('create_project', { name: 'Brackets' })) as { project: { id: string }; component: { id: string } };
    await call('rename_document', { document: library.component.id, name: 'Plate' });
    const profile = await plate(call, library.component.id);
    expect(await call('library', { action: 'mark', project: library.project.id, on: true })).toMatchObject({ id: expect.any(String) });
    expect(((await call('list_libraries')) as { name: string }[]).map((l) => l.name)).toEqual(['Standard parts', 'Brackets']);

    const robot = (await call('create_project', { name: 'Robot' })) as { project: { id: string } };
    const assembly = ((await call('create_document', { project: robot.project.id, kind: 'assembly', name: 'Robot' })) as { id: string }).id;
    const inserted = (await call('insert_library_part', { document: assembly, library: 'Brackets', part: 'Plate' })) as { part: { id: string; version: string } };
    const volume = async () => ((await call('assembly_properties', { document: assembly })) as { volume: number }).volume;
    const before = await volume();
    expect(before).toBeCloseTo(60 * 30 * 6 - 2 * Math.PI * 1.7 ** 2 * 6, 0);
    // The copy is read only: it changes in the library.
    expect(String(await call('edit_component', { document: inserted.part.id, commands: [{ type: 'set-parameter', id: 'x', expression: '1' }] }))).toMatch(/comes from the library Brackets/);

    // The library's plate gets thicker; the robot keeps its version until it updates.
    await call('edit_component', { document: library.component.id, commands: [{ type: 'edit-feature', feature: { type: 'extrude', id: 'e', name: '', suppressed: false, sketch: 's', profiles: [profile], distance: '10 mm', direction: 'normal', operation: 'new-body' } }] });
    expect(await volume()).toBeCloseTo(before, 0);
    const updates = (await call('library', { action: 'updates', project: robot.project.id })) as { document: string; version: string; latest: string }[];
    expect(updates).toMatchObject([{ document: inserted.part.id, version: inserted.part.version }]);
    expect(await call('library', { action: 'update', project: robot.project.id })).toMatchObject([{ id: inserted.part.id }]);
    expect(await volume()).toBeCloseTo((before * 10) / 6, 0);
  });
});

describe('the trash and project notes, for agents (CAD-148, CAD-149)', () => {
  it('restores a deleted document and keeps notes with attachments', { timeout: 120_000 }, async () => {
    const { call, exports } = server();
    const created = (await call('create_project', { name: 'Lamp' })) as { project: { id: string }; component: { id: string } };
    expect(await call('delete_document', { document: created.component.id })).toMatch(/trash/);
    expect(await call('trash', { action: 'list' })).toMatchObject([{ kind: 'document', id: created.component.id, projectName: 'Lamp' }]);
    expect(await call('trash', { action: 'restore', id: created.component.id })).toBe('Restored Component 1.');
    expect(((await call('list_documents', { project: created.project.id })) as unknown[]).length).toBe(1);

    await call('project_notes', { action: 'set', project: 'Lamp', description: '# Lamp\nAn LED desk lamp.' });
    const notes = join(exports, 'wiring.md');
    writeFileSync(notes, 'Red to +5 V.');
    const attached = (await call('project_notes', { action: 'attach', project: 'Lamp', path: notes })) as { id: string };
    await call('project_notes', { action: 'attach', project: 'Lamp', url: 'https://example.com/led' });
    expect(await call('project_notes', { action: 'get', project: 'Lamp' })).toMatchObject({ description: '# Lamp\nAn LED desk lamp.', attachments: [{ name: 'wiring.md', mediaType: 'text/markdown' }, { kind: 'link', url: 'https://example.com/led' }] });
    expect(await call('project_notes', { action: 'read', project: 'Lamp', attachment: attached.id })).toBe('Red to +5 V.');
  });
});
