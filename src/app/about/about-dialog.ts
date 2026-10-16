import { ChangeDetectionStrategy, Component, type ElementRef, signal, viewChild } from '@angular/core';
import { appVersion, credits } from './credits';

const repository = 'https://github.com/h3ll5ur7er/CADence';

/** The libraries CADence is built on, named first; the full list follows. */
const highlights: readonly { readonly name: string; readonly label: string; readonly role: string }[] = [
  { name: 'replicad-opencascadejs', label: 'OpenCascade', role: 'geometry kernel' },
  { name: '@salusoft89/planegcs', label: 'planegcs (FreeCAD GCS)', role: 'sketch constraint solver' },
  { name: 'replicad', label: 'replicad', role: 'modeling on OpenCascade' },
  { name: 'three', label: 'three.js', role: '3D view' },
  { name: '@angular/core', label: 'Angular', role: 'user interface' },
  { name: 'opentype.js', label: 'opentype.js', role: 'text outlines' },
  { name: '@fontsource/inter', label: 'Inter', role: 'font' },
  { name: 'isomorphic-git', label: 'isomorphic-git', role: 'versions and sync' },
];

/** What CADence is, its version, and the credits its libraries' licences ask for. */
@Component({
  selector: 'cad-about-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../shared/dialogs.scss',
  template: `
    <dialog #dialog class="dialog about" aria-labelledby="about-heading">
      <header>
        <span class="mark" aria-hidden="true"></span>
        <div>
          <h2 id="about-heading">CADence</h2>
          <p class="version">Version <span data-testid="app-version">{{ version }}</span></p>
        </div>
      </header>
      <p>Parametric CAD for 3D printing and laser cutting, in the browser and on the desktop.</p>
      <p class="links">
        <a [href]="repository" target="_blank" rel="noopener">Source code</a>
        <a [href]="repository + '/blob/master/docs/User-guide.md'" target="_blank" rel="noopener">User guide</a>
      </p>
      <section aria-labelledby="built-on-heading">
        <h3 id="built-on-heading">Built on</h3>
        <ul class="highlights">
          @for (item of builtOn; track item.name) {
            <li>
              <a [href]="item.url" target="_blank" rel="noopener">{{ item.label }}</a>
              <span class="role">{{ item.role }}</span>
              <span class="license">{{ item.license }}</span>
            </li>
          }
        </ul>
        <p class="note">
          OpenCascade and planegcs are used under the GNU Lesser General Public License. They are loaded as separate WebAssembly
          files, which can be replaced by modified versions; their sources are linked above.
        </p>
      </section>
      <details>
        <summary>All {{ all.length }} libraries and fonts</summary>
        <div class="scroll">
        <table aria-label="Libraries and fonts">
          <thead>
            <tr><th>Package</th><th>Version</th><th>Licence</th></tr>
          </thead>
          <tbody>
            @for (item of all; track item.name + item.version) {
              <tr>
                <td><a [href]="item.url" target="_blank" rel="noopener">{{ item.name }}</a></td>
                <td>{{ item.version }}</td>
                <td>{{ item.license }}</td>
              </tr>
            }
          </tbody>
        </table>
        </div>
      </details>
      <details (toggle)="loadTexts()">
        <summary>Licence texts</summary>
        <pre class="scroll" data-testid="licence-texts">{{ texts() ?? 'Loading…' }}</pre>
      </details>
      <div class="actions">
        <button type="button" class="btn btn-primary" (click)="dialog.close()">Close</button>
      </div>
    </dialog>
  `,
  styles: `
    .about { width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 64px); }
    header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
    header h2 { margin: 0; }
    .mark { width: 36px; height: 36px; border-radius: 9px; background: var(--accent); flex: none; }
    .version { margin: 0; font-size: 12px; }
    .links { display: flex; flex-wrap: wrap; gap: var(--space-4); }
    h3 { margin: 0 0 var(--space-2); font-size: 13px; }
    .highlights { display: grid; gap: var(--space-1); margin: 0 0 var(--space-3); padding: 0; list-style: none; }
    .highlights li { display: grid; grid-template-columns: 11rem 1fr auto; gap: var(--space-2); font-size: 13px; }
    .role, .license { color: var(--text-muted); }
    .license { font-size: 12px; }
    .note { font-size: 12px; }
    details { margin-bottom: var(--space-3); font-size: 13px; }
    .scroll { max-height: 240px; overflow: auto; margin: var(--space-2) 0 0; }
    pre.scroll { padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-raised); font-size: 11px; white-space: pre-wrap; }
    a { color: var(--accent-strong); }
    summary { cursor: pointer; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 2px var(--space-2) 2px 0; text-align: left; }
    th { color: var(--text-muted); font-weight: 500; }
  `,
})
export class AboutDialog {
  protected readonly version = appVersion;
  protected readonly repository = repository;
  protected readonly all = credits;
  protected readonly builtOn = highlights.flatMap((item) => {
    const credit = credits.find((c) => c.name === item.name);
    return credit ? [{ ...item, url: credit.url, license: credit.license }] : [];
  });
  /** The full licence texts, served with the app (generated by tools/licences). */
  protected readonly texts = signal<string | undefined>(undefined);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected async loadTexts(): Promise<void> {
    if (this.texts() !== undefined) return;
    const response = await fetch(new URL('third-party-licences.txt', document.baseURI));
    this.texts.set(response.ok ? await response.text() : 'The licence texts could not be loaded.');
  }

  open(): void {
    this.dialog().nativeElement.showModal();
  }
}
