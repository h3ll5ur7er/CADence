import { ChangeDetectionStrategy, Component, computed, DestroyRef, type ElementRef, inject, output, signal, viewChild } from '@angular/core';
import type { Attachment, ProjectSummary } from '@core/contracts';
import { PROJECT_MANAGER } from '../core.providers';
import { byteSize } from '../shared/format';
import { Icon } from '../shared/icon';
import { markdownToHtml } from '../shared/markdown';

/**
 * A project's notes (CAD-149): its description in Markdown, files kept with it as they are (photos,
 * datasheets) and links; and whether it is a library other projects use (CAD-151).
 */
@Component({
  selector: 'cad-project-dialog',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../shared/dialogs.scss',
  template: `
    <dialog #dialog class="dialog notes" aria-labelledby="notes-heading" (close)="closed()">
      @if (project(); as p) {
        <h2 id="notes-heading">{{ p.name }}</h2>
        <div class="columns">
          <label class="field">
            Description (Markdown)
            <textarea #text rows="9" aria-label="Description" [value]="description()" (input)="description.set(text.value)" placeholder="What the project is, what it needs, how it goes together…"></textarea>
          </label>
          <section class="preview" aria-label="Description as shown" [innerHTML]="preview()"></section>
        </div>
        <div class="row">
          <button type="button" class="btn" [disabled]="description() === (p.description ?? '')" (click)="saveDescription()">Save description</button>
        </div>

        <h3 class="eyebrow">Attachments</h3>
        <ul class="attachments" aria-label="Attachments">
          @for (attachment of p.attachments ?? []; track attachment.id) {
            <li>
              @if (attachment.kind === 'link') {
                <cad-icon name="link" [size]="16" />
                <a [href]="attachment.url" target="_blank" rel="noopener">{{ attachment.name }}</a>
              } @else {
                @if (pictures()[attachment.id]; as url) {
                  <img class="photo" [src]="url" [alt]="attachment.name" />
                } @else {
                  <cad-icon name="attach" [size]="16" />
                }
                <button type="button" class="btn btn-ghost" [attr.aria-label]="'Open ' + attachment.name" (click)="openFile(attachment)">{{ attachment.name }}</button>
                <span class="size">{{ size(attachment) }}</span>
              }
              <button type="button" class="icon-btn" [attr.aria-label]="'Remove ' + attachment.name" title="Remove" (click)="remove(attachment)">
                <cad-icon name="trash" [size]="14" />
              </button>
            </li>
          } @empty {
            <li class="hint">Keep photos, datasheets (PDF) and links with the project: they are versioned and synced with it.</li>
          }
        </ul>
        <div class="row">
          <label class="btn">
            <cad-icon name="attach" /> Attach files…
            <input #files type="file" multiple class="visually-hidden" (change)="attach(files)" />
          </label>
          <form class="link" (submit)="$event.preventDefault(); addLink(url.value, label.value); url.value = ''; label.value = ''">
            <input #url aria-label="Link address" placeholder="https://…" autocomplete="off" />
            <input #label aria-label="Link name" placeholder="Name (optional)" autocomplete="off" />
            <button type="submit" class="btn">Add link</button>
          </form>
        </div>

        <label class="check">
          <input type="checkbox" [checked]="!!p.library" (change)="setLibrary($any($event.target).checked)" />
          A library: other projects insert its components into their assemblies
        </label>
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
        <div class="actions">
          <button type="button" class="btn btn-primary" (click)="dialog.close()">Close</button>
        </div>
      }
    </dialog>
  `,
  styles: `
    .notes { width: min(760px, calc(100vw - 32px)); }
    .columns { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
    @media (max-width: 640px) { .columns { grid-template-columns: 1fr; } }
    .field { display: grid; gap: var(--space-1); font-size: 12px; color: var(--text-muted); }
    textarea { width: 100%; padding: var(--space-2); border: 1px solid var(--border); border-radius: 4px; background: var(--surface-raised); color: var(--text); font: 13px/1.5 var(--font-mono, monospace); resize: vertical; }
    .preview { max-height: 220px; overflow: auto; padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: 4px; font-size: 13px; line-height: 1.5; }
    .preview :is(h3, h4, h5) { margin: var(--space-2) 0 var(--space-1); }
    .preview p, .preview ul, .preview ol { margin: 0 0 var(--space-2); }
    .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: var(--space-2) 0; }
    .link { display: flex; gap: var(--space-1); }
    .link input { width: 160px; height: 30px; padding: 0 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-raised); color: var(--text); }
    .attachments { display: grid; gap: var(--space-1); margin: var(--space-2) 0; padding: 0; list-style: none; }
    .attachments li { display: flex; align-items: center; gap: var(--space-2); }
    .attachments a, .attachments .btn-ghost { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .photo { width: 40px; height: 40px; border-radius: 4px; object-fit: cover; }
    .size { color: var(--text-muted); font-size: 11px; }
    .check { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-3) 0; font-size: 13px; }
    .eyebrow { margin: var(--space-4) 0 0; }
    .hint { color: var(--text-muted); font-size: 12px; }
    .error { padding: var(--space-2); border-radius: var(--radius); background: var(--danger-soft); color: var(--danger); font-size: 12px; }
  `,
})
export class ProjectDialog {
  /** The project's notes or library mark changed. */
  readonly changed = output();
  protected readonly project = signal<ProjectSummary | undefined>(undefined);
  protected readonly description = signal('');
  protected readonly preview = computed(() => markdownToHtml(this.description()));
  protected readonly error = signal<string | undefined>(undefined);
  /** Pictures' object URLs, by attachment. */
  protected readonly pictures = signal<Readonly<Record<string, string>>>({});
  private readonly projects = inject(PROJECT_MANAGER);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.closed());
  }

  async open(project: ProjectSummary): Promise<void> {
    this.error.set(undefined);
    this.description.set(project.description ?? '');
    await this.load(project.id);
    this.dialog().nativeElement.showModal();
  }

  protected size(attachment: Attachment): string {
    return attachment.kind === 'file' ? byteSize(attachment.byteLength) : '';
  }

  protected async saveDescription(): Promise<void> {
    await this.done(await this.projects.setProjectDescription(this.id(), this.description()));
  }

  protected async attach(input: HTMLInputElement): Promise<void> {
    const files = [...(input.files ?? [])];
    input.value = '';
    for (const file of files) {
      const result = await this.projects.addAttachment(this.id(), { file: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } });
      if (!result.ok) return this.done(result);
    }
    await this.done({ ok: true });
  }

  protected async addLink(url: string, name: string): Promise<void> {
    if (!url.trim()) return;
    await this.done(await this.projects.addAttachment(this.id(), { link: { url, ...(name.trim() ? { name } : {}) } }));
  }

  protected async remove(attachment: Attachment): Promise<void> {
    await this.done(await this.projects.removeAttachment(this.id(), attachment.id));
  }

  protected async setLibrary(library: boolean): Promise<void> {
    await this.done(await this.projects.setLibrary(this.id(), library));
  }

  /** A file kept as it is: handed to the user (a download, or a save dialog on the desktop). */
  protected async openFile(attachment: Attachment): Promise<void> {
    const file = await this.projects.attachmentFile(this.id(), attachment.id);
    if (!file.ok) return void this.error.set(file.error.message);
    await this.projects.deliverFile({ name: attachment.name, mediaType: attachment.kind === 'file' ? attachment.mediaType : 'application/octet-stream', bytes: file.value.bytes });
  }

  private id() {
    return (this.project() as ProjectSummary).id;
  }

  private async done(result: { readonly ok: true } | { readonly ok: false; readonly error: { readonly message: string } }): Promise<void> {
    this.error.set(result.ok ? undefined : result.error.message);
    await this.load(this.id());
    this.changed.emit();
  }

  private async load(id: ProjectSummary['id']): Promise<void> {
    const project = await this.projects.findProject(id);
    this.project.set(project);
    this.release();
    const pictures: Record<string, string> = {};
    for (const attachment of project?.attachments ?? []) {
      if (attachment.kind !== 'file' || !attachment.mediaType.startsWith('image/')) continue;
      const file = await this.projects.attachmentFile(id, attachment.id);
      if (file.ok) pictures[attachment.id] = URL.createObjectURL(new Blob([file.value.bytes.slice()], { type: attachment.mediaType }));
    }
    this.pictures.set(pictures);
  }

  protected closed(): void {
    this.release();
  }

  private release(): void {
    for (const url of Object.values(this.pictures())) URL.revokeObjectURL(url);
    this.pictures.set({});
  }
}
