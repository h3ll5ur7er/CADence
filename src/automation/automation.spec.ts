import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeCore } from '@core/composition/node';
import { decodePicture } from '@core/utilities/picture';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Cadence, type ComponentSummary } from './api';
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
    const server = new McpServer(new Cadence(core, core.exports), '// the types', '1.2.3');
    let id = 0;
    const call = async (name: string, args: Record<string, unknown> = {}) => server.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });

    const init = (await server.handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26' } })) as { result: Record<string, unknown> };
    expect(init.result).toMatchObject({ protocolVersion: '2025-03-26', serverInfo: { name: 'cadence', version: '1.2.3' }, capabilities: { tools: {} } });
    expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined();
    const tools = (await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
    expect(tools.result.tools.map((t) => t.name)).toContain('edit_component');

    const created = JSON.parse(text(await call('create_project', { name: 'Plate' }))) as { component: { id: string } };
    const document = created.component.id;
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
    ) as ComponentSummary;
    expect(sketched.sketches[0]).toMatchObject({ id: 's1', status: 'fully-constrained' });
    const plate = sketched.sketches[0]?.profiles.find((p) => p.area > 1000);
    expect(plate?.area).toBeCloseTo(1800 - Math.PI * 16, 0);

    const extruded = JSON.parse(
      text(
        await call('edit_component', {
          document,
          commands: [{ type: 'add-feature', feature: { type: 'extrude', id: 'e1', name: '', suppressed: false, sketch: 's1', profiles: [plate?.id], distance: '6 mm', direction: 'normal', operation: 'new-body' } }],
        }),
      ),
    ) as ComponentSummary;
    expect(extruded.timeline.map((t) => [t.name, t.state])).toEqual([
      ['Sketch 1', 'ok'],
      ['Extrude 1', 'ok'],
    ]);
    // Bottom, top, four sides and the hole (two halves).
    expect(extruded.bodies[0]?.faces.length).toBe(8);

    const [properties] = JSON.parse(text(await call('component_properties', { document }))) as { volume: number }[];
    expect(properties?.volume).toBeCloseTo((1800 - Math.PI * 16) * 6, 0);
    const path = text(await call('export_component', { document, format: 'stl' }));
    expect(path.startsWith(exports)).toBe(true);
    expect(readFileSync(path).byteLength).toBeGreaterThan(84);
    expect(text(await call('command_reference'))).toBe('// the types');

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
    send({ id: 3, method: 'tools/call', params: { name: 'command_reference', arguments: {} } });
    child.stdin.end();
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    expect(code).toBe(0);
    expect(responses.map((r) => r['id'])).toEqual([1, 2, 3]);
    expect(text(responses[1])).toContain('"name": "Over stdio"');
    // The embedded reference holds the command and feature types.
    expect(text(responses[2])).toContain("readonly type: 'add-feature'");
    expect(text(responses[2])).toContain('export interface ExtrudeFeature');
  });
});
