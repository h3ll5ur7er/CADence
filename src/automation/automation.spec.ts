import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeCore } from '@core/composition/node';
import { decodePicture } from '@core/utilities/picture';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Cadence, type ComponentChanges, type ComponentSummary } from './api';
import { desktopFolder, type Io, parseArguments, runCli } from './cli';
import { McpServer } from './mcp';

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
    expect(await server.handle({ jsonrpc: '2.0', id: 99, method: 'resources/list' })).toMatchObject({ error: { code: -32601 } });

    // Documents can be renamed and deleted (CAD-108).
    expect(text(await call('rename_document', { document, name: 'Plate' }))).toBe('Renamed to Plate.');
    const project = (JSON.parse(text(await call('list_projects'))) as { id: string }[])[0]?.id as string;
    expect((JSON.parse(text(await call('list_documents', { project }))) as { name: string }[]).map((d) => d.name)).toEqual(['Plate']);
    const scrap = JSON.parse(text(await call('create_document', { project, kind: 'component', name: 'Scrap' }))) as { id: string };
    expect(text(await call('delete_document', { document: scrap.id }))).toBe('Deleted Scrap.');
    expect((JSON.parse(text(await call('list_documents', { project }))) as unknown[]).length).toBe(1);
  });

  it('assembles, moves, explodes and checks an assembly (CAD-97, CAD-100)', { timeout: 180_000 }, async () => {
    const exports = folder();
    const core = createNodeCore({ exports });
    const server = new McpServer(new Cadence(core, core.exports), { commands: '// the types' }, '1.2.3');
    let id = 0;
    const call = async (name: string, args: Record<string, unknown> = {}) => server.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const result = (response: unknown) => (response as { result: { isError?: boolean; content: { type: string; text?: string; data?: string }[] } }).result;

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
    const gif = /at (.+\.gif)\./.exec(animated.content[1]?.text ?? '')?.[1] as string;
    expect(new TextDecoder().decode(readFileSync(gif).subarray(0, 6))).toBe('GIF89a');

    const properties = JSON.parse(text(await call('assembly_properties', { document: linkage }))) as { billOfMaterials: { count: number }[] };
    expect(properties.billOfMaterials[0]?.count).toBe(2);
    expect(text(await call('export_assembly', { document: linkage, format: 'step' }))).toMatch(/\.step$/);
    const undone = JSON.parse(text(await call('undo_assembly', { document: linkage }))) as { removed?: string[] };
    expect(undone.removed).toEqual(['apart']); // one command at a time
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
        const { firstDocument } = (await cadence.projects.createProject(name)).value;
        const washer = await cadence.component(firstDocument.id);
        await washer.run(
          { type: 'create-sketch', id: 's', plane: 'XY' },
          { type: 'add-circle', sketchId: 's', id: 'outer', x: 0, y: 0, diameter: 20 },
          { type: 'add-circle', sketchId: 's', id: 'inner', x: 0, y: 0, diameter: 8.4 },
        );
        const ring = washer.summary().sketches[0].profiles.find((p) => p.holes === 1);
        await washer.run({ type: 'add-feature', feature: { type: 'extrude', id: 'e', name: 'Washer', suppressed: false, sketch: 's', profiles: [ring.id], distance: '1.6 mm', direction: 'normal', operation: 'new-body' } });
      }`,
    );
    const io = recorder();
    const options = ['--folder', projects, '--exports', exports];
    expect(await runCli(['run', script, 'M8 washer', ...options], io)).toBe(0);
    expect(await runCli(['projects', ...options], io)).toBe(0);
    expect(io.lines.at(-1)).toMatch(/M8 washer {2}\(1 documents\)$/);
    expect(await runCli(['documents', 'M8 washer', ...options], io)).toBe(0);
    expect(io.lines.at(-1)).toMatch(/component +Component 1$/);
    expect(await runCli(['export', 'M8 washer', 'Component 1', 'step', '-o', join(exports, 'washer.step'), ...options], io)).toBe(0);
    expect(readFileSync(join(exports, 'washer.step'), 'utf8')).toMatch(/^ISO-10303-21;/);
    expect(await runCli(['export', 'M8 washer', 'Component 1', 'svg', '--sketch', 's', ...options], io)).toBe(0);
    expect(readFileSync(io.lines.at(-1) as string, 'utf8')).toContain('<svg');

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
