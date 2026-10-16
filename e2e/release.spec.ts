import { expect, test } from '@playwright/test';
import { evidence } from './support';

/** Phase 15 (Release and desktop) user journey: the About dialog and its credits. */
test('says what CADence is built on, with the licences', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'About CADence' }).click();
  const about = page.getByRole('dialog', { name: 'CADence' });
  await expect(about.getByTestId('app-version')).toHaveText(/^\d+\.\d+\.\d+$/);
  const builtOn = (name: string) => about.getByRole('listitem').filter({ has: page.getByRole('link', { name, exact: true }) });
  await expect(builtOn('OpenCascade')).toContainText('LGPL-2.1-only');
  await expect(builtOn('planegcs (FreeCAD GCS)')).toContainText('LGPL-2.0-or-later');
  await expect(builtOn('Inter')).toContainText('OFL-1.1');
  await about.getByText(/^All \d+ libraries and fonts$/).click();
  await expect(about.getByRole('table', { name: 'Libraries and fonts' }).getByRole('row').filter({ hasText: 'isomorphic-git' })).toContainText('MIT');
  await evidence(page, '62-about');

  // The full licence texts come with the app.
  await about.getByText('Licence texts', { exact: true }).click();
  await expect(about.getByTestId('licence-texts')).toContainText('GNU LESSER GENERAL PUBLIC LICENSE');
});
