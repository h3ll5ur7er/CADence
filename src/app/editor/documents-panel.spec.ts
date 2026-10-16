import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { asDocumentId, asProjectId, type DocumentSummary } from '@core/contracts';
import { DocumentsPanel } from './documents-panel';

const doc = (id: string, kind: DocumentSummary['kind'], name: string): DocumentSummary => ({
  id: asDocumentId(id),
  projectId: asProjectId('p'),
  kind,
  name,
  createdAt: '2026-10-14T10:00:00.000Z',
  modifiedAt: '2026-10-14T10:00:00.000Z',
});

describe('DocumentsPanel', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [DocumentsPanel], providers: [provideRouter([])] });
  });

  async function render(documents: DocumentSummary[], activeId?: string) {
    const fixture = TestBed.createComponent(DocumentsPanel);
    fixture.componentRef.setInput('documents', documents);
    fixture.componentRef.setInput('activeId', activeId);
    await fixture.whenStable();
    return fixture;
  }

  it('groups documents by kind and marks the open one', async () => {
    const fixture = await render(
      [doc('c1', 'component', 'Bracket'), doc('a1', 'assembly', 'Gearbox'), doc('i1', 'imported', 'Fan')],
      'a1',
    );
    const element = fixture.nativeElement as HTMLElement;
    expect([...element.querySelectorAll('h3')].map((h) => h.textContent?.trim())).toEqual([
      'Components',
      'Assemblies',
      'Imported',
    ]);
    expect(element.querySelector('[aria-current="page"]')?.textContent).toContain('Gearbox');
  });

  it('asks to create documents of a kind', async () => {
    const fixture = await render([]);
    const created: string[] = [];
    fixture.componentInstance.create.subscribe((kind) => created.push(kind));
    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.actions button')];
    buttons.forEach((b) => b.click());
    expect(created).toEqual(['component', 'assembly', 'drawing']);
  });

  it('explains an empty project', async () => {
    const fixture = await render([]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('This project is empty');
  });
});
