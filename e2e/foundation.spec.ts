import { expect, type Page, test } from '@playwright/test';

/** Phase 1 (Foundation) user journey; also writes the evidence screenshots to e2e/evidence/. */
test.describe.configure({ mode: 'serial' });

const evidence = (page: Page, name: string) => page.screenshot({ path: `e2e/evidence/${name}.png` });

async function waitForViewport(page: Page): Promise<void> {
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);
}

test('projects, documents and the three editor modes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'No projects yet' })).toBeVisible();
  await evidence(page, '01-home-empty');

  // A new project opens straight in the editor with its first component.
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Desk organizer');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/documents\/[^/]+$/);
  await expect(page.getByTestId('mode')).toHaveText('Component');
  await expect(page.getByLabel('Model browser')).toContainText('Timeline');
  await waitForViewport(page);
  await evidence(page, '02-component-mode');

  // The view cube turns the camera.
  await page.getByRole('button', { name: 'Top view' }).click();
  await page.waitForTimeout(600);
  await evidence(page, '03-component-top-view');

  // Assembly mode.
  await page.getByRole('button', { name: 'Assembly' }).click();
  await expect(page.getByTestId('mode')).toHaveText('Assembly');
  await expect(page.getByLabel('Assembly browser')).toContainText('Instances');
  await waitForViewport(page);
  await evidence(page, '04-assembly-mode');

  // Imported mode.
  await page.getByLabel('Import', { exact: true }).setInputFiles('e2e/fixtures/wedge.stl');
  await expect(page.getByTestId('mode')).toHaveText('Imported');
  const properties = page.getByLabel('Properties');
  await expect(properties).toContainText('wedge.stl');
  await expect(properties).toContainText('stl');
  await waitForViewport(page);
  await evidence(page, '05-imported-mode');

  // Unsupported files are refused with an explanation.
  await page.getByLabel('Import', { exact: true }).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  await expect(page.getByRole('alert')).toContainText('CADence imports');

  // Rename a document.
  const nav = page.getByRole('navigation', { name: 'Project documents' });
  await nav.getByRole('button', { name: 'Rename Component 1' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Pen holder');
  await page.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(nav).toContainText('Pen holder');

  // Everything persists across a reload and shows on the home page.
  await page.reload();
  await expect(nav).toContainText('Pen holder');
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Projects' })).toContainText('Desk organizer');
  await expect(page.getByRole('list', { name: 'Projects' })).toContainText('3 documents');
  await evidence(page, '06-home-projects');
});

test('deleting a project asks first and removes it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Throwaway');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('mode')).toHaveText('Component');
  await page.getByRole('link', { name: 'Projects', exact: true }).click();

  await page.getByRole('button', { name: 'Delete Throwaway' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('list', { name: 'Projects' })).toContainText('Throwaway');

  await page.getByRole('button', { name: 'Delete Throwaway' }).click();
  await page.getByRole('button', { name: 'Delete project' }).click();
  await expect(page.getByText('No projects yet')).toBeVisible();
});
