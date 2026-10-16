import { TestBed } from '@angular/core/testing';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { AppUpdates, DesktopUpdates, RELOAD, ServiceWorkerUpdates } from './app-updates';
import { UpdateNotice } from './update-notice';

describe('UpdateNotice', () => {
  async function render(providers: unknown[]) {
    TestBed.configureTestingModule({ imports: [UpdateNotice], providers });
    const fixture = TestBed.createComponent(UpdateNotice);
    await fixture.whenStable();
    return fixture;
  }

  describe('in the web app', () => {
    let events: Subject<VersionEvent>;
    let reload: ReturnType<typeof vi.fn>;

    const web = (enabled = true) => {
      events = new Subject<VersionEvent>();
      reload = vi.fn();
      return render([
        { provide: AppUpdates, useClass: ServiceWorkerUpdates },
        { provide: SwUpdate, useValue: { isEnabled: enabled, versionUpdates: events, unrecoverable: new Subject() } },
        { provide: RELOAD, useValue: reload },
      ]);
    };

    it('stays hidden until a new version is ready', async () => {
      const fixture = await web();
      events.next({ type: 'VERSION_DETECTED', version: { hash: 'b' } });
      await fixture.whenStable();
      expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
    });

    it('offers to reload when a new version is ready', async () => {
      const fixture = await web();
      events.next({ type: 'VERSION_READY', currentVersion: { hash: 'a' }, latestVersion: { hash: 'b' } });
      await fixture.whenStable();
      const element = fixture.nativeElement as HTMLElement;
      expect(element.textContent).toContain('A new version of CADence is ready');
      element.querySelector('button')?.click();
      expect(reload).toHaveBeenCalled();
    });

    it('does nothing without a service worker', async () => {
      const fixture = await web(false);
      expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
    });
  });

  describe('in the desktop app', () => {
    it('offers to install a newer release and restart', async () => {
      const install = vi.fn(async () => undefined);
      const fixture = await render([{ provide: AppUpdates, useValue: new DesktopUpdates({ check: async () => '0.16.0', install }) }]);
      await fixture.whenStable();
      const element = fixture.nativeElement as HTMLElement;
      expect(element.textContent).toContain('CADence 0.16.0 is available.');
      const button = element.querySelector('button') as HTMLButtonElement;
      expect(button.textContent?.trim()).toBe('Install and restart');
      button.click();
      expect(install).toHaveBeenCalled();
    });

    it('stays hidden when there is no newer release', async () => {
      const fixture = await render([{ provide: AppUpdates, useValue: new DesktopUpdates({ check: async () => undefined, install: vi.fn() }) }]);
      await fixture.whenStable();
      expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
    });
  });
});
