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

  it('keeps version 3 documents as they are: version 4 only marks the newer fields (phases 35 to 41)', () => {
    const component = { id: 'c', schemaVersion: 3, kind: 'component', material: { name: 'PLA', density: 1.24 }, timeline: [{ id: 's', type: 'sketch', entities: [], constraints: [] }] };
    expect(migrate(component)).toEqual({ ...component, schemaVersion: 4 });
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

  it('opens a component of schema 3 unchanged as schema 4, whose gears and springs an older app would misread (phase 37)', () => {
    const timeline = [{ id: 'g', type: 'part', part: { kind: 'gear', module: '1 mm', teeth: '20' } }];
    expect(migrate({ id: 'c', schemaVersion: 3, kind: 'component', timeline })).toEqual({ id: 'c', schemaVersion: 4, kind: 'component', timeline });
  });

  it('rejects documents written by a newer app', () => {
    expect(() => migrate({ schemaVersion: 99 })).toThrow(/saved by a newer CADence .*Update CADence to open it/);
  });

  it('reports a missing migration step', () => {
    expect(() => migrate({ schemaVersion: 1 }, {}, 2)).toThrow(/Missing document migration/);
  });
});
