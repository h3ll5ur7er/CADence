import { expect, type Page, test } from '@playwright/test';
import { anchorOnScreen, cutHole, evidence, fromModelMenu, plateProject, screenPositionOf, sheetPoint, topPoints, visiblePointOf } from './support';

/** Phase 39 (Drawings III) user journeys: offset and half sections, tolerances and fits, surface finish, true lengths, cosmetic threads, anchors on assembly parts. */
test.setTimeout(300_000);

const click = (page: Page, p: { x: number; y: number }) => page.mouse.click(p.x, p.y);

interface Anchor {
  readonly view: string;
  readonly kind: 'point' | 'circle' | 'line';
  readonly name: string;
  readonly at: [number, number];
  readonly radius?: number;
  readonly model?: [number, number, number];
  readonly hidden?: true;
}
interface Layout {
  readonly height: number;
  readonly anchors: readonly Anchor[];
  readonly views: readonly { readonly id: string; readonly note?: string; readonly error?: string }[];
  readonly paths: readonly { readonly points: readonly [number, number][]; readonly style: string; readonly owner?: string }[];
}

/** The sheet as laid out, and the drawing's views, through Angular's dev-mode debug API. */
async function sheet(page: Page): Promise<{ layout: Layout; views: string[] }> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
    const mode = ng.getComponent(document.querySelector('cad-drawing-mode') as Element);
    return { layout: mode.store.layout(), views: mode.store.document().views.map((v: { id: string }) => v.id) };
  });
}

/** Where on screen an anchor of the `index`-th view is that `pick` chooses (on a circle's rim). */
async function anchorWhere(page: Page, index: number, pick: (anchors: readonly Anchor[]) => Anchor | undefined): Promise<{ x: number; y: number }> {
  const { layout, views } = await sheet(page);
  const anchor = pick(layout.anchors.filter((a) => a.view === views[index] && !a.hidden));
  if (!anchor) throw new Error('No such anchor');
  return sheetPoint(page, anchor.kind === 'circle' ? [anchor.at[0] + (anchor.radius ?? 0), anchor.at[1]] : anchor.at);
}

async function addView(page: Page, direction: string, source?: string): Promise<void> {
  await page.getByRole('button', { name: 'View', exact: true }).click();
  if (source) await page.locator('#view-source').selectOption({ label: source });
  await page.locator('#view-direction').selectOption({ label: direction });
  await page.getByRole('button', { name: 'Add view' }).click();
}

