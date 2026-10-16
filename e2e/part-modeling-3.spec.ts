import { expect, type Page, test } from '@playwright/test';
import { center, evidence, fromModelMenu, plateProject, screenPositionOf } from './support';

/** Phase 18 (Part modeling III) user journey: standard parts, gears, parts for printing and fits. */
test.setTimeout(180_000);

const number = async (page: Page, testId: string) => Number(((await page.getByTestId(testId).first().textContent()) ?? '').replace(/[^\d.]/g, ''));

/** A sketch on the plate's top face with points `dx` pixels left and right of its origin. */
async function topPoints(page: Page, offsets: readonly number[]): Promise<void> {
  const top = await screenPositionOf(page, 'face', ':end$');
  await page.mouse.click(top.x, top.y);
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'Selected face' }).click();
  await page.waitForTimeout(600);
  const origin = await center(page, 'circle.point.origin');
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  for (const dx of offsets) {
    await page.mouse.move(origin.x + dx, origin.y);
    await page.mouse.click(origin.x + dx, origin.y);
  }
  await page.getByRole('button', { name: 'Finish sketch' }).click();
}

test('puts screws on a plate, and their clearance holes with a fit for the printer', async ({ page }) => {
  await plateProject(page, 'Standard parts');
  await page.getByRole('button', { name: 'Check manufacturability' }).click();
  await page.getByRole('spinbutton', { name: 'Hole compensation' }).fill('0.1');
  await page.getByRole('spinbutton', { name: 'Hole compensation' }).press('Tab');
  await page.getByRole('button', { name: 'Close checks' }).click();
  await topPoints(page, [-60, 60]);

  // M4 clearance holes, loose: ⌀4.5 + 0.3 + 0.1 through the plate.
  const volume = await number(page, 'body-volume');
  await fromModelMenu(page, 'Create', 'Hole');
  await page.locator('#feature-hole-preset').selectOption({ label: 'M4 clearance (⌀4.5)' });
  await expect(page.locator('#feature-diameter')).toHaveValue('4.5 mm');
  await page.locator('#feature-fit').selectOption('loose');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect.poll(() => number(page, 'body-volume')).toBeCloseTo(volume - 2 * Math.PI * 2.45 ** 2 * 6, 0);

  // M4 × 16 screws in them, as their own body.
  await fromModelMenu(page, 'Create', 'Part');
  await expect(page.getByTestId('point-count')).toHaveText('2 parts');
  await page.locator('#feature-part-size').selectOption('M4');
  await page.locator('#feature-part-length').fill('16');
  await page.locator('#feature-part-length').press('Tab');
  await page.locator('#feature-operation').selectOption('new-body');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Part 1');
  await expect.poll(() => number(page, 'body-count')).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(800);
  await evidence(page, '73-standard-parts');
});

test('makes a gear, says where its mate goes, and cuts a living hinge', async ({ page }) => {
  await plateProject(page, 'Gears');
  await topPoints(page, [0]);

  await fromModelMenu(page, 'Create', 'Part');
  await page.locator('#feature-part-kind').selectOption('gear');
  await page.locator('#feature-part-bore').fill('5');
  await page.locator('#feature-part-bore').press('Tab');
  await page.locator('#feature-mate-teeth').fill('12');
  await page.locator('#feature-mate-teeth').press('Tab');
  await expect(page.getByTestId('centre-distance')).toHaveText('Put its centre 16 mm along X, turned 15°.');
  await page.locator('#feature-operation').selectOption('new-body');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect(page.getByTestId('body-count')).toHaveText('2');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(800);
  await evidence(page, '74-gear');

  // A living hinge across the plate: a groove leaving a thin web.
  const volume = await number(page, 'body-volume');
  await fromModelMenu(page, 'Create', 'Part');
  await page.locator('#feature-part-kind').selectOption('living-hinge');
  await expect(page.locator('#feature-operation')).toHaveValue('cut');
  await page.locator('#feature-part-depth').fill('4');
  await page.locator('#feature-part-depth').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Part 2');
  expect(await number(page, 'body-volume')).not.toBe(volume);
  await evidence(page, '75-living-hinge');
});
