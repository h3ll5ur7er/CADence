import { expect, type Page, test } from '@playwright/test';
import { evidence, fromModelMenu, plateProject, screenPositionOf } from './support';

/** Phase 19 (Workflow) user journey: timeline folders and notes, repairing lost references, configurations as CSV, the command palette. */
test.setTimeout(180_000);

/** Clicks the edge at `at` until the open feature has it (the first click may land while the view settles). */
async function pickEdge(page: Page, at: { x: number; y: number }): Promise<void> {
  const selection = page.getByTestId('edge-selection');
  await expect(async () => {
    if ((await selection.textContent())?.trim() !== '1 edge selected') await page.mouse.click(at.x, at.y);
    await expect(selection).toHaveText('1 edge selected', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

test('groups the timeline in folders with notes, and suppresses a folder at once', async ({ page }) => {
  await plateProject(page, 'Folders');
  const timeline = page.getByRole('list', { name: 'Timeline' });

  await page.getByRole('button', { name: 'New folder' }).click();
  await page.locator('#folder-name').fill('Base plate');
  await page.locator('#folder-first').selectOption({ label: 'Sketch 1' });
  await page.locator('#folder-last').selectOption({ label: 'Extrude 1' });
  await page.locator('#folder-note').fill('60 × 30, as thick as the parameter');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(timeline.getByRole('button', { name: 'Close Base plate' })).toBeVisible();

  await page.getByRole('button', { name: 'Note on Extrude 1' }).click();
  await page.locator('#note-text').fill('Thickness comes from the parameter');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('button', { name: 'Edit Extrude 1' })).toHaveAttribute('title', 'Thickness comes from the parameter');
  await evidence(page, '76-timeline-folders');

  // Closed, the folder hides its items; suppressed, its plate goes.
  await timeline.getByRole('button', { name: 'Close Base plate' }).click();
  await expect(page.getByRole('button', { name: 'Edit Extrude 1' })).toBeHidden();
  await page.getByRole('button', { name: 'Suppress Base plate' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('0');
  await page.getByRole('button', { name: 'Unsuppress Base plate' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1');
  await timeline.getByRole('button', { name: 'Open Base plate' }).click();
  await expect(page.getByRole('button', { name: 'Edit Extrude 1' })).toBeVisible();
});

test('repairs a fillet whose edge a chamfer took away', async ({ page }) => {
  await plateProject(page, 'Repair');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  const corner = '^e:f:[^|]*:side:[^|]*\\|f:[^|]*:side:';
  await page.getByRole('button', { name: 'Fillet' }).click();
  const edge = await screenPositionOf(page, 'edge', corner);
  await pickEdge(page, edge);
  await page.locator('#feature-size').fill('0.5');
  await page.locator('#feature-size').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Fillet 1');

  // A chamfer on the same edge, put in before the fillet.
  const marker = page.getByRole('separator', { name: 'Rollback marker' });
  await marker.focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.item.rolled-back')).toHaveCount(1);
  await page.getByRole('button', { name: 'Chamfer' }).click();
  await pickEdge(page, edge);
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Chamfer 1');
  await marker.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.item.failed')).toHaveCount(1);

  await page.getByRole('button', { name: 'Repair Fillet 1' }).click();
  const lost = page.getByRole('list', { name: 'Lost references' });
  await expect(lost).toContainText('Lost edge');
  await evidence(page, '77-repair');
  await lost.getByRole('button', { name: /Use the nearest edge/ }).click();
  await expect(page.getByTestId('nothing-lost')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.item.rolled-back')).toHaveCount(0);
  await expect(page.locator('.item.failed')).toHaveCount(0);
});

test('exports configurations as CSV and imports them back after checking', async ({ page }) => {
  await plateProject(page, 'Configurations');
  await page.getByRole('button', { name: /Parameters/ }).click();
  await page.getByRole('textbox', { name: 'New configuration name' }).fill('Thin');
  await page.getByRole('button', { name: 'Add configuration' }).click();
  await page.getByRole('textbox', { name: 'thickness in Thin' }).fill('2 mm');
  await page.getByRole('textbox', { name: 'thickness in Thin' }).press('Tab');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const csv = await (await download).path().then((path) => import('node:fs').then((fs) => fs.readFileSync(path, 'utf8')));
  expect(csv).toBe('Configuration,thickness\r\nThin,2 mm\r\n');

  // Edited in a spreadsheet: a bad value is caught before anything changes.
  const input = page.getByLabel('Import configurations from CSV');
  await input.setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('Configuration;thickness\nThin;2 mm\nThick;ten\n') });
  await expect(page.getByRole('region', { name: 'Configurations to import' })).toContainText('Thick:');
  await expect(page.getByRole('button', { name: 'Apply' })).toBeDisabled();
  await input.setInputFiles({ name: 'good.csv', mimeType: 'text/csv', buffer: Buffer.from('Configuration;thickness\nThin;3 mm\nThick;10 mm\n') });
  await expect(page.getByTestId('csv-summary')).toHaveText('2 configurations (new: Thick; changed: Thin).');
  await evidence(page, '78-configurations-csv');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('textbox', { name: 'Name of configuration Thick' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Shown configuration' }).selectOption({ label: 'Thick' });
  await page.getByRole('button', { name: 'Close parameters' }).click();
  await expect(page.getByTestId('body-size')).toHaveText('60, 30, 10 mm');
});

test('finds and runs any command by name with Ctrl+K', async ({ page }) => {
  await plateProject(page, 'Palette');
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('pat');
  await expect(palette.getByRole('option').first()).toContainText('Pattern along a path');
  await evidence(page, '79-command-palette');

  await page.getByRole('combobox', { name: 'Command' }).fill('fillet');
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(page.getByRole('heading', { name: 'New fillet' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Documents and settings too.
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Command' }).fill('new assembly');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/documents\//);
  await expect(page.getByTestId('storage')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Command' }).fill('component 1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Extrude 1');
  await fromModelMenu(page, 'Create', 'Loft');
  await page.getByRole('button', { name: 'Cancel' }).click();
});
