import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { evidence } from './support';

/** Phase 41 (Automation III) user journeys: the script console and plugins. */
test.setTimeout(180_000);

async function newProject(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);
}

async function openScripts(page: Page) {
  await page.getByRole('button', { name: 'Scripts and plugins' }).click();
  const dialog = page.getByRole('dialog', { name: /Scripts of/ });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('a generator script kept with the project runs twice with two sizes, and a running script stops (CAD-173)', async ({ page }) => {
  await newProject(page, 'Generators');
  const dialog = await openScripts(page);

  // A new script starts as a generator of boxes, with its size as a parameter.
  await expect(dialog.locator('#script-source')).toHaveValue(/params\.size/);
  await dialog.locator('#script-name').fill('Box');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('navigation', { name: 'Scripts and plugins' }).getByRole('button', { name: 'Box', exact: true })).toBeVisible();

  // The editor completes the scripting API's members.
  const editor = dialog.locator('#script-source');
  await editor.click();
  await editor.press('Control+End');
  await editor.pressSequentially('\nconst c = await cadence.comp');
  const completions = dialog.getByRole('listbox', { name: 'Completions' });
  await expect(completions.getByRole('option').first()).toContainText('component');
  await editor.press('Enter');
  await expect(editor).toHaveValue(/cadence\.component$/);
  await dialog.locator('summary', { hasText: "The scripting API's types" }).click();
  await expect(dialog.getByTestId('script-types')).toContainText('interface Component {');
  await dialog.locator('summary', { hasText: "The scripting API's types" }).click();
  // Back to the kept script.
  await dialog.getByRole('navigation', { name: 'Scripts and plugins' }).getByRole('button', { name: 'Box', exact: true }).click();
  await expect(editor).toHaveValue(/return created\.value\.name;\s*$/);

  // Run: the parameters are asked first.
  await dialog.getByRole('button', { name: 'Run…' }).click();
  await expect(dialog.locator('#script-value-size')).toHaveValue('20 mm');
  await dialog.getByRole('form', { name: 'Values for the run' }).getByRole('button', { name: 'Run' }).click();
  const output = dialog.getByTestId('script-output');
  await expect(output).toContainText('Made: Box 20', { timeout: 60_000 });
  await expect(output).toContainText('Made Box 20');

  await dialog.getByRole('button', { name: 'Run…' }).click();
  await dialog.locator('#script-value-size').fill('40 mm');
  await dialog.getByRole('form', { name: 'Values for the run' }).getByRole('button', { name: 'Run' }).click();
  await expect(output).toContainText('Made: Box 40', { timeout: 60_000 });
  await evidence(page, 'phase-41-script-console');

  // A script that never ends is stopped.
  await dialog.getByRole('button', { name: 'New script' }).click();
  await dialog.getByRole('button', { name: 'Remove parameter size' }).click();
  await editor.fill('console.log("going round");\nwhile (true) {}');
  await dialog.getByRole('button', { name: 'Run…' }).click();
  await expect(output).toContainText('going round');
  await expect(dialog.getByRole('button', { name: 'Stop' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Stop' }).click();
  await expect(output).toContainText('The script was stopped.');

  // The boxes are in the project, each its own size; the script stays with the project.
  await dialog.getByRole('button', { name: 'Close' }).click();
  const documents = page.getByRole('navigation', { name: 'Project documents' });
  await expect(documents.getByRole('link', { name: 'Box 20' })).toBeVisible();
  await documents.getByRole('link', { name: 'Box 40' }).click();
  await expect(page.getByTestId('body-size')).toHaveText('40, 40, 40 mm');
  await page.reload();
  await expect(page.getByTestId('body-size')).toHaveText('40, 40, 40 mm');
  const again = await openScripts(page);
  await expect(again.getByRole('navigation', { name: 'Scripts and plugins' }).getByRole('button', { name: 'Box', exact: true })).toBeVisible();
});

test('a plugin adds a feature that regenerates with the parameters, and exports with its exporter (CAD-174)', async ({ page }) => {
  await newProject(page, 'Trays');
  await page.getByRole('button', { name: /Parameters/ }).click();
  await page.getByRole('textbox', { name: 'New parameter name' }).fill('size');
  await page.getByRole('textbox', { name: 'New parameter expression' }).fill('60 mm');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Close parameters' }).click();

  const dialog = await openScripts(page);
  await dialog.getByRole('button', { name: 'Install the sample plugin' }).click();
  const plugin = dialog.locator('[data-plugin="cadence.trays"]');
  await expect(plugin).toContainText(/Trays\s*1\.0\.0/);
  await plugin.getByRole('button', { name: 'Tray…' }).click();
  await dialog.locator('#script-value-width').fill('size');
  await dialog.getByRole('form', { name: 'Values for the run' }).getByRole('button', { name: 'Add' }).click();
  await expect(dialog.getByTestId('script-output')).toContainText('Added Tray to Component 1.');
  await dialog.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByTestId('body-size')).toHaveText('60, 40, 20 mm');
  // The parameter changes: the plugin builds the tray again.
  await page.getByRole('button', { name: /Parameters/ }).click();
  await page.getByRole('textbox', { name: 'Expression of size' }).fill('100 mm');
  await page.getByRole('textbox', { name: 'Expression of size' }).press('Enter');
  await page.getByRole('button', { name: 'Close parameters' }).click();
  await expect(page.getByTestId('body-size')).toHaveText('100, 40, 20 mm');
  // The feature dialog edits its parameters.
  await page.getByRole('button', { name: 'Edit Tray' }).click();
  await expect(page.getByTestId('plugin-feature')).toHaveText('cadence.trays 1.0.0: tray');
  await expect(page.locator('#feature-plugin-width')).toHaveValue('size');
  await page.locator('#feature-plugin-height').fill('30 mm');
  await page.locator('#feature-plugin-height').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-size')).toHaveText('100, 40, 30 mm');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(800);
  await evidence(page, 'phase-41-plugin-feature');

  // Its exporter writes the tray as OpenSCAD polyhedra.
  const scripts = await openScripts(page);
  const download = page.waitForEvent('download');
  await scripts.locator('[data-plugin="cadence.trays"]').getByRole('button', { name: 'OpenSCAD polyhedra' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Component 1.scad');
  expect(readFileSync(await file.path(), 'utf8')).toMatch(/^\/\/ Component 1, exported from CADence\n\/\/ Tray\npolyhedron\(points=/);
  await evidence(page, 'phase-41-plugins');
});
