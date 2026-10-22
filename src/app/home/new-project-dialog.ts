import { ChangeDetectionStrategy, Component, type ElementRef, signal, viewChild } from '@angular/core';
import { ModalDialog } from '../shared/dialogs';
import { HelpLink } from '../shared/help';

/** A template as the app lists it (public/templates/index.json). */
export interface TemplateEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/** An example project as the app lists it (public/examples/index.json, CAD-199): an archive to import, with a picture. */
export interface ExampleEntry extends TemplateEntry {
  readonly archive: string;
  readonly picture: string;
  /** The document it opens at, by name. */
  readonly open: string;
}

export interface NewProject {
  readonly name: string;
  /** Absent: an empty project. */
  readonly template?: string;
}

/** Line pictures of the templates (64 × 48), drawn for CADence. */
const pictures: Readonly<Record<string, string>> = {
  empty: 'M20 18l12-6 12 6v14l-12 6-12-6zM20 18l12 6 12-6M32 24v14',
  'box-with-lid': 'M14 24l18-8 18 8v12l-18 8-18-8zM14 24l18 8 18-8M32 32v12M14 14l18-8 18 8-18 8zM14 14v3l18 8 18-8v-3',
  'wall-bracket': 'M18 10v28l14 6V18zM18 10l14 8M32 44l18-8-14-6M25 30a2 1 0 1 0 0.1 0M40 36a2 1 0 1 0 0.1 0',
  enclosure: 'M12 22l20-9 20 9v13l-20 9-20-9zM12 22l20 9 20-9M32 31v13M18 23v5M26 19v5M38 27v5M46 23v5',
};

/** A template's line picture (64 × 48); an empty project's for templates without one. */
export const templatePicture = (id: string): string => pictures[id] ?? pictures['empty'] ?? '';

/** Asks for a new project's name and what it starts from: nothing, or a template. */
@Component({
  selector: 'cad-new-project-dialog',
  imports: [HelpLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../shared/dialogs.scss',
  template: `
    <dialog #dialog class="dialog new-project" aria-labelledby="new-project-heading" (close)="finish(undefined)">
      <form (submit)="submit($event)">
        <h2 id="new-project-heading">New project <cad-help topic="new-project" /></h2>
        <fieldset class="templates">
          <legend>Start from</legend>
          @for (choice of choices(); track choice.id) {
            <label class="template" [class.chosen]="chosen() === choice.id">
              <input type="radio" name="template" [value]="choice.id" [checked]="chosen() === choice.id" (change)="choose(choice)" />
              <svg viewBox="0 0 64 48" aria-hidden="true"><path [attr.d]="picture(choice.id)" /></svg>
              <span class="label">{{ choice.name }}</span>
              <span class="description">{{ choice.description }}</span>
            </label>
          }
        </fieldset>
        <label class="field">
          Name
          <input #input name="name" autocomplete="off" maxlength="80" [value]="name()" (input)="name.set(input.value); named = true" />
        </label>
        <div class="actions">
          <button type="button" class="btn" (click)="finish(undefined)">Cancel</button>
          <button type="submit" class="btn btn-primary" [disabled]="!name().trim()">Create project</button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    .new-project { width: min(620px, calc(100vw - 32px)); }
    .templates { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: var(--space-2); margin: 0; padding: 0; border: 0; }
    legend { margin-bottom: var(--space-2); font-size: 12px; color: var(--text-muted); }
    .template { display: grid; align-content: start; gap: 2px; padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; }
    .template.chosen { border-color: var(--accent); background: var(--accent-soft); }
    .template:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }
    .template input { position: absolute; opacity: 0; pointer-events: none; }
    svg { width: 100%; height: 56px; fill: none; stroke: var(--accent-strong); stroke-width: 1.4; stroke-linejoin: round; }
    .label { font-weight: 600; font-size: 13px; }
    .description { color: var(--text-muted); font-size: 11px; line-height: 1.3; }
  `,
})
export class NewProjectDialog extends ModalDialog<NewProject | undefined> {
  protected readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly choices = signal<readonly TemplateEntry[]>([]);
  protected readonly chosen = signal('empty');
  protected readonly name = signal('');
  /** The user typed a name: choosing a template keeps it. */
  protected named = false;
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');

  ask(templates: readonly TemplateEntry[]): Promise<NewProject | undefined> {
    const empty = { id: 'empty', name: 'Empty project', description: 'A component to model in, nothing else.' };
    this.choices.set([empty, ...templates]);
    this.chosen.set('empty');
    this.name.set('Untitled project');
    this.named = false;
    const answer = this.open();
    const input = this.input().nativeElement;
    input.value = this.name();
    input.select();
    return answer;
  }

  protected picture(id: string): string {
    return templatePicture(id);
  }

  protected choose(choice: TemplateEntry): void {
    this.chosen.set(choice.id);
    if (!this.named) {
      this.name.set(choice.id === 'empty' ? 'Untitled project' : choice.name);
      this.input().nativeElement.value = this.name();
    }
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const name = this.name().trim();
    if (!name) return;
    this.finish(this.chosen() === 'empty' ? { name } : { name, template: this.chosen() });
  }

  protected dismissed(): undefined {
    return undefined;
  }
}
