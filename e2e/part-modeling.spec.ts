import { readFileSync, statSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { cutHole, evidence, fromModelMenu, plateProject, screenPositionOf, setThickness, shown } from './support';

/** Phase 3 (Part modeling) user journey: a parametric bracket, printed and exported. */
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const volume = (page: Page) => page.getByTestId('body-volume').first();

test('a parametric bracket: extrude, hole on a face, pattern, fillet, exports', async ({ page }) => {
  await plateProject(page, 'Bracket');
  await expect(volume(page)).toHaveText(shown(10800, 'mm³'));

  // A hole sketched on the top face, cut through.
  await cutHole(page);
  await expect(volume(page)).toHaveText(shown(10800 - Math.PI * 16 * 6, 'mm³'));

  // Three holes in a row.
  await fromModelMenu(page, 'Pattern', 'Linear pattern');
  await page.locator('#feature-spacing').fill('15');
  await page.locator('#feature-spacing').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(volume(page)).toHaveText(shown(10800 - 3 * Math.PI * 16 * 6, 'mm³'));

  // Round a vertical corner edge, seen from the home view.
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Fillet' }).click();
  await expect(page.getByTestId('edge-selection')).toHaveText('0 edges selected');
  const corner = await screenPositionOf(page, 'edge', '^e:f:[^|]*:side:[^|]*\\|f:[^|]*:side:');
  await page.mouse.click(corner.x, corner.y);
  await expect(page.getByTestId('edge-selection')).toHaveText('1 edge selected');
  await page.locator('#feature-size').fill('3');
  await page.locator('#feature-size').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Fillet 1');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  await evidence(page, '13-part-bracket');

  // A thicker plate: every feature follows.
  await setThickness(page, '10 mm');
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await evidence(page, '14-part-thicker');

  // Exports for printing and CAD.
  for (const [label, file] of [
    ['STEP (exact, for CAD)', 'bracket.step'],
    ['STL (for slicers)', 'bracket.stl'],
    ['3MF (for slicers)', 'bracket.3mf'],
  ] as const) {
    await page.getByRole('button', { name: 'Export' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: label }).click();
    await (await download).saveAs(`e2e/evidence/${file}`);
    expect(statSync(`e2e/evidence/${file}`).size).toBeGreaterThan(1000);
  }
  expect(readFileSync('e2e/evidence/bracket.step', 'utf8')).toContain('ISO-10303-21');
});
