import { readFileSync, statSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { cutHole, evidence, plateProject, rimOf, setThickness } from './support';

/** Phase 5 (Assemblies) user journey: two plates hinged at their holes, checked, animated and exported. */
test.setTimeout(180_000);

const view = async (page: Page, name: string) => {
  // Faces of the view cube that are turned away cannot be clicked, so the click is dispatched.
  await page.getByRole('button', { name: `${name} view` }).dispatchEvent('click');
  await page.waitForTimeout(800);
};

async function pick(page: Page, at: { x: number; y: number }): Promise<void> {
  await page.mouse.click(at.x, at.y);
}

test('instances, a revolute joint, interference, a motion study, recording and export', async ({ page }) => {
  await plateProject(page, 'Linkage');
  await setThickness(page, '4 mm');
  await cutHole(page);

  // A new assembly with the plate twice: the first is grounded at the origin.
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  await expect(page.getByText('Insert components from the toolbar.')).toBeVisible();
  for (const expected of ['1', '2']) {
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Component 1' }).click();
    await expect(page.getByTestId('instance-count')).toHaveText(expected);
  }
  await expect(page.getByRole('list', { name: 'Instances' })).toContainText('Component 1 1');
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading');

  // Hinge: the top rim of the first plate's hole holds the bottom rim of the second's.
  await page.getByRole('button', { name: 'Joint', exact: true }).click();
  await view(page, 'Home');
  await pick(page, await rimOf(page, 0, 'top'));
  await expect(page.getByTestId('joint-side-a')).toContainText('edge of Component 1 1');
  await view(page, 'Bottom');
  await pick(page, await rimOf(page, 1, 'bottom'));
  await expect(page.getByTestId('joint-side-b')).toContainText('edge of Component 1 2');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('list', { name: 'Joints' })).toContainText('Revolute 1');
  await page.getByRole('spinbutton', { name: 'Angle value of Revolute 1' }).fill('90');
  await page.getByRole('spinbutton', { name: 'Angle value of Revolute 1' }).press('Tab');
  await view(page, 'Home');
  await evidence(page, '22-assembly-joint');

  // Stacked, the plates only touch; turned over, the second one cuts into the first.
  await page.getByRole('button', { name: 'Check interference' }).click();
  await expect(page.getByTestId('interference-result')).toHaveText('No parts overlap.');
  await page.getByRole('button', { name: 'Select Revolute 1' }).click();
  await page.getByLabel('Turn the moving side over').check();
  await page.getByRole('button', { name: 'Check interference' }).click();
  await expect(page.getByTestId('interference-result')).toContainText('1 pair overlaps');
  await evidence(page, '23-assembly-interference');
  await page.getByRole('button', { name: 'Select Revolute 1' }).click();
  await page.getByLabel('Turn the moving side over').uncheck();

  // A motion study: 90° at the start, 270° after two seconds.
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Keys' })).toContainText('Revolute 1');
  await page.getByRole('button', { name: 'Select Revolute 1' }).click();
  await page.getByRole('spinbutton', { name: 'Angle value of Revolute 1' }).fill('270');
  await page.getByRole('spinbutton', { name: 'Angle value of Revolute 1' }).press('Tab');
  await page.getByRole('button', { name: 'Select Motion study 1' }).click();
  await page.locator('#key-time').fill('2');
  await page.locator('#key-time').press('Tab');
  await page.getByRole('button', { name: 'Key at current values' }).click();
  await expect(page.getByRole('table', { name: 'Keys' })).toContainText('270');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByTestId('motion-time')).toHaveText('2.00 s', { timeout: 10_000 });
  await page.getByRole('slider', { name: 'Time' }).fill('1');
  await expect(page.getByTestId('motion-time')).toHaveText('1.00 s');
  await evidence(page, '24-assembly-motion');

  // Record the study to video, and export the assembly.
  const video = page.waitForEvent('download', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Record video' }).click();
  await (await video).saveAs('e2e/evidence/linkage.webm');
  expect(statSync('e2e/evidence/linkage.webm').size).toBeGreaterThan(1000);
  await page.getByRole('button', { name: 'Export' }).click();
  const step = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'STEP (one solid per instance)' }).click();
  await (await step).saveAs('e2e/evidence/linkage.step');
  const text = readFileSync('e2e/evidence/linkage.step', 'utf8');
  expect(text).toContain("'Component 1 1'");
  expect(text).toContain("'Component 1 2'");
});
