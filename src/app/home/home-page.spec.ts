import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { createInMemoryCore } from '@core/composition';
import type { ProjectId } from '@core/contracts';
import type { ProjectManager } from '@core/managers/project';
import { PROJECT_MANAGER } from '../core.providers';
import { HomePage } from './home-page';

describe('HomePage', () => {
  let manager: ProjectManager;

  /** The files the app ships, as fetch gives them. */
  function serve() {
    const folder = join(process.cwd(), 'public');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(readFileSync(join(folder, new URL(String(url)).pathname))));
  }

  async function render() {
    const fixture = TestBed.createComponent(HomePage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    manager = createInMemoryCore().projectManager;
    TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideRouter([]), { provide: PROJECT_MANAGER, useValue: manager }],
    });
  });

  it('invites to create the first project when there is none', async () => {
    const page = await render();
    expect(page.querySelector('h1')?.textContent).toContain('No projects yet');
    expect(page.querySelectorAll('.card')).toHaveLength(0);
  });

  it('lists existing projects with their document counts', async () => {
    const created = await manager.createProject('Desk organizer');
    if (!created.ok) throw new Error('setup failed');
    await manager.createDocument(created.value.project.id, 'assembly');
    await manager.createProject('Filament clip');

    const page = await render();
    const cards = [...page.querySelectorAll('.card')].map((c) => c.textContent?.replace(/\s+/g, ' ').trim());
    expect(cards).toHaveLength(2);
    expect(cards.find((c) => c?.includes('Desk organizer'))).toContain('2 documents');
    expect(cards.find((c) => c?.includes('Filament clip'))).toContain('1 document');
  });

  it('lists the samples and makes a project of the one opened (CAD-181)', async () => {
    serve();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const page = await render();
    await vi.waitFor(() => expect(page.querySelectorAll('[aria-label="Samples"] .sample')).toHaveLength(5));
    expect(page.querySelector('[aria-label="Samples"]')?.textContent).toContain('Box with lid');
    page.querySelector<HTMLButtonElement>('button[aria-label="Open sample Wall bracket"]')?.click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
    const [project] = await manager.listProjects();
    expect(project?.name).toBe('Wall bracket');
    expect(navigate.mock.calls[0]?.[0]).toEqual(['/projects', project?.id, 'documents', expect.any(String)]);
    vi.restoreAllMocks();
  });

  it('opens an example as a project of its own, at its assembly (CAD-199)', async () => {
    serve();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const page = await render();
    await vi.waitFor(() => expect(page.querySelector('button[aria-label="Open sample Stewart platform S6"] img')).not.toBeNull());
    page.querySelector<HTMLButtonElement>('button[aria-label="Open sample Stewart platform S6"]')?.click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
    const [project] = await manager.listProjects();
    expect(project?.name).toBe('Stewart platform S6');
    const assembly = (await manager.listDocuments(project?.id as ProjectId)).find((d) => d.kind === 'assembly');
    expect(navigate.mock.calls[0]?.[0]).toEqual(['/projects', project?.id, 'documents', assembly?.id]);
    vi.restoreAllMocks();
  });

  it('links each project to its editor', async () => {
    const created = await manager.createProject('Desk organizer');
    if (!created.ok) throw new Error('setup failed');
    const page = await render();
    expect(page.querySelector('.card-link')?.getAttribute('href')).toBe(`/projects/${created.value.project.id}`);
  });
});
