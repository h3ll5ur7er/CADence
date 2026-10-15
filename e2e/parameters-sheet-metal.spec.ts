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
