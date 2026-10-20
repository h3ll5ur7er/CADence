import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { type Appearance, type DocumentId, type Finish, finishes, type DocumentSummary, type Matrix4, sourceKey, type Vec3 } from '@core/contracts';
import type { AssemblyFormat } from '@core/managers/assembly';
import { newId } from '@core/utilities/identity';
import { compose, rotation, translation } from '@core/utilities/math';
import { relativeTime } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { Shortcuts } from '../../shared/shortcuts';
import { Viewport } from '../../viewport/viewport';
import { grams, millimetres, point } from '../analysis/units';
import { type AssemblySelection, AssemblyStore } from '../assembly/assembly-store';
import { JointPanel } from '../assembly/joint-panel';
import { JointProperties } from '../assembly/joint-properties';
import { MotionPanel } from '../assembly/motion-panel';
import { PatternPanel } from '../assembly/pattern-panel';
import { ExplodePanel } from '../assembly/explode-panel';
import { LinkPanel } from '../assembly/link-panel';
import { PictureDialog } from '../picture-dialog';
import { EditorStatus } from '../editor-status';
import { ThumbnailSaver } from '../thumbnail-saver';
import { ChangedElsewhereNotice } from '../changed-elsewhere';
import { LibraryPanel } from '../assembly/library-panel';

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
  imports: [ChangedElsewhereNotice, LibraryPanel, Viewport, PictureDialog, Icon, JointPanel, JointProperties, MotionPanel, PatternPanel, LinkPanel, ExplodePanel],
  providers: [AssemblyStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './assembly-mode.html',
  styleUrls: ['./mode-layout.scss', './editor-tools.scss', './assembly-mode.scss'],
})
export class AssemblyMode {
  /** Opens the document again, with what another program changed (CAD-150). */
  protected reopen(): void {
    const { id, projectId } = this.document();
    void this.store.open(id, projectId);
  }

  readonly document = input.required<DocumentSummary>();
  protected readonly status = inject(EditorStatus);
  protected readonly thumbnails = inject(ThumbnailSaver);
  protected readonly store = inject(AssemblyStore);
  protected readonly menu = signal<'insert' | 'export' | 'pattern' | undefined>(undefined);
  protected readonly exportFormats = exportFormats;
  protected readonly relativeTime = relativeTime;
  protected readonly mm = millimetres;
  protected readonly grams = grams;
  protected readonly finishes = finishes;
  protected readonly finishLabels: Readonly<Record<Finish, string>> = { matte: 'Matte', plastic: 'Plastic', metal: 'Metal', glass: 'Glass', wood: 'Wood' };
  protected readonly at = point;
  protected readonly round = (v: number) => Math.round(v * 100) / 100;
  protected readonly positionFields = [
    { label: 'X (mm)', index: 0 },
    { label: 'Y (mm)', index: 1 },
    { label: 'Z (mm)', index: 2 },
    { label: 'Turn (°)', index: 3 },
  ] as const;
  /** The theme's body colour, for the colour field of instances that have none of their own. */
  protected readonly defaultColor = getComputedStyle(document.documentElement).getPropertyValue('--body').trim() || '#a9b6c2';
  private readonly viewport = viewChild.required(Viewport);
  protected readonly pictureDialog = viewChild.required(PictureDialog);
  protected readonly capture = (fps: number) => this.viewport().captureStream(fps);

  protected setConfiguration(instanceId: string, configuration: string): void {
    void this.store.run({ type: 'set-instance-configuration', instanceId, ...(configuration ? { configuration } : {}) });
  }

  protected readonly instances = computed(() => {
    const state = this.store.state();
    return (state?.document.instances ?? []).map((instance) => ({ instance, status: state?.components.get(sourceKey(instance.component, instance.configuration))?.status ?? 'loading' }));
  });
  protected readonly joints = computed(() => this.store.state()?.document.joints ?? []);
  protected readonly studies = computed(() => this.store.state()?.document.motionStudies ?? []);
  protected readonly patterns = computed(() => this.store.state()?.document.patterns ?? []);
  protected readonly links = computed(() => this.store.state()?.document.links ?? []);
  protected readonly views = computed(() => this.store.state()?.document.explodedViews ?? []);
  /** Joints with freedoms, which links can connect. */
  protected readonly linkable = computed(() => this.joints().filter((j) => j.values.length > 0).length);
  /** A picture of the view for build instructions, once it shows what was just set. */
  protected readonly picture = async (box: { min: Vec3; max: Vec3 } | undefined) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 60));
    const jpeg = await this.viewport().picture(1200, 800, box);
    return jpeg ? { jpeg, width: 1200, height: 800 } : undefined;
  };
  protected readonly selectedInstance = computed(() => {
    const selection = this.store.selection();
    const state = this.store.state();
    const instance = selection?.kind === 'instance' ? state?.document.instances.find((i) => i.id === selection.id) : undefined;
    if (!instance || !state) return undefined;
    return {
      instance,
      component: state.components.get(sourceKey(instance.component, instance.configuration))?.name ?? 'a component',
      configurations: state.components.get(sourceKey(instance.component, instance.configuration))?.configurations ?? [],
      placed: state.placed.has(instance.id),
      position: positionOf(state.poses.get(instance.id) ?? instance.transform),
    };
  });

  constructor() {
    effect(() => {
      const { id, projectId } = this.document();
      untracked(() => void this.store.open(id, projectId));
    });
    const stop = inject(Shortcuts).register('document', {
      undo: () => void this.store.undo(),
      redo: () => void this.store.redo(),
      cancel: () => this.store.cancelJoint(),
    });
    inject(DestroyRef).onDestroy(stop);
  }

  protected isSelected(kind: NonNullable<AssemblySelection>['kind'], id: string): boolean {
    const selection = this.store.selection();
    return selection?.kind === kind && selection.id === id;
  }

  protected instanceName(id: string): string {
    return this.store.state()?.document.instances.find((i) => i.id === id)?.name ?? id;
  }

  protected pattern(kind: 'linear' | 'circular' | 'mirror'): void {
    this.menu.set(undefined);
    this.store.startPattern(kind);
  }

  protected toggleMenu(menu: 'insert' | 'export' | 'pattern'): void {
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

  /** Back to the component's own look; a hidden instance stays hidden. */
  protected resetLook(instanceId: string, current: Appearance | undefined): void {
    void this.store.run({ type: 'set-instance-appearance', instanceId, appearance: current?.hidden ? { hidden: true } : {} });
  }

  /** Changes how an instance is shown; one undoable step. */
  protected setAppearance(instanceId: string, current: Appearance | undefined, change: Partial<Appearance>): void {
    const { hidden, ...look } = { ...current, ...change };
    void this.store.run({ type: 'set-instance-appearance', instanceId, appearance: hidden ? { ...look, hidden } : look });
  }
}
