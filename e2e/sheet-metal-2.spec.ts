import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { center, evidence, fromModelMenu } from './support';

/** Phase 38 (Sheet metal II) user journey: a box of flanges with corner reliefs, a flange on a flange, hems and a miter flange, laid flat. */
test.setTimeout(240_000);

/** The edges of the first body whose names match, with their middles in the model and where they are on screen. */
async function edgesOf(page: Page, pattern: string): Promise<{ name: string; middle: number[]; x: number; y: number }[]> {
  return page.evaluate((pattern) => {
    // Test-only introspection of Angular's dev-mode debug API and the viewport's three.js scene.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
    const viewport = ng.getComponent(document.querySelector('cad-viewport') as Element);
    const scene = viewport.scene();
    const mesh = viewport.bodies()[0];
    const p = mesh.edgePositions;
    const Vector = scene.camera.position.constructor;
    const rect = scene.eventTarget.getBoundingClientRect();
    return mesh.edges
      .filter((e: { name: string }) => new RegExp(pattern).test(e.name))
      .map((e: { name: string; start: number; count: number }) => {
        const middle = [0, 1, 2].map((k) => (p[e.start * 3 + k] + p[(e.start + e.count - 1) * 3 + k]) / 2);
        const v = new Vector(...middle).project(scene.camera);
        return { name: e.name, middle, x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
      });
  }, pattern);
}

/** The top edges of the sheet: between its top face and a side. */
const topEdges = '^e:f:[^:]+:end[|]f:[^:]+:side:[^|:]+(~[0-9]+)?$';

type EdgeOnScreen = Awaited<ReturnType<typeof edgesOf>>[number];

/**
 * Clicks a top edge of the thin sheet a few pixels away from the edge below it (the same edge on the
 * bottom face, a few pixels off on screen), so the pick cannot take the wrong one.
 */
async function clickTop(page: Page, edge: EdgeOnScreen): Promise<void> {
  const below = (await edgesOf(page, '.'))
    .filter((e) => e.name !== edge.name && Math.hypot((e.middle[0] ?? 0) - (edge.middle[0] ?? 0), (e.middle[1] ?? 0) - (edge.middle[1] ?? 0)) < 1e-3)
    .sort((a, b) => (a.middle[2] ?? 0) - (b.middle[2] ?? 0))[0];
  const [dx, dy] = below ? [edge.x - below.x, edge.y - below.y] : [0, -1];
  const n = Math.hypot(dx, dy) || 1;
  const at = { x: edge.x + (dx / n) * 2, y: edge.y + (dy / n) * 2 };
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(250);
  await page.mouse.click(at.x, at.y);
}

/** A new project with a sheet: a rectangle on XY made a base flange (2 mm thick, 2 mm bend radius). */
async function sheet(page: Page, name: string, relief?: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'XY plane (top)' }).click();
  await page.waitForTimeout(500);
  const origin = await center(page, 'circle.point.origin');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.click(origin.x, origin.y);
  await page.mouse.click(origin.x + 240, origin.y - 160);
  await page.getByRole('button', { name: 'Finish sketch' }).click();
  await fromModelMenu(page, 'Create', 'Base flange');
  await expect(page.getByTestId('profile-selection')).toHaveText('1 profile selected');
  if (relief) {
    await page.getByRole('combobox', { name: 'Corner relief' }).selectOption(relief);
    await expect(page.getByRole('textbox', { name: 'Relief size' })).toHaveValue('2 * (2 mm)');
  }
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(1000);
}

