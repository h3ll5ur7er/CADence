import type { EdgeTreatmentFeature, ExtrudeFeature } from '@core/contracts';
import { circleLoop, profile, rectangleLoop } from '@core/contracts/testing/profiles';
import { applyPick, type FeatureDraft, pickableFor, selectionOf, solidProfiles } from './feature-drafts';

type Fillet = EdgeTreatmentFeature;

describe('feature drafts', () => {
  const extrude: FeatureDraft = {
    mode: 'create',
    feature: { id: 'e', type: 'extrude', name: '', suppressed: false, sketch: 's1', profiles: ['a'], distance: '10', direction: 'normal', operation: 'new-body' } satisfies ExtrudeFeature,
  };

  it('preselects plates without the profiles that fill their holes', () => {
    const plate = profile(rectangleLoop(0, 0, 40, 20, 'r'), [circleLoop(10, 10, 3, 'hole', false)], 'plate');
    const plug = profile(circleLoop(10, 10, 3, 'hole'), [], 'plug');
    const tab = profile(rectangleLoop(50, 0, 10, 10, 't'), [], 'tab');
    expect(solidProfiles([plate, plug, tab])).toEqual(['plate', 'tab']);
  });

  it('toggles profiles of one sketch and switches sketches', () => {
    const added = applyPick(extrude, { kind: 'profile', sketch: 's1', profile: 'b' });
    expect((added.feature as ExtrudeFeature).profiles).toEqual(['a', 'b']);
    const removed = applyPick(added, { kind: 'profile', sketch: 's1', profile: 'a' });
    expect((removed.feature as ExtrudeFeature).profiles).toEqual(['b']);
    const other = applyPick(removed, { kind: 'profile', sketch: 's2', profile: 'x' });
    expect(other.feature).toMatchObject({ sketch: 's2', profiles: ['x'] });
  });

  it('collects edges for fillets and shows them as the selection', () => {
    const fillet: FeatureDraft = { mode: 'create', feature: { id: 'f', type: 'fillet', name: '', suppressed: false, edges: [], size: '1' } satisfies Fillet };
    const picked = applyPick(fillet, { kind: 'edge', body: 'b', name: 'e:x', hint: [1, 2, 3] });
    expect((picked.feature as Fillet).edges).toEqual([{ kind: 'edge', body: 'b', name: 'e:x', hint: [1, 2, 3] }]);
    expect(selectionOf(picked)).toEqual([{ kind: 'edge', body: 'b', name: 'e:x', hint: [1, 2, 3] }]);
    expect([...pickableFor(picked)]).toEqual(['edge']);
    expect((applyPick(picked, { kind: 'edge', body: 'b', name: 'e:x', hint: [1, 2, 3] }).feature as Fillet).edges).toEqual([]);
  });

  it('takes an edge as axis when asked for one', () => {
    const revolve: FeatureDraft = {
      mode: 'create',
      target: 'axis',
      feature: { id: 'r', type: 'revolve', name: '', suppressed: false, sketch: 's', profiles: [], axis: { kind: 'origin', axis: 'Z' }, angle: '360 deg', operation: 'new-body' },
    };
    expect([...pickableFor(revolve)]).toEqual(['edge']);
    const picked = applyPick(revolve, { kind: 'edge', body: 'b', name: 'e:y', hint: [0, 0, 0] });
    expect(picked.target).toBeUndefined();
    expect(picked.feature).toMatchObject({ axis: { kind: 'edge', edge: { name: 'e:y' } } });
  });
});

