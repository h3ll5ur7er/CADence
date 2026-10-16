import { readFileSync, statSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { cutHole, evidence, plateProject, screenPositionOf } from './support';

/** Phase 23 (Visuals) user journey: surface analysis, finishes in the realistic look, pictures and turntables. */
test.setTimeout(180_000);

/** The size a PNG says it has. */
const pngSize = (bytes: Buffer) => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];

async function roundEdge(page: Page): Promise<void> {
  // A fillet on a vertical corner edge, so curvature and zebra stripes have something to show.
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Fillet' }).click();
  const corner = await screenPositionOf(page, 'edge', '^e:f:[^|]*:side:[^|]*\\|f:[^|]*:side:');
  const selection = page.getByTestId('edge-selection');
  await expect(async () => {
    if ((await selection.textContent())?.trim() !== '1 edge selected') await page.mouse.click(corner.x, corner.y);
    await expect(selection).toHaveText('1 edge selected', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.locator('#feature-size').fill('5');
  await page.locator('#feature-size').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Fillet 1');
}

test('shows surfaces as zebra stripes, curvature and draft', async ({ page }) => {
  await plateProject(page, 'Surfaces');
  await cutHole(page);
  await roundEdge(page);
  await page.getByRole('button', { name: 'Surface analysis' }).click();
  await expect(page.getByRole('form', { name: 'Surface analysis' })).toBeVisible();
  await page.waitForTimeout(500);
  await evidence(page, '88-zebra');
  await page.locator('#analysis-kind').selectOption('curvature');
  await page.waitForTimeout(500);
  await evidence(page, '89-curvature');
  await page.locator('#analysis-kind').selectOption('draft');
  await page.locator('#analysis-draft').fill('2');
  await page.locator('#analysis-draft').press('Tab');
  await expect(page.getByRole('form', { name: 'Surface analysis' })).toContainText('too little draft');
  await page.getByRole('button', { name: 'Surface analysis' }).click();
  await expect(page.getByRole('form', { name: 'Surface analysis' })).toHaveCount(0);
});

test('gives a part a metal finish in the realistic look, and saves pictures and a turntable', async ({ page }) => {
  await plateProject(page, 'Finishes');
  await cutHole(page);
  await page.getByRole('combobox', { name: 'Finish of Extrude 1' }).selectOption('metal');
  await page.getByRole('button', { name: 'Realistic lighting' }).click();
  await expect(page.getByRole('button', { name: 'Realistic lighting' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(1500);
  await evidence(page, '90-realistic');

  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'Picture or turntable…' }).click();
  await page.locator('#picture-width').fill('800');
  await page.locator('#picture-width').press('Tab');
  await page.locator('#picture-height').fill('500');
  await page.locator('#picture-height').press('Tab');
  await page.locator('#picture-transparent').check();
  const picture = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save picture' }).click();
  await (await picture).saveAs('e2e/evidence/looks.png');
  const png = readFileSync('e2e/evidence/looks.png');
  expect(pngSize(png)).toEqual([800, 500]);

  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'Picture or turntable…' }).click();
  await page.locator('#turntable-seconds').fill('2');
  await page.locator('#turntable-seconds').press('Tab');
  const video = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Turntable video' }).click();
  await (await video).saveAs('e2e/evidence/looks-turntable.webm');
  expect(statSync('e2e/evidence/looks-turntable.webm').size).toBeGreaterThan(1000);
  // Back to the plain look for the journeys after this one.
  await page.getByRole('button', { name: 'Realistic lighting' }).click();
});
