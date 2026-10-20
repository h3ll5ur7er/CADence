import { expect, test, type Page } from '@playwright/test';
import { GitHttpServer } from '../src/core/access/version/testing/git-http-server';
import { cutHole, evidence, plateProject, setThickness } from './support';

/** Phase 42 (Versions and collaboration) user journey: comparing versions, merging inside a document. */
test.setTimeout(240_000);

/** Opens the sync dialog, syncs, and waits for what it says. */
async function sync(page: Page, says: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Sync with git' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sync with git' });
  await dialog.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText(says);
  await dialog.getByRole('button', { name: 'Close' }).click();
}

test('compares two versions of a plate: the new hole overlaid in red, side by side, and listed (CAD-175)', async ({ page }) => {
  await plateProject(page, 'Compared plate');
  await page.waitForTimeout(3500); // the version of the plain plate is recorded
  await cutHole(page);
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Extrude 2');

  await page.getByRole('button', { name: 'History of Component 1' }).click();
  const versions = page.getByRole('list', { name: 'Versions' }).getByRole('listitem');
  await expect(versions.first()).toContainText('Changed Component 1');
  await versions.nth(1).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Compare with now' }).click();

  const differences = page.getByRole('complementary', { name: 'Differences' });
  await expect(differences.getByRole('list', { name: 'Timeline' })).toContainText('Extrude 2');
  await expect(differences.getByRole('list', { name: 'Timeline' })).toContainText('Sketch 2');
  await expect(page.getByTestId('compare-volumes')).toContainText('Removed');
  await expect(page.getByTestId('compare-volumes').locator('.removed-text')).not.toHaveText('0 mm³');
  await page.waitForTimeout(800);
  await evidence(page, 'phase-42-compare-overlay');

  await page.getByRole('button', { name: 'Side by side' }).click();
  await expect(page.getByRole('button', { name: 'Side by side' })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(800);
  await evidence(page, 'phase-42-compare-side-by-side');

  await page.getByRole('button', { name: 'Close comparison' }).click();
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Extrude 2');
  await expect(page.getByTestId('body-count')).toHaveText('1');
});

test('merges a hole made in one browser with a thicker plate made in another, and asks per item what both changed (CAD-176)', async ({ page, browser }) => {
  const server = await GitHttpServer.start();
  try {
    const url = server.repository('merged-plate');
    await plateProject(page, 'Merged plate');
    await page.getByRole('button', { name: 'Sync with git' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sync with git' });
    await dialog.getByRole('textbox', { name: 'Repository address' }).fill(url);
    await dialog.getByRole('button', { name: 'Sync', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Sent the versions');
    await dialog.getByRole('button', { name: 'Close' }).click();

    // Another device cuts a hole; here the plate gets thicker. Both changed the one component.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const other = await context.newPage();
    await other.goto(new URL(page.url()).origin);
    await other.getByRole('button', { name: 'Open from git…' }).click();
    await other.getByRole('textbox', { name: 'Repository address' }).fill(url);
    await other.getByRole('button', { name: 'Open project' }).click();
    await expect(other.getByTestId('body-size')).toHaveText('60, 30, 6 mm');
    await cutHole(other);
    await expect(other.getByRole('list', { name: 'Timeline' })).toContainText('Extrude 2');
    await expect(other.getByTestId('body-count')).toHaveText('1');
    await sync(other, 'Sent the versions');

    await setThickness(page, '9 mm');
    await expect(page.getByTestId('body-size')).toHaveText('60, 30, 9 mm');
    await sync(page, 'Combined the changes');
    // One component with both: the hole and the thickness.
    await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Extrude 2');
    await expect(page.getByTestId('body-size')).toHaveText('60, 30, 9 mm');
    await evidence(page, 'phase-42-merged');

    // Now both change the thickness: only that is asked, side by side.
    await sync(other, 'Took the versions');
    await setThickness(other, '15 mm');
    await sync(other, 'Sent the versions');
    await context.close();
    await setThickness(page, '12 mm');
    await page.getByRole('button', { name: 'Sync with git' }).click();
    await dialog.getByRole('button', { name: 'Sync', exact: true }).click();
    const choice = dialog.getByRole('radiogroup', { name: 'Component 1: Parameter thickness' });
    await expect(choice).toContainText('expression 12 mm');
    await expect(choice).toContainText('expression 15 mm');
    await expect(dialog.getByTestId('item-conflicts')).toContainText('Everything else of it was combined');
    await choice.getByRole('radio', { name: /Theirs/ }).check();
    await evidence(page, 'phase-42-item-conflict');
    await dialog.getByRole('button', { name: 'Sync with these choices' }).click();
    await expect(dialog.getByRole('status')).toContainText('Combined the changes');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('body-size')).toHaveText('60, 30, 15 mm');
    await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Extrude 2');
  } finally {
    await server.stop();
  }
});
