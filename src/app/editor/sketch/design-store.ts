import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { DocumentId, SketchPlane } from '@core/contracts';
import type { DesignCommand, DesignSession, DesignState, DrawingFormat, SketchView } from '@core/managers/design';
import { newId } from '@core/utilities/identity';
import { DESIGN_MANAGER } from '../../core.providers';
import type { Tool } from './sketch-tools';

/**
 * Client-side state of one component editor: the Design session as signals, plus pure UI state
 * (which sketch is edited, the active tool, the selection). Provided per component mode.
 */
@Injectable()
export class DesignStore {
  private readonly manager = inject(DESIGN_MANAGER);
  private session: DesignSession | undefined;
  private unsubscribe: (() => void) | undefined;
  private dragFrame: Promise<unknown> = Promise.resolve();

  readonly state = signal<DesignState | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);
  readonly editing = signal<string | undefined>(undefined);
  readonly tool = signal<Tool>('select');
  readonly selection = signal<readonly string[]>([]);
  /** A solved drag that is not committed yet. */
  readonly preview = signal<SketchView | undefined>(undefined);

  readonly editedView = computed(() => {
    const id = this.editing();
    if (!id) return undefined;
    const preview = this.preview();
    return preview?.sketch.id === id ? preview : this.state()?.sketches.get(id);
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.unsubscribe?.());
  }

  async open(documentId: DocumentId): Promise<void> {
    this.unsubscribe?.();
    this.reset();
    const opened = await this.manager.open(documentId);
    if (!opened.ok) {
      this.error.set(opened.error.message);
      return;
    }
    this.session = opened.value;
    this.state.set(this.session.state());
    this.unsubscribe = this.session.subscribe((state) => {
      this.state.set(state);
      if (this.editing() && !state.sketches.has(this.editing() as string)) this.finishEditing();
    });
  }

  /** Runs a command; shows its error and returns false when it was rejected. */
  async run(command: DesignCommand): Promise<boolean> {
    if (!this.session) return false;
    const result = await this.session.execute(command);
    this.error.set(result.ok ? undefined : result.error.message);
    return result.ok;
  }

  async createSketch(plane: SketchPlane): Promise<void> {
    const id = newId();
    if (await this.run({ type: 'create-sketch', id, plane })) this.edit(id, 'line');
  }

  /** New sketches start drawing; existing ones start selecting. */
  edit(sketchId: string, tool: Tool = 'select'): void {
    this.editing.set(sketchId);
    this.tool.set(tool);
    this.selection.set([]);
    this.error.set(undefined);
  }

  finishEditing(): void {
    this.editing.set(undefined);
    this.tool.set('select');
    this.selection.set([]);
    this.preview.set(undefined);
  }

  select(ids: readonly string[]): void {
    this.selection.set(ids);
  }

  /** Previews a point drag; at most one solve runs at a time, later moves win. */
  drag(pointId: string, x: number, y: number): void {
    const sketchId = this.editing();
    if (!sketchId || !this.session) return;
    const session = this.session;
    this.dragFrame = this.dragFrame.then(async () => {
      this.preview.set(await session.previewDrag(sketchId, pointId, x, y));
    });
  }

  async drop(pointId: string, x: number, y: number): Promise<void> {
    const sketchId = this.editing();
    await this.dragFrame;
    if (sketchId) await this.run({ type: 'move-point', sketchId, pointId, x, y });
    this.preview.set(undefined);
  }

  async undo(): Promise<void> {
    await this.session?.undo();
    this.error.set(undefined);
  }

  async redo(): Promise<void> {
    await this.session?.redo();
    this.error.set(undefined);
  }

  async exportSketch(sketchId: string, format: DrawingFormat): Promise<void> {
    const result = await this.session?.exportSketch(sketchId, format);
    if (result && !result.ok) this.error.set(result.error.message);
  }

  private reset(): void {
    this.session = undefined;
    this.state.set(undefined);
    this.finishEditing();
    this.error.set(undefined);
  }
}
