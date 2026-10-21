import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeCore } from '@core/composition/node';
import { decodePicture } from '@core/utilities/picture';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Cadence, type ComponentChanges, type ComponentSummary, faceChanges } from './api';
import { desktopFolder, type Io, parseArguments, runCli } from './cli';
import { McpServer, serveStdio } from './mcp';

const repository = join(import.meta.dirname, '..', '..');
const folders: string[] = [];
const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'cadence-automation-'));
  folders.push(path);
  return path;
};
afterAll(() => folders.forEach((path) => rmSync(path, { recursive: true, force: true })));

/** What a command line printed. */
function recorder(): Io & { readonly lines: string[]; readonly errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, out: (text) => lines.push(text), err: (text) => errors.push(text) };
}

const text = (result: unknown) => ((result as { result: { content: { text: string }[] } }).result.content[0] as { text: string }).text;
const result = (response: unknown) => (response as { result: { isError?: boolean; content: { type: string; text?: string; data?: string }[] } }).result;

describe('the MCP server', () => {
  it('models, checks and exports the plate of its instructions', { timeout: 120_000 }, async () => {
    const exports = folder();
    const core = createNodeCore({ exports });
    const server = new McpServer(new Cadence(core, core.exports), { commands: '// the types' }, '1.2.3');
    let id = 0;
    const call = async (name: string, args: Record<string, unknown> = {}) => server.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });

    const init = (await server.handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26' } })) as { result: Record<string, unknown> };
    expect(init.result).toMatchObject({ protocolVersion: '2025-03-26', serverInfo: { name: 'cadence', version: '1.2.3' }, capabilities: { tools: {} } });
    expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined();
    const tools = (await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
    expect(tools.result.tools.map((t) => t.name)).toContain('edit_component');

    const created = JSON.parse(text(await call('create_project', { name: 'Plate' }))) as { component: { id: string } };
    const document = created.component.id;
    // Edits answer with what changed (CAD-102): the new sketch with its profiles.
    const sketched = JSON.parse(
      text(
        await call('edit_component', {
          document,
          commands: [
            { type: 'create-sketch', id: 's1', plane: 'XY' },
            { type: 'add-rectangle', sketchId: 's1', id: 'r', x: 0, y: 0, width: 60, height: 30 },
            { type: 'add-circle', sketchId: 's1', id: 'c', x: 15, y: 15, diameter: 8 },
          ],
        }),
      ),
    ) as ComponentChanges;
    expect(sketched.sketches[0]).toMatchObject({ id: 's1', status: 'fully-constrained' });
    expect(sketched).not.toHaveProperty('parameters');
    const plate = sketched.sketches[0]?.profiles.find((p) => p.area > 1000);
    expect(plate?.area).toBeCloseTo(1800 - Math.PI * 16, 0);

    const extruded = JSON.parse(
      text(
        await call('edit_component', {
          document,
          commands: [{ type: 'add-feature', feature: { type: 'extrude', id: 'e1', name: '', suppressed: false, sketch: 's1', profiles: [plate?.id], distance: '6 mm', direction: 'normal', operation: 'new-body' } }],
        }),
      ),
    ) as ComponentChanges;
    expect(extruded.timeline.map((t) => [t.name, t.state])).toEqual([['Extrude 1', 'ok']]);
    expect(extruded.sketches).toEqual([]);
    // Bottom, top, four sides and the hole (two halves).
    expect(extruded.bodies[0]).toMatchObject({ id: 'e1', faceCount: 8 });
    expect(extruded.bodies[0]?.newFaces).toBeUndefined(); // a new body: get_component lists its faces

    // get_component filters: the hole's faces, with their centres; the edge whose middle is at a point.
    const full = JSON.parse(text(await call('get_component', { document }))) as ComponentSummary;
    expect(full.timeline.map((t) => t.name)).toEqual(['Sketch 1', 'Extrude 1']);
    const hole = JSON.parse(text(await call('get_component', { document, only: ['faces'], match: 'f:e1:side:c*' }))) as ComponentSummary;
    expect(hole).not.toHaveProperty('timeline');
    expect(hole.bodies[0]?.faces?.map((f) => f.name).sort()).toEqual(['f:e1:side:c~1', 'f:e1:side:c~2']);
    expect(hole.bodies[0]?.faces?.[0]?.center[2]).toBeCloseTo(3);
    const corner = JSON.parse(text(await call('get_component', { document, only: ['edges'], near: [60, 15, 6], within: 1 }))) as ComponentSummary;
    expect(corner.bodies[0]?.edges?.map((e) => e.name)).toEqual(['e:f:e1:end|f:e1:side:r:right']);
    expect(corner.bodies[0]?.edges?.[0]?.middle).toHaveLength(3);
    // A point on the hole's wall finds it, though the wall's centre lies on its axis (CAD-111).
    const wall = JSON.parse(text(await call('get_component', { document, only: ['faces'], near: [15, 19, 1], within: 0.5 }))) as ComponentSummary;
    expect(wall.bodies[0]?.faces?.map((f) => f.name.split('~')[0])).toEqual(['f:e1:side:c']);

    const [properties] = JSON.parse(text(await call('component_properties', { document }))) as { volume: number }[];
    expect(properties?.volume).toBeCloseTo((1800 - Math.PI * 16) * 6, 0);
    const path = text(await call('export_component', { document, format: 'stl' }));
    expect(path.startsWith(exports)).toBe(true);
    expect(readFileSync(path).byteLength).toBeGreaterThan(84);
    expect(text(await call('command_reference', { topic: 'commands' }))).toBe('// the types');
    expect(text(await call('command_reference'))).toMatch(/^Topics: commands \(0k characters\)/);

    // A picture to look at: the plate from above, grey on white, with its hole.
    const picture = (await call('render_picture', { document, view: 'top', width: 120, height: 80 })) as { result: { content: { type: string; data: string; mimeType: string }[] } };
    const [image] = picture.result.content;
    expect(image).toMatchObject({ type: 'image', mimeType: 'image/png' });
    const pixels = await decodePicture(new Uint8Array(Buffer.from(image?.data ?? '', 'base64')));
    expect([pixels.width, pixels.height]).toEqual([120, 80]);
    const at = (x: number, y: number) => Array.from(pixels.data.subarray((y * 120 + x) * 4, (y * 120 + x) * 4 + 3));
    expect(at(1, 1)).toEqual([255, 255, 255]); // the ground
    expect(at(90, 40)[0]).toBeLessThan(230); // the plate

    // A refused command says which and why; the commands before it stay.
    const refused = (await call('edit_component', { document, commands: [{ type: 'rename-item', itemId: 'e1', name: 'Plate' }, { type: 'delete-item', itemId: 'nothing' }] })) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(refused.result.isError).toBe(true);
    expect(refused.result.content[0]?.text).toMatch(/^Command 2 \(delete-item\) was refused/);
    expect(JSON.parse(text(await call('get_component', { document }))).timeline[1].name).toBe('Plate');
    expect(await server.handle({ jsonrpc: '2.0', id: 99, method: 'sampling/createMessage' })).toMatchObject({ error: { code: -32601 } });

    // Documents can be renamed and deleted (CAD-108).
    expect(text(await call('rename_document', { document, name: 'Plate' }))).toBe('Renamed to Plate.');
    const project = (JSON.parse(text(await call('list_projects'))) as { id: string }[])[0]?.id as string;
    expect((JSON.parse(text(await call('list_documents', { project }))) as { name: string }[]).map((d) => d.name)).toEqual(['Plate']);
    const scrap = JSON.parse(text(await call('create_document', { project, kind: 'component', name: 'Scrap' }))) as { id: string };
    expect(text(await call('delete_document', { document: scrap.id }))).toBe('Moved Scrap to the trash (restore it with trash).');
    expect((JSON.parse(text(await call('list_documents', { project }))) as unknown[]).length).toBe(1);
  });

  it('assembles, moves, explodes and checks an assembly (CAD-97, CAD-100)', { timeout: 180_000 }, async () => {
    const exports = folder();
    const core = createNodeCore({ exports });
    const server = new McpServer(new Cadence(core, core.exports), { commands: '// the types' }, '1.2.3');
    let id = 0;
    const call = async (name: string, args: Record<string, unknown> = {}) => server.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });

    // A 40 × 10 × 4 bar with a hole at each end, to hinge two of them.
    const created = JSON.parse(text(await call('create_project', { name: 'Linkage' }))) as { project: { id: string }; component: { id: string } };
    const bar = created.component.id;
    await call('edit_component', {
      document: bar,
      commands: [
        { type: 'create-sketch', id: 's', plane: 'XY' },
        { type: 'add-rectangle', sketchId: 's', id: 'r', x: -5, y: -5, width: 50, height: 10 },
        { type: 'add-circle', sketchId: 's', id: 'a', x: 0, y: 0, diameter: 4 },
        { type: 'add-circle', sketchId: 's', id: 'b', x: 40, y: 0, diameter: 4 },
      ],
    });
    const profile = (JSON.parse(text(await call('get_component', { document: bar, only: ['sketches'] }))) as ComponentSummary).sketches[0]?.profiles.find((p) => p.holes === 2)?.id;
    await call('edit_component', { document: bar, commands: [{ type: 'add-feature', feature: { type: 'extrude', id: 'bar', name: '', suppressed: false, sketch: 's', profiles: [profile], distance: '4 mm', direction: 'normal', operation: 'new-body' } }] });

    const linkage = (JSON.parse(text(await call('create_document', { project: created.project.id, kind: 'assembly', name: 'Linkage' }))) as { id: string }).id;
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const hinged = JSON.parse(
      text(
        await call('edit_assembly', {
          document: linkage,
          commands: [
            { type: 'insert-instance', instance: { id: 'base', component: bar, name: '', transform: identity, grounded: true } },
            { type: 'insert-instance', instance: { id: 'arm', component: bar, name: '', transform: identity, grounded: false } },
            // The arm's origin (its first hole) on the base's second hole, 4 mm higher.
            { type: 'add-joint', joint: { id: 'hinge', name: '', type: 'revolute', a: { instance: 'base', offset: { translate: [40, 0, 4], angle: 0 } }, b: { instance: 'arm' }, flip: false, values: [90], limits: [null] } },
          ],
        }),
      ),
    ) as { created: { instances: unknown[]; joints: unknown[] }; counts: { instances: number } };
    expect(hinged.counts.instances).toBe(2);
    expect(hinged.created.instances).toHaveLength(2);
    expect(hinged.created.joints).toHaveLength(1);
    // Turning the hinge answers with its values and where the arm went, not the whole joint (CAD-111).
    const turned = JSON.parse(text(await call('edit_assembly', { document: linkage, commands: [{ type: 'set-joint-values', jointId: 'hinge', values: [45] }] })));
    expect(turned).toMatchObject({ joints: [{ id: 'hinge', values: [45] }] });
    expect(turned).not.toHaveProperty('created');
    expect(turned).not.toHaveProperty('changed');
    await call('edit_assembly', { document: linkage, commands: [{ type: 'set-joint-values', jointId: 'hinge', values: [90] }] });
    const listed = JSON.parse(text(await call('get_assembly', { document: linkage }))) as { instances: { id: string; origin: number[]; placed: boolean }[]; joints: { id: string; error?: string }[] };
    const arm = listed.instances.find((i) => i.id === 'arm');
    expect(arm?.placed).toBe(true);
    expect(arm?.origin.map((v) => Math.round(v))).toEqual([40, 0, 4]);
    expect(listed.joints[0]?.error).toBeUndefined();
    expect(JSON.parse(text(await call('check_assembly', { document: linkage })))).toEqual([]);

    // A study turns the hinge; an exploded view lifts the arm; pictures show both.
    await call('edit_assembly', {
      document: linkage,
      commands: [
        { type: 'add-study', study: { id: 'swing', name: 'Swing', duration: 1, keys: [], drives: [{ joint: 'hinge', dof: 0, speed: 180 }] } },
        { type: 'set-exploded-view', view: { id: 'apart', name: 'Apart', steps: [{ id: 'up', instances: ['arm'], direction: [0, 0, 1], distance: 30 }] } },
      ],
    });
    const png = async (args: Record<string, unknown>) => {
      const picture = result(await call('render_picture', { document: linkage, width: 160, height: 120, ...args }));
      expect(picture.isError, picture.content[0]?.text).toBeUndefined();
      return decodePicture(new Uint8Array(Buffer.from(picture.content[0]?.data ?? '', 'base64')));
    };
    const filled = (p: Awaited<ReturnType<typeof png>>) => Array.from({ length: p.width * p.height }, (_, i) => p.data[i * 4] as number).filter((r) => r < 250).length;
    const standing = await png({ view: 'front' });
    const exploded = await png({ view: 'front', explode: 'apart' });
    expect(filled(exploded)).not.toBe(filled(standing));
    await png({ study: 'swing', time: 0.5, view: 'top' });
    await png({ direction: [1, 1, 3], up: [0, 0, 1], focus: ['arm'], ghost: ['base'] });
    const wrong = result(await call('render_picture', { document: linkage, focus: ['nothing'] }));
    expect(wrong.isError).toBe(true);
    expect(wrong.content[0]?.text).toContain('There is no body or instance "nothing"');

    // A study's collision check tells how far it got, when the client asks for progress (CAD-114).
    const notes: Record<string, unknown>[] = [];
    const checked = await server.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'check_assembly', arguments: { document: linkage, study: 'swing', fps: 2 }, _meta: { progressToken: 'p1' } } }, (n) => notes.push(n));
    expect(JSON.parse(text(checked))).toMatchObject({ checked: 3, moments: 3 });
    expect(notes.map((n) => (n['params'] as { progress: number }).progress)).toEqual([1, 2, 3]);
    expect(notes[0]).toMatchObject({ method: 'notifications/progress', params: { progressToken: 'p1', total: 3, message: 'Moment 1 of 3 checked' } });

    const animated = result(await call('animate_study', { document: linkage, study: 'swing', width: 120, height: 90, fps: 4, moments: 4 }));
    expect(animated.content.map((c) => c.type)).toEqual(['image', 'text']);
    // Whole turns: a sheet of nine shows only the four poses a turn has at four frames a second (CAD-122).
    await call('edit_assembly', { document: linkage, commands: [{ type: 'add-study', study: { id: 'turns', name: 'Turns', duration: 2, keys: [], drives: [{ joint: 'hinge', dof: 0, speed: 360 }] } }] });
    const turns = result(await call('animate_study', { document: linkage, study: 'turns', width: 120, height: 90, fps: 4, moments: 9 }));
    expect(turns.content[1]?.text).toContain('The sheet shows the moments 0, 0.25, 0.5, 0.75 s. The study repeats itself: only 4 moments show different poses.');
    await call('undo_assembly', { document: linkage });
    const gif = /at (.+\.gif)\./.exec(animated.content[1]?.text ?? '')?.[1] as string;
    expect(new TextDecoder().decode(readFileSync(gif).subarray(0, 6))).toBe('GIF89a');

    const properties = JSON.parse(text(await call('assembly_properties', { document: linkage }))) as { billOfMaterials: { count: number }[] };
    expect(properties.billOfMaterials[0]?.count).toBe(2);
    expect(text(await call('export_assembly', { document: linkage, format: 'step' }))).toMatch(/\.step$/);
    const undone = JSON.parse(text(await call('undo_assembly', { document: linkage }))) as { removed?: string[] };
    expect(undone.removed).toEqual(['apart']); // one command at a time
  });
});

