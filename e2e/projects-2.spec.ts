import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { evidence } from './support';

/** Phase 16 (Projects II) user journey: files in and out, copies, templates and a shared viewer. */
test.setTimeout(240_000);

const fixture = (name: string) => join(import.meta.dirname, 'fixtures', name);

/** Drops a file from the fixtures onto an element, as a file dragged from the desktop would be. */
async function dropFile(page: Page, selector: string, name: string): Promise<void> {
  const bytes = [...readFileSync(fixture(name))];
  await page.evaluate(
    ({ selector, name, bytes }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], name));
      const target = document.querySelector(selector) as Element;
      target.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    },
    { selector, name, bytes },
  );
}

test('opens and drops files, duplicates documents and replaces an imported file', async ({ page }) => {
  await page.goto('/');
  // Files picked on the home page start a project named after the first one.
  await page.locator('input[type=file][multiple]').setInputFiles([fixture('wedge.stl'), fixture('plate.svg')]);
  await expect(page.getByTitle('Rename project')).toHaveText('wedge');
  const documents = page.getByRole('navigation', { name: 'Project documents' });
  await expect(documents.getByRole('link')).toHaveText(['plate', 'wedge']);

  // Dropped onto the documents panel, a file is imported into the project.
  await dropFile(page, 'cad-documents-panel', 'bracket.step');
  await expect(documents.getByRole('link', { name: 'bracket' })).toBeVisible();

  await page.getByRole('button', { name: 'Duplicate wedge' }).click();
  await expect(documents.getByRole('link', { name: 'wedge (copy)' })).toBeVisible();
  // The copy gets a newer file: the bracket instead of the wedge.
  await page.getByLabel('Replace the file of wedge (copy)').setInputFiles(fixture('bracket.step'));
  await documents.getByRole('link', { name: 'wedge (copy)' }).click();
  await expect(page.getByTestId('imported-size')).toHaveText('60, 30, 10 mm');
  await page.waitForTimeout(800);
  await evidence(page, '64-files');
});

test('starts a project from a template, duplicates it, and moves it as one file', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('dialog').getByText('Box with lid', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Box with lid');
  await evidence(page, '65-templates');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('body-size')).toHaveText('80, 60, 40 mm');
  const documents = page.getByRole('navigation', { name: 'Project documents' });
  await expect(documents.getByRole('link')).toHaveText(['Box', 'Lid', 'Box with lid']);

  // Copies and archives on the home page.
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate Box with lid' }).click();
  const cards = page.getByRole('list', { name: 'Projects' }).getByRole('listitem');
  await expect(cards.filter({ hasText: 'Box with lid (copy)' })).toBeVisible();
  await page.getByRole('button', { name: 'Export Box with lid', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const archive = join(import.meta.dirname, 'evidence', 'box-with-lid.cadence');
  await (await download).saveAs(archive);
  await page.locator('input[type=file][multiple]').setInputFiles(archive);
  await expect(documents.getByRole('link')).toHaveText(['Box', 'Lid', 'Box with lid']);
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(cards.filter({ hasText: /^Box with lid/ })).toHaveCount(3);
});

test('shares an assembly as one HTML file that shows, measures and explodes it', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('dialog').getByText('Box with lid', { exact: true }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('navigation', { name: 'Project documents' }).getByRole('link', { name: 'Box with lid' }).click();
  await expect(page.getByTestId('mode')).toHaveText('Assembly');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Viewer (HTML, to share)' }).click();
  const file = join(import.meta.dirname, 'evidence', 'box-with-lid.html');
  await (await download).saveAs(file);
  expect(readFileSync(file, 'utf8')).toContain('<title>Box with lid</title>');

  // The file on its own, as someone without CADence opens it.
  const viewer = await context.newPage();
  await viewer.setViewportSize({ width: 1000, height: 700 });
  await viewer.goto(`file://${file.replace(/\\/g, '/')}`);
  await expect(viewer.getByRole('checkbox')).toHaveCount(2);
  await viewer.getByLabel('Explode').fill('0.6');
  await viewer.getByRole('button', { name: 'Measure' }).click();
  await viewer.mouse.click(470, 330);
  await viewer.mouse.click(560, 390);
  await expect(viewer.getByRole('status')).toContainText(/Distance \d+\.\d\d mm|Click a second point|Click two points/);
  await evidence(viewer, '66-viewer');
});
