import { expect, test } from '@playwright/test';
import { evidence, plateProject, setThickness } from './support';

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

test('keeps the history of a document: names versions and restores one', async ({ page }) => {
  await plateProject(page, 'History');
  await expect(page.getByTestId('body-size')).toHaveText('60, 30, 6 mm');
  await page.waitForTimeout(3500); // the version of the 6 mm plate is recorded
  await setThickness(page, '10 mm');
  await expect(page.getByTestId('body-size')).toHaveText('60, 30, 10 mm');

  await page.getByRole('button', { name: 'History of Component 1' }).click();
  const versions = page.getByRole('list', { name: 'Versions' }).getByRole('listitem');
  await expect(versions.first()).toContainText('Changed Component 1');
  await versions.first().getByRole('button', { name: /^Name the version/ }).click();
  await page.getByRole('textbox', { name: 'Version name' }).fill('thick');
  await page.getByRole('textbox', { name: 'Version name' }).press('Enter');
  await expect(versions.first().getByTestId('version-name')).toHaveText('thick');
  await evidence(page, '58-history');

  // Back to the 6 mm plate: the version before.
  await versions.nth(1).getByRole('button', { name: /^Restore/ }).click();
  await expect(versions.first()).toContainText('Restored Component 1');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('body-size')).toHaveText('60, 30, 6 mm');
});
