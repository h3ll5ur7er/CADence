import { InMemoryAssetAccess } from '@core/access/asset';
import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
import { InMemoryProjectAccess } from '@core/access/project';
import { createShapeAccess } from '@core/access/shape';
import { asDocumentId, asProjectId, currentSchemaVersion, type DomainEvents, type Result } from '@core/contracts';
import { createAnalysisEngine } from '@core/engines/analysis';
import { createInterchangeEngine } from '@core/engines/interchange';
import { createModelingEngine } from '@core/engines/modeling';
import { createParameterEngine } from '@core/engines/parameter';
import { createSketchEngine } from '@core/engines/sketch';
import { steppingClock } from '@core/utilities/clock';
import { EventBus } from '@core/utilities/messaging';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDesignManager, type DesignSession } from './index';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const sketchEngine = createSketchEngine();
const shapes = createShapeAccess();
const modeling = createModelingEngine(shapes);

describe('Wrap (CAD-155)', () => {
  let session: DesignSession;

  beforeEach(async () => {
    const projects = new InMemoryProjectAccess();
    await projects.establish({ id: asProjectId('p1'), name: 'Project', createdAt: '2026-10-14T10:00:00.000Z', modifiedAt: '2026-10-14T10:00:00.000Z' });
    const documents = new InMemoryDocumentAccess();
    await documents.store({
      id: asDocumentId('d1'),
      projectId: asProjectId('p1'),
      kind: 'component',
      name: 'Knob',
      createdAt: '2026-10-14T10:00:00.000Z',
      modifiedAt: '2026-10-14T10:00:00.000Z',
      schemaVersion: currentSchemaVersion,
      units: 'mm',
      parameters: [],
      timeline: [],
      rollbackIndex: 0,
    });
    const manager = createDesignManager({
      projects,
      documents,
      externalFiles: new InMemoryExternalFileAccess(),
      sketches: sketchEngine,
      parameters: createParameterEngine(),
      modeling,
      interchange: createInterchangeEngine(shapes),
      analysis: createAnalysisEngine(shapes),
      assets: new InMemoryAssetAccess(),
      events: new EventBus<DomainEvents>(),
      clock: steppingClock('2026-10-14T11:00:00.000Z'),
    });
    session = unwrap(await manager.open(asDocumentId('d1')));
    // A round knob: a circle of 12 mm radius extruded 20 mm.
    unwrap(await session.execute({ type: 'create-sketch', id: 's1', plane: 'XY' }));
    unwrap(
      await session.execute({
        type: 'add-sketch-geometry',
        sketchId: 's1',
        entities: [
          { id: 'c', kind: 'point', x: 0, y: 0 },
          { id: 'rim', kind: 'circle', center: 'c', radius: 12, construction: false },
        ],
        constraints: [],
      }),
    );
    const profile = session.state().sketches.get('s1')?.profiles[0]?.id as string;
    unwrap(await session.execute({ type: 'add-feature', feature: { type: 'extrude', id: 'e1', name: '', suppressed: false, sketch: 's1', profiles: [profile], distance: '20 mm', direction: 'normal', operation: 'new-body' } }));
  });

  const volume = async () => (await session.properties())[0]?.volume ?? 0;

  it('embosses text wrapped round a cylinder, and follows when the text changes', { timeout: 60_000 }, async () => {
    const before = await volume();
    unwrap(await session.execute({ type: 'create-sketch', id: 'label', plane: 'XZ' }));
    unwrap(
      await session.execute({
        type: 'add-sketch-geometry',
        sketchId: 'label',
        entities: [
          { id: 'at', kind: 'point', x: -6, y: 8 },
          { id: 't', kind: 'text', anchor: 'at', text: 'OK', height: 5, weight: 'bold', angle: 0, construction: false },
        ],
        constraints: [],
      }),
    );
    const letters = session.state().sketches.get('label')?.profiles ?? [];
    expect(letters.length).toBeGreaterThanOrEqual(2);
    const face = session.state().bodies[0]?.faces.find((f) => f.name.startsWith('f:e1:side:rim'))?.name as string;
    unwrap(
      await session.execute({
        type: 'add-feature',
        feature: { type: 'wrap', id: 'w1', name: '', suppressed: false, sketch: 'label', profiles: letters.map((p) => p.id), face: { kind: 'face', body: 'e1', name: face }, method: 'wrap', depth: '0.6 mm', operation: 'emboss' },
      }),
    );
    expect(session.state().items.get('w1')).toEqual({ state: 'ok' });
    expect(session.state().document.timeline.at(-1)?.name).toBe('Wrap 1');
    const area = letters.reduce((sum, p) => sum + p.area, 0);
    // Raised 0.6 mm: a little more than area × depth, since it widens outward.
    expect((await volume()) - before).toBeGreaterThan(area * 0.6 * 0.95);
    expect((await volume()) - before).toBeLessThan(area * 0.6 * 1.1);
    expect(session.state().bodies[0]?.faces.some((f) => f.name.startsWith('f:w1:top'))).toBe(true);

    // Engraved instead, deeper.
    const wrap = session.state().document.timeline.at(-1);
    if (wrap?.type !== 'wrap') throw new Error('no wrap');
    unwrap(await session.execute({ type: 'edit-feature', feature: { ...wrap, operation: 'engrave', depth: '1 mm' } }));
    const engraved = before - (await volume());
    expect(engraved).toBeGreaterThan(area * 0.9);
    // Smaller letters: the wrap follows them (their profiles keep their ids).
    unwrap(await session.execute({ type: 'set-sketch-text', sketchId: 'label', textId: 't', text: 'OK', height: 3, weight: 'bold', angle: 0 }));
    expect(session.state().items.get('w1')).toEqual({ state: 'ok' });
    expect(before - (await volume())).toBeLessThan(engraved * 0.5);
  });
});
