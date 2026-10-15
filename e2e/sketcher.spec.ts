import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page, test } from '@playwright/test';

/** Phase 2 (Sketcher) user journey: a laser-cut plate with a hole, dimensioned and exported. */
test.describe.configure({ mode: 'serial' });

const evidence = (page: Page, name: string) => page.screenshot({ path: `e2e/evidence/${name}.png` });

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Types a value into the inline dimension editor that opens after placing a dimension. */
async function typeDimension(page: Page, value: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Dimension value' });
  await expect(input).toBeFocused();
  await input.fill(value);
  await input.press('Enter');
  await expect(input).toBeHidden();
}

test('sketch, constrain and export a plate', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Laser bracket');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);

  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'XY plane (top)' }).click();
  const canvas = page.getByRole('application', { name: 'Sketch canvas' });
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(500); // camera turns to the plane
  const origin = await center(page.locator('circle.point.origin'));

  // Rectangle starting on the origin: its corner is the origin point itself.
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.click(origin.x, origin.y);
  await page.mouse.click(origin.x + 220, origin.y - 120);
  const status = page.getByTestId('sketch-status');
  await expect(status).toHaveText('2 degrees of freedom');

  // Width and height dimensions.
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.mouse.click(origin.x + 110, origin.y);
  await page.mouse.click(origin.x + 110, origin.y + 60);
  await typeDimension(page, '80');
  const right = await center(page.locator('.curve').nth(1));
  await page.mouse.click(right.x, right.y);
  await page.mouse.click(right.x + 80, right.y);
  await typeDimension(page, '2 * 20 mm');
  await expect(status).toHaveText('Fully constrained');
  await evidence(page, '08-sketch-rectangle-constrained');

  // A hole: a circle, dimensioned by its diameter.
  const plate = await page.locator('.profile').first().boundingBox();
  if (!plate) throw new Error('no profile');
  const hole = { x: plate.x + plate.width * 0.7, y: plate.y + plate.height / 2 };
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  await page.mouse.click(hole.x, hole.y);
  await page.mouse.click(hole.x + 30, hole.y);
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.mouse.click(hole.x + 30, hole.y);
  await typeDimension(page, '12');
  await expect(page.getByTestId('profile-count')).toHaveText('2');
  await expect(status).toHaveText('2 degrees of freedom');

  // Dragging the hole's centre moves it; the solver keeps every constraint.
  await page.getByRole('button', { name: 'Select and drag', exact: true }).click();
  await page.mouse.move(hole.x, hole.y);
  await page.mouse.down();
  await page.mouse.move(hole.x - 60, hole.y + 10, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.dimension text', { hasText: '⌀ 12' })).toBeVisible();
  await evidence(page, '09-sketch-plate-with-hole');

  // Exports for the laser cutter.
  const dxfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'DXF' }).click();
  const dxf = await dxfDownload;
  expect(dxf.suggestedFilename()).toBe('Component 1 - Sketch 1.dxf');
  await dxf.saveAs('e2e/evidence/plate.dxf');
  const dxfText = readFileSync('e2e/evidence/plate.dxf', 'utf8');
  expect(dxfText.match(/^LINE$/gm)).toHaveLength(4);
  expect(dxfText).toContain('CIRCLE');

  const svgDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'SVG' }).click();
  const svg = await svgDownload;
  await svg.saveAs('e2e/evidence/plate.svg');
  expect(readFileSync('e2e/evidence/plate.svg', 'utf8')).toContain('width="80mm" height="40mm"');

  // Undo and redo the last change (the drag).
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  await expect(page.getByTestId('profile-count')).toHaveText('2');

  // Finishing shows the sketch in 3D; everything survives a reload.
  await page.getByRole('button', { name: 'Finish sketch' }).click();
  await expect(canvas).toBeHidden();
  await page.waitForTimeout(500);
  await evidence(page, '10-sketch-in-3d');
  await page.reload();
  await page.getByRole('button', { name: 'Edit Sketch 1' }).click();
  await expect(page.getByTestId('profile-count')).toHaveText('2');
  await expect(page.locator('.dimension text')).toHaveText(['80', '40', '⌀ 12']);
});

test('conflicting constraints are refused with an explanation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Conflicts');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'XY plane (top)' }).click();
  await page.waitForTimeout(500);
  const origin = await center(page.locator('circle.point.origin'));

  // A line drawn almost horizontally becomes horizontal; making it vertical too would collapse it.
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.mouse.click(origin.x + 20, origin.y - 40);
  await page.mouse.click(origin.x + 200, origin.y - 42);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Select and drag', exact: true }).click();
  const line = await center(page.locator('.curve').first());
  await page.mouse.click(line.x, line.y);
  await page.getByRole('button', { name: /^Vertical \(a line/ }).click();
  await expect(page.getByRole('alert')).toContainText('shrink a line, circle or arc to nothing');

  // Two length dimensions on one line contradict each other.
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.mouse.click(line.x, line.y);
  await page.mouse.click(line.x, line.y + 50);
  await page.getByRole('textbox', { name: 'Dimension value' }).press('Enter');
  await page.mouse.click(line.x, line.y);
  await page.mouse.click(line.x, line.y - 50);
  await expect(page.getByRole('alert')).toContainText('conflicts with existing constraints (distance)');
  await evidence(page, '11-sketch-conflict');
});
