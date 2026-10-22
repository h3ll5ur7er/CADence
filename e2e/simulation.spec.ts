import { expect, type Page, test } from '@playwright/test';
import { evidence, plateProject } from './support';

/** Phase 24 (Simulation) user journey: hold a plate at one end, load the other, and check its strength. */
test.setTimeout(180_000);

/** Turns the view to a standard direction (test-only access to the viewport component). */
async function showView(page: Page, view: 'left' | 'home'): Promise<void> {
  await page.evaluate((v) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
    ng.getComponent(document.querySelector('cad-viewport') as Element).showView(v);
  }, view);
  await page.waitForTimeout(600);
}

/** Where on screen the middle of the plate's end face at `x` is. */
async function endFace(page: Page, x: number): Promise<{ x: number; y: number }> {
  return page.evaluate((x) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
    const viewport = ng.getComponent(document.querySelector('cad-viewport') as Element);
    const scene = viewport.scene();
    const face = viewport.bodies()[0].faces.find((f: { center: number[]; planar: boolean }) => f.planar && Math.abs((f.center[0] as number) - x) < 1e-6);
    const v = new scene.camera.position.constructor(...face.center).project(scene.camera);
    const rect = scene.eventTarget.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }, x);
}

test('a strength check: fixed face, a force, stresses, deflection and safety factor', async ({ page }) => {
  await plateProject(page, 'Bracket');
  await page.locator('#component-material').selectOption({ label: 'Steel · 7.85 g/cm³' });

  await page.getByRole('button', { name: 'Check strength' }).click();
  const panel = page.locator('cad-simulate-panel');
  await expect(panel).toContainText('Steel: stiffness 200 GPa, yields at 250 MPa.');
  await expect(panel.getByRole('button', { name: 'Run' })).toBeDisabled();

  // Hold the end at x = 0 (seen from the left), then load the other end, pushing down.
  await showView(page, 'left');
  const held = await endFace(page, 0);
  await page.mouse.click(held.x, held.y);
  await expect(panel.getByRole('region', { name: 'Fixed faces' })).toContainText('Face of Extrude 1');
  await panel.getByRole('button', { name: 'Load', exact: true }).click();
  await showView(page, 'home');
  const loaded = await endFace(page, 60);
  await page.mouse.click(loaded.x, loaded.y);
  const load = panel.locator('[data-load="0"]');
  await expect(load).toContainText('Face of Extrude 1');
  await expect(load.getByRole('combobox', { name: 'Direction' })).toHaveValue('into');
  await load.getByRole('combobox', { name: 'Direction' }).selectOption({ label: 'Down (−Z)' });
  await load.getByRole('spinbutton', { name: 'Force' }).fill('50');
  await load.getByRole('spinbutton', { name: 'Force' }).press('Tab');
  await expect(load.getByRole('combobox', { name: 'Direction' })).toHaveValue('0');

  // 50 N at the end of a 60 mm steel cantilever, 30 × 6: beam theory says 0.033 mm and 17 MPa at the wall.
  await panel.getByRole('button', { name: 'Run' }).click();
  await expect(panel.getByTestId('sim-deflection')).toHaveText(/^0\.0(2[89]|3\d) mm$/, { timeout: 60_000 });
  const stress = Number((await panel.getByTestId('sim-stress').textContent())?.replace(/[^\d.]/g, ''));
  expect(stress).toBeGreaterThan(12);
  expect(stress).toBeLessThan(60);
  await expect(panel.getByTestId('sim-safety')).toHaveAttribute('data-status', 'pass');
  await page.waitForTimeout(600);
  await evidence(page, '91-strength');

  // The setup is stored with the component.
  await page.reload();
  await expect(page.getByTestId('body-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Check strength' }).click();
  await expect(panel.getByRole('region', { name: 'Fixed faces' })).toContainText('Face of Extrude 1');
  await expect(panel.locator('[data-load="0"]').getByRole('spinbutton', { name: 'Force' })).toHaveValue('50');
  await panel.getByRole('button', { name: 'Run' }).click();
  await expect(panel.getByTestId('sim-deflection')).toBeVisible({ timeout: 60_000 });
  await panel.getByRole('checkbox', { name: /bent shape/ }).uncheck();
  await page.waitForTimeout(400);
  await evidence(page, '92-strength-unbent');

  // The answer says how settled it is: the same check with coarser elements (CAD-190).
  await expect(panel.getByTestId('sim-coarser')).toHaveText(/MPa$/);
  // Its own weight and a moment on the end instead of the force (CAD-191).
  await panel.getByRole('checkbox', { name: /own weight/ }).check();
  await expect(panel.getByRole('checkbox', { name: /own weight/ })).toBeChecked();
  await panel.locator('[data-load="0"]').getByRole('combobox', { name: 'Kind of load' }).selectOption('moment');
  await expect(panel.locator('[data-load="0"]').getByRole('combobox', { name: 'Moment axis' })).toBeVisible();
  await panel.locator('[data-load="0"]').getByRole('spinbutton', { name: 'Moment' }).fill('2');
  await panel.locator('[data-load="0"]').getByRole('spinbutton', { name: 'Moment' }).press('Tab');
  await panel.locator('[data-load="0"]').getByRole('combobox', { name: 'Moment axis' }).selectOption({ label: 'About +Y' });
  await panel.getByRole('button', { name: 'Run' }).click();
  await expect(panel.getByTestId('sim-stress')).toHaveText(/MPa$/, { timeout: 60_000 });
  await expect(panel.getByRole('checkbox', { name: /own weight/ })).toBeChecked();
  await page.waitForTimeout(600);
  await evidence(page, '102-strength-moment');
});
