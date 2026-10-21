import { TestBed } from '@angular/core/testing';
import { MEDIA_QUERIES } from './layout';
import { AUTOMATED, TOUR_DOCUMENT, Tour, tourSteps } from './tour';
import { SETTINGS_STORAGE } from './user-settings';

describe('Tour', () => {
  let stored: Map<string, string>;
  /** The selectors the fake page has elements for. */
  let present: Set<string>;

  function tour(automated = false, phone = false): Tour {
    TestBed.configureTestingModule({
      providers: [
        { provide: MEDIA_QUERIES, useValue: () => ({ matches: phone, addEventListener: () => undefined, removeEventListener: () => undefined }) },
        { provide: SETTINGS_STORAGE, useValue: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v) } },
        { provide: TOUR_DOCUMENT, useValue: { querySelector: (s: string) => (present.has(s) ? {} : null) } },
        { provide: AUTOMATED, useValue: automated },
      ],
    });
    return TestBed.inject(Tour);
  }

  const until = (title: string) => tourSteps.find((s) => s.title === title)?.until as string;

  beforeEach(() => {
    stored = new Map();
    present = new Set();
  });

  it('starts by itself on the first start only', () => {
    const t = tour();
    t.offer();
    expect(t.step()?.title).toBe('Welcome to CADence');
    t.skip();
    expect(t.step()).toBeUndefined();
    expect(stored.get('cadence.tour')).toBe('skipped');
    t.offer();
    expect(t.step()).toBeUndefined();
  });

  it('does not start by itself in an automated browser, but starts when asked', () => {
    const t = tour(true);
    t.offer();
    expect(t.step()).toBeUndefined();
    t.start();
    expect(t.index()).toBe(0);
  });

  it('does not start by itself on a phone, where there is no modelling', () => {
    const t = tour(false, true);
    t.offer();
    expect(t.step()).toBeUndefined();
  });

  it('runs through a first part as the user does each step', () => {
    const t = tour();
    t.start();
    t.next();
    expect(t.step()?.target).toBe('new-project');
    t.check();
    expect(t.step()?.target).toBe('new-project');
    // The project is created: the editor shows New sketch.
    present.add(until('A project'));
    t.check();
    expect(t.step()?.target).toBe('new-sketch');
    present.add(until('A sketch'));
    t.check();
    expect(t.step()?.target).toBe('rectangle');
    // Drawing has no sign of its own: Next.
    t.check();
    expect(t.step()?.target).toBe('rectangle');
    t.next();
    expect(t.step()?.target).toBe('finish-sketch');
    present.add(until('Finish the sketch'));
    t.check();
    expect(t.step()?.target).toBe('extrude');
    present.add(until('Extrude'));
    t.check();
    expect(t.step()?.target).toBe('export');
    t.next();
    expect(t.step()?.title).toBe('That is a part');
    t.finish();
    expect(t.step()).toBeUndefined();
    expect(stored.get('cadence.tour')).toBe('done');
  });

  it('passes over the steps already done when it starts in an open project', () => {
    present.add(until('A project'));
    const t = tour();
    t.start();
    t.next();
    expect(t.step()?.target).toBe('new-sketch');
  });
});
