import { TestBed } from '@angular/core/testing';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { RELOAD, UpdateNotice } from './update-notice';

describe('UpdateNotice', () => {
  let events: Subject<VersionEvent>;
  let reload: ReturnType<typeof vi.fn>;

  async function render(enabled = true) {
    events = new Subject<VersionEvent>();
    reload = vi.fn();
    TestBed.configureTestingModule({
      imports: [UpdateNotice],
      providers: [
        { provide: SwUpdate, useValue: { isEnabled: enabled, versionUpdates: events, unrecoverable: new Subject() } },
        { provide: RELOAD, useValue: reload },
      ],
    });
    const fixture = TestBed.createComponent(UpdateNotice);
    await fixture.whenStable();
    return fixture;
  }

  it('stays hidden until a new version is ready', async () => {
    const fixture = await render();
    events.next({ type: 'VERSION_DETECTED', version: { hash: 'b' } });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });

  it('offers to reload when a new version is ready', async () => {
    const fixture = await render();
    events.next({ type: 'VERSION_READY', currentVersion: { hash: 'a' }, latestVersion: { hash: 'b' } });
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('A new version of CADence is ready');
    element.querySelector('button')?.click();
    expect(reload).toHaveBeenCalled();
  });

  it('does nothing without a service worker', async () => {
    const fixture = await render(false);
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });
});
