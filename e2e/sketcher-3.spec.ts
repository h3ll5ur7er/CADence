import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { center, evidence } from './support';

/** Phase 17 (Sketcher III) user journey: what a sketch leaves free, equation curves, pictures and fonts. */
test.setTimeout(240_000);

const fixture = (name: string) => join(import.meta.dirname, 'fixtures', name);

async function newSketch(page: Page, project: string): Promise<{ x: number; y: number }> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill(project);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'XY plane (top)' }).click();
  await page.waitForTimeout(500);
  return center(page, 'circle.point.origin');
}

test('shows what a sketch leaves free, defines it fully, and resolves a conflict', async ({ page }) => {
  const origin = await newSketch(page, 'Diagnostics');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.click(origin.x + 60, origin.y - 30);
  await page.mouse.click(origin.x + 300, origin.y - 150);
  const status = page.getByTestId('sketch-status');
  await expect(status).toHaveText(/degrees of freedom/);
  // Free points get arrows showing where they can move.
  await expect(page.getByTestId('freedom-arrow').first()).toBeVisible();
  await evidence(page, '67-freedom');

  await page.getByRole('button', { name: 'Fully define' }).click();
  await expect(status).toHaveText('Fully constrained');
  await expect(page.getByTestId('freedom-arrow')).toHaveCount(0);

  // A second length on the bottom side contradicts the first: the toast offers to remove that one.
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.mouse.click(origin.x + 180, origin.y - 30);
  await page.mouse.click(origin.x + 180, origin.y + 40);
  const conflicts = page.getByRole('list', { name: 'Conflicting relations and dimensions' });
  await expect(conflicts.getByRole('listitem').first()).toBeVisible();
  await evidence(page, '68-conflict');
  await conflicts.getByRole('button', { name: /^Remove Distance/ }).first().click();
  await expect(conflicts).toHaveCount(0);
  await expect(status).toHaveText('Fully constrained');
});

test('draws curves from equations', async ({ page }) => {
  await newSketch(page, 'Equations');
  await page.getByRole('button', { name: 'Shapes' }).click();
  await page.getByRole('menuitem', { name: 'Curve from equations…' }).click();
  await page.getByRole('textbox', { name: 'x of t' }).fill('(25 + 5 * cos(t * 6)) * cos(t)');
  await page.getByRole('textbox', { name: 'y of t' }).fill('(25 + 5 * cos(t * 6)) * sin(t)');
  await page.getByRole('spinbutton', { name: 'Points along the curve' }).fill('121');
  await page.getByRole('button', { name: 'Add curve' }).click();
  await expect(page.getByTestId('profile-count')).toHaveText('1');
  await evidence(page, '69-equation');
});

test('draws over a picture, and traces it into curves', async ({ page }) => {
  await newSketch(page, 'Pictures');
  await page.getByRole('button', { name: 'Finish sketch' }).click();
  await page.locator('cad-documents-panel input[type=file]').first().setInputFiles(fixture('logo.png'));
  await expect(page.getByTestId('imported-picture')).toBeVisible();
  await page.getByRole('navigation', { name: 'Project documents' }).getByRole('link', { name: 'Component 1' }).click();
  await page.getByRole('button', { name: 'Edit Sketch 1' }).click();

  await page.getByRole('button', { name: 'Picture', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Put logo behind the sketch' }).click();
  await expect(page.getByTestId('sketch-picture')).toBeVisible();
  await evidence(page, '70-picture');

  await page.getByRole('button', { name: 'Insert drawing' }).click();
  await page.getByRole('combobox', { name: 'Insert as' }).selectOption('none');
  await page.getByRole('checkbox', { name: 'Smooth traced outlines' }).uncheck();
  await page.getByRole('menuitem', { name: 'logo (PNG)' }).click();
  // The ring (with its hole), the disk inside it, and the flag.
  await expect(page.getByTestId('profile-count')).toHaveText('3');
  await evidence(page, '71-traced');
});

test('sets text in an imported font, along a circle', async ({ page }) => {
  const origin = await newSketch(page, 'Fonts');
  await page.getByRole('button', { name: 'Finish sketch' }).click();
  await page.locator('cad-documents-panel input[type=file]').first().setInputFiles(join(import.meta.dirname, '..', 'node_modules', '@fontsource', 'inter', 'files', 'inter-latin-700-normal.woff'));
  await page.getByRole('navigation', { name: 'Project documents' }).getByRole('link', { name: 'Component 1' }).click();
  await page.getByRole('button', { name: 'Edit Sketch 1' }).click();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  await page.mouse.click(origin.x, origin.y);
  await page.mouse.click(origin.x + 150, origin.y);
  await page.getByRole('button', { name: 'Shapes' }).click();
  await page.getByRole('menuitem', { name: 'Text' }).click();
  await page.getByRole('textbox', { name: 'Text to place' }).fill('CADENCE');
  await page.mouse.click(origin.x - 200, origin.y + 200);
  await page.getByRole('button', { name: 'Select and drag', exact: true }).click();
  const text = await center(page, '.curve', 1);
  await page.mouse.click(text.x, text.y);
  await page.getByRole('combobox', { name: 'Font of the text' }).selectOption({ label: 'inter-latin-700-normal' });
  await page.getByRole('combobox', { name: 'Curve the text follows' }).selectOption({ label: 'Circle 1' });
  await page.getByRole('checkbox', { name: 'Text on the other side' }).check();
  await expect(page.getByRole('checkbox', { name: 'Text on the other side' })).toBeChecked();
  await page.waitForTimeout(500);
  await evidence(page, '72-text-along');
});
