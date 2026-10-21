import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeCore } from '@core/composition/node';
import { afterAll, describe, expect, it } from 'vitest';
import { Cadence } from './api';
import { type Io, runCli } from './cli';
import { McpServer } from './mcp';
import { completionsAfter, scriptApiTypes, scriptMembers } from './script-api';
import { parameterValues, runGenerator, runScript } from './script';

const repository = join(import.meta.dirname, '..', '..');
const samplePlugin = join(repository, 'public', 'plugins', 'trays.cadence-plugin.js');
const folders: string[] = [];
const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'cadence-scripts-'));
  folders.push(path);
  return path;
};
afterAll(() => folders.forEach((path) => rmSync(path, { recursive: true, force: true })));

type Answer = { result: { isError?: boolean; content: { type: string; text: string }[] } } & { error?: { code: number; message: string } };

/** An MCP server on a fresh projects folder, and a way to call its tools. */
function server(guide: Record<string, string> = {}) {
  const exports = folder();
  const core = createNodeCore({ projects: folder(), exports });
  const cadence = new Cadence(core, core.exports);
  const mcp = new McpServer(cadence, { commands: '// the design commands' }, '1.0.0', exports, guide);
  let id = 0;
  const request = async (method: string, params: Record<string, unknown> = {}) => (await mcp.handle({ jsonrpc: '2.0', id: ++id, method, params })) as Answer;
  const call = async (name: string, args: Record<string, unknown> = {}) => (await request('tools/call', { name, arguments: args })).result;
  const json = async (name: string, args: Record<string, unknown> = {}) => {
    const answer = await call(name, args);
    if (answer.isError) throw new Error(answer.content[0]?.text);
    return JSON.parse(answer.content[0]?.text ?? 'null') as Record<string, unknown> & { value: unknown; output: string[]; documents: { created: { id: string; name: string }[]; changed: unknown[]; deleted: unknown[] } };
  };
  return { cadence, mcp, request, call, json, exports };
}

/** A script that makes `count` plates, `step` mm longer each. */
const plates = `
const { project } = (await cadence.projects.createProject(args.name)).value;
const made = [];
for (let i = 1; i <= args.count; i++) {
  const document = (await cadence.projects.createDocument(project.id, 'component', 'Plate ' + i)).value;
  const plate = await cadence.component(document.id);
  await plate.run(
    { type: 'create-sketch', id: 's', plane: 'XY' },
    { type: 'add-rectangle', sketchId: 's', id: 'r', x: 0, y: 0, width: 10 * i, height: 20 },
  );
  const profile = (await plate.summary({ only: ['sketches'] })).sketches[0].profiles[0];
  await plate.run({ type: 'add-feature', feature: { type: 'extrude', id: 'e', name: '', suppressed: false, sketch: 's', profiles: [profile.id], distance: '3 mm', direction: 'normal', operation: 'new-body' } });
  made.push(document.name);
}
console.log('made', made.length);
return made;`;

