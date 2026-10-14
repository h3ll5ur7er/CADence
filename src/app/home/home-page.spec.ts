import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { createInMemoryCore } from '@core/composition';
import type { ProjectManager } from '@core/managers/project';
import { PROJECT_MANAGER } from '../core.providers';
import { HomePage } from './home-page';

describe('HomePage', () => {
  let manager: ProjectManager;

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

  it('links each project to its editor', async () => {
    const created = await manager.createProject('Desk organizer');
    if (!created.ok) throw new Error('setup failed');
    const page = await render();
    expect(page.querySelector('.card-link')?.getAttribute('href')).toBe(`/projects/${created.value.project.id}`);
  });
});
