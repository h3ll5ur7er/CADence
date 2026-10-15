import { expect, test } from '@playwright/test';
import { GitHttpServer } from '../src/core/access/version/testing/git-http-server';
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

test('syncs a project through git: sent from one browser, opened in another, changed and taken back', async ({ page, browser }) => {
  const server = await GitHttpServer.start();
  try {
    const url = server.repository('plate');
    await plateProject(page, 'Shared plate');
    await page.getByRole('button', { name: 'Sync with git' }).click();
    const sync = page.getByRole('dialog', { name: 'Sync with git' });
    await sync.getByRole('textbox', { name: 'Repository address' }).fill(url);
    await sync.getByRole('button', { name: 'Sync', exact: true }).click();
    await expect(sync.getByRole('status')).toContainText('Sent the versions');
    await evidence(page, '59-sync');
    await sync.getByRole('button', { name: 'Close' }).click();

    // Another device: its own browser storage.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const other = await context.newPage();
    await other.goto(new URL(page.url()).origin);
    await other.getByRole('button', { name: 'Open from git…' }).click();
    await other.getByRole('textbox', { name: 'Repository address' }).fill(url);
    await other.getByRole('button', { name: 'Open project' }).click();
    await expect(other.getByRole('button', { name: 'Shared plate' })).toBeVisible();
    await expect(other.getByTestId('body-size')).toHaveText('60, 30, 6 mm');
    await setThickness(other, '9 mm');
    await expect(other.getByTestId('body-size')).toHaveText('60, 30, 9 mm');
    await other.getByRole('button', { name: 'Sync with git' }).click();
    await other.getByRole('dialog', { name: 'Sync with git' }).getByRole('button', { name: 'Sync', exact: true }).click();
    const otherSync = other.getByRole('dialog', { name: 'Sync with git' });
    await expect(otherSync.getByRole('status')).toContainText('Sent the versions');
    await otherSync.getByRole('button', { name: 'Close' }).click();

    // Back here: the change arrives.
    await page.getByRole('button', { name: 'Sync with git' }).click();
    await sync.getByRole('button', { name: 'Sync', exact: true }).click();
    await expect(sync.getByRole('status')).toContainText('Took the versions');
    await sync.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('body-size')).toHaveText('60, 30, 9 mm');

    // Both change the plate: the second sync asks which to keep.
    await setThickness(other, '15 mm');
    await other.getByRole('button', { name: 'Sync with git' }).click();
    await otherSync.getByRole('button', { name: 'Sync', exact: true }).click();
    await expect(otherSync.getByRole('status')).toContainText('Sent the versions');
    await context.close();
    await setThickness(page, '12 mm');
    await expect(page.getByTestId('body-size')).toHaveText('60, 30, 12 mm');
    await page.getByRole('button', { name: 'Sync with git' }).click();
    await sync.getByRole('button', { name: 'Sync', exact: true }).click();
    const choice = sync.getByRole('radiogroup', { name: 'Component 1' });
    await expect(choice).toBeVisible();
    await choice.getByRole('radio', { name: 'Theirs' }).check();
    await evidence(page, '60-sync-conflict');
    await sync.getByRole('button', { name: 'Sync with these choices' }).click();
    await expect(sync.getByRole('status')).toContainText('Combined the changes');
    await sync.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('body-size')).toHaveText('60, 30, 15 mm');
    expect(server.log('plate')[0]).toMatch(/^Merged the changes from/);
  } finally {
    await server.stop();
  }
});