describe('scripts for agents (CAD-171)', () => {
  it('makes ten parts in one call, and answers with what the script returned, printed and made', { timeout: 240_000 }, async () => {
    const { json, cadence } = server();
    const answer = await json('run_script', { script: plates, arguments: { name: 'Plates', count: 10 } });
    expect(answer.value).toEqual(Array.from({ length: 10 }, (_, i) => `Plate ${i + 1}`));
    expect(answer.output).toEqual(['made 10']);
    // The project's first component, and the ten plates.
    expect(answer.documents.created.map((d) => d.name)).toEqual(expect.arrayContaining(['Component 1', 'Plate 1', 'Plate 10']));
    expect(answer.documents.created).toHaveLength(11);
    const tenth = answer.documents.created.find((d) => d.name === 'Plate 10') as { id: string };
    const [body] = await (await cadence.component(tenth.id)).properties();
    expect(body?.volume).toBeCloseTo(100 * 20 * 3, 0);
  });

  it('is sandboxed: the API only, no files outside the exports folder, a time limit', { timeout: 120_000 }, async () => {
    const { json, call, exports } = server();
    const reach = await json('run_script', { script: 'return [typeof process, typeof require, typeof fetch, typeof cadence.stop, typeof cadence.forget, typeof cadence.component];' });
    expect(reach.value).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'function']);

    const box = `const { firstDocument } = (await cadence.projects.createProject('Box')).value;
      const box = await cadence.component(firstDocument.id);
      await box.run({ type: 'create-sketch', id: 's', plane: 'XY' }, { type: 'add-rectangle', sketchId: 's', id: 'r', x: 0, y: 0, width: 10, height: 10 });
      const [profile] = (await box.summary()).sketches[0].profiles;
      await box.run({ type: 'add-feature', feature: { type: 'extrude', id: 'e', name: '', suppressed: false, sketch: 's', profiles: [profile.id], distance: '10', direction: 'normal', operation: 'new-body' } });
      return await box.export('stl', { to: args.to });`;
    const inside = await json('run_script', { script: box, arguments: { to: 'boxes/box.stl' } });
    expect(inside.value).toBe(join(exports, 'boxes', 'box.stl'));
    expect(readFileSync(inside.value as string).length).toBeGreaterThan(0);
    const outside = await call('run_script', { script: box, arguments: { to: '../box.stl' } });
    expect(outside.isError).toBe(true);
    expect(outside.content[0]?.text).toMatch(/only in the exports folder/);
    // What it did before the refusal is in the answer.
    expect(outside.content[0]?.text).toContain('"created"');

    const loop = await call('run_script', { script: 'console.log("going round"); while (true) {}', seconds: 1 });
    expect(loop.isError).toBe(true);
    expect(loop.content[0]?.text).toMatch(/ran out of time[\s\S]*going round/);
    const thrown = await call('run_script', { script: 'await cadence.component("nothing");' });
    expect(thrown.content[0]?.text).toMatch(/The script failed: .*nothing/);
  });

  it('stops a script when the call is cancelled', { timeout: 60_000 }, async () => {
    const { mcp } = server();
    // In this thread, a script is stopped where it waits; the command line runs it in a worker it ends.
    const running = mcp.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'run_script', arguments: { script: 'while (true) await cadence.projects.listProjects();' } } });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await mcp.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } });
    expect(await running).toBeUndefined();
  });

  it('runs scripts kept with a project with other values each time, and lists them', { timeout: 120_000 }, async () => {
    const { json, cadence } = server();
    const created = await cadence.projects.createProject('Spacers');
    if (!created.ok) throw new Error(created.error.message);
    const { project } = created.value;
    const source = `const d = (await cadence.projects.createDocument(project.id, 'component', 'Spacer ' + params.length)).value; return { name: d.name, length: params.length, label: params.label };`;
    expect((await cadence.projects.setProjectScripts(project.id, [{ id: 'sp', name: 'Spacer', source, parameters: [{ name: 'length', default: '10 mm', kind: 'length' }, { name: 'label', default: 'A', kind: 'text' }] }])).ok).toBe(true);
    const first = await json('run_script', { project: 'Spacers', generator: 'Spacer' });
    expect(first.value).toEqual({ name: 'Spacer 10', length: 10, label: 'A' });
    const second = await json('run_script', { project: 'Spacers', generator: 'Spacer', parameters: { length: '2 cm', label: 'B' } });
    expect(second.value).toEqual({ name: 'Spacer 20', length: 20, label: 'B' });
    expect(second.documents.created.map((d) => d.name)).toEqual(['Spacer 20']);
    expect((await json('list_scripts', { project: 'Spacers' })) as unknown).toEqual({ scripts: [{ id: 'sp', name: 'Spacer', parameters: expect.any(Array) }], plugins: [] });
    await expect(runGenerator(cadence, 'Spacers', 'Nothing')).rejects.toThrow(/has no script or generator “Nothing”. It has: Spacer/);
    expect(() => parameterValues([{ name: 'n', default: 'x', kind: 'number' }])).toThrow(/needs a number/);
    // Names are checked.
    expect(await cadence.projects.setProjectScripts(project.id, [{ id: 'a', name: 'S', source: '', parameters: [] }, { id: 'b', name: 'S', source: '', parameters: [] }])).toMatchObject({ ok: false, error: { code: 'duplicate-name' } });
    expect(await cadence.projects.setProjectScripts(project.id, [{ id: 'a', name: 'S', source: '', parameters: [{ name: '2x', default: '1', kind: 'number' }] }])).toMatchObject({ ok: false, error: { code: 'invalid-name' } });
  });

  it('describes its API once: members, types and completions', () => {
    expect(scriptApiTypes).toContain('interface Component {');
    expect(scriptApiTypes).toContain('  run(...commands: Command[]): Promise<void>;');
    expect(completionsAfter('cadence').map((m) => m.name)).toEqual(expect.arrayContaining(['component', 'projects']));
    expect(completionsAfter('projects')).toBe(scriptMembers.projects);
    expect(completionsAfter('plate').map((m) => m.name)).toEqual(expect.arrayContaining(['run', 'summary', 'exportInstructions']));
  });
});

