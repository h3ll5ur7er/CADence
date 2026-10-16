import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeCore } from '@core/composition/node';
import type { DocumentId, Feature, Matrix4 } from '@core/contracts';
import { afterAll, expect, it } from 'vitest';
import { Cadence, type ComponentScript } from '../../src/automation/api';

/**
 * Benchmarks of large models (CAD-94): run with `npm run bench`. Each case prints its timings; the
 * numbers in docs/Architecture/Performance.md come from here. The core runs as in scripts (no worker).
 */

const exports = mkdtempSync(join(tmpdir(), 'cadence-bench-'));
afterAll(() => rmSync(exports, { recursive: true, force: true }));
const core = createNodeCore({ exports });
const cadence = new Cadence(core, core.exports);
const rows: string[] = [];
afterAll(() => console.log(['', '| Case | Measure | Value |', '| --- | --- | --- |', ...rows].join('\n')));

async function time<T>(work: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const value = await work();
  return [value, performance.now() - start];
}
const record = (subject: string, measure: string, value: string) => {
  console.log(subject, measure, value);
  rows.push(`| ${subject} | ${measure} | ${value} |`);
};
const ms = (value: number) => `${Math.round(value).toLocaleString('en-US')} ms`;
const triangles = (part: ComponentScript) => part.state().bodies.reduce((n, b) => n + b.indices.length / 3, 0);
const translate = (x: number, y: number): Matrix4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1];

async function newComponent(project: string): Promise<{ part: ComponentScript; projectId: string; documentId: string }> {
  const { project: created, firstDocument } = unwrapped(await cadence.projects.createProject(project));
  return { part: await cadence.component(firstDocument.id), projectId: created.id, documentId: firstDocument.id };
}
function unwrapped<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

it('a plate with 400 holes', { timeout: 600_000 }, async () => {
  const { part } = await newComponent('Perforated');
  await part.run({ type: 'add-parameter', parameter: { id: 't', name: 'thickness', expression: '4 mm' } });
  const circles = Array.from({ length: 400 }, (_, i) => ({ type: 'add-circle' as const, sketchId: 's', id: `h${i}`, x: 10 + (i % 20) * 15, y: 10 + Math.floor(i / 20) * 15, diameter: 6 }));
  const [, sketching] = await time(() => part.run({ type: 'create-sketch', id: 's', plane: 'XY' }, { type: 'add-rectangle', sketchId: 's', id: 'r', x: 0, y: 0, width: 305, height: 305 }, ...circles));
  record('Plate, 400 holes', 'Sketch (401 curves, solved)', ms(sketching));
  const profile = part.summary().sketches[0]?.profiles.find((p) => p.holes === 400)?.id as string;
  const [, extruding] = await time(() => part.run({ type: 'add-feature', feature: { type: 'extrude', id: 'e', name: '', suppressed: false, sketch: 's', profiles: [profile], distance: 'thickness', direction: 'normal', operation: 'new-body' } }));
  record('Plate, 400 holes', 'Extrude (build and mesh)', ms(extruding));
  record('Plate, 400 holes', 'Faces / triangles', `${part.state().bodies[0]?.faces.length} / ${triangles(part).toLocaleString('en-US')}`);
  const [, changing] = await time(() => part.run({ type: 'set-parameter', parameter: { id: 't', name: 'thickness', expression: '5 mm' } }));
  record('Plate, 400 holes', 'Thickness changed', ms(changing));
  const [, weighing] = await time(() => part.properties());
  record('Plate, 400 holes', 'Mass properties', ms(weighing));
  const [, checking] = await time(() => part.validate());
  record('Plate, 400 holes', 'Printability check', ms(checking));
  const [, exporting] = await time(() => part.export('stl'));
  record('Plate, 400 holes', 'STL export', ms(exporting));
  expect(part.state().bodies[0]?.faces.length).toBeGreaterThan(800);
});

