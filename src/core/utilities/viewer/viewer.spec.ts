import { describe, expect, it } from 'vitest';
import { viewerHtml } from './index';

const triangle = {
  name: 'Plate <1>',
  positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  edges: new Float32Array([0, 0, 0, 10, 0, 0]),
};

describe('viewerHtml', () => {
  const html = viewerHtml({ title: 'Bracket </script>', parts: [triangle, { ...triangle, color: '#ff0000', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1] }] });

  it('is one page holding the model and the viewer', () => {
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<title>Bracket &lt;/script&gt;</title>');
    // Nothing is loaded from elsewhere.
    expect(html).not.toMatch(/\bsrc="|https?:\/\//);
    const json = /<script id="model" type="application\/json">(.*?)<\/script>/s.exec(html)?.[1] as string;
    const data = JSON.parse(json) as { title: string; parts: { name: string; color: string; transform: number[] | null; positions: string }[] };
    expect(data.title).toBe('Bracket </script>');
    expect(data.parts.map((p) => [p.name, p.color, p.transform?.[12] ?? null])).toEqual([
      ['Plate <1>', '#9fb2bb', null],
      ['Plate <1>', '#ff0000', 5],
    ]);
    expect([...new Float32Array(Uint8Array.from(atob(data.parts[0]?.positions as string), (c) => c.charCodeAt(0)).buffer)]).toEqual([0, 0, 0, 10, 0, 0, 0, 10, 0]);
  });

  it('carries a viewer that needs nothing from outside itself', () => {
    const script = /<script>\((.*)\)\(JSON\.parse/s.exec(html)?.[1] as string;
    expect(script).toMatch(/^function runViewer\(data\)/);
    // A function that runs on its own: it compiles without the module around it.
    expect(() => new Function(`return (${script});`)()).not.toThrow();
    expect(script).not.toMatch(/__name|__vite|import\(/);
  });
});
