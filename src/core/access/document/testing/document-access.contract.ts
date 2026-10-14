import {
  asDocumentId,
  asProjectId,
  type ComponentDocument,
  currentSchemaVersion,
  summarize,
} from '@core/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DocumentAccess } from '../document-access';

const component = (id: string, projectId: string, name = `Part ${id}`): ComponentDocument => ({
  id: asDocumentId(id),
  projectId: asProjectId(projectId),
  kind: 'component',
  name,
  createdAt: '2026-10-14T10:00:00.000Z',
  modifiedAt: '2026-10-14T10:00:00.000Z',
  schemaVersion: currentSchemaVersion,
  units: 'mm',
  parameters: [{ id: 'p1', name: 'wall', expression: '2 mm' }],
  timeline: [],
  rollbackIndex: 0,
});

/** Behaviour every DocumentAccess implementation must show. */
export function describeDocumentAccessContract(name: string, create: () => DocumentAccess): void {
  describe(`${name} (DocumentAccess contract)`, () => {
    let access: DocumentAccess;
    beforeEach(() => {
      access = create();
    });

    it('stores and loads documents unchanged', async () => {
      await access.store(component('d1', 'p'));
      expect(await access.load(asDocumentId('d1'))).toEqual(component('d1', 'p'));
      expect(await access.load(asDocumentId('missing'))).toBeUndefined();
    });

    it('enumerates the summaries of one project only', async () => {
      await access.store(component('d1', 'p'));
      await access.store(component('d2', 'p'));
      await access.store(component('d3', 'other'));
      const summaries = await access.enumerate(asProjectId('p'));
      expect(summaries.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
        summarize(component('d1', 'p')),
        summarize(component('d2', 'p')),
      ]);
    });

    it('replaces a document stored again', async () => {
      await access.store(component('d1', 'p'));
      await access.store(component('d1', 'p', 'Renamed'));
      expect((await access.load(asDocumentId('d1')))?.name).toBe('Renamed');
      expect(await access.enumerate(asProjectId('p'))).toHaveLength(1);
    });

    it('does not let callers mutate stored state', async () => {
      const doc = component('d1', 'p');
      await access.store(doc);
      (doc as { name: string }).name = 'mutated';
      expect((await access.load(asDocumentId('d1')))?.name).toBe('Part d1');
    });

    it('discards documents and ignores unknown ids', async () => {
      await access.store(component('d1', 'p'));
      await access.discard(asDocumentId('d1'));
      await access.discard(asDocumentId('nope'));
      expect(await access.load(asDocumentId('d1'))).toBeUndefined();
    });
  });
}
