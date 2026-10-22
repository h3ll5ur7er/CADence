import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createNodeCore } from '@core/composition/node';
import { describe, expect, it } from 'vitest';
import { Cadence } from './api';

const folder = join(import.meta.dirname, '..', '..', 'public', 'examples');
const examples = JSON.parse(readFileSync(join(folder, 'index.json'), 'utf8')) as { id: string; name: string; archive: string; picture: string; open: string }[];

/**
 * The example projects the app ships (public/examples, CAD-199): archives of the stress tests'
 * machines, the radial engine, the robot arm and the Stewart platform. Each opens with every component regenerated, every assembly placed and every drawing
 * drawn, without errors, so a change that breaks old documents shows here.
 */
describe('example projects', { timeout: 600_000 }, () => {
  it.each(examples.map((e) => [e.id, e] as const))('%s opens without errors', async (_id, example) => {
    const core = createNodeCore({ exports: join(folder, '..') });
    const cadence = new Cadence(core, core.exports);
    const imported = await cadence.projects.importProject({ name: example.archive, bytes: readFileSync(join(folder, example.archive)) });
    if (!imported.ok) throw new Error(imported.error.message);
    expect(imported.value.name).toBe(example.name);
    expect(readFileSync(join(folder, example.picture)).subarray(1, 4).toString()).toBe('PNG');
    const documents = await cadence.projects.listDocuments(imported.value.id);
    expect(documents.filter((d) => d.kind === 'assembly').map((d) => d.name)).toContain(example.open);
    for (const document of documents) {
      if (document.kind === 'component') {
        const script = await cadence.component(document.id);
        expect(script.summary().timeline.filter((item) => item.state !== 'ok'), document.name).toEqual([]);
      } else if (document.kind === 'assembly') {
        const summary = await (await cadence.assembly(document.id)).summary();
        expect(summary.components.filter((c) => c.status !== 'ready'), document.name).toEqual([]);
        expect(summary.joints.filter((j) => j.error), document.name).toEqual([]);
      } else if (document.kind === 'drawing') {
        const summary = await (await cadence.drawing(document.id)).summary();
        expect((summary.views ?? []).filter((v) => v.error), document.name).toEqual([]);
      }
    }
  });
});
