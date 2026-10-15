import { expect, test } from '@playwright/test';
import { evidence, plateProject } from './support';

/** Phase 13 (Projects) user journey: thumbnails, version history, sync. */
test.setTimeout(180_000);

test('shows pictures of documents and projects', async ({ page }) => {
  await plateProject(page, 'Pictures');
  // The picture is taken a moment after the model settles.
  await expect(page.getByTestId('document-thumbnail').locator('img')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  const card = page.getByRole('list', { name: 'Projects' }).getByRole('listitem').filter({ hasText: 'Pictures' });
  await expect(card.getByTestId('project-thumbnail').locator('img')).toBeVisible();
  await evidence(page, '57-thumbnails');
});
