import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runSandboxed, type SandboxOptions } from '@core/utilities/sandbox';
import { describe, expect, it } from 'vitest';
import { createPluginEngine } from './index';

const sample = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'public', 'plugins', 'trays.cadence-plugin.js'), 'utf8');

describe('the plugin engine', () => {
  it('reads the sample plugin: its features, generators and exporters with their parameters', async () => {
    const read = await createPluginEngine().read(sample);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value).toMatchObject({ id: 'cadence.trays', name: 'Trays', version: '1.0.0', api: 1, source: sample });
    expect(read.value.features).toEqual([expect.objectContaining({ name: 'tray', label: 'Tray' })]);
    expect(read.value.features[0]?.parameters[0]).toEqual({ name: 'width', label: 'Width', default: '60 mm', kind: 'length' });
    expect(read.value.generators.map((g) => g.name)).toEqual(['set']);
    expect(read.value.exporters).toEqual([{ name: 'openscad', label: 'OpenSCAD polyhedra', extension: 'scad', mediaType: 'text/plain' }]);
  });

  it('refuses plugins without a proper id, version or API, and says why', async () => {
    const engine = createPluginEngine();
    const plugin = (fields: string) => `return { name: 'P', features: {}, ${fields} };`;
    expect(await engine.read(plugin("id: 'Bad Id', version: '1.0.0', cadence: 1"))).toMatchObject({ ok: false, error: { message: expect.stringContaining('lower case') } });
    expect(await engine.read(plugin("id: 'p', version: 'one', cadence: 1"))).toMatchObject({ ok: false, error: { message: expect.stringContaining('version') } });
    expect(await engine.read(plugin("id: 'p', version: '1.0.0', cadence: 2"))).toMatchObject({ ok: false, error: { code: 'unsupported-plugin', message: expect.stringContaining('plugin API 2') } });
    expect(await engine.read('return 5;')).toMatchObject({ ok: false, error: { message: expect.stringContaining('returns its description') } });
    expect(await engine.read("return { id: 'p', name: 'P', version: '1.0.0', cadence: 1, features: { box: { parameters: [] } } };")).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('no build function') },
    });
    expect(await engine.read('syntax error here')).toMatchObject({ ok: false, error: { message: expect.stringContaining('did not load') } });
  });

  it('builds a feature’s solids from its values, once per set of values', async () => {
    let runs = 0;
    const counted = (source: string, options: SandboxOptions) => {
      runs++;
      return runSandboxed(source, options);
    };
    const engine = createPluginEngine(counted);
    const read = await engine.read(sample);
    if (!read.ok) throw new Error(read.error.message);
    const values = { width: 60, depth: 40, height: 20, wall: 2, corner: 4 };
    const built = await engine.build(read.value, 'tray', values);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.map((s) => [s.z, s.height, s.holes.length])).toEqual([
      [0, 2, 0],
      [2, 18, 1],
    ]);
    const xs = built.value[0]?.outline.map((p) => p[0]) ?? [];
    expect(Math.max(...xs)).toBeCloseTo(30, 6);
    const before = runs;
    await engine.build(read.value, 'tray', { ...values });
    expect(runs).toBe(before);
    await engine.build(read.value, 'tray', { ...values, width: 80 });
    expect(runs).toBe(before + 1);
    // The plugin's own refusal comes back as the feature's error.
    expect(await engine.build(read.value, 'tray', { ...values, wall: 30 })).toMatchObject({ ok: false, error: { message: expect.stringContaining('thicker than half') } });
    expect(await engine.build(read.value, 'lid', values)).toMatchObject({ ok: false, error: { message: expect.stringContaining('no feature "lid"') } });
  });

  it('exports a model with an exporter', async () => {
    const engine = createPluginEngine();
    const read = await engine.read(sample);
    if (!read.ok) throw new Error(read.error.message);
    const text = await engine.export(read.value, 'openscad', { name: 'Tray', bodies: [{ id: 'b1', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], indices: [0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2] }] });
    expect(text).toMatchObject({ ok: true, value: expect.stringContaining('polyhedron(points=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]], faces=[[0,1,2],') });
  });
});
