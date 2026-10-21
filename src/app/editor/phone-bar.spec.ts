import { TestBed } from '@angular/core/testing';
import { Layout, MEDIA_QUERIES } from '../shared/layout';
import { AR_SUPPORT, type ArMode, arSupport } from '../viewport/augmented-reality';
import type { Viewport } from '../viewport/viewport';
import { PhoneBar } from './phone-bar';

/** A media query answering `matches`, which a test can change. */
function media(matches: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  return {
    matches,
    addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
    change(value: boolean) {
      this.matches = value;
      for (const listener of listeners) listener({ matches: value });
    },
  };
}

describe('phone layout', () => {
  afterEach(() => {
    delete (navigator as { xr?: unknown }).xr;
  });

  it('follows the screen: phone-sized screens get the viewer layout, and leaving it closes the drawer', () => {
    const query = media(true);
    TestBed.configureTestingModule({ providers: [{ provide: MEDIA_QUERIES, useValue: () => query }] });
    const layout = TestBed.inject(Layout);
    expect(layout.phone()).toBe(true);
    layout.drawer.set(true);
    query.change(false);
    expect(layout.phone()).toBe(false);
    expect(layout.drawer()).toBe(false);
  });

  it('finds WebXR where the browser can place models in the room, and nothing where it cannot', async () => {
    expect(await arSupport()).toBeUndefined();
    (navigator as { xr?: unknown }).xr = { isSessionSupported: async (mode: string) => mode === 'immersive-ar', requestSession: async () => ({}) };
    expect(await arSupport()).toBe('webxr');
    (navigator as { xr?: unknown }).xr = { isSessionSupported: async () => Promise.reject(new Error('SecurityError')) };
    expect(await arSupport()).toBeUndefined();
  });

  async function bar(options: { measurable?: boolean; ar?: boolean; device?: ArMode } = {}) {
    TestBed.configureTestingModule({ providers: [{ provide: MEDIA_QUERIES, useValue: () => media(true) }, { provide: AR_SUPPORT, useValue: async () => options.device }] });
    const fixture = TestBed.createComponent(PhoneBar);
    const viewport = { zoomToFit: vi.fn(), showView: vi.fn() };
    fixture.componentRef.setInput('viewport', viewport as unknown as Viewport);
    fixture.componentRef.setInput('measurable', options.measurable ?? false);
    if (options.ar) fixture.componentRef.setInput('arFile', async () => ({ name: 'Part.glb', bytes: new Uint8Array() }));
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const button = (label: string) => element.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    return { fixture, viewport, element, button };
  }

  it('offers the view tools, and measuring where the mode can measure', async () => {
    const { viewport, button, fixture } = await bar({ measurable: true });
    button('Zoom to fit')?.click();
    button('Home view')?.click();
    expect(viewport.zoomToFit).toHaveBeenCalled();
    expect(viewport.showView).toHaveBeenCalledWith('home');
    const measured = vi.fn();
    fixture.componentInstance.measure.subscribe(measured);
    button('Measure')?.click();
    expect(measured).toHaveBeenCalled();
    button('Documents')?.click();
    expect(TestBed.inject(Layout).drawer()).toBe(true);
  });

  it('shows the AR button only where the device has augmented reality', async () => {
    expect((await bar({ ar: true })).button('View in AR')).toBeNull();
    TestBed.resetTestingModule();
    expect((await bar({ ar: true, device: 'quick-look' })).button('View in AR')?.dataset['ar']).toBe('quick-look');
    TestBed.resetTestingModule();
    // A mode that makes no AR files (imported files) has no button, whatever the device.
    expect((await bar({ device: 'webxr' })).button('View in AR')).toBeNull();
  });

  it('has no measure button where the mode cannot measure (imported files)', async () => {
    expect((await bar()).button('Measure')).toBeNull();
  });
});
