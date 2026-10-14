import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { JointType } from '@core/contracts';
import { AssemblyStore, type DraftSide } from './assembly-store';
import { jointTypes } from './joint-types';

/** Draws a new joint: its type, then a face or edge on each of two instances. */
@Component({
  selector: 'cad-joint-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.jointDraft(); as draft) {
      <p class="eyebrow">Assemble</p>
      <div class="head">
        <h2>New joint</h2>
        <button type="button" class="icon-btn" aria-label="Cancel joint" (click)="store.cancelJoint()">×</button>
      </div>
      <label class="field">
        <span>Type</span>
        <select id="joint-type" (change)="store.updateJoint({ type: value($event) })">
          @for (t of types; track t.type) {
            <option [value]="t.type" [selected]="t.type === draft.type">{{ t.label }}</option>
          }
        </select>
      </label>
      <p class="hint">{{ description() }}</p>
      @for (side of sides(); track side.key) {
        <button type="button" class="side" [class.active]="draft.target === side.key" [attr.data-testid]="'joint-side-' + side.key" (click)="store.updateJoint({ target: side.key })">
          <span class="label">{{ side.label }}</span>
          <span>{{ side.text }}</span>
        </button>
      }
      <label class="check">
        <input id="joint-flip" type="checkbox" [checked]="draft.flip" (change)="store.updateJoint({ flip: !draft.flip })" />
        Turn the moving side over
      </label>
      @if (store.error(); as error) {
        <p class="error" role="alert">{{ error }}</p>
      }
      <div class="actions">
        <button type="button" class="btn" (click)="store.cancelJoint()">Cancel</button>
        <button type="button" class="btn btn-primary" [disabled]="!draft.a || !draft.b" (click)="store.commitJoint()">OK</button>
      </div>
    }
  `,
  styleUrl: './assembly-panels.scss',
})
export class JointPanel {
  protected readonly store = inject(AssemblyStore);
  protected readonly types = jointTypes;

  protected readonly description = computed(() => jointTypes.find((t) => t.type === this.store.jointDraft()?.type)?.description ?? '');

  protected readonly sides = computed(() => {
    const draft = this.store.jointDraft();
    const state = this.store.state();
    const describe = (side: DraftSide | undefined) => {
      if (!side) return 'Click a face or edge in the view';
      const instance = state?.document.instances.find((i) => i.id === side.origin.instance);
      const what = side.origin.ref?.kind === 'edge' ? 'edge' : side.flat ? 'flat face' : 'round face';
      return `${what} of ${instance?.name ?? 'an instance'}`;
    };
    return [
      { key: 'a' as const, label: 'Stays', text: describe(draft?.a) },
      { key: 'b' as const, label: 'Moves', text: describe(draft?.b) },
    ];
  });

  protected value(event: Event): JointType {
    return (event.target as HTMLSelectElement).value as JointType;
  }
}
