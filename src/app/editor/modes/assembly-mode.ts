import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { type DocumentId, type DocumentSummary, type Matrix4 } from '@core/contracts';
import type { AssemblyFormat } from '@core/managers/assembly';
import { newId } from '@core/utilities/identity';
import { compose, rotation, translation } from '@core/utilities/math';
import { relativeTime } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { Viewport } from '../../viewport/viewport';
import { millimetres } from '../analysis/units';
import { AssemblyStore } from '../assembly/assembly-store';
import { JointPanel } from '../assembly/joint-panel';
import { JointProperties } from '../assembly/joint-properties';
import { MotionPanel } from '../assembly/motion-panel';
import { EditorStatus } from '../editor-status';

const exportFormats: readonly { format: AssemblyFormat; label: string }[] = [
  { format: 'step', label: 'STEP (one solid per instance)' },
  { format: '3mf', label: '3MF (one object per instance)' },
  { format: 'stl', label: 'STL (all parts)' },
  { format: 'obj', label: 'OBJ (mesh)' },
];

/** X, Y, Z in mm and the turn about Z in degrees: how a free instance is placed by hand. */
type Position = readonly [number, number, number, number];

const positionOf = (m: Matrix4): Position => {
  const round = (v: number) => Math.round(v * 1000) / 1000 + 0;
  return [round(m[12] as number), round(m[13] as number), round(m[14] as number), round((Math.atan2(m[1] as number, m[0] as number) * 180) / Math.PI)];
};

/** Assembly mode: instances of components, joints between them, motion studies. */
@Component({
  selector: 'cad-assembly-mode',
  imports: [Viewport, Icon, JointPanel, JointProperties, MotionPanel],
  providers: [AssemblyStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './assembly-mode.html',
  styleUrls: ['./mode-layout.scss', './editor-tools.scss', './assembly-mode.scss'],
  host: {
    '(document:keydown)': 'shortcut($event)',
  },
})
export class AssemblyMode {
  readonly document = input.required<DocumentSummary>();
  protected readonly status = inject(EditorStatus);
  protected readonly store = inject(AssemblyStore);
  protected readonly menu = signal<'insert' | 'export' | undefined>(undefined);
  protected readonly exportFormats = exportFormats;
  protected readonly relativeTime = relativeTime;
  protected readonly mm = millimetres;
  protected readonly positionFields = [
    { label: 'X (mm)', index: 0 },
    { label: 'Y (mm)', index: 1 },
    { label: 'Z (mm)', index: 2 },
    { label: 'Turn (°)', index: 3 },
  ] as const;
  private readonly viewport = viewChild.required(Viewport);
  protected readonly capture = (fps: number) => this.viewport().captureStream(fps);

  protected readonly instances = computed(() => {
    const state = this.store.state();
    return (state?.document.instances ?? []).map((instance) => ({ instance, status: state?.components.get(instance.component)?.status ?? 'loading' }));
  });
  protected readonly joints = computed(() => this.store.state()?.document.joints ?? []);
  protected readonly studies = computed(() => this.store.state()?.document.motionStudies ?? []);
  protected readonly selectedInstance = computed(() => {
    const selection = this.store.selection();
    const state = this.store.state();
    const instance = selection?.kind === 'instance' ? state?.document.instances.find((i) => i.id === selection.id) : undefined;
    if (!instance || !state) return undefined;
    return {
      instance,
      component: state.components.get(instance.component)?.name ?? 'a component',
      placed: state.placed.has(instance.id),
      position: positionOf(state.poses.get(instance.id) ?? instance.transform),
    };
  });

  constructor() {
    effect(() => {
      const { id, projectId } = this.document();
      untracked(() => void this.store.open(id, projectId));
    });
  }

  protected isSelected(kind: 'instance' | 'joint' | 'study', id: string): boolean {
    const selection = this.store.selection();
    return selection?.kind === kind && selection.id === id;
  }

  protected instanceName(id: string): string {
    return this.store.state()?.document.instances.find((i) => i.id === id)?.name ?? id;
  }

  protected toggleMenu(menu: 'insert' | 'export'): void {
    this.menu.set(this.menu() === menu ? undefined : menu);
  }

  protected insert(component: DocumentId): void {
    this.menu.set(undefined);
    void this.store.insert(component);
  }

  protected exportAs(format: AssemblyFormat): void {
    this.menu.set(undefined);
    void this.store.exportAssembly(format);
  }

  protected async addStudy(): Promise<void> {
    const id = newId();
    const joint = this.joints()[0];
    const keys = joint ? [{ time: 0, joint: joint.id, values: joint.values }] : [];
    if (await this.store.run({ type: 'add-study', study: { id, name: '', duration: 2, keys } })) this.store.select({ kind: 'study', id });
  }

  protected removeInstance(id: string): void {
    if (this.store.selection()?.id === id) this.store.selection.set(undefined);
    void this.store.run({ type: 'remove-instance', instanceId: id });
  }

  protected move(id: string, position: Position, index: number, event: Event): void {
    const next = position.map((v, i) => (i === index ? Number((event.target as HTMLInputElement).value) : v));
    const [x, y, z, turn] = next as [number, number, number, number];
    void this.store.run({ type: 'move-instance', instanceId: id, transform: compose(translation([x, y, z]), rotation([0, 0, 1], (turn * Math.PI) / 180)) });
  }

  protected shortcut(event: KeyboardEvent): void {
    if ((event.target as HTMLElement | null)?.closest('input, textarea, select, dialog')) return;
    if (event.key === 'Escape') {
      this.store.cancelJoint();
      return;
    }
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      void this.store.undo();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      void this.store.redo();
    }
  }
}
