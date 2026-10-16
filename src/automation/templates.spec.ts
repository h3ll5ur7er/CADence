import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createNodeCore } from '@core/composition/node';
import type { ProjectTemplate } from '@core/contracts';
import { describe, expect, it } from 'vitest';
import { Cadence } from './api';
import { buildTemplate, templates } from './templates';

const folder = join(import.meta.dirname, '..', '..', 'public', 'templates');
const update = process.env['UPDATE_TEMPLATES'] === '1';
const cadence = () => {
  const core = createNodeCore({ exports: join(folder, '..') });
  return new Cadence(core, core.exports);
};
const file = (id: string) => join(folder, `${id}.json`);
const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Worked out by hand from the default parameters (mm³). */
const expectedVolumes: Record<string, Record<string, number>> = {
  // 80 × 60 × 40 − 76 × 56 × 38; a 2 mm plate and a rim of 75.4 × 55.4 × 4.
  'box-with-lid': { Box: 30272, Lid: 26309 },
  // Legs 40 × 4 × 30 and 4 × 50 × 30 sharing 4 × 4 × 30, less two ⌀4.5 holes through 4 mm.
  'wall-bracket': { Bracket: 10193 },
  // 78 × 58 × 25 − 74 × 54 × 23, posts ⌀6 standing 6 mm on the floor, ⌀2.2 holes 8 mm deep.
  enclosure: { Case: 21749 },
};

describe('project templates', { timeout: 120_000 }, () => {
  it.each(templates.map((t) => [t.id, t] as const))('%s is built from its definition and regenerates without errors', async (id, definition) => {
    const template = await buildTemplate(cadence(), definition);
    if (update) {
      mkdirSync(folder, { recursive: true });
      writeFileSync(file(id), text(template));
    }
    expect(existsSync(file(id)), `run with UPDATE_TEMPLATES=1 to write ${file(id)}`).toBe(true);
    expect(readFileSync(file(id), 'utf8').replace(/\r\n/g, '\n'), `${id} changed: run with UPDATE_TEMPLATES=1`).toBe(text(template));

    // A project from the template opens with every component regenerated and no errors.
    const fresh = cadence();
    const created = await fresh.projects.createFromTemplate(JSON.parse(readFileSync(file(id), 'utf8')) as ProjectTemplate);
    if (!created.ok) throw new Error(created.error.message);
    const volumes: Record<string, number> = {};
    for (const document of await fresh.projects.listDocuments(created.value.project.id)) {
      if (document.kind !== 'component') continue;
      const script = await fresh.component(document.id);
      expect(script.summary().timeline.filter((item) => item.state !== 'ok'), `${document.name}`).toEqual([]);
      volumes[document.name] = Math.round((await script.properties()).reduce((sum, body) => sum + body.volume, 0));
    }
    // The volumes the parameters give (mm³): every feature cut or added what it should.
    expect(volumes).toEqual(expectedVolumes[id]);
  });

  it('are listed for the app', () => {
    const index = templates.map(({ id, name, description }) => ({ id, name, description }));
    if (update) writeFileSync(join(folder, 'index.json'), text(index));
    expect(readFileSync(join(folder, 'index.json'), 'utf8').replace(/\r\n/g, '\n')).toBe(text(index));
  });
});
