import { byteSize, plural, relativeTime } from './format';

describe('format', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');

  it('describes times relative to now', () => {
    expect(relativeTime('2026-10-14T11:59:40.000Z', now)).toBe('just now');
    expect(relativeTime('2026-10-14T11:55:00.000Z', now)).toBe('5 minutes ago');
    expect(relativeTime('2026-10-13T12:00:00.000Z', now)).toBe('yesterday');
    expect(relativeTime('2026-09-14T12:00:00.000Z', now)).toBe('last month');
  });

  it('formats byte sizes', () => {
    expect(byteSize(812)).toBe('812 B');
    expect(byteSize(14540)).toBe('14.2 KB');
    expect(byteSize(3_250_586)).toBe('3.1 MB');
  });

  it('pluralizes counts', () => {
    expect(plural(1, 'document')).toBe('1 document');
    expect(plural(3, 'document')).toBe('3 documents');
  });
});
