import { asProjectId, type Project } from '@core/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProjectAccess } from '../project-access';

const project = (id: string, name = `Project ${id}`): Project => ({
  id: asProjectId(id),
  name,
  createdAt: '2026-10-14T10:00:00.000Z',
  modifiedAt: '2026-10-14T10:00:00.000Z',
});

/** Behaviour every ProjectAccess implementation must show. */
export function describeProjectAccessContract(name: string, create: () => ProjectAccess): void {
  describe(`${name} (ProjectAccess contract)`, () => {
    let access: ProjectAccess;
    beforeEach(() => {
      access = create();
    });

    it('starts empty', async () => {
      expect(await access.enumerate()).toEqual([]);
    });

    it('establishes and finds projects', async () => {
      await access.establish(project('a'));
      await access.establish(project('b'));
      expect(await access.find(asProjectId('a'))).toEqual(project('a'));
      expect((await access.enumerate()).map((p) => p.id).sort()).toEqual(['a', 'b']);
    });

    it('refuses to establish a duplicate id', async () => {
      await access.establish(project('a'));
      await expect(access.establish(project('a'))).rejects.toThrow(/already exists/);
    });

    it('revises existing projects only', async () => {
      await access.establish(project('a'));
      await access.revise(project('a', 'Renamed'));
      expect((await access.find(asProjectId('a')))?.name).toBe('Renamed');
      await expect(access.revise(project('x'))).rejects.toThrow(/Unknown project/);
    });

    it('discards projects and ignores unknown ids', async () => {
      await access.establish(project('a'));
      await access.discard(asProjectId('a'));
      await access.discard(asProjectId('nope'));
      expect(await access.find(asProjectId('a'))).toBeUndefined();
    });
  });
}
