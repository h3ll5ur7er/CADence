import { expect, type Page, test } from '@playwright/test';
import { evidence, plateProject } from './support';

/** Phase 11 (Part modeling II) user journey: timeline, body operations, planes, loft and sweep, holes, draft. */
test.setTimeout(180_000);

const timelineNames = (page: Page) => page.getByRole('list', { name: 'Timeline' }).locator('.item-name').allTextContents();

test('rolls the timeline back, inserts a feature there and reorders it', async ({ page }) => {
  await plateProject(page, 'Timeline');
  const marker = page.getByRole('separator', { name: 'Rollback marker' });
  const extrude = page.getByRole('button', { name: 'Edit Extrude 1' });

  // Dragging the marker above the extrude rolls the plate away.
  await marker.dragTo(extrude, { targetPosition: { x: 20, y: 3 } });
  await expect(page.getByTestId('body-count')).toHaveText('0');
  await expect(page.locator('.item.rolled-back')).toHaveCount(1);

  // A construction plane added now goes in at the marker, before the extrude.
  await page.getByRole('button', { name: 'Construction plane', exact: true }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect.poll(() => timelineNames(page)).toEqual(['Sketch 1', 'Plane 1', 'Extrude 1']);

  // The arrow keys move the marker; the plate comes back.
  await marker.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('body-count')).toHaveText('1');
  await expect(page.locator('.item.rolled-back')).toHaveCount(0);

  // The plane moves to the top; the extrude cannot move above its sketch.
  await page.getByRole('button', { name: 'Edit Plane 1' }).dragTo(page.getByRole('button', { name: 'Edit Sketch 1' }), { targetPosition: { x: 20, y: 3 } });
  await expect.poll(() => timelineNames(page)).toEqual(['Plane 1', 'Sketch 1', 'Extrude 1']);
  await page.getByRole('button', { name: 'Edit Extrude 1' }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.getByRole('alert')).toContainText('Extrude 1 uses Sketch 1, so it has to come after it.');
  expect(await timelineNames(page)).toEqual(['Plane 1', 'Sketch 1', 'Extrude 1']);
  await evidence(page, '46-timeline');
});

test('copies, turns, scales and combines bodies', async ({ page }) => {
  await plateProject(page, 'Bodies');
  const bodies = page.getByTestId('body-count');
  const fromMenu = async (menu: string, item: string) => {
    await page.getByRole('toolbar', { name: 'Model tools' }).getByRole('button', { name: menu, exact: true }).click();
    await page.getByRole('menuitem', { name: item }).click();
  };

  // A copy 40 mm along Y, turned a quarter about Z.
  await fromMenu('Bodies', 'Move or copy bodies');
  await page.locator('#feature-move-x').fill('0');
  await page.locator('#feature-move-x').press('Tab');
  await page.locator('#feature-move-y').fill('80');
  await page.locator('#feature-move-y').press('Tab');
  await page.locator('#feature-angle').fill('90 deg');
  await page.locator('#feature-angle').press('Tab');
  await page.locator('#feature-copy').check();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(bodies).toHaveText('2');

  // The copy at half size, then joined into the plate where they touch? They do not: cut it from nothing, keep both.
  await fromMenu('Bodies', 'Scale bodies');
  await page.locator('#feature-factor').fill('0.5');
  await page.locator('#feature-factor').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Scale 1');

  await fromMenu('Bodies', 'Combine bodies');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(bodies).toHaveText('1');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  await evidence(page, '47-bodies');
});
