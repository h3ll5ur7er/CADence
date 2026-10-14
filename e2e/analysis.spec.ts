import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { center, evidence, plateProject, screenPositionOf, setThickness, shown } from './support';

/** Phase 4 (Analysis) user journey: weigh, measure and check a plate for printing and laser cutting. */
test.setTimeout(120_000);

test('mass properties, measuring, and manufacturability checks for printer and laser', async ({ page }) => {
  await plateProject(page, 'Gauge');

  // Mass properties in the component's material.
  await expect(page.getByTestId('body-volume')).toHaveText(shown(10800, 'mm³'));
  await expect(page.getByTestId('body-mass')).toHaveText('13.39 g');
  await expect(page.getByTestId('body-size')).toHaveText('60, 30, 6 mm');
  await page.locator('#component-material').selectOption({ label: 'Steel · 7.85 g/cm³' });
  await expect(page.getByTestId('body-mass')).toHaveText('84.78 g');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  await evidence(page, '16-mass-properties');

  // Measure: the top face, then the distance to a bottom edge.
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  const top = await screenPositionOf(page, 'face', ':end$');
  await page.mouse.click(top.x, top.y);
  await expect(page.getByTestId('measure-area')).toHaveText(shown(1800, 'mm²'));
  const bottomEdge = await screenPositionOf(page, 'edge', ':side:[^|]*\\|f:[^|]*:start$');
  await page.mouse.click(bottomEdge.x, bottomEdge.y);
  await expect(page.getByTestId('measure-distance')).toHaveText('6 mm');
  await expect(page.getByTestId('measure-angle')).toHaveText('0°');
  await evidence(page, '17-measure');

  // A plate too thin for the nozzle fails the wall check; its faces are flagged in the view.
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  await setThickness(page, '0.3 mm');
  await page.getByRole('button', { name: 'Check manufacturability' }).click();
  const walls = page.locator('[data-check="walls"]');
  await expect(walls).toHaveAttribute('data-status', 'fail');
  await expect(walls).toContainText('Walls down to 0.3 mm are thinner than the 0.4 mm nozzle');
  await expect(walls).toContainText('Shown in the view');
  await expect(page.getByTestId('check-summary')).toHaveText('3 passed, 0 warnings, 1 failed for FDM printer 220 × 220 × 250.');
  await evidence(page, '18-check-print');

  // The same part for a laser cutter: one 3 mm sheet, closed outlines, kerf compensation.
  await page.locator('#check-profile').selectOption({ label: 'Diode laser 400 × 400, 3 mm plywood' });
  await expect(page.locator('[data-check="sheet"]')).toContainText('Extrude 1 is 0.3 mm thick; the sheet is 3 mm.');
  await setThickness(page, '3 mm');
  await page.getByRole('button', { name: 'Check manufacturability' }).click();
  await expect(page.getByTestId('check-summary')).toHaveText('4 passed, 0 warnings, 0 failed for Diode laser 400 × 400, 3 mm plywood.');
  await expect(page.locator('[data-check="kerf"]')).toContainText('0.15 mm kerf (0.075 mm per side)');
  await evidence(page, '19-check-laser');

  // Export the sketch with its outline grown by half the kerf.
  await page.getByRole('button', { name: 'Edit Sketch 1' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'DXF −kerf' }).click();
  await (await download).saveAs('e2e/evidence/plate-kerf.dxf');
  const dxf = readFileSync('e2e/evidence/plate-kerf.dxf', 'utf8').split(/\r?\n/);
  expect(dxf).toContain('60.075');
  expect(dxf).toContain('-0.075');
  await page.getByRole('button', { name: 'Finish sketch' }).click();

  // Back to the printer: a boss sticking out of the front face hangs in the air underneath.
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  const front = await screenPositionOf(page, 'face', ':side:');
  await page.mouse.click(front.x, front.y);
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'Selected face' }).click();
  await page.waitForTimeout(600);
  const faceOrigin = await center(page, 'circle.point.origin');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.click(faceOrigin.x - 60, faceOrigin.y);
  await page.mouse.click(faceOrigin.x + 60, faceOrigin.y - 90);
  await expect(page.getByTestId('profile-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Finish sketch' }).click();
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await page.locator('#feature-distance').fill('15');
  await page.locator('#feature-distance').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Extrude 2');
  await page.getByRole('button', { name: 'Check manufacturability' }).click();
  await page.locator('#check-profile').selectOption({ label: 'FDM printer 220 × 220 × 250' });
  const overhang = page.locator('[data-check="overhang"]');
  await expect(overhang).toHaveAttribute('data-status', 'warning');
  await expect(overhang).toContainText('needs supports or bridging');
  // The flagged underside, seen from below.
  await page.getByRole('button', { name: 'Bottom view' }).dispatchEvent('click'); // that face of the view cube is turned away
  await page.waitForTimeout(800);
  await evidence(page, '20-check-overhang');
});
