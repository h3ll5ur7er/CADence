import { readFileSync, statSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { cutHole, evidence, plateProject, rimOf, setThickness } from './support';

/** Phase 21 (Motion and assembly documents) user journey: motion links, speeds and collisions, exploded views and instructions, bill of materials. */
test.setTimeout(240_000);

/** A standard view of the whole assembly. */
const view = async (page: Page, name: string) => {
  await page.getByRole('button', { name: `${name} view` }).dispatchEvent('click');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await page.waitForTimeout(600);
};

/** A revolute joint from the top rim of one plate's hole to the bottom rim of another plate's. */
async function hinge(page: Page, stays: number, instance: number): Promise<void> {
  await page.getByRole('button', { name: 'Joint', exact: true }).click();
  await view(page, 'Home');
  const top = await rimOf(page, stays, 'top');
  await page.mouse.click(top.x, top.y);
  await view(page, 'Bottom');
  const bottom = await rimOf(page, instance, 'bottom');
  await page.mouse.click(bottom.x, bottom.y);
  await page.getByRole('button', { name: 'OK' }).click();
}

test('links joints by gears, drives them at a speed, explodes the assembly into build instructions and lists its parts', async ({ page }) => {
  await plateProject(page, 'Gearbox');
  await setThickness(page, '4 mm');
  await cutHole(page);
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  for (const expected of ['1', '2', '3']) {
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Component 1' }).click();
    await expect(page.getByTestId('instance-count')).toHaveText(expected);
  }
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading');

  // A stack of three plates on one axis: the second hinged on the first, the third on the second.
  await hinge(page, 0, 1);
  await expect(page.getByRole('list', { name: 'Joints' })).toContainText('Revolute 1');
  await hinge(page, 1, 2);
  await expect(page.getByRole('list', { name: 'Joints' })).toContainText('Revolute 2');

  // Gears: 20 teeth drive 10, so the second turns twice as far, the other way.
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Links' })).toContainText('Gear 1');
  await page.locator('#link-size-a').fill('20');
  await page.locator('#link-size-a').press('Tab');
  await page.locator('#link-size-b').fill('10');
  await page.locator('#link-size-b').press('Tab');
  await expect(page.locator('#link-ratio')).toHaveValue('-2');
  await page.getByRole('button', { name: 'Select Revolute 1' }).click();
  await page.getByRole('spinbutton', { name: 'Angle value of Revolute 1' }).fill('30');
  await page.getByRole('spinbutton', { name: 'Angle value of Revolute 1' }).press('Tab');
  await page.getByRole('button', { name: 'Select Revolute 2' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Angle value of Revolute 2' })).toHaveValue('-60');

  // A study that turns the first gear at 30 rpm: no parts hit.
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  await page.getByRole('combobox', { name: 'Freedom to drive' }).selectOption({ label: 'Revolute 1 · Angle' });
  await page.getByRole('button', { name: 'Speed', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Speed of Revolute 1 · Angle' }).fill('30');
  await page.getByRole('spinbutton', { name: 'Speed of Revolute 1 · Angle' }).press('Tab');
  await page.getByRole('button', { name: 'Check collisions' }).click();
  await expect(page.getByTestId('collision-result')).toHaveText('No parts hit each other.', { timeout: 60_000 });
  await page.getByRole('slider', { name: 'Time' }).fill('1');
  await view(page, 'Home');
  await evidence(page, '83-motion-link');

  // Exploded in two steps, with trails, then build instructions.
  await page.getByRole('button', { name: 'Explode', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Component 1 3', exact: true }).check();
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByRole('checkbox', { name: 'Component 1 2', exact: true }).check();
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByRole('spinbutton', { name: 'Distance of step 1' }).fill('80');
  await page.getByRole('spinbutton', { name: 'Distance of step 1' }).press('Tab');
  await page.getByRole('slider', { name: 'Explode' }).fill('2');
  await view(page, 'Home');
  await evidence(page, '84-exploded-view');
  const pdf = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Build instructions (PDF)' }).click();
  await (await pdf).saveAs('e2e/evidence/gearbox-instructions.pdf');
  expect(readFileSync('e2e/evidence/gearbox-instructions.pdf', 'latin1').startsWith('%PDF-1.4')).toBe(true);
  expect(readFileSync('e2e/evidence/gearbox-instructions.pdf', 'latin1')).toContain('/Count 4');
  expect(statSync('e2e/evidence/gearbox-instructions.pdf').size).toBeGreaterThan(20_000);

  // The bill of materials: one component, three times.
  await page.getByRole('button', { name: 'Bill of materials' }).click();
  await expect(page.getByRole('table', { name: 'Bill of materials' })).toContainText('Component 1');
  await expect(page.getByRole('table', { name: 'Bill of materials' }).locator('tbody tr td').nth(1)).toHaveText('3');
  await evidence(page, '85-bill-of-materials');
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const text = readFileSync(await (await csv).path(), 'utf8');
  expect(text).toContain('Component 1,,3,PLA');
});