it('a timeline of 60 features', { timeout: 600_000 }, async () => {
  const { part } = await newComponent('Long timeline');
  await part.run({ type: 'add-parameter', parameter: { id: 'w', name: 'width', expression: '200 mm' } });
  await part.run({ type: 'create-sketch', id: 'base', plane: 'XY' }, { type: 'add-rectangle', sketchId: 'base', id: 'r', x: 0, y: 0, width: 'width', height: 40 });
  const base = part.summary().sketches[0]?.profiles[0]?.id as string;
  await part.run({ type: 'add-feature', feature: { type: 'extrude', id: 'plate', name: '', suppressed: false, sketch: 'base', profiles: [base], distance: '5 mm', direction: 'normal', operation: 'new-body' } });
  const [, building] = await time(async () => {
    for (let i = 0; i < 29; i++) {
      await part.run({ type: 'create-sketch', id: `s${i}`, plane: 'XY' }, { type: 'add-circle', sketchId: `s${i}`, id: 'c', x: 5 + i * 6.5, y: 20, diameter: 4 });
      const circle = part.summary().sketches.find((s) => s.id === `s${i}`)?.profiles[0]?.id as string;
      await part.run({ type: 'add-feature', feature: { type: 'extrude', id: `b${i}`, name: '', suppressed: false, sketch: `s${i}`, profiles: [circle], distance: `${8 + (i % 5)} mm`, direction: 'normal', operation: 'join' } });
    }
  });
  record('Timeline, 60 items', 'Building it (29 sketch + boss pairs)', ms(building));
  const [, first] = await time(() => part.run({ type: 'set-parameter', parameter: { id: 'w', name: 'width', expression: '210 mm' } }));
  record('Timeline, 60 items', 'First sketch changed (all again)', ms(first));
  const boss = part.state().document.timeline.find((item) => item.id === 'b28') as Feature;
  const [, last] = await time(() => part.run({ type: 'edit-feature', feature: { ...boss, distance: '20 mm' } as Feature }));
  record('Timeline, 60 items', 'Last feature changed (the rest reused)', ms(last));
  expect(part.summary().timeline.every((t) => t.state === 'ok')).toBe(true);
});

it('an assembly of 200 parts', { timeout: 600_000 }, async () => {
  const { part, projectId, documentId } = await newComponent('Big assembly');
  await part.run({ type: 'create-sketch', id: 's', plane: 'XY' }, { type: 'add-circle', sketchId: 's', id: 'o', x: 0, y: 0, diameter: 12 }, { type: 'add-circle', sketchId: 's', id: 'i', x: 0, y: 0, diameter: 6 });
  const ring = part.summary().sketches[0]?.profiles.find((p) => p.holes === 1)?.id as string;
  await part.run({ type: 'add-feature', feature: { type: 'extrude', id: 'e', name: '', suppressed: false, sketch: 's', profiles: [ring], distance: '2 mm', direction: 'normal', operation: 'new-body' } });
  const assemblyId = unwrapped(await cadence.projects.createDocument(projectId as never, 'assembly', 'Rack')).id;
  const assembly = await cadence.assembly(assemblyId);
  const [, inserting] = await time(async () => {
    for (let i = 0; i < 200; i++) {
      await assembly.run({ type: 'insert-instance', instance: { id: `i${i}`, component: documentId as DocumentId, name: `Washer ${i + 1}`, transform: translate((i % 20) * 15, Math.floor(i / 20) * 15), grounded: i === 0 } });
    }
  });
  record('Assembly, 200 washers', 'Inserting one by one', ms(inserting));
  assembly.close();
  const [reopened, opening] = await time(async () => {
    const again = await cadence.assembly(assemblyId);
    while ([...again.state().components.values()].some((c) => c.status === 'loading')) await new Promise((r) => setTimeout(r, 5));
    return again;
  });
  record('Assembly, 200 washers', 'Opening it', ms(opening));
  const [overlaps, checking] = await time(() => reopened.interference());
  record('Assembly, 200 washers', 'Interference check (none)', ms(checking));
  const [, picturing] = await time(() => reopened.picture({ width: 800, height: 600 }));
  record('Assembly, 200 washers', 'Software picture 800 × 600', ms(picturing));
  reopened.close();
  expect(overlaps).toEqual([]);
});

it('a strength check of a plate with a hole', { timeout: 600_000 }, async () => {
  const { part } = await newComponent('Strength');
  await part.run({ type: 'create-sketch', id: 's', plane: 'XY' }, { type: 'add-rectangle', sketchId: 's', id: 'r', x: 0, y: 0, width: 60, height: 30 }, { type: 'add-circle', sketchId: 's', id: 'c', x: 30, y: 15, diameter: 8 });
  const plate = part.summary().sketches[0]?.profiles.find((p) => p.holes === 1)?.id as string;
  await part.run({ type: 'add-feature', feature: { type: 'extrude', id: 'e', name: '', suppressed: false, sketch: 's', profiles: [plate], distance: '3 mm', direction: 'normal', operation: 'new-body' } });
  const faces = part.state().bodies[0]?.faces ?? [];
  const end = (x: number) => ({ kind: 'face' as const, body: 'e', name: faces.find((f) => f.planar && Math.abs((f.center[0] as number) - x) < 1e-6)?.name as string });
  for (const size of [undefined, 1.5, 1]) {
    await part.run({ type: 'set-simulation', setup: { fixed: [end(0)], loads: [{ kind: 'force', face: end(60), force: 660, direction: [1, 0, 0] }], ...(size ? { size } : {}) } });
    const [result, solving] = await time(() => part.simulate());
    record('Strength, 60 × 30 × 3 plate', `Size ${size ?? 'auto'}: ${result.elements.toLocaleString('en-US')} elements`, ms(solving));
  }
});
