import { expect, type Page, test } from '@playwright/test';
import { evidence, fromModelMenu, plateProject, topPoints } from './support';

/**
 * Phase 37 (Gears and springs) user journeys: profile-shifted gears (CAD-159), bevel gears and worms
 * with where their mates go (CAD-160), springs with their rates and helices as sweep paths (CAD-161).
 */
test.setTimeout(240_000);

/** A part of `kind` at a point on the plate's top face, as a body of its own. */
async function partOnPlate(page: Page, project: string, kind: string): Promise<void> {
  await plateProject(page, project);
  await topPoints(page, [0]);
  await fromModelMenu(page, 'Create', 'Part');
  await page.locator('#feature-part-kind').selectOption(kind);
  await page.locator('#feature-operation').selectOption('new-body');
}

/** OK, then the model from above or the side, fitted. */
async function finish(page: Page, view: 'Top' | 'Home', name: string): Promise<void> {
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect(page.getByTestId('body-count')).toHaveText('2');
  await page.getByRole('button', { name: `${view} view` }).dispatchEvent('click');
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await page.waitForTimeout(800);
  await evidence(page, name);
}

test('shifts the profile of a pinion of 8 teeth so it has no undercut, and says where its mate goes (CAD-159)', async ({ page }) => {
  await partOnPlate(page, 'Pinion', 'gear');
  await page.locator('#feature-part-teeth').fill('8');
  await page.locator('#feature-part-teeth').press('Tab');
  // 8 teeth at 20° need a shift of 1 − 8 sin²20° / 2 = 0.532 module.
  await expect(page.getByTestId('undercut')).toHaveText('8 teeth are undercut without a profile shift of at least 0.54.');
  await page.locator('#feature-part-shift').fill('0.55');
  await page.locator('#feature-part-shift').press('Tab');
  await expect(page.getByTestId('undercut')).toHaveCount(0);
  // A 20-tooth mate, unshifted: further out than 14 mm, at the working pressure angle.
  await expect(page.getByTestId('centre-distance')).toHaveText('Put its centre 14.4916 mm along X, turned 9°.');
  await page.locator('#feature-mate-shift').fill('-0.55');
  await page.locator('#feature-mate-shift').press('Tab');
  await expect(page.getByTestId('centre-distance')).toHaveText('Put its centre 14 mm along X, turned 9°.');
  await finish(page, 'Top', 'phase-37-shifted-pinion');
});

test('makes a bevel gear and a worm, and says where their mates go (CAD-160)', async ({ page }) => {
  await partOnPlate(page, 'Bevel', 'bevel-gear');
  // 20 and 20 teeth at 90°: pitch cones of 45°, the apex 10 mm up.
  await expect(page.getByTestId('centre-distance')).toHaveText(
    "The apex of its cone is 10 mm up its axis. Put the mate (20 teeth) with its large end centred 10 mm along X and 10 mm up, its axis towards the apex at 90° to this one's, its X axis along Y and turned 9°. It turns -1 of this gear's turn.",
  );
  await page.locator('#feature-part-mateTeeth').fill('30');
  await page.locator('#feature-part-mateTeeth').press('Tab');
  await expect(page.getByTestId('centre-distance')).toContainText('It turns -0.667 of this gear');
  await finish(page, 'Home', 'phase-37-bevel-gear');

  await fromModelMenu(page, 'Create', 'Part');
  await page.locator('#feature-part-kind').selectOption('worm');
  await page.locator('#feature-operation').selectOption('new-body');
  // One start at 5°: a pitch diameter of 1 / tan 5°.
  await expect(page.getByTestId('centre-distance')).toHaveText("Its pitch diameter is 11.43 mm. Put the wheel's middle 15.715 mm along X on this plane, its axis along Y; it turns 1/20 of a turn per turn of the worm.");
  await page.locator('#feature-part-kind').selectOption('worm-wheel');
  await expect(page.getByTestId('centre-distance')).toContainText('goes 20.715 mm along −X, 3 mm up');
});

test('makes a compression spring and shows its rate, and sweeps a circle along a helix (CAD-161)', async ({ page }) => {
  await partOnPlate(page, 'Spring', 'compression-spring');
  // ⌀1 wire, ⌀10 outside, pitch 3, 8 turns, closed and ground.
  await expect(page.getByTestId('spring-lengths')).toHaveText('Free length 20 mm, solid 8 mm, 6 active turns.');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect(page.getByTestId('body-count')).toHaveText('2');
  // In PLA: G = 3500 / 2.72 MPa, k = G d⁴ / (8 D³ · 6).
  await expect(page.getByTestId('spring-rate')).toHaveText('0.0368 N/mm');
  await expect(page.getByTestId('spring-length')).toContainText('20');
  await page.getByRole('button', { name: 'Home view' }).dispatchEvent('click');
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await page.waitForTimeout(800);
  await evidence(page, 'phase-37-compression-spring');

  // A helix about Z, 3 turns, and a ⌀3 circle across its start (on XZ, at x = 10): swept along it.
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Coil');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);
  await fromModelMenu(page, 'Create', 'Helix');
  await page.locator('#feature-helix-turns').fill('3');
  await page.locator('#feature-helix-turns').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'XZ plane (front)' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Shapes' }).click();
  await page.getByRole('menuitem', { name: 'Curve from equations…' }).click();
  await page.getByRole('textbox', { name: 'x of t' }).fill('10 + 1.5 * cos(t)');
  await page.getByRole('textbox', { name: 'y of t' }).fill('1.5 * sin(t)');
  // A smooth curve through 25 points: sweeping it takes a while, more with more points.
  await page.getByRole('spinbutton', { name: 'Points along the curve' }).fill('25');
  await page.getByRole('button', { name: 'Add curve' }).click();
  await expect(page.getByTestId('profile-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Finish sketch' }).click();
  await fromModelMenu(page, 'Create', 'Sweep');
  await expect(page.locator('#feature-path')).toHaveValue(/.+/);
  await expect(page.locator('#feature-path option:checked')).toHaveText('Helix 1');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 120_000 });
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await page.getByRole('button', { name: 'Home view' }).dispatchEvent('click');
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await page.waitForTimeout(800);
  await evidence(page, 'phase-37-helix-sweep');
});
