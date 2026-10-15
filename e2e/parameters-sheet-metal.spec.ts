import { expect, test } from '@playwright/test';
import { evidence, plateProject } from './support';

/** Phase 12 (Parameters and sheet metal) user journey: units, project parameters, configurations, sheet metal. */
test.setTimeout(180_000);

test('shows and takes lengths in inches without changing the model', async ({ page }) => {
  await plateProject(page, 'Inches');
  const size = page.getByTestId('body-size');
  await expect(size).toHaveText('60, 30, 6 mm');
  const volume = await page.getByTestId('body-volume').textContent();
  await page.getByRole('combobox', { name: 'Units' }).selectOption('in');
  await expect(page.getByTestId('units')).toHaveText('in');
  await expect(size).toHaveText('2.36, 1.18, 0.24 in');
  await expect(page.getByTestId('body-volume')).toHaveText('0.66 in³');
  await page.getByRole('combobox', { name: 'Units' }).selectOption('mm');
  await expect(page.getByTestId('body-volume')).toHaveText(volume ?? '');
  await page.getByRole('combobox', { name: 'Units' }).selectOption('in');
  await evidence(page, '52-inches');
});

test('drives a component from a project parameter', async ({ page }) => {
  await plateProject(page, 'Shared parameters');
  await page.getByRole('button', { name: /Parameters/ }).click();
  await page.getByRole('textbox', { name: 'New project parameter name' }).fill('sheet');
  await page.getByRole('textbox', { name: 'New project parameter expression' }).fill('12 mm');
  await page.getByRole('textbox', { name: 'New project parameter expression' }).press('Enter');
  const shared = page.getByRole('table', { name: 'Project parameters' });
  await expect(shared).toContainText('12 mm');
  // The component's thickness follows the project's sheet.
  await page.getByRole('textbox', { name: 'Expression of thickness' }).fill('sheet');
  await page.getByRole('textbox', { name: 'Expression of thickness' }).press('Enter');
  await expect(page.getByRole('table', { name: 'Parameters', exact: true })).toContainText('12 mm');
  await page.getByRole('textbox', { name: 'Expression of project parameter sheet' }).fill('3 mm');
  await page.getByRole('textbox', { name: 'Expression of project parameter sheet' }).press('Enter');
  await expect(shared).toContainText('3 mm');
  await expect(page.getByRole('table', { name: 'Parameters', exact: true })).toContainText('3 mm');
  await evidence(page, '53-project-parameters');
  await page.getByRole('button', { name: 'Close parameters' }).click();
  await expect(page.getByTestId('body-size')).toHaveText('60, 30, 3 mm');
});

test('keeps configurations of a component and shows one in an assembly', async ({ page }) => {
  await plateProject(page, 'Configurations');
  await page.getByRole('button', { name: /Parameters/ }).click();
  await page.getByRole('textbox', { name: 'New configuration name' }).fill('Thick');
  await page.getByRole('button', { name: 'Add configuration' }).click();
  await page.getByRole('textbox', { name: 'thickness in Thick' }).fill('12 mm');
  await page.getByRole('textbox', { name: 'thickness in Thick' }).press('Enter');
  await page.getByRole('combobox', { name: 'Shown configuration' }).selectOption({ label: 'Thick' });
  await expect(page.getByRole('table', { name: 'Parameters', exact: true })).toContainText('12 mm');
  await evidence(page, '54-configurations');
  await page.getByRole('combobox', { name: 'Shown configuration' }).selectOption({ label: "The parameters' own values" });
  await expect(page.getByRole('table', { name: 'Parameters', exact: true })).toContainText('6 mm');
  await page.getByRole('button', { name: 'Close parameters' }).click();

  // In an assembly: the second instance shows the thick variant.
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  for (const expected of ['1', '2']) {
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Component 1' }).click();
    await expect(page.getByTestId('instance-count')).toHaveText(expected);
  }
  await page.getByRole('button', { name: 'Select Component 1 2' }).click();
  await page.locator('#instance-configuration').selectOption({ label: 'Thick' });
  await expect(page.getByText('Instance of Component 1 (Thick)')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(800);
  await evidence(page, '55-configuration-in-assembly');
});
