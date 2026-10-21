import { expect, test } from '@playwright/test';
import { cutHole, evidence, hinge, plateProject, setThickness, standardView } from './support';

/**
 * Phases 44 to 47 (the robot arm's and the Stewart platform's findings, CAD-182, CAD-183) user
 * journeys: joints that say where a limit holds them, offsets that follow parameters, actuators.
 */
test.setTimeout(240_000);

test('moves a joint by a parameter, says where its limit holds it, and marks it as an actuator (CAD-185, CAD-186, CAD-195, CAD-197)', async ({ page }) => {
  await plateProject(page, 'Legs');
  await setThickness(page, '4 mm');
  await cutHole(page);
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  for (const expected of ['1', '2']) {
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Component 1' }).click();
    await expect(page.getByTestId('instance-count')).toHaveText(expected);
  }
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading');
  // Universal joints are among the types, with what they do.
  await page.getByRole('button', { name: 'Joint', exact: true }).click();
  await expect(page.locator('#joint-type option', { hasText: 'Universal' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Cancel joint' }).click();
  await hinge(page, 0, 1);
  await expect(page.getByRole('list', { name: 'Joints' })).toContainText('Revolute 1');

  // The hinge sits a plate's thickness up, and follows the parameter.
  await page.getByRole('textbox', { name: 'Z offset of stays' }).fill('thickness * 2');
  await page.getByRole('textbox', { name: 'Z offset of stays' }).press('Tab');
  await expect(page.getByRole('textbox', { name: 'Z offset of stays' })).toHaveValue('thickness * 2');
  await expect(page.locator('.item.failed')).toHaveCount(0);

  // A limit of 30°: asked for 75°, the joint says it is held there.
  await page.getByRole('spinbutton', { name: 'Max' }).first().fill('30');
  await page.getByRole('spinbutton', { name: 'Max' }).first().press('Tab');
  await page.getByRole('spinbutton', { name: 'Angle value of Revolute 1' }).fill('75');
  await page.getByRole('spinbutton', { name: 'Angle value of Revolute 1' }).press('Tab');
  await expect(page.getByRole('status').filter({ hasText: 'Angle is held at its maximum, 30° (asked 75°).' })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Angle value of Revolute 1' })).toHaveValue('30');
  await standardView(page, 'Front');
  await evidence(page, '100-joint-limits');

  // An actuator: other joints moving never change it.
  await page.getByRole('checkbox', { name: 'Driven (an actuator)' }).check();
  await expect(page.getByRole('checkbox', { name: 'Driven (an actuator)' })).toBeChecked();
});
