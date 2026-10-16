import { TestBed } from '@angular/core/testing';
import { fuzzyScore } from './command-palette';
import { Shortcuts } from './shortcuts';
import { SETTINGS_STORAGE, UserSettings } from './user-settings';

describe('Shortcuts and user settings', () => {
  let stored: Map<string, string>;
  const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

  beforeEach(() => {
    stored = new Map([['cadence.settings', JSON.stringify({ controls: 'onshape', projection: 'orthographic' })]]);
    TestBed.configureTestingModule({
      providers: [{ provide: SETTINGS_STORAGE, useValue: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v) } }],
    });
  });

  it('reads and keeps the preferences', () => {
    const settings = TestBed.inject(UserSettings);
    expect(settings.controls()).toBe('onshape');
    expect(settings.projection()).toBe('orthographic');
    settings.controls.set('fusion');
    TestBed.tick();
    expect(JSON.parse(stored.get('cadence.settings') ?? '{}')).toEqual({ controls: 'fusion', projection: 'orthographic' });
  });

  it('runs the command of the active scheme and scope, never while typing', () => {
    const shortcuts = TestBed.inject(Shortcuts);
    TestBed.inject(UserSettings).controls.set('cadence');
    const ran: string[] = [];
    const stopModeling = shortcuts.register('modeling', { extrude: () => ran.push('extrude'), revolve: () => ran.push('revolve') });
    press('e');
    press('r');
    const stopSketch = shortcuts.register('sketch', { 'sketch-rectangle': () => ran.push('rectangle') });
    press('r');
    press('e'); // modeling is off while a sketch is edited
    stopSketch();
    const field = document.body.appendChild(document.createElement('input'));
    press('e', {}, field);
    field.remove();
    stopModeling();
    press('e');
    expect(ran).toEqual(['extrude', 'revolve', 'rectangle']);
  });

  it('follows the chosen scheme', () => {
    const shortcuts = TestBed.inject(Shortcuts);
    const ran: string[] = [];
    shortcuts.register('modeling', { extrude: () => ran.push('extrude') });
    press('e'); // Onshape extrudes with Shift+E
    press('E', { shiftKey: true });
    expect(ran).toEqual(['extrude']);
  });
  it('lists what can run now for the command palette', () => {
    const shortcuts = TestBed.inject(Shortcuts);
    TestBed.inject(UserSettings).controls.set('cadence');
    const noop = () => undefined;
    const stop = shortcuts.register('modeling', { extrude: noop });
    const withdraw = shortcuts.registerActions([{ label: 'Loft', group: 'Create', run: noop }]);
    expect(shortcuts.available().map((a) => [a.label, a.group, a.keys])).toEqual([
      ['Extrude', 'Model', ['E']],
      ['Loft', 'Create', undefined],
    ]);
    stop();
    withdraw();
    expect(shortcuts.available()).toEqual([]);
  });

  it('finds commands by their letters in order, best matches first', () => {
    expect(fuzzyScore('lft', 'Loft')).toBeDefined();
    expect(fuzzyScore('ld', 'Loft')).toBeUndefined();
    const ranked = ['Export STL (for slicers)', 'Extrude', 'Text'].sort((a, b) => (fuzzyScore('ext', b) ?? -1e9) - (fuzzyScore('ext', a) ?? -1e9));
    expect(ranked[0]).toBe('Extrude');
    // Word starts count: "cp" ranks "Circular pattern" above "Scope".
    expect((fuzzyScore('cp', 'Circular pattern') as number) > (fuzzyScore('cp', 'Scope') as number)).toBe(true);
  });
});
