import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { anchorOnScreen, cutHole, evidence, plateProject, setThickness, sheetPoint } from './support';

/** Phase 22 (Technical drawings) user journey: views, sections and details, dimensions and callouts, parts lists, PDF and DXF. */
test.setTimeout(240_000);

const click = (page: Page, p: { x: number; y: number }) => page.mouse.click(p.x, p.y);

test('draws a part: views with hidden lines, a section and a detail, dimensions, a hole callout and a note, as PDF and DXF', async ({ page }) => {
  await plateProject(page, 'Drawings');
  await setThickness(page, '8 mm');
  await cutHole(page);

  await page.getByRole('button', { name: 'Drawing', exact: true }).click();
  await expect(page.getByRole('application', { name: 'Drawing sheet' })).toBeVisible();
  for (const direction of ['Top', 'Front']) {
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.locator('#view-direction').selectOption({ label: direction });
    await page.getByRole('button', { name: 'Add view' }).click();
  }
  // The outlines of both views and the hole.
  await expect.poll(() => page.locator('svg.sheet polyline.visible').count()).toBeGreaterThan(7);

  // The plate's width, from corner to corner of the top view.
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Horizontal' }).click();
  await click(page, await anchorOnScreen(page, 0, 'point', 'left'));
  await click(page, await anchorOnScreen(page, 0, 'point', 'right'));
  await expect(page.locator('svg.sheet text').filter({ hasText: /^60$/ })).toHaveCount(1);
  // The hole (an extruded cut, so its diameter; hole features say more).
  await page.getByRole('button', { name: 'Hole callout' }).click();
  await click(page, await anchorOnScreen(page, 0, 'circle', 'rim'));
  await click(page, await sheetPoint(page, [200, 250]));
  await expect(page.locator('svg.sheet text').filter({ hasText: /^⌀8$/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  await click(page, await sheetPoint(page, [30, 60]));
  await page.locator('#note-text').fill('Break all edges 0.5 mm');
  await page.locator('#note-text').press('Tab');
  await expect(page.locator('svg.sheet text').filter({ hasText: 'Break all edges 0.5 mm' })).toHaveCount(1);

  // The front view cut through the middle, and a detail of the hole.
  await page.keyboard.press('Escape');
  await click(page, await anchorOnScreen(page, 1, 'point', 'left'));
  await page.getByLabel('Section (cut through the middle)').check();
  await expect.poll(() => page.locator('svg.sheet polyline.hatch').count()).toBeGreaterThan(3);
  await page.getByRole('button', { name: 'Detail view' }).click();
  const hole = await anchorOnScreen(page, 0, 'circle', 'first');
  await click(page, hole);
  await expect(page.locator('svg.sheet text').filter({ hasText: 'Detail B' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Fit the sheet' }).click();
  await evidence(page, '86-drawing');

  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'PDF' }).click();
  await (await pdf).saveAs('e2e/evidence/plate-drawing.pdf');
  expect(readFileSync('e2e/evidence/plate-drawing.pdf', 'latin1').startsWith('%PDF-1.4')).toBe(true);
  const dxf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'DXF (for CAD)' }).click();
  await (await dxf).saveAs('e2e/evidence/plate-drawing.dxf');
  expect(readFileSync('e2e/evidence/plate-drawing.dxf', 'utf8')).toContain('HIDDEN');
});

test('draws an assembly with a parts list and balloons', async ({ page }) => {
  await plateProject(page, 'Assembly drawing');
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  for (const expected of ['1', '2']) {
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Component 1' }).click();
    await expect(page.getByTestId('instance-count')).toHaveText(expected);
  }
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading');

  await page.getByRole('button', { name: 'Drawing', exact: true }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.locator('#view-source').selectOption({ label: 'Assembly 1' });
  await page.locator('#view-direction').selectOption({ label: 'Isometric' });
  await page.getByRole('button', { name: 'Add view' }).click();
  await expect.poll(() => page.locator('svg.sheet polyline.visible').count()).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Parts list' }).click();
  await click(page, await sheetPoint(page, [400, 280]));
  await expect(page.locator('svg.sheet text').filter({ hasText: 'Component 1' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Balloon' }).click();
  const part = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
    const layout = ng.getComponent(document.querySelector('cad-drawing-mode') as Element).store.layout();
    return layout.instances[1].at as [number, number];
  });
  await click(page, await sheetPoint(page, part));
  await click(page, await sheetPoint(page, [part[0] + 30, part[1] + 30]));
  await expect(page.locator('svg.sheet text').filter({ hasText: /^1$/ })).toHaveCount(2); // the parts list's item and the balloon
  await page.getByRole('button', { name: 'Fit the sheet' }).click();
  await evidence(page, '87-assembly-drawing');
});
