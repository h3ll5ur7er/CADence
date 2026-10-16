import { ChangeDetectionStrategy, Component, type ElementRef, signal, viewChild } from '@angular/core';
import type { TimelineFolder, TimelineItem } from '@core/contracts';
import { ModalDialog } from '../../shared/dialogs';

export interface FolderRequest {
  readonly heading: string;
  readonly folder: TimelineFolder;
  readonly items: readonly TimelineItem[];
}

/** Names a timeline folder, the items it runs from and to, and its note; resolves `undefined` when cancelled. */
@Component({
  selector: 'cad-folder-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="dialog" aria-labelledby="folder-dialog-heading" (close)="finish(undefined)">
      <form (submit)="submit($event)">
        <h2 id="folder-dialog-heading">{{ request().heading }}</h2>
        <label class="field">
          Name
          <input id="folder-name" autocomplete="off" maxlength="80" placeholder="Folder" [value]="folder().name" (input)="change({ name: value($event) })" />
        </label>
        <label class="field">
          From
          <select id="folder-first" (change)="change({ first: value($event) })">
            @for (item of request().items; track item.id) {
              <option [value]="item.id" [selected]="item.id === folder().first">{{ item.name }}</option>
            }
          </select>
        </label>
        <label class="field">
          To
          <select id="folder-last" (change)="change({ last: value($event) })">
            @for (item of request().items; track item.id) {
              <option [value]="item.id" [selected]="item.id === folder().last">{{ item.name }}</option>
            }
          </select>
        </label>
        <label class="field">
          Note
          <textarea id="folder-note" rows="3" [value]="folder().note ?? ''" (input)="change({ note: value($event) })"></textarea>
        </label>
        <div class="actions">
          <button type="button" class="btn" (click)="finish(undefined)">Cancel</button>
          <button type="submit" class="btn btn-primary">OK</button>
        </div>
      </form>
    </dialog>
  `,
  styleUrl: '../../shared/dialogs.scss',
})
export class FolderDialog extends ModalDialog<TimelineFolder | undefined> {
  protected readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly request = signal<FolderRequest>({ heading: '', folder: { id: '', name: '', first: '', last: '' }, items: [] });
  protected readonly folder = signal<TimelineFolder>({ id: '', name: '', first: '', last: '' });

  ask(request: FolderRequest): Promise<TimelineFolder | undefined> {
    this.request.set(request);
    this.folder.set(request.folder);
    return this.open();
  }

  protected change(changes: Partial<TimelineFolder>): void {
    this.folder.update((f) => ({ ...f, ...changes }));
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.finish(this.folder());
  }

  protected dismissed(): undefined {
    return undefined;
  }
}

/** Asks for a note on a timeline item; resolves `undefined` when cancelled (an empty note removes it). */
@Component({
  selector: 'cad-note-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="dialog" aria-labelledby="note-dialog-heading" (close)="finish(undefined)">
      <form (submit)="submit($event)">
        <h2 id="note-dialog-heading">Note on {{ name() }}</h2>
        <label class="field">
          Why it is there
          <textarea #input id="note-text" rows="4" [value]="note()" (input)="note.set(input.value)"></textarea>
        </label>
        <div class="actions">
          <button type="button" class="btn" (click)="finish(undefined)">Cancel</button>
          <button type="submit" class="btn btn-primary">Save note</button>
        </div>
      </form>
    </dialog>
  `,
  styleUrl: '../../shared/dialogs.scss',
})
export class NoteDialog extends ModalDialog<string | undefined> {
  protected readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly name = signal('');
  protected readonly note = signal('');

  ask(name: string, note: string): Promise<string | undefined> {
    this.name.set(name);
    this.note.set(note);
    return this.open();
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.finish(this.note());
  }

  protected dismissed(): undefined {
    return undefined;
  }
}