describe('MCP resources and prompts (CAD-172)', () => {
  it('lists and reads the command reference and the user guide, and gives prompts for common jobs', async () => {
    const { request } = server({ Automation: '# Automation\n\nScripts and agents.', Sketching: '# Sketching\n\nLines.' });
    const init = await request('initialize', { protocolVersion: '2025-06-18' });
    expect((init as unknown as { result: { capabilities: unknown } }).result.capabilities).toEqual({ tools: {}, resources: {}, prompts: {} });

    const listed = (await request('resources/list')) as unknown as { result: { resources: { uri: string; title: string; mimeType: string }[] } };
    expect(listed.result.resources.map((r) => r.uri)).toEqual(['cadence://reference/commands', 'cadence://reference/scripts', 'cadence://guide/Automation', 'cadence://guide/Sketching']);
    expect(listed.result.resources[2]).toMatchObject({ title: 'User guide: Automation', mimeType: 'text/markdown' });
    const read = (await request('resources/read', { uri: 'cadence://guide/Sketching' })) as unknown as { result: { contents: { uri: string; text: string }[] } };
    expect(read.result.contents).toEqual([{ uri: 'cadence://guide/Sketching', mimeType: 'text/markdown', text: '# Sketching\n\nLines.' }]);
    const scripts = (await request('resources/read', { uri: 'cadence://reference/scripts' })) as unknown as { result: { contents: { text: string }[] } };
    expect(scripts.result.contents[0]?.text).toContain('declare const cadence');
    expect((await request('resources/read', { uri: 'cadence://guide/Nothing' })).error?.code).toBe(-32002);

    const prompts = (await request('prompts/list')) as unknown as { result: { prompts: { name: string; arguments: { name: string; required?: boolean }[] }[] } };
    expect(prompts.result.prompts.map((p) => p.name)).toEqual(['part_from_sketch', 'drawing_of_part', 'assembly_of_parts', 'parts_by_script']);
    const prompt = (await request('prompts/get', { name: 'part_from_sketch', arguments: { part: 'a wall bracket for a 25 mm pipe', process: 'print' } })) as unknown as {
      result: { messages: { role: string; content: { type: string; text: string } }[] };
    };
    expect(prompt.result.messages[0]).toMatchObject({ role: 'user', content: { type: 'text', text: expect.stringContaining('Model a wall bracket for a 25 mm pipe in CADence.') } });
    expect(prompt.result.messages[0]?.content.text).toContain('check_component');
    expect((await request('prompts/get', { name: 'drawing_of_part', arguments: {} })).error).toMatchObject({ code: -32602, message: expect.stringContaining('needs component') });
    expect((await request('prompts/get', { name: 'nothing' })).error?.code).toBe(-32602);
  });
});

