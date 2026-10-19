import { TestBed } from '@angular/core/testing';
import { AGENT_CLI } from '../shared/agent-cli';
import { AboutDialog } from './about-dialog';

describe('AboutDialog', () => {
  async function opened(path?: string) {
    TestBed.configureTestingModule({ imports: [AboutDialog], providers: path === undefined ? [] : [{ provide: AGENT_CLI, useValue: { path: async () => path } }] });
    const fixture = TestBed.createComponent(AboutDialog);
    await fixture.whenStable();
    // jsdom has no modal dialogs: opening one is enough to ask for the command line.
    ((fixture.nativeElement as HTMLElement).querySelector('dialog') as HTMLDialogElement).showModal = () => undefined;
    fixture.componentInstance.open();
    // The path is asked for: it arrives a moment later.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('says how to add the MCP server installed with the desktop app (CAD-132)', async () => {
    const element = await opened('C:\\Program Files\\CADence\\cadence-cli.exe');
    expect(element.querySelector('[data-testid="mcp-command"]')?.textContent).toBe('claude mcp add cadence -- "C:\\Program Files\\CADence\\cadence-cli.exe" mcp');
  });

  it('points to the releases where there is none (the web app)', async () => {
    const element = await opened();
    expect(element.querySelector('[data-testid="mcp-command"]')).toBeNull();
    expect(element.querySelector('a[href$="/releases/latest"]')).not.toBeNull();
  });
});
