import { describe, expect, it } from 'vitest';
import { contentHash, newId, stableStringify } from './index';

describe('identity', () => {
  it('creates unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, newId));
    expect(ids.size).toBe(1000);
  });

  it('serializes objects independent of key order', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(stableStringify({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it('hashes equal content equally and different content differently', () => {
    expect(contentHash({ x: 1, y: [2, 3] })).toBe(contentHash({ y: [2, 3], x: 1 }));
    expect(contentHash({ x: 1 })).not.toBe(contentHash({ x: 2 }));
    expect(contentHash('a')).toMatch(/^[0-9a-f]{14}$/);
  });
});
