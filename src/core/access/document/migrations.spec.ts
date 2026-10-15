import { describe, expect, it } from 'vitest';
import { migrate } from './migrations';

describe('document migrations', () => {
  it('passes documents of the current version through', () => {
    const doc = { id: 'd', schemaVersion: 2, name: 'Bracket' };
    expect(migrate(doc)).toEqual(doc);
  });

  it('gives version 1 assemblies an empty list of motion studies', () => {
    expect(migrate({ id: 'a', schemaVersion: 1, kind: 'assembly', instances: [], joints: [] })).toEqual({
      id: 'a',
      schemaVersion: 2,
      kind: 'assembly',
      instances: [],
      joints: [],
      motionStudies: [],
    });
    expect(migrate({ id: 'c', schemaVersion: 1, kind: 'component' })).toEqual({ id: 'c', schemaVersion: 2, kind: 'component' });
  });

  it('runs each step in order up to the target version', () => {
    const migrated = migrate(
      { id: 'd', schemaVersion: 1, name: 'bracket' },
      {
        1: (d) => ({ ...d, units: 'mm' }),
        2: (d) => ({ ...d, name: String(d['name']).toUpperCase() }),
      },
      3,
    );
    expect(migrated).toEqual({ id: 'd', schemaVersion: 3, name: 'BRACKET', units: 'mm' });
  });

  it('rejects documents written by a newer app', () => {
    expect(() => migrate({ schemaVersion: 99 })).toThrow(/newer than this app supports/);
  });

  it('reports a missing migration step', () => {
    expect(() => migrate({ schemaVersion: 1 }, {}, 2)).toThrow(/Missing document migration/);
  });
});
