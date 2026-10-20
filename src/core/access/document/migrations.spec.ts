import { describe, expect, it } from 'vitest';
import { migrate } from './migrations';

describe('document migrations', () => {
  it('passes documents of the current version through', () => {
    const doc = { id: 'd', schemaVersion: 4, name: 'Bracket' };
    expect(migrate(doc)).toEqual(doc);
  });

  it('gives version 1 assemblies an empty list of motion studies', () => {
    expect(migrate({ id: 'a', schemaVersion: 1, kind: 'assembly', instances: [], joints: [] })).toEqual({
      id: 'a',
      schemaVersion: 4,
      kind: 'assembly',
      instances: [],
      joints: [],
      motionStudies: [],
    });
    expect(migrate({ id: 'c', schemaVersion: 1, kind: 'component' })).toEqual({ id: 'c', schemaVersion: 4, kind: 'component' });
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

  it('reads version 3 documents as they are: sheet metal features came as new, optional ones', () => {
    const component = { id: 'c', schemaVersion: 3, kind: 'component', timeline: [{ id: 'bf', type: 'base-flange', thickness: '2 mm' }] };
    expect(migrate(component)).toEqual({ ...component, schemaVersion: 4 });
  });

  it('rejects documents written by a newer app', () => {
    expect(() => migrate({ schemaVersion: 99 })).toThrow(/saved by a newer CADence .*Update CADence to open it/);
  });

  it('reports a missing migration step', () => {
    expect(() => migrate({ schemaVersion: 1 }, {}, 2)).toThrow(/Missing document migration/);
  });
});
