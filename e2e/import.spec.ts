import { readFileSync, statSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { evidence, fromModelMenu } from './support';

/** Phase 6 (Import) user journey: STEP and SVG files viewed, converted, and used in parts and assemblies. */
test.setTimeout(180_000);

const number = async (page: Page, testId: string) => Number(((await page.getByTestId(testId).first().textContent()) ?? '').replace(/[^\d.]/g, ''));

test('import STEP and SVG, convert them, build with them', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Imports');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);

  // A STEP file: shown in 3D with what it holds, and converted to STL.
  await page.getByLabel('Import', { exact: true }).setInputFiles('e2e/fixtures/bracket.step');
  await expect(page.getByTestId('mode')).toHaveText('Imported');
  await expect(page.getByTestId('imported-contents')).toContainText('Triangles', { timeout: 60_000 });
  expect(await number(page, 'imported-volume')).toBeGreaterThan(16_000);
  await expect(page.getByTestId('imported-size')).toHaveText('60, 30, 10 mm');
  await page.waitForTimeout(800);
  await evidence(page, '26-imported-step');
  await page.getByRole('button', { name: 'Export as' }).click();
  const stl = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'STL' }).click();
  await (await stl).saveAs('e2e/evidence/bracket-converted.stl');
  expect(statSync('e2e/evidence/bracket-converted.stl').size).toBeGreaterThan(10_000);

  // An SVG drawing: shown flat, converted to DXF.
  await page.getByLabel('Import', { exact: true }).setInputFiles('e2e/fixtures/plate.svg');
  await expect(page.getByTestId('imported-curves')).toHaveText('14'); // 4 sides and 4 corner arcs, 2 holes, the slot's 2 lines and 2 arcs
  await expect(page.getByTestId('imported-size')).toHaveText('80, 50, 0 mm');
  await page.waitForTimeout(800);
  await evidence(page, '27-imported-svg');
  await page.getByRole('button', { name: 'Export as' }).click();
  const dxf = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'DXF' }).click();
  await (await dxf).saveAs('e2e/evidence/plate-converted.dxf');
  expect(readFileSync('e2e/evidence/plate-converted.dxf', 'utf8')).toContain('CIRCLE');

  // The drawing in a sketch: the plate extrudes with its holes and slot.
  await page.getByRole('link', { name: 'Component 1' }).click();
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'XY plane (top)' }).click();
  await page.getByRole('button', { name: 'Insert drawing' }).click();
  await page.getByRole('menuitem', { name: 'plate (SVG)' }).click();
  await expect(page.getByTestId('profile-count')).toHaveText('4');
  await page.getByRole('button', { name: 'Finish sketch' }).click();
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await expect(page.getByTestId('profile-selection')).toHaveText('1 profile selected');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1');
  const area = 80 * 50 - (4 - Math.PI) * 25 - 2 * Math.PI * 16 - (20 * 10 + Math.PI * 25);
  await expect(page.getByTestId('body-volume')).toHaveText(/mm³/);
  expect(await number(page, 'body-volume')).toBeCloseTo(area * 10, 0);

  // The STEP bracket as a body of the same component.
  await fromModelMenu(page, 'Create', 'Insert body');
  await expect(page.locator('#feature-document')).toHaveValue(/.+/);
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('2');
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Insert body 1');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(800);
  await evidence(page, '28-built-from-imports');

  // And the bracket as an instance in an assembly.
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'bracket' }).click();
  await expect(page.getByRole('list', { name: 'Instances' })).toContainText('bracket 1');
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('missing');
});