describe('everything the app does, for agents (CAD-124)', () => {
  it('manages projects, versions and git', { timeout: 180_000 }, async () => {
    const core = createNodeCore({ projects: folder(), exports: folder() });
    const mcp = new McpServer(new Cadence(core, core.exports), { commands: '// the types' }, '1.2.3');
    let id = 0;
    const call = async (name: string, args: Record<string, unknown> = {}) => mcp.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const json = async (name: string, args: Record<string, unknown>) => JSON.parse(text(await call(name, args))) as Record<string, unknown>;

    const made = (await json('create_project_from_template', { template: 'wall-bracket', name: 'Bracket' })) as { project: { id: string }; documents: { id: string; kind: string }[] };
    expect(made.documents.map((d) => d.kind)).toContain('component');
    const project = made.project.id;
    expect(text(await call('rename_project', { project, name: 'Pipe bracket' }))).toBe('Renamed to Pipe bracket.');
    expect(await json('duplicate', { project: 'Pipe bracket' })).toMatchObject({ name: expect.stringContaining('Pipe bracket') });
    const part = (made.documents.find((d) => d.kind === 'component') as { id: string }).id;
    expect(await json('duplicate', { document: part })).toMatchObject({ kind: 'component' });

    // Versions: recorded, named, listed, and a document restored.
    const recorded = (await json('versions', { action: 'record', project, message: 'First fit' })) as { id: string; message: string };
    expect(recorded.message).toBe('First fit');
    expect(text(await call('versions', { action: 'name', project, name: 'v1' }))).toBe('Named v1.');
    await call('rename_document', { document: part, name: 'Renamed part' });
    expect((await json('versions', { action: 'list', project })) as unknown).toEqual(expect.arrayContaining([expect.objectContaining({ names: ['v1'] })]));
    // Compared in words (CAD-175): renamed, and the same body.
    const compared = (await json('versions', { action: 'compare', document: part, version: recorded.id })) as { changes: string[]; volume: Record<string, number> };
    expect(compared.changes).toContainEqual(expect.stringMatching(/^Changed Name: .* → Renamed part$/));
    expect(compared.volume).toMatchObject({ added: 0, removed: 0 });
    expect(compared.volume['before']).toBeGreaterThan(0);
    expect(text(await call('versions', { action: 'restore', document: part, version: recorded.id }))).toBe(`Restored as of ${recorded.id}.`);
    expect((await core.projectManager.findDocument(part as never))?.name).not.toBe('Renamed part');

    // An archive with its history, back in as a new project.
    const archive = text(await call('export_project', { project, history: true }));
    expect(archive).toMatch(/\.cadence$/);
    expect(await json('import_project', { path: archive })).toMatchObject({ name: 'Pipe bracket' });

    // Git (synced for real in the Project Manager's tests): the tools reach it, and say when a repository is not there.
    const url = 'http://127.0.0.1:9/bracket.git';
    expect(text(await call('sync_project', { project, url }))).toContain('(remote-unreachable)');
    expect(text(await call('open_git', { url }))).toContain('(remote-unreachable)');

    expect(text(await call('delete_project', { project }))).toBe('Moved Pipe bracket to the trash (restore it with trash).');
    // The archive brought back in is left (the copy has a name of its own).
    expect((await core.projectManager.listProjects()).filter((p) => p.name === 'Pipe bracket')).toHaveLength(1);
  });

  it('measures, checks sketches, imports into sketches, exports viewers, tables and instructions', { timeout: 240_000 }, async () => {
    const core = createNodeCore({ exports: folder() });
    const mcp = new McpServer(new Cadence(core, core.exports), { commands: '// the types' }, '1.2.3');
    let id = 0;
    const call = async (name: string, args: Record<string, unknown> = {}) => mcp.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const json = async (name: string, args: Record<string, unknown>) => JSON.parse(text(await call(name, args))) as Record<string, unknown>;
    const created = (await json('create_project', { name: 'Parity' })) as { project: { id: string }; component: { id: string } };
    const block = created.component.id;

    // A free sketch: its points still move, and the sketcher suggests relations.
    const line = [{ id: 'a', kind: 'point', x: 0, y: 0 }, { id: 'b', kind: 'point', x: 20, y: 0.001 }, { id: 'ab', kind: 'line', start: 'a', end: 'b', construction: false }];
    await call('edit_component', { document: block, commands: [{ type: 'create-sketch', id: 'free', plane: 'XY' }, { type: 'add-sketch-geometry', sketchId: 'free', entities: line, constraints: [] }] });
    const free = (await json('check_sketch', { document: block, sketch: 'free' })) as { fullyConstrained: boolean; points: unknown[]; suggestions: { kind: string }[] };
    expect(free.fullyConstrained).toBe(false);
    expect(free.points.length).toBeGreaterThan(0);
    expect(free.suggestions.map((s) => s.kind)).toContain('horizontal');
    expect(result(await call('edit_component', { document: block, commands: [{ type: 'add-suggested-constraints', sketchId: 'free', idPrefix: 'hint' }] })).isError).toBeUndefined();

    // A 20 mm cube: measured, exported as a viewer; a configuration table read from CSV.
    await call('edit_component', { document: block, commands: [{ type: 'add-parameter', parameter: { id: 'p', name: 'size', expression: '20 mm' } }, { type: 'create-sketch', id: 's', plane: 'XY' }, { type: 'add-rectangle', sketchId: 's', id: 'r', x: 0, y: 0, width: 'size', height: 'size' }] });
    const profile = (JSON.parse(text(await call('get_component', { document: block, only: ['sketches'], sketch: 's' }))) as ComponentSummary).sketches[0]?.profiles[0]?.id;
    await call('edit_component', { document: block, commands: [{ type: 'add-feature', feature: { type: 'extrude', id: 'e', name: '', suppressed: false, sketch: 's', profiles: [profile], distance: 'size', direction: 'normal', operation: 'new-body' } }] });
    const top = { kind: 'face', body: 'e', name: 'f:e:end' };
    expect(await json('measure', { document: block, refs: [top] })).toMatchObject({ area: expect.closeTo(400, 6) });
    expect(text(await call('export_component', { document: block, format: 'html' }))).toMatch(/\.html$/);
    const table = result(await call('edit_component', { document: block, commands: [{ type: 'import-configurations', csv: 'Configuration,size\nSmall,10 mm\nLarge,40 mm\n' }] }));
    expect(table.isError, table.content[0]?.text).toBeUndefined();
    expect(readFileSync(text(await call('export_component', { document: block, format: 'csv' })), 'utf8')).toContain('Large');
    // Undone and redone.
    expect(result(await call('undo_component', { document: block })).isError).toBeUndefined();
    expect(result(await call('undo_component', { document: block, redo: true })).isError).toBeUndefined();

    // An SVG into a sketch; an STL pictured as it was read.
    const svg = (await json('import_file', { project: created.project.id, path: join(repository, 'e2e', 'fixtures', 'plate.svg') })) as { id: string };
    const inserted = result(await call('edit_component', { document: block, commands: [{ type: 'create-sketch', id: 'traced', plane: 'XY' }, { type: 'insert-drawing', sketchId: 'traced', document: svg.id, idPrefix: 'svg' }] }));
    expect(inserted.isError, inserted.content[0]?.text).toBeUndefined();
    const stl = (await json('import_file', { project: created.project.id, path: join(repository, 'e2e', 'fixtures', 'wedge.stl') })) as { id: string };
    expect(result(await call('render_picture', { document: stl.id, width: 120, height: 90 })).content[0]?.type).toBe('image');
    expect(result(await call('render_picture', { document: svg.id })).content[0]?.text).toContain('not a 3D file');
    // A mesh kept simplified as well; a circuit board with its holes named for joints (CAD-169, CAD-170).
    const simplified = (await json('import_file', { project: created.project.id, path: join(repository, 'e2e', 'fixtures', 'wedge.stl'), triangles: 4 })) as { simplified: { name: string; triangles: number } };
    expect(simplified.simplified).toMatchObject({ name: 'wedge (simplified)', triangles: expect.any(Number) });
    const board = (await json('import_file', { project: created.project.id, path: join(repository, 'e2e', 'fixtures', 'sensor-board.kicad_pcb') })) as { board: { mountingHoles: string[] } };
    expect(board.board.mountingHoles).toEqual(['hole:H1', 'hole:H2', 'hole:H3', 'hole:H4']);

    // A section through the cube's middle shows less of it than the whole cube.
    const ink = async (args: Record<string, unknown>) => {
      const picture = await decodePicture(new Uint8Array(Buffer.from(result(await call('render_picture', { document: block, width: 120, height: 120, view: 'front', ...args })).content[0]?.data ?? '', 'base64')));
      return Array.from({ length: picture.width * picture.height }, (_, i) => picture.data[i * 4] as number).filter((r) => r < 250).length;
    };
    expect(await ink({ section: { point: [0, 0, 10], normal: [0, 0, 1] } })).toBeLessThan((await ink({})) * 0.75);

    // An assembly of two cubes: measured between instances, its parts list, viewer and build instructions.
    const assembly = ((await json('create_document', { project: created.project.id, kind: 'assembly' })) as { id: string }).id;
    const at = (x: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
    await call('edit_assembly', {
      document: assembly,
      commands: [
        { type: 'insert-instance', instance: { id: 'a', component: block, name: '', transform: at(0), grounded: true } },
        { type: 'insert-instance', instance: { id: 'b', component: block, name: '', transform: at(50), grounded: true } },
        { type: 'set-exploded-view', view: { id: 'apart', name: 'Apart', steps: [{ id: 'up', instances: ['b'], direction: [0, 0, 1], distance: 30 }] } },
      ],
    });
    const between = result(await call('measure', { document: assembly, refs: [{ ...top, instance: 'a' }, { ...top, instance: 'b' }] }));
    expect(between.isError, between.content[0]?.text).toBeUndefined();
    expect(readFileSync(text(await call('export_assembly', { document: assembly, format: 'csv' })), 'utf8')).toContain('Component 1');
    expect(text(await call('export_assembly', { document: assembly, format: 'html' }))).toMatch(/\.html$/);
    const instructions = text(await call('export_assembly', { document: assembly, format: 'pdf', explode: 'apart' }));
    expect(readFileSync(instructions, 'latin1')).toContain('/FlateDecode');
    expect(result(await call('export_assembly', { document: assembly, format: 'pdf' })).content[0]?.text).toContain('exploded view');
    expect(result(await call('undo_assembly', { document: assembly, redo: true })).isError).toBeUndefined();
  });
});

describe('drawings for agents (CAD-123)', () => {
  it('draws a component with views, a section, dimensions and a callout, and exports the sheet', { timeout: 180_000 }, async () => {
    const core = createNodeCore({ exports: folder() });
    const server = new McpServer(new Cadence(core, core.exports), { drawing: '// the types' }, '1.2.3');
    let id = 0;
    const call = async (name: string, args: Record<string, unknown> = {}) => server.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const json = async (name: string, args: Record<string, unknown>) => JSON.parse(text(await call(name, args))) as Record<string, unknown>;
    const created = (await json('create_project', { name: 'Drawn' })) as { project: { id: string }; component: { id: string } };
    const plate = created.component.id;
    await call('edit_component', { document: plate, commands: [{ type: 'create-sketch', id: 's', plane: 'XY' }, { type: 'add-rectangle', sketchId: 's', id: 'r', x: 0, y: 0, width: 60, height: 30 }, { type: 'add-circle', sketchId: 's', id: 'c', x: 20, y: 15, diameter: 8 }] });
    const profile = (JSON.parse(text(await call('get_component', { document: plate, only: ['sketches'] }))) as ComponentSummary).sketches[0]?.profiles.find((p) => p.holes === 1)?.id;
    await call('edit_component', { document: plate, commands: [{ type: 'add-feature', feature: { type: 'extrude', id: 'e', name: '', suppressed: false, sketch: 's', profiles: [profile], distance: '6 mm', direction: 'normal', operation: 'new-body' } }] });

    const sheet = (await json('create_document', { project: created.project.id, kind: 'drawing', name: 'Plate drawing' })) as { id: string; kind: string };
    expect(sheet.kind).toBe('drawing');
    const placed = await json('edit_drawing', {
      document: sheet.id,
      commands: [
        { type: 'set-sheet', sheet: { size: 'A3', orientation: 'landscape', scale: 2 } },
        { type: 'add-view', view: { id: 'top', source: plate, direction: 'top', at: [120, 200] } },
        { type: 'add-view', view: { id: 'front', source: plate, direction: 'front', at: [120, 90] } },
        { type: 'add-view', view: { id: 'right', source: plate, direction: 'right', at: [260, 90] } },
        { type: 'add-view', view: { id: 'cut', source: plate, direction: 'front', at: [330, 200], section: { offset: 0 }, label: 'Section A-A' } },
      ],
    });
    expect(placed).toMatchObject({ created: { views: ['top', 'front', 'right', 'cut'] }, changed: { sheet: true }, placed: { top: { min: [60, 170], max: [180, 230] } } });
    expect(placed).not.toHaveProperty('viewErrors');

    // What the top view offers to dimension: its corners and the hole.
    const anchors = (await json('get_drawing', { document: sheet.id, view: 'top' })) as { anchors: { view: string; kind: string; ref: string; at: number[]; radius?: number }[]; anchorCounts: Record<string, number> };
    expect(anchors.anchorCounts['front']).toBeGreaterThan(0);
    const points = anchors.anchors.filter((a) => a.kind === 'point').sort((a, b) => (a.at[0] as number) - (b.at[0] as number));
    const circle = anchors.anchors.find((a) => a.kind === 'circle' && a.radius === 8); // ⌀8 at 2:1
    // Annotations attach by the anchors' short handles (CAD-128).
    const ref = (a: { view: string; ref: string } | undefined) => ({ view: a?.view, ref: a?.ref });
    expect(circle).toBeDefined();
    expect((await json('get_drawing', { document: sheet.id, near: circle?.at, within: 1 }))['anchors']).toEqual(expect.arrayContaining([expect.objectContaining({ ref: circle?.ref })]));
    const annotated = await json('edit_drawing', {
      document: sheet.id,
      commands: [
        { type: 'add-annotation', annotation: { kind: 'dimension', id: 'width', type: 'horizontal', anchors: [ref(points[0]), ref(points.at(-1))], offset: 12 } },
        { type: 'add-annotation', annotation: { kind: 'dimension', id: 'hole', type: 'diameter', anchors: [ref(circle)], offset: 8 } },
        { type: 'add-annotation', annotation: { kind: 'callout', id: 'call', circle: ref(circle), at: [200, 255] } },
      ],
    });
    expect(annotated).toMatchObject({ created: { annotations: ['width', 'hole', 'call'] } });
    expect(annotated).not.toHaveProperty('lost');
    expect(await call('edit_drawing', { document: sheet.id, commands: [{ type: 'add-annotation', annotation: { kind: 'center-mark', id: 'm', circle: { view: 'top', ref: 'cnope' } } }] })).toMatchObject({
      result: { isError: true, content: [{ text: expect.stringContaining('View top has no anchor cnope') }] },
    });

    const picture = result(await call('render_picture', { document: sheet.id, width: 840 }));
    expect(picture.content[0]?.type).toBe('image');
    const zoomed = await decodePicture(new Uint8Array(Buffer.from(result(await call('render_picture', { document: sheet.id, width: 300, focus: ['top'] })).content[0]?.data ?? '', 'base64')));
    expect(zoomed.width).toBe(300);
    const pdf = text(await call('export_drawing', { document: sheet.id, format: 'pdf' }));
    expect(new TextDecoder().decode(readFileSync(pdf).subarray(0, 8))).toBe('%PDF-1.4');
    expect(text(await call('export_drawing', { document: sheet.id, format: 'dxf' }))).toMatch(/Plate drawing\.dxf$/);
    // Undone and redone, one command at a time.
    expect(await json('undo_drawing', { document: sheet.id })).toMatchObject({ removed: ['call'] });
    expect(await json('undo_drawing', { document: sheet.id, redo: true })).toMatchObject({ created: { annotations: ['call'] } });
    // A fit on the hole, and a surface finish symbol on an edge by its handle (CAD-165).
    const edge = ((await json('get_drawing', { document: sheet.id, view: 'top', kind: 'line' })) as typeof anchors).anchors[0];
    const finished = await json('edit_drawing', {
      document: sheet.id,
      commands: [
        { type: 'add-annotation', annotation: { kind: 'dimension', id: 'fit', type: 'diameter', anchors: [ref(circle)], offset: 14, angle: 225, tolerance: { kind: 'fit', fit: 'H7' } } },
        { type: 'add-annotation', annotation: { kind: 'surface-finish', id: 'ra', at: [150, 245], edge: ref(edge), process: 'removal', roughness: 'Ra 1.6' } },
      ],
    });
    expect(finished).toMatchObject({ created: { annotations: ['fit', 'ra'] } });
    expect(finished).not.toHaveProperty('lost');
    const listed = (await json('get_drawing', { document: sheet.id, only: ['annotations'] })) as { annotations: { id: string; edge?: { ref?: string } }[] };
    expect(listed.annotations.find((a) => a.id === 'ra')?.edge?.ref).toBe(edge?.ref);
    expect(text(await call('command_reference', {}))).toContain('drawing');
  });
});

describe('short drawing answers (CAD-128) and configurations in views (CAD-126)', () => {
  it('lists the anchors asked for, once per place, with short handles and model points', { timeout: 180_000 }, async () => {
    const core = createNodeCore({ exports: folder() });
    const server = new McpServer(new Cadence(core, core.exports), { drawing: '// the types' }, '1.2.3');
    let id = 0;
    const call = async (name: string, args: Record<string, unknown> = {}) => server.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const json = async (name: string, args: Record<string, unknown>) => JSON.parse(text(await call(name, args))) as Record<string, unknown>;
    const created = (await json('create_project', { name: 'Short' })) as { project: { id: string }; component: { id: string } };
    const plate = created.component.id;
    // A 60 × 30 × 6 plate with ⌀8 and ⌀4 holes, and a configuration 12 thick.
    await call('edit_component', {
      document: plate,
      commands: [
        { type: 'add-parameter', parameter: { id: 't', name: 'thickness', expression: '6 mm' } },
        { type: 'create-sketch', id: 's', plane: 'XY' },
        { type: 'add-rectangle', sketchId: 's', id: 'r', x: 0, y: 0, width: 60, height: 30 },
        { type: 'add-circle', sketchId: 's', id: 'c', x: 20, y: 15, diameter: 8 },
        { type: 'add-circle', sketchId: 's', id: 'd', x: 45, y: 15, diameter: 4 },
        { type: 'set-configurations', configurations: [{ id: 'thick', name: 'Thick', values: { thickness: '12 mm' } }] },
      ],
    });
    const profile = (JSON.parse(text(await call('get_component', { document: plate, only: ['sketches'] }))) as ComponentSummary).sketches[0]?.profiles.find((p) => p.holes === 2)?.id;
    await call('edit_component', { document: plate, commands: [{ type: 'add-feature', feature: { type: 'extrude', id: 'e', name: '', suppressed: false, sketch: 's', profiles: [profile], distance: 'thickness', direction: 'normal', operation: 'new-body' } }] });
    const sheet = (await json('create_document', { project: created.project.id, kind: 'drawing', name: 'Plate drawing' })) as { id: string };
    const placed = await json('edit_drawing', {
      document: sheet.id,
      commands: [
        { type: 'add-view', view: { id: 'top', source: plate, direction: 'top', at: [120, 200] } },
        { type: 'add-view', view: { id: 'front', source: plate, direction: 'front', at: [120, 90] } },
        { type: 'add-view', view: { id: 'thick', source: plate, configuration: 'thick', direction: 'front', at: [300, 90] } },
      ],
    });
    // The thick configuration's view is twice as tall (12 instead of 6, at 1:1).
    const height = (box: { min: number[]; max: number[] }) => Math.round((box.max[1] as number) - (box.min[1] as number));
    const boxes = (placed as { placed: Record<string, { min: number[]; max: number[] }> }).placed;
    expect([height(boxes['front'] as never), height(boxes['thick'] as never)]).toEqual([6, 12]);

    // Without a filter: no anchors, only how many each view offers.
    const plain = await json('get_drawing', { document: sheet.id });
    expect(plain).not.toHaveProperty('anchors');
    expect((plain['anchorCounts'] as Record<string, number>)['top']).toBeGreaterThan(0);
    expect(Object.keys(await json('get_drawing', { document: sheet.id, only: ['views'] }))).toEqual(['id', 'name', 'views', 'lost', 'anchorCounts']);

    interface Anchor {
      view: string;
      ref: string;
      kind: string;
      at: number[];
      diameter?: number;
      model?: number[];
      hidden?: true;
      name?: string;
    }
    const listed = async (args: Record<string, unknown>) => (await json('get_drawing', { document: sheet.id, ...args }))['anchors'] as Anchor[];
    // From the front, the plate's back corners lie on its front ones: one point per place.
    const front = (await listed({ view: 'front', kind: 'point', hidden: true, names: true })).filter((a) => !a.name?.startsWith('extreme:'));
    const places = new Set(front.map((a) => a.at.join(',')));
    expect(places.size).toBeGreaterThan(4);
    expect(front).toHaveLength(places.size);
    // Circles by diameter (model mm), with their centres in the model.
    const holes = await listed({ view: 'top', diameter: 4 });
    expect(holes.map((h) => [h.kind, h.diameter, h.model?.slice(0, 2)])).toEqual([['circle', 4, [45, 15]]]);
    expect(holes[0]?.ref).toMatch(/^c[0-9a-z.]+$/);
    // The outermost points, for an overall width.
    const extremes = await listed({ view: 'top', extremes: true, names: true });
    expect(extremes.map((a) => a.name)).toEqual(['extreme:left', 'extreme:right', 'extreme:bottom', 'extreme:top']);
    const [left, right] = extremes as Anchor[];
    expect([left?.at[0], right?.at[0]]).toEqual([90, 150]);
    const answer = await json('edit_drawing', {
      document: sheet.id,
      commands: [{ type: 'add-annotation', annotation: { kind: 'dimension', id: 'width', type: 'horizontal', anchors: [{ view: 'top', ref: left?.ref }, { view: 'top', ref: right?.ref }], offset: 10 } }],
    });
    expect(answer).toMatchObject({ created: { annotations: ['width'] } });
    // Annotations answer with the handles; with names, as stored.
    const annotations = (await json('get_drawing', { document: sheet.id, only: ['annotations'] }))['annotations'] as { anchors: { ref?: string; name?: string }[] }[];
    expect(annotations[0]?.anchors).toEqual([{ view: 'top', kind: 'point', ref: left?.ref }, { view: 'top', kind: 'point', ref: right?.ref }]);
    const named = (await json('get_drawing', { document: sheet.id, only: ['annotations'], names: true }))['annotations'] as { anchors: { name?: string }[] }[];
    expect(named[0]?.anchors.map((a) => a.name)).toEqual(['extreme:left', 'extreme:right']);
  });
});

describe('open assemblies after their components change (CAD-116)', () => {
  it('checks the parts as edit_component and other processes left them', { timeout: 180_000 }, async () => {
    const projects = folder();
    const core = createNodeCore({ projects, exports: folder() });
    const cadence = new Cadence(core, core.exports);
    const server = new McpServer(cadence, { commands: '// the types' }, '1.2.3');
    let id = 0;
    const call = async (name: string, args: Record<string, unknown> = {}) => server.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const created = JSON.parse(text(await call('create_project', { name: 'Overlap' }))) as { project: { id: string }; component: { id: string } };
    const block = created.component.id;
    await call('edit_component', { document: block, commands: [{ type: 'create-sketch', id: 's', plane: 'XY' }, { type: 'add-rectangle', sketchId: 's', id: 'r', x: 0, y: 0, width: 10, height: 10 }] });
    const profile = (JSON.parse(text(await call('get_component', { document: block, only: ['sketches'] }))) as ComponentSummary).sketches[0]?.profiles[0]?.id;
    const extrude = (distance: string) => ({ type: 'extrude', id: 'e', name: 'Extrude 1', suppressed: false, sketch: 's', profiles: [profile], distance, direction: 'normal', operation: 'new-body' });
    await call('edit_component', { document: block, commands: [{ type: 'add-feature', feature: extrude('4 mm') }] });
    // Two blocks in one place overlap by a whole block.
    const assembly = (JSON.parse(text(await call('create_document', { project: created.project.id, kind: 'assembly', name: 'Pair' }))) as { id: string }).id;
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    await call('edit_assembly', { document: assembly, commands: ['a', 'b'].map((i) => ({ type: 'insert-instance', instance: { id: i, component: block, name: '', transform: identity, grounded: true } })) });
    const overlap = async () => (JSON.parse(text(await call('check_assembly', { document: assembly }))) as { volume: number }[])[0]?.volume;
    expect(await overlap()).toBeCloseTo(400, 3);

    // Taller through the same server: the open assembly sees it at once.
    await call('edit_component', { document: block, commands: [{ type: 'edit-feature', feature: extrude('8 mm') }] });
    expect(await overlap()).toBeCloseTo(800, 3);

    // Lower through another process on the same folders: seen too, and the server's component is opened again.
    const other = createNodeCore({ projects, exports: folder() });
    const script = await new Cadence(other, other.exports).component(block);
    await script.run({ type: 'edit-feature', feature: extrude('2 mm') } as never);
    expect(await overlap()).toBeCloseTo(200, 3);
    expect((JSON.parse(text(await call('component_properties', { document: block }))) as { volume: number }[])[0]?.volume).toBeCloseTo(200, 3);

    // New project parameters make the result stale: the assembly asks for it again, and a script waits for it (CAD-119).
    await call('set_project_parameters', { project: created.project.id, parameters: [{ name: 'gap', expression: '1 mm' }] });
    await cadence.settled();
    expect([...(await cadence.assembly(assembly)).state().components.values()].map((c) => c.status)).toEqual(['ready']);
    expect(text(await call('get_assembly', { document: assembly }))).not.toContain('loading');
  });
});

describe('scripting papercuts (CAD-108)', () => {
  it('places shorthands by expressions, parts at the origin, and names what conflicts', { timeout: 120_000 }, async () => {
    const core = createNodeCore({ exports: folder() });
    const cadence = new Cadence(core, core.exports);
    const created = await cadence.projects.createProject('Rod');
    if (!created.ok) throw new Error(created.error.message);
    const part = await cadence.component(created.value.firstDocument.id);
    const centre = () => {
      const sketch = part.state().sketches.get('s')?.sketch;
      const point = sketch?.entities.find((e) => e.id === 'small:center');
      return point?.kind === 'point' ? [Math.round(point.x * 1000) / 1000, Math.round(point.y * 1000) / 1000] : undefined;
    };
    // A hole at `rod` mm from the origin follows the parameter.
    await part.run(
      { type: 'add-parameter', parameter: { id: 'p', name: 'rod', expression: '110 mm' } },
      { type: 'create-sketch', id: 's', plane: 'XY' },
      { type: 'add-circle', sketchId: 's', id: 'small', x: 'rod', y: 0, diameter: 12 },
      { type: 'add-polygon', sketchId: 's', id: 'outline', points: [[-20, -10], ['rod + 15', -10], ['rod + 15', 10], [-20, 10]] },
    );
    expect(centre()).toEqual([110, 0]);
    expect(part.summary().sketches[0]?.status).toBe('fully-constrained');
    await part.run({ type: 'set-parameter', parameter: { id: 'p', name: 'rod', expression: '120 mm' } });
    expect(centre()).toEqual([120, 0]);
    expect(part.summary().sketches[0]?.profiles.find((p) => p.holes === 1)?.max).toEqual([135, 10]);

    // A part at the sketch origin.
    await part.run({ type: 'add-feature', feature: { type: 'part', id: 'nut', name: '', suppressed: false, part: { kind: 'nut', size: 'M6' }, sketch: 's', points: ['origin'], angle: '0 deg', flip: false, operation: 'new-body' } });
    expect(part.summary().timeline.find((t) => t.id === 'nut')?.state).toBe('ok');

    // A point on a line that touches a circle is redundant, not contradictory, and the constraints are named.
    await part.run({ type: 'create-sketch', id: 't', plane: 'XY' });
    const refused = part.run({
      type: 'add-sketch-geometry',
      sketchId: 't',
      entities: [
        { id: 'o', kind: 'point', x: 0, y: 0 },
        { id: 'c', kind: 'circle', center: 'o', radius: 10, construction: false },
        { id: 'a', kind: 'point', x: -20, y: 10 },
        { id: 'b', kind: 'point', x: 20, y: 10 },
        { id: 'l', kind: 'line', start: 'a', end: 'b', construction: false },
        { id: 'm', kind: 'point', x: 0, y: 10 },
      ],
      constraints: [
        { id: 'fixed', kind: 'fix', point: 'o', x: 0, y: 0 },
        { id: 'size', kind: 'radius', curve: 'c', expression: '10 mm' },
        { id: 'touch', kind: 'tangent', curves: ['l', 'c'] },
        { id: 'flat', kind: 'horizontal', line: 'l' },
        { id: 'on-line', kind: 'point-on', point: 'm', curve: 'l' },
        { id: 'on-circle', kind: 'point-on', point: 'm', curve: 'c' },
      ],
    });
    await expect(refused).rejects.toThrow(/redundant, not contradictory.*The ones involved: .*on-line/);
  });
});

describe('the command line', () => {
  it('reads its arguments and knows where the desktop app keeps projects', () => {
    expect(parseArguments(['export', 'Plate', 'Component 1', 'dxf', '--sketch', 's1', '-o', 'out.dxf', '--flat-pattern'])).toEqual({
      positional: ['export', 'Plate', 'Component 1', 'dxf'],
      options: { sketch: 's1', o: 'out.dxf', 'flat-pattern': true },
    });
    expect(desktopFolder({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32')).toBe(join('C:\\Users\\a\\AppData\\Roaming', 'dev.cadence.app'));
    expect(desktopFolder({ XDG_DATA_HOME: '/data' }, 'linux')).toBe(join('/data', 'dev.cadence.app'));
  });

  it('runs a script on a projects folder, then lists and exports what it made', { timeout: 120_000 }, async () => {
    const projects = folder();
    const exports = folder();
    const script = join(folder(), 'washer.mjs');
    writeFileSync(
      script,
      `export default async function (cadence, [name]) {
        const { project, firstDocument } = (await cadence.projects.createProject(name)).value;
        const washer = await cadence.component(firstDocument.id);
        await washer.run(
          { type: 'create-sketch', id: 's', plane: 'XY' },
          { type: 'add-circle', sketchId: 's', id: 'outer', x: 0, y: 0, diameter: 20 },
          { type: 'add-circle', sketchId: 's', id: 'inner', x: 0, y: 0, diameter: 8.4 },
        );
        const ring = washer.summary().sketches[0].profiles.find((p) => p.holes === 1);
        await washer.run({ type: 'add-feature', feature: { type: 'extrude', id: 'e', name: 'Washer', suppressed: false, sketch: 's', profiles: [ring.id], distance: '1.6 mm', direction: 'normal', operation: 'new-body' } });
        const sheet = (await cadence.projects.createDocument(project.id, 'drawing', 'Washer drawing')).value;
        await (await cadence.drawing(sheet.id)).run({ type: 'add-view', view: { id: 'top', source: firstDocument.id, direction: 'top', at: [100, 150], hidden: false } });
      }`,
    );
    const io = recorder();
    const options = ['--folder', projects, '--exports', exports];
    expect(await runCli(['run', script, 'M8 washer', ...options], io)).toBe(0);
    expect(await runCli(['projects', ...options], io)).toBe(0);
    expect(io.lines.at(-1)).toMatch(/M8 washer {2}\(2 documents\)$/);
    expect(await runCli(['documents', 'M8 washer', ...options], io)).toBe(0);
    expect(io.lines.slice(-2)).toEqual(expect.arrayContaining([expect.stringMatching(/component +Component 1$/), expect.stringMatching(/drawing +Washer drawing$/)]));
    expect(await runCli(['export', 'M8 washer', 'Component 1', 'step', '-o', join(exports, 'washer.step'), ...options], io)).toBe(0);
    expect(readFileSync(join(exports, 'washer.step'), 'utf8')).toMatch(/^ISO-10303-21;/);
    expect(await runCli(['export', 'M8 washer', 'Component 1', 'svg', '--sketch', 's', ...options], io)).toBe(0);
    expect(readFileSync(io.lines.at(-1) as string, 'utf8')).toContain('<svg');
    // Drawings export as PDF and DXF, and picture as the PDF shows them (CAD-123).
    expect(await runCli(['export', 'M8 washer', 'Washer drawing', 'pdf', ...options], io)).toBe(0);
    expect(readFileSync(io.lines.at(-1) as string, 'latin1').startsWith('%PDF-1.4')).toBe(true);
    const png = join(exports, 'sheet.png');
    expect(await runCli(['picture', 'M8 washer', 'Washer drawing', png, '--width', '420', ...options], io)).toBe(0);
    expect((await decodePicture(new Uint8Array(readFileSync(png)))).width).toBe(420);
    expect(await runCli(['export', 'M8 washer', 'Washer drawing', 'step', ...options], io)).toBe(1);
    expect(io.errors.at(-1)).toBe('A drawing exports to pdf, dxf.');

    // Mistakes are explained, with a non-zero exit code.
    expect(await runCli(['export', 'Nothing', 'Component 1', 'stl', ...options], io)).toBe(1);
    expect(io.errors.at(-1)).toBe('No project "Nothing".');
    expect(await runCli(['frobnicate'], io)).toBe(1);
  });

  it('converts files without a project', { timeout: 120_000 }, async () => {
    const io = recorder();
    const output = join(folder(), 'wedge.obj');
    expect(await runCli(['convert', join(repository, 'e2e', 'fixtures', 'wedge.stl'), output, '--exports', folder()], io)).toBe(0);
    expect(io.lines).toEqual([output]);
    expect(readFileSync(output, 'utf8')).toMatch(/^v /m);
  });
});

describe('the built command line', () => {
  const bundle = join(repository, 'dist', 'automation', 'cadence.mjs');
  beforeAll(() => {
    const built = spawnSync(process.execPath, [join(repository, 'tools', 'automation', 'build.mjs')], { encoding: 'utf8' });
    expect(built.status, built.stderr).toBe(0);
  });

  it('serves MCP over stdio, with nothing but messages on stdout', { timeout: 120_000 }, async () => {
    expect(existsSync(bundle)).toBe(true);
    const child = spawn(process.execPath, [bundle, 'mcp', '--folder', folder(), '--exports', folder()], { stdio: ['pipe', 'pipe', 'pipe'] });
    const responses: Record<string, unknown>[] = [];
    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      responses.push(...lines.map((line) => JSON.parse(line) as Record<string, unknown>));
    });
    const send = (message: Record<string, unknown>) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/call', params: { name: 'create_project', arguments: { name: 'Over stdio' } } });
    send({ id: 3, method: 'tools/call', params: { name: 'command_reference', arguments: { topic: 'commands' } } });
    send({ id: 4, method: 'tools/call', params: { name: 'command_reference', arguments: { topic: 'features' } } });
    send({ id: 5, method: 'tools/call', params: { name: 'command_reference', arguments: { topic: 'assembly' } } });
    child.stdin.end();
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    expect(code).toBe(0);
    // Answered side by side (CAD-134): in the order they finish, so by id here.
    responses.sort((a, b) => Number(a['id']) - Number(b['id']));
    expect(responses.map((r) => r['id'])).toEqual([1, 2, 3, 4, 5]);
    expect(text(responses[1])).toContain('"name": "Over stdio"');
    // The embedded reference holds the command, feature, part and assembly types, by topic, each short enough to read whole (CAD-111).
    expect(text(responses[2])).toContain("readonly type: 'add-feature'");
    expect(text(responses[3])).toContain('export interface ExtrudeFeature');
    expect(text(responses[3])).toContain("readonly kind: 'ring-gear'");
    expect(text(responses[4])).toContain('export type AssemblyCommand');
    expect(text(responses[4])).toContain('export interface Joint');
    for (const response of responses.slice(2)) expect(text(response).length).toBeLessThan(30_000);
  });
});

describe('the keyboard enclosure findings', () => {
  it('tells faces only renumbered from faces made and removed (CAD-139)', () => {
    const before = [
      { name: 'f:cut:side~1', center: [0, 0, 5] },
      { name: 'f:cut:side~2', center: [10, 0, 5] },
      { name: 'f:e:end', center: [5, 5, 10] },
    ];
    const after = [
      { name: 'f:cut:side~1', center: [10, 0, 5] },
      { name: 'f:cut:side~2', center: [0, 0, 5] },
      { name: 'f:fillet:round', center: [5, 5, 9] },
    ];
    // The two cut walls swapped numbers: renumbered, not gone and new; the end face went, a round and a third wall came.
    expect(faceChanges(before, [...after, { name: 'f:cut:side~3', center: [20, 0, 5] }])).toEqual({
      added: ['f:fillet:round', 'f:cut:side~3'],
      gone: ['f:e:end'],
      renumbered: { 'f:cut:side~1': 'f:cut:side~2', 'f:cut:side~2': 'f:cut:side~1' },
    });
    const renamed = faceChanges(before, [{ name: 'f:cut:side~3', center: [0, 0, 5] }, { name: 'f:cut:side~1', center: [10, 0, 5] }, ...after.slice(2)]);
    expect(renamed).toEqual({ added: ['f:fillet:round'], gone: ['f:e:end'], renumbered: { 'f:cut:side~2': 'f:cut:side~1', 'f:cut:side~1': 'f:cut:side~3' } });
  });

  it('extrudes the profiles of overlapping shapes at once (CAD-138)', { timeout: 60_000 }, async () => {
    const core = createNodeCore({ exports: folder() });
    const cadence = new Cadence(core, core.exports);
    const created = (await cadence.projects.createProject('Ribs')) as { ok: true; value: { firstDocument: { id: string } } };
    const c = await cadence.component(created.value.firstDocument.id);
    // A housing circle, a block over it, a rib across the block's edge and one far away (the keyboard's top shell).
    await c.run(
      { type: 'create-sketch', id: 's', plane: 'XY' },
      { type: 'add-circle', sketchId: 's', id: 'housing', x: 15, y: 144.5, diameter: 28 },
      { type: 'add-rectangle', sketchId: 's', id: 'block', x: 7, y: 150, width: 16, height: 20 },
      { type: 'add-rectangle', sketchId: 's', id: 'rib', x: -0.5, y: 155.5, width: 9.5, height: 10 },
      { type: 'add-rectangle', sketchId: 's', id: 'far', x: 349, y: 155.5, width: 5.2625, height: 10 },
    );
    const profiles = c.summary().sketches.find((s) => s.id === 's')?.profiles ?? [];
    // A sliver lies between the circle, the block and the rib.
    expect(Math.min(...profiles.map((p) => p.area))).toBeLessThan(0.2);
    await c.run({ type: 'add-feature', feature: { type: 'extrude', id: 'e', name: '', suppressed: false, sketch: 's', profiles: profiles.map((p) => p.id), distance: '38 mm', direction: 'normal', operation: 'new-body' } });
    expect(c.summary().timeline.find((t) => t.id === 'e')).toMatchObject({ state: 'ok' });
    const area = profiles.reduce((sum, p) => sum + p.area, 0);
    expect((await c.properties()).reduce((sum, b) => sum + b.volume, 0)).toBeCloseTo(area * 38, 0);
  });

  it('intersects a helical gear with a chamfered cylinder of its tip diameter (CAD-137)', { timeout: 180_000 }, async () => {
    const core = createNodeCore({ exports: folder() });
    const cadence = new Cadence(core, core.exports);
    const created = (await cadence.projects.createProject('Trimmed gear')) as { ok: true; value: { firstDocument: { id: string } } };
    const c = await cadence.component(created.value.firstDocument.id);
    const gear = { kind: 'gear', module: '1 mm', teeth: '16', width: '6 mm', bore: '6.8 mm', pressureAngle: '20 deg', helixAngle: '45 deg' } as const;
    await c.run(
      { type: 'create-sketch', id: 's', plane: 'XY' },
      { type: 'add-sketch-geometry', sketchId: 's', entities: [{ id: 'p', kind: 'point', x: 0, y: 0 }], constraints: [] },
      { type: 'add-feature', feature: { type: 'part', id: 'gear', name: 'Gear', suppressed: false, sketch: 's', points: ['p'], angle: '0 deg', flip: false, operation: 'new-body', part: gear } },
      { type: 'create-sketch', id: 'k', plane: 'XY' },
      { type: 'add-circle', sketchId: 'k', id: 'tip', x: 0, y: 0, diameter: 18 },
    );
    const profile = c.summary().sketches.find((s) => s.id === 'k')?.profiles[0]?.id;
    await c.run({ type: 'add-feature', feature: { type: 'extrude', id: 'cyl', name: 'Tip', suppressed: false, sketch: 'k', profiles: [profile as string], distance: '6 mm', direction: 'normal', operation: 'new-body' } });
    const rims = (c.summary({ body: 'cyl', only: ['edges'] }).bodies?.[0]?.edges ?? [])
      .map((e) => ({ name: e.name, middle: [e.middle[0] ?? 0, e.middle[1] ?? 0, e.middle[2] ?? 0] as const }))
      .filter((e) => !e.name.includes('seam') && Math.abs(Math.hypot(e.middle[0], e.middle[1]) - 9) < 0.01);
    await c.run({ type: 'add-feature', feature: { type: 'chamfer', id: 'ch', name: '', suppressed: false, edges: rims.map((e) => ({ kind: 'edge' as const, body: 'cyl', name: e.name, hint: e.middle })), size: '0.8 mm' } });
    // The tips lie on the cylinder: the exact common comes out empty, which cannot be right for bodies on top of each other; a fuzzy one is not.
    await c.run({ type: 'add-feature', feature: { type: 'combine', id: 'x', name: 'Trim', suppressed: false, target: 'gear', tools: ['cyl'], operation: 'intersect', keepTools: false } });
    expect(c.summary().timeline.find((t) => t.id === 'x')).toMatchObject({ state: 'ok' });
    expect(c.summary().bodies.map((b) => b.id)).toEqual(['gear']);
  });

  it('keeps a sketch on a face where it was made, says where it is, and names a failed feature (CAD-136, CAD-142)', { timeout: 120_000 }, async () => {
    const core = createNodeCore({ exports: folder() });
    const server = new McpServer(new Cadence(core, core.exports), { commands: '// the types' }, '1.2.3');
    let id = 0;
    const call = async (name: string, args: Record<string, unknown> = {}) => server.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const created = JSON.parse(text(await call('create_project', { name: 'Flange' }))) as { project: { id: string }; component: { id: string } };
    const part = created.component.id;
    await call('edit_component', {
      document: part,
      commands: [
        { type: 'add-parameter', parameter: { id: 'w', name: 'width', expression: '60 mm' } },
        { type: 'create-sketch', id: 's', plane: 'XY' },
        { type: 'add-rectangle', sketchId: 's', id: 'r', x: 0, y: 0, width: 'width', height: 30 },
      ],
    });
    const sketchOf = async (sketch: string) => (JSON.parse(text(await call('get_component', { document: part, only: ['sketches'], sketch }))) as ComponentSummary).sketches[0];
    const profile = (await sketchOf('s'))?.profiles[0]?.id;
    await call('edit_component', { document: part, commands: [{ type: 'add-feature', feature: { type: 'extrude', id: 'e', name: 'Plate', suppressed: false, sketch: 's', profiles: [profile], distance: '10 mm', direction: 'normal', operation: 'new-body' } }] });
    await call('edit_component', { document: part, commands: [{ type: 'create-sketch', id: 'top', plane: { face: { kind: 'face', body: 'e', name: 'f:e:end' } } }] });
    // At the face's middle, axes along the model's x and y.
    expect((await sketchOf('top'))?.frame).toEqual({ origin: [30, 15, 10], u: [1, 0, 0], v: [0, 1, 0] });
    // The plate grows: the face's middle moves, the sketch does not.
    await call('edit_component', { document: part, commands: [{ type: 'set-parameter', parameter: { id: 'w', name: 'width', expression: '80 mm' } }] });
    expect((await sketchOf('top'))?.frame?.origin).toEqual([30, 15, 10]);
    // Without the plate, the sketch on its face says why its body is missing.
    const answer = text(await call('edit_component', { document: part, commands: [{ type: 'suppress-item', itemId: 'e', suppressed: true }] }));
    expect(answer).toContain('The body of its face is missing at this point of the timeline. Plate is suppressed.');
  });

  it('answers requests side by side, and a cancelled call stops the kernel without an answer (CAD-134)', { timeout: 60_000 }, async () => {
    // The server: one request that waits until it is let go, others that answer at once.
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => (release = resolve));
    const server = { handle: async (message: { id?: number; method: string }) => (message.method === 'slow' ? (await slow, { id: message.id, result: 'slow' }) : { id: message.id, result: 'quick' }) };
    const { PassThrough } = await import('node:stream');
    const [input, output] = [new PassThrough(), new PassThrough()];
    const lines: string[] = [];
    output.on('data', (chunk: Buffer) => lines.push(...chunk.toString().split('\n').filter(Boolean)));
    const served = serveStdio(server as unknown as McpServer, input, output);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'slow' })}\n${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'quick' })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lines.map((l) => (JSON.parse(l) as { id: number }).id)).toEqual([2]);
    release();
    input.end();
    await served;
    expect(lines.map((l) => (JSON.parse(l) as { id: number }).id)).toEqual([2, 1]);

    // Cancelled while it runs: the kernel is stopped, and the call gets no answer.
    const core = createNodeCore({ exports: folder() });
    let stopped = 0;
    let letGo: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => (letGo = resolve));
    const projectManager = new Proxy(core.projectManager, { get: (target, key) => (key === 'listProjects' ? async () => (await waiting, target.listProjects()) : Reflect.get(target, key)) });
    const mcp = new McpServer(new Cadence({ ...core, projectManager, stopGeometry: () => void stopped++ }, core.exports), { commands: '// the types' }, '1.2.3');
    const call = mcp.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'list_projects', arguments: {} } });
    await mcp.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7, reason: 'Too slow' } });
    expect(stopped).toBe(1);
    letGo();
    expect(await call).toBeUndefined();
  });

  it('reads documents again after the kernel started anew, and says so (CAD-133)', { timeout: 120_000 }, async () => {
    const core = createNodeCore({ exports: folder() });
    // The kernel's generation, as the core reports it: changed by the test as a failure would.
    let generation = 'a';
    let asked = 0;
    const cadence = new Cadence({ ...core, kernelGeneration: async () => (++asked, generation) }, core.exports);
    const created = (await cadence.projects.createProject('Restarted')) as { ok: true; value: { firstDocument: { id: string } } };
    const id = created.value.firstDocument.id;
    const first = await cadence.component(id);
    expect(await cadence.component(id)).toBe(first);
    generation = 'b';
    const again = await cadence.component(id);
    expect(again).not.toBe(first);
    expect(again.summary().timeline).toEqual([]);

    const server = new McpServer(cadence, { commands: '// the types' }, '1.2.3');
    const before = asked;
    let calls = 0;
    // The kernel fails while this call runs: the generation it ends with is a new one.
    const failing = new McpServer(new Cadence({ ...core, kernelGeneration: async () => (++calls > 1 ? 'd' : 'c') }, core.exports), { commands: '// the types' }, '1.2.3');
    const listed = result(await failing.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_projects', arguments: {} } }));
    expect(listed.content.at(-1)?.text).toContain('The geometry kernel failed during this call and started again');
    expect(result(await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_projects', arguments: {} } })).content).toHaveLength(1);
    expect(asked).toBeGreaterThan(before);
  });

  it('restores only documents of the project named, and copies keep the history (CAD-147)', { timeout: 120_000 }, async () => {
    const core = createNodeCore({ exports: folder() });
    const server = new McpServer(new Cadence(core, core.exports), { commands: '// the types' }, '1.2.3');
    let id = 0;
    const call = async (name: string, args: Record<string, unknown> = {}) => server.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const created = JSON.parse(text(await call('create_project', { name: 'Original' }))) as { project: { id: string }; component: { id: string } };
    const version = JSON.parse(text(await call('versions', { action: 'record', project: created.project.id, message: 'Before the copy' }))) as { id: string };
    const copy = JSON.parse(text(await call('duplicate', { project: created.project.id }))) as { id: string };
    expect((JSON.parse(text(await call('versions', { action: 'list', project: copy.id }))) as { message: string }[]).map((v) => v.message)).toContain('Before the copy');
    const refused = result(await call('versions', { action: 'restore', project: copy.id, document: created.component.id, version: version.id }));
    expect(refused).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('a document of another project') }] });
  });

  it('uses project parameters set after a component was opened (CAD-146)', { timeout: 120_000 }, async () => {
    const core = createNodeCore({ exports: folder() });
    const server = new McpServer(new Cadence(core, core.exports), { commands: '// the types' }, '1.2.3');
    let id = 0;
    const call = async (name: string, args: Record<string, unknown> = {}) => server.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const created = JSON.parse(text(await call('create_project', { name: 'Tilted' }))) as { project: { id: string }; component: { id: string } };
    const part = created.component.id;
    // Opened first, then the project gets a parameter: no listener of the part hears of it.
    await call('get_component', { document: part });
    await call('set_project_parameters', { project: created.project.id, parameters: [{ name: 'tilt', expression: '5 deg' }] });
    const added = result(await call('edit_component', { document: part, commands: [{ type: 'add-parameter', parameter: { id: 'rise', name: 'rise', expression: '100 mm * tan(tilt)' } }] }));
    expect(added.isError, added.content[0]?.text).toBeUndefined();
    const listed = (JSON.parse(text(await call('get_component', { document: part, only: ['parameters'] }))) as ComponentSummary).parameters;
    expect(listed).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'tilt', project: true }), expect.objectContaining({ name: 'rise', value: expect.stringMatching(/^8\.7/) })]));
  });
});
