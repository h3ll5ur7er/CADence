import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PROJECT_MANAGER } from '../core.providers';

/** A link to view a project shared on a CADence server (CAD-177): opens it here, to look at. */
@Component({
  selector: 'cad-shared-link-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="opening">
      @if (error(); as message) {
        <h1>This link does not open</h1>
        <p role="alert">{{ message }}</p>
        <a routerLink="/">All projects</a>
      } @else {
        <h1>Opening the shared project…</h1>
        <p>It opens here to view; it stays up to date with the server.</p>
      }
    </main>
  `,
  styles: `
    .opening { display: grid; place-content: center; gap: var(--space-2); min-height: 100vh; padding: var(--space-4); text-align: center; }
    h1 { margin: 0; font-size: 20px; }
    p { margin: 0; color: var(--text-muted); }
  `,
})
export class SharedLinkPage {
  /** Query parameters (bound by the router). */
  readonly server = input<string>();
  readonly link = input<string>();
  protected readonly error = signal<string | undefined>(undefined);
  private readonly projects = inject(PROJECT_MANAGER);
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      const [server, link] = [this.server(), this.link()];
      if (!server || !link) return this.error.set('The link is incomplete: it needs the server and the link itself.');
      void this.projects.openViewLink(server, link).then(async (result) => {
        if (!result.ok) return this.error.set(result.error.message);
        await this.router.navigate(['/projects', result.value.id], { replaceUrl: true });
      });
    });
  }
}