describe('plugins (CAD-174)', () => {
  it('installs the sample plugin; its feature regenerates with the parameters, its exporter and generator run', { timeout: 240_000 }, async () => {
    const { json, call, cadence, exports } = server();
    const created = (await json('create_project', { name: 'Trays' })) as unknown as { project: { id: string }; component: { id: string } };
    const plugin = await json('install_plugin', { project: 'Trays', path: samplePlugin });
    expect(plugin).toMatchObject({ id: 'cadence.trays', version: '1.0.0', features: [{ name: 'tray' }], generators: [{ name: 'set' }], exporters: [{ name: 'openscad' }] });
    expect(plugin).not.toHaveProperty('source');

    const document = created.component.id;
    const tray = { type: 'plugin', id: 'tray', name: 'Tray', suppressed: false, plugin: 'cadence.trays', version: '1.0.0', feature: 'tray', plane: 'XY', operation: 'new-body', parameters: { width: 'size', depth: '40 mm', height: '20 mm', wall: '2 mm', corner: '0 mm' } };
    await json('edit_component', { document, commands: [{ type: 'add-parameter', parameter: { id: 'p1', name: 'size', expression: '60 mm' } }, { type: 'add-feature', feature: tray }] });
    const volume = async () => ((await json('component_properties', { document })) as unknown as { volume: number }[]).map((b) => Math.round(b.volume));
    // A floor of 60 × 40 × 2 and walls 2 thick, 18 high: one body.
    expect(await volume()).toEqual([60 * 40 * 2 + (60 * 40 - 56 * 36) * 18]);
    // The parameter changes: the plugin builds the tray again.
    await json('edit_component', { document, commands: [{ type: 'set-parameter', parameter: { id: 'p1', name: 'size', expression: '100 mm' } }] });
    expect(await volume()).toEqual([100 * 40 * 2 + (100 * 40 - 96 * 36) * 18]);
    // A value the plugin refuses is refused, with the plugin's reason.
    const refused = await call('edit_component', { document, commands: [{ type: 'set-parameter', parameter: { id: 'p1', name: 'size', expression: '3 mm' } }] });
    expect(refused.content[0]?.text).toMatch(/Tray would fail: Trays: The walls are thicker than half the tray\. \(line 45\)/);

    const scad = await call('export_component', { document, format: 'plugin', exporter: 'cadence.trays/openscad' });
    expect(scad.isError).toBeUndefined();
    expect(scad.content[0]?.text).toBe(join(exports, 'Component 1.scad'));
    expect(readFileSync(join(exports, 'Component 1.scad'), 'utf8')).toMatch(/^\/\/ Component 1, exported from CADence\n\/\/ Tray\npolyhedron\(points=\[/);

    const generated = await json('run_script', { project: 'Trays', generator: 'cadence.trays/set', parameters: { count: 2 } });
    expect(generated.value).toEqual(['Tray 40 mm', 'Tray 60 mm']);
    const second = generated.documents.created.find((d) => d.name === 'Tray 60 mm') as { id: string };
    const [body] = await (await cadence.component(second.id)).properties();
    expect(Math.round(body?.volume ?? 0)).toBeGreaterThan(60 * 40 * 2);

    // Without the plugin, its features say what is missing.
    expect((await cadence.projects.removePlugin(created.project.id as never, 'cadence.trays')).ok).toBe(true);
    await cadence.settled();
    const missing = (await json('get_component', { document, only: ['timeline'] })) as unknown as { timeline: { state: string; error?: string }[] };
    expect(missing.timeline[0]).toMatchObject({ state: 'error', error: expect.stringContaining('cadence.trays 1.0.0 is not installed') });
  });

  it('installs a plugin from the command line', { timeout: 120_000 }, async () => {
    const projects = folder();
    const lines: string[] = [];
    const io: Io = { out: (text) => lines.push(text), err: (text) => lines.push(text) };
    const cadence = new Cadence(createNodeCore({ projects, exports: folder() }), { delivered: [], deliverNextTo: () => undefined });
    await cadence.projects.createProject('Shelf');
    expect(await runCli(['install-plugin', 'Shelf', samplePlugin, '--folder', projects], io)).toBe(0);
    expect(lines.at(-1)).toBe('cadence.trays  Trays 1.0.0  (feature tray, generator set, exporter openscad)');
  });

  it('gives a script the project it runs for', { timeout: 60_000 }, async () => {
    const core = createNodeCore({ projects: folder(), exports: folder() });
    const run = await runScript(new Cadence(core, core.exports), 'return project;', { project: { id: 'p' as never, name: 'Mine' } });
    expect(run).toMatchObject({ ok: true, value: { id: 'p', name: 'Mine' }, documents: { created: [], changed: [], deleted: [] } });
  });
});
