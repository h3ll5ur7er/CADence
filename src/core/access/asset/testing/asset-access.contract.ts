import { asAssetId, asProjectId } from '@core/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Asset, AssetAccess } from '../asset-access';

const asset = (id: string, bytes = [1, 2, 3]): Asset => ({
  id: asAssetId(id),
  projectId: asProjectId('p'),
  name: `${id}.stl`,
  byteLength: bytes.length,
  bytes: new Uint8Array(bytes),
});

/** Behaviour every AssetAccess implementation must show. */
export function describeAssetAccessContract(name: string, create: () => AssetAccess): void {
  describe(`${name} (AssetAccess contract)`, () => {
    let access: AssetAccess;
    beforeEach(() => {
      access = create();
    });

    it('keeps and fetches blobs byte for byte', async () => {
      await access.keep(asset('a', [0, 255, 7]));
      const fetched = await access.fetch(asAssetId('a'));
      expect(fetched?.name).toBe('a.stl');
      expect([...(fetched?.bytes ?? [])]).toEqual([0, 255, 7]);
      expect(await access.fetch(asAssetId('missing'))).toBeUndefined();
    });

    it('does not share the caller buffer', async () => {
      const original = asset('a');
      await access.keep(original);
      original.bytes[0] = 99;
      expect((await access.fetch(asAssetId('a')))?.bytes[0]).toBe(1);
    });

    it('releases blobs and ignores unknown ids', async () => {
      await access.keep(asset('a'));
      await access.release(asAssetId('a'));
      await access.release(asAssetId('nope'));
      expect(await access.fetch(asAssetId('a'))).toBeUndefined();
    });
  });
}