test('draws a tapped plate: threads as ISO 6410, a half and an offset section, a fit, a surface finish and a true length on an isometric view', async ({ page }) => {
  await plateProject(page, 'Drawings III');
  // Two ⌀5 holes through the plate, one of them tapped M6 with its thread modelled.
  await topPoints(page, [-60, 60]);
  await fromModelMenu(page, 'Create', 'Hole');
  await expect(page.getByTestId('point-count')).toHaveText('2 holes');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  await fromModelMenu(page, 'Create', 'Thread');
  await expect(page.locator('#feature-thread-size')).toHaveValue('M6');
  const hole = await screenPositionOf(page, 'face', ':wall:');
  await page.mouse.move(hole.x, hole.y);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -300);
  await page.waitForTimeout(400);
  const wall = await visiblePointOf(page, ':wall:');
  await page.mouse.click(wall.x, wall.y);
  await expect(page.getByTestId('face-selection')).toHaveText('1 round face selected');
  await page.locator('#feature-modelled').check();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Thread 1');

  await page.getByRole('button', { name: 'Drawing', exact: true }).click();
  await expect(page.getByRole('application', { name: 'Drawing sheet' })).toBeVisible();
  const started = Date.now();
  await addView(page, 'Top');
  await addView(page, 'Front');
  // The modelled thread is drawn as threads are, not as its helix: exactly, and fast (CAD-166).
  await expect.poll(async () => (await sheet(page)).layout.views.filter((v) => !v.error).length, { timeout: 60_000 }).toBe(2);
  expect(Date.now() - started).toBeLessThan(45_000);
  expect((await sheet(page)).layout.views.every((v) => !v.note)).toBe(true);
  // Seen along its axis, a thin three-quarter circle: the thread's major diameter.
  await expect.poll(() => page.locator('svg.sheet polyline.thin').count()).toBeGreaterThan(0);

  // The thread called out from its own circle.
  await page.getByRole('button', { name: 'Hole callout' }).click();
  const thread = (await sheet(page)).layout.anchors.find((a) => a.kind === 'circle' && a.name.startsWith('thread:') && !a.hidden) as Anchor;
  await click(page, await sheetPoint(page, [thread.at[0] + (thread.radius ?? 0), thread.at[1]]));
  await click(page, await sheetPoint(page, [thread.at[0] + 15, thread.at[1] + 30]));
  await expect(page.locator('svg.sheet text').filter({ hasText: /M6 thread/ })).toHaveCount(1);

  // A fit on the other hole (CAD-165).
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Diameter' }).click();
  await click(page, await anchorWhere(page, 0, (anchors) => anchors.filter((a) => a.kind === 'circle' && !a.name.startsWith('thread:') && Math.abs((a.radius ?? 0) - 2.5) < 0.01).sort((a, b) => a.at[0] - b.at[0])[0]));
  await page.keyboard.press('Escape');
  await page.locator('svg.sheet text').filter({ hasText: /^⌀5$/ }).click();
  await page.locator('#dimension-tolerance').selectOption('fit');
  await expect(page.locator('svg.sheet text').filter({ hasText: /^⌀5 H7$/ })).toHaveCount(1);
  await page.locator('#tolerance-deviations').check();
  await expect(page.locator('svg.sheet text').filter({ hasText: '⌀5 H7 (+0.012/0)' })).toHaveCount(1);

  // A surface finish symbol standing on the top view's upper edge.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Surface finish' }).click();
  const edge = await anchorWhere(page, 0, (anchors) => anchors.filter((a) => a.kind === 'line' && !a.name.startsWith('s:')).sort((a, b) => b.at[1] - a.at[1])[0]);
  await click(page, edge);
  await click(page, { x: edge.x + 40, y: edge.y - 30 });
  await page.locator('#finish-roughness').fill('Ra 1.6');
  await page.locator('#finish-roughness').press('Tab');
  await expect(page.locator('svg.sheet text').filter({ hasText: 'Ra 1.6' })).toHaveCount(1);

  // The front view cut in half: the tapped hole's thread shows its thin major lines in the cut (CAD-164).
  await page.keyboard.press('Escape');
  await click(page, await anchorOnScreen(page, 1, 'point', 'left'));
  await page.getByLabel('Section (cut through the middle)').check();
  await page.locator('#view-section-half').check();
  await expect.poll(() => page.locator('svg.sheet polyline.hatch').count()).toBeGreaterThan(3);
  // Its centre line between the halves.
  await expect.poll(async () => {
    const { layout, views } = await sheet(page);
    return layout.paths.filter((p) => p.owner === views[1] && p.style === 'center').length;
  }).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Fit the sheet' }).click();
  await evidence(page, 'phase-39-half-section');

  // Then an offset section, stepping 3 mm back from the middle on.
  await page.locator('#view-section-half').uncheck();
  await page.locator('#view-section-steps').fill('0:-3');
  await page.locator('#view-section-steps').press('Tab');
  await expect.poll(async () => {
    const { layout, views } = await sheet(page);
    return layout.paths.find((p) => p.owner === views[1] && p.style === 'center')?.points.length;
  }).toBe(4);

  // An isometric view, dimensioned along the plate's length: its true length, 60 (CAD-165).
  await page.getByRole('button', { name: 'Fit the sheet' }).click();
  await addView(page, 'Isometric');
  await expect.poll(async () => (await sheet(page)).layout.views.filter((v) => !v.error).length, { timeout: 60_000 }).toBe(3);
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Aligned' }).click();
  const corner = (x: number) => (anchors: readonly Anchor[]) => anchors.find((a) => a.kind === 'point' && a.model && Math.hypot(a.model[0] - x, a.model[1], a.model[2] - 6) < 1e-6);
  await click(page, await anchorWhere(page, 2, corner(0)));
  await click(page, await anchorWhere(page, 2, corner(60)));
  await expect(page.locator('svg.sheet text').filter({ hasText: /^60$/ })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Fit the sheet' }).click();
  await evidence(page, 'phase-39-drawing');
  // Close up: the thread's three-quarter circle and, in the section, its thin lines.
  const near = await sheetPoint(page, [thread.at[0] + 60, thread.at[1]]);
  await page.mouse.move(near.x, near.y);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -200);
  await page.waitForTimeout(300);
  await evidence(page, 'phase-39-threads');

});

test('dimensions the hole of one part of an assembly view (CAD-167)', async ({ page }) => {
  await plateProject(page, 'Assembly anchors');
  await cutHole(page);
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  for (const expected of ['1', '2']) {
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Component 1' }).click();
    await expect(page.getByTestId('instance-count')).toHaveText(expected);
  }
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading');

  await page.getByRole('button', { name: 'Drawing', exact: true }).click();
  await addView(page, 'Top', 'Assembly 1');
  await expect.poll(async () => (await sheet(page)).layout.anchors.filter((a) => a.kind === 'circle' && a.name.includes('/') && !a.hidden).length, { timeout: 60_000 }).toBeGreaterThan(1);
  // Each part offers its own geometry, named by its instance.
  const { layout } = await sheet(page);
  const instances = new Set(layout.anchors.filter((a) => a.name.includes('/')).map((a) => a.name.split('/')[0]));
  expect(instances.size).toBe(2);
  // The second part's hole, by its own name.
  const second = [...instances].sort()[1] as string;
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Diameter' }).click();
  await click(page, await anchorWhere(page, 0, (anchors) => anchors.find((a) => a.kind === 'circle' && a.name.startsWith(`${second}/`) && Math.abs((a.radius ?? 0) - 4) < 0.01)));
  await expect(page.locator('svg.sheet text').filter({ hasText: /^⌀8$/ })).toHaveCount(1);
  const named = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
    return ng.getComponent(document.querySelector('cad-drawing-mode') as Element).store.document().annotations[0].anchors[0].name as string;
  });
  expect(named.startsWith(`${second}/`)).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Fit the sheet' }).click();
  await evidence(page, 'phase-39-assembly-anchors');
});