/** Saves a flat pattern export and returns its text. */
async function flatPattern(page: Page, format: 'DXF' | 'SVG', path: string): Promise<string> {
  await page.getByRole('button', { name: 'Export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: `Flat pattern (${format})` }).click();
  const file = await download;
  await file.saveAs(path);
  return readFileSync(path, 'utf8');
}

test('bends a box with corner reliefs and a flange on a flange, and lays it flat', async ({ page }, info) => {
  await sheet(page, 'Tray', 'round');
  // The four top edges of the sheet: between its top face and its sides.
  await fromModelMenu(page, 'Create', 'Edge flange');
  const top = await edgesOf(page, topEdges);
  expect(top).toHaveLength(4);
  for (const edge of top) await clickTop(page, edge);
  await expect(page.getByTestId('edge-selection')).toHaveText('4 edges selected');
  await page.getByRole('textbox', { name: 'Length' }).fill('15');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await page.waitForTimeout(800);
  await evidence(page, 'phase-38-box-reliefs');

  // A lip on top of one wall: an edge flange on the wall's outer top edge, bent outwards. The walls' edges,
  // once the view shows the flanged body; of those at the top, the one furthest left (the left wall's outer edge).
  await expect.poll(async () => (await edgesOf(page, ':flange:')).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await fromModelMenu(page, 'Create', 'Edge flange');
  await expect(page.getByRole('heading', { name: 'New edge flange' })).toBeVisible();
  const walls = await edgesOf(page, ':flange:');
  const height = Math.max(...walls.map((e) => e.middle[2] ?? 0));
  const rim = walls.filter((e) => (e.middle[2] ?? 0) > height - 1e-3).reduce((a, b) => ((a.middle[0] ?? 0) <= (b.middle[0] ?? 0) ? a : b));
  await page.mouse.move(rim.x, rim.y);
  await page.waitForTimeout(250);
  await page.mouse.click(rim.x, rim.y);
  await expect(page.getByTestId('edge-selection')).toHaveText('1 edge selected');
  await page.getByRole('textbox', { name: 'Length' }).fill('8');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await page.waitForTimeout(800);
  await evidence(page, 'phase-38-flange-on-flange');

  // Flat: the box opened out, the lip beyond its wall, a round relief at each corner, five bend lines.
  const dxf = await flatPattern(page, 'DXF', info.outputPath('tray-flat.dxf'));
  expect(dxf.match(/\nARC\n/g)).toHaveLength(4);
  expect(dxf.match(/\nBEND\n/g)?.length).toBeGreaterThanOrEqual(5);
  const svg = await flatPattern(page, 'SVG', info.outputPath('tray-flat.svg'));
  await page.setContent(`<body style="margin:0;background:#fff;display:grid;place-items:center;height:100vh">${svg.replace('<svg', '<svg style="width:90vw;height:90vh"')}</body>`);
  await evidence(page, 'phase-38-flat-pattern');
});

test('hems an edge and runs a miter flange along two edges from a profile', async ({ page }, info) => {
  await sheet(page, 'Cover');
  const top = await edgesOf(page, topEdges);
  // The hem on the front edge (smallest y), a teardrop.
  const front = top.reduce((a, b) => ((a.middle[1] ?? 0) < (b.middle[1] ?? 0) ? a : b));
  await fromModelMenu(page, 'Create', 'Hem');
  await clickTop(page, front);
  await expect(page.getByTestId('edge-selection')).toHaveText('1 edge selected');
  await page.getByRole('combobox', { name: 'Style' }).selectOption('teardrop');
  await page.getByRole('textbox', { name: 'Gap' }).fill('3');
  await page.getByRole('textbox', { name: 'Length' }).fill('8');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);

  // The profile on the XZ plane (square to the left and right edges), from the origin at the left edge's
  // front end: up, then over outwards (to the left).
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'XZ plane (front)' }).click();
  await page.waitForTimeout(500);
  const origin = await center(page, 'circle.point.origin');
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  for (const [dx, dy] of [
    [0, 0],
    [0, -100],
    [-40, -100],
  ] as const) {
    await page.mouse.move(origin.x + dx, origin.y + dy);
    await page.waitForTimeout(150);
    await page.mouse.click(origin.x + dx, origin.y + dy);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('.curve')).toHaveCount(2);
  await page.getByRole('button', { name: 'Finish sketch' }).click();

  // The left edge and the back edge, which meet at a corner.
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(800);
  const edges = await edgesOf(page, topEdges);
  const back = edges.reduce((a, b) => ((a.middle[1] ?? 0) > (b.middle[1] ?? 0) ? a : b));
  const left = edges.reduce((a, b) => ((a.middle[0] ?? 0) < (b.middle[0] ?? 0) ? a : b));
  await fromModelMenu(page, 'Create', 'Miter flange');
  await expect(page.getByRole('heading', { name: 'New miter flange' })).toBeVisible();
  await clickTop(page, left);
  await clickTop(page, back);
  await expect(page.getByTestId('edge-selection')).toHaveText('2 edges selected');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await page.waitForTimeout(800);
  await evidence(page, 'phase-38-hem-miter');

  const dxf = await flatPattern(page, 'DXF', info.outputPath('cover-flat.dxf'));
  // The hem's bend, and two bends on each piece of the miter flange.
  expect(dxf.match(/\nBEND\n/g)?.length).toBeGreaterThanOrEqual(5);
});
