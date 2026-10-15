import { expect, type Page, test } from '@playwright/test';
import { evidence, plateProject, rectangleSketch, screenPositionOf, setThickness, shown } from './support';

/** CAD-33: the features the Part modeling journey leaves out, clicked through in the browser. */
test.setTimeout(150_000);

const volume = (page: Page) => page.getByTestId('body-volume').first();
const size = (page: Page) => page.getByTestId('body-size').first();
const vertical = '^e:f:[^|]*:side:[^|]*\\|f:[^|]*:side:';

async function confirm(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('form.dialog')).toBeHidden();
  await expect(page.locator('.item.failed')).toHaveCount(0);
}

test('chamfer a corner, then shell the plate open at the top', async ({ page }) => {
  await plateProject(page, 'Tray');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);

  // A 2 mm chamfer on a vertical corner cuts a prism of 2 × 2 / 2 × 6 mm³.
  await page.getByRole('button', { name: 'Chamfer' }).click();
  const corner = await screenPositionOf(page, 'edge', vertical);
  await page.mouse.move(corner.x, corner.y); // the pointer arrives before it clicks, as a hand's would
  await page.mouse.click(corner.x, corner.y);
  await expect(page.getByTestId('edge-selection')).toHaveText('1 edge selected');
  await page.locator('#feature-size').fill('2');
  await page.locator('#feature-size').press('Tab');
  await confirm(page);
  await expect(volume(page)).toHaveText(shown(10800 - 12, 'mm³'));

  // Shell with the top face open and 1 mm walls: a tray (the cavity is 58 × 28 × 5, less its chamfered corner).
  await page.getByRole('button', { name: 'Shell' }).click();
  const top = await screenPositionOf(page, 'face', ':end$');
  await page.mouse.move(top.x, top.y);
  await page.mouse.click(top.x, top.y);
  await expect(page.getByTestId('face-selection')).toHaveText('1 face to open');
  await page.locator('#feature-thickness').fill('1');
  await page.locator('#feature-thickness').press('Tab');
  await confirm(page);
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Shell 1');
  await expect(volume(page)).toHaveText(/mm³/);
  const tray = Number((await volume(page).textContent())?.replace(/[^\d.]/g, ''));
  expect(tray).toBeGreaterThan(10788 - 58 * 28 * 5);
  expect(tray).toBeLessThan(10788 - 58 * 28 * 5 + 20);
  await expect(size(page)).toHaveText('60, 30, 6 mm');
  await page.waitForTimeout(600);
  await evidence(page, '30-chamfer-shell');
});

test('revolve a rectangle about the Y axis into a cylinder', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Spool');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);

  await rectangleSketch(page, 'XY plane (top)', 20, 10);
  await page.getByRole('button', { name: 'Revolve' }).click();
  await expect(page.getByTestId('profile-selection')).toHaveText('1 profile selected');
  await page.locator('#feature-axis').selectOption('origin:Y');
  await confirm(page);
  // Radius 20 (the rectangle's width), height 10 along Y.
  await expect(volume(page)).toHaveText(shown(Math.PI * 20 * 20 * 10, 'mm³'));
  await expect(size(page)).toHaveText('40, 10, 40 mm');

  // Half a turn makes half the cylinder.
  await page.getByRole('button', { name: 'Edit Revolve 1' }).click();
  await page.locator('#feature-angle').fill('180 deg');
  await page.locator('#feature-angle').press('Tab');
  await confirm(page);
  await expect(volume(page)).toHaveText(shown((Math.PI * 20 * 20 * 10) / 2, 'mm³'));
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  await evidence(page, '31-revolve');
});

test('a construction plane mirrors the plate, a circular pattern repeats it, both follow the thickness', async ({ page }) => {
  await plateProject(page, 'Pinwheel');

  // A plane on top of the plate, offset by the thickness parameter.
  await page.getByRole('button', { name: 'Construction plane' }).click();
  await page.locator('#feature-base').selectOption('XY');
  await page.locator('#feature-offset').fill('thickness');
  await page.locator('#feature-offset').press('Tab');
  await confirm(page);
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Plane 1');

  // Mirrored across that plane: the extrude made a new body, so its mirror image is a second body on top.
  await page.getByRole('button', { name: 'Mirror' }).click();
  await page.locator('#feature-plane').selectOption({ index: 3 });
  await confirm(page);
  const bodies = page.getByRole('list', { name: 'Bodies' });
  const mirrored = bodies.locator('li', { hasText: 'Mirror 1' });
  await expect(page.getByTestId('body-count')).toHaveText('2');
  await expect(mirrored).toContainText('10,800 mm³');
  await expect(mirrored).toContainText('Centre of mass30, 15, 9');

  // Four plates around the Z axis in the bottom layer: three more bodies.
  await page.getByRole('button', { name: 'Circular pattern' }).click();
  await expect(page.locator('#feature-count')).toHaveValue('4');
  await confirm(page);
  await expect(page.getByTestId('body-count')).toHaveText('5');
  await expect(page.getByTestId('body-volume')).toHaveText(Array(5).fill('10,800 mm³'));
  await expect(bodies).toContainText('Centre of mass-15, 30, 3');
  await expect(bodies).toContainText('Circular pattern 1 (3)');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  await evidence(page, '32-plane-mirror-pattern');

  // A thicker plate: the plane moves up, the mirrored body and the pattern follow.
  await setThickness(page, '10 mm');
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect(page.getByTestId('body-volume')).toHaveText(Array(5).fill('18,000 mm³'));
  await expect(mirrored).toContainText('Centre of mass30, 15, 15');
});
