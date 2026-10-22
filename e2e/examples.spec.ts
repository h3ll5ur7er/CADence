import { expect, test } from '@playwright/test';
import { evidence } from './support';

/** CAD-199: the stress tests' machines (the radial engine, the robot arm, the Stewart platform) as example projects, opened from the home page. */
test('opens an example machine from the home page as a project of its own', async ({ page }) => {
  await page.goto('/');
  const robot = page.getByRole('button', { name: 'Open sample Robot arm R6' });
  const stewart = page.getByRole('button', { name: 'Open sample Stewart platform S6' });
  const engine = page.getByRole('button', { name: 'Open sample Magnum Opus R-9 radial engine' });
  for (const card of [engine, robot, stewart]) await expect(card).toBeVisible();
  // Their pictures are there, next to the templates' line drawings.
  for (const card of [engine, robot, stewart]) await expect.poll(() => card.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Open sample Box with lid' })).toBeVisible();
  await robot.scrollIntoViewIfNeeded();
  await evidence(page, 'cad-199-examples');

  await robot.click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/documents\//);
  // The arm's assembly opens with all 24 instances placed.
  await expect(page.getByTestId('instance-count')).toHaveText('24', { timeout: 60_000 });
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading', { timeout: 120_000 });
  await expect(page.getByRole('list', { name: 'Instances' })).toContainText('Gripper');
  await page.waitForTimeout(1000);
  await evidence(page, 'cad-199-robot-arm');

  // A project of one's own: it is listed at home, with the arm's documents.
  await page.goto('/');
  await expect(page.locator('.card', { hasText: 'Robot arm R6' }).first()).toContainText('24 documents');
});
