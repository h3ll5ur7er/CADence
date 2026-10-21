import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { cutHole, evidence, plateProject, rimOf, setThickness } from './support';

/** Phase 34 (Projects III) user journeys: the trash, project notes, following changes made elsewhere, libraries and standard parts. */
test.setTimeout(300_000);

const fixture = (name: string) => join(import.meta.dirname, 'fixtures', name);

async function newProject(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('mode')).toHaveText('Component');
}

const documents = (page: Page) => page.getByRole('navigation', { name: 'Project documents' });

test('deleted documents and projects wait in the trash and come back with their history', async ({ page }) => {
  await newProject(page, 'Shelf');
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  await expect(documents(page).getByRole('link', { name: 'Assembly 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Assembly 1' }).click();
  await expect(page.getByRole('dialog')).toContainText('goes to the trash');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(documents(page).getByRole('link', { name: 'Assembly 1' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  const trash = page.getByRole('region', { name: 'Trash' });
  await trash.getByRole('button', { name: 'Trash' }).click();
  await expect(trash.getByRole('list', { name: 'Deleted projects and documents' })).toContainText('assembly of Shelf');

  // The project goes to the trash too, and both come back.
  await page.getByRole('button', { name: 'Delete Shelf' }).click();
  await page.getByRole('button', { name: 'Delete project' }).click();
  await expect(page.getByText('No projects yet')).toBeVisible();
  // A project in the trash holds its own deleted documents.
  await expect(trash.getByRole('listitem')).toHaveCount(1);
  await expect(trash).toContainText('Project, 1 document');
  await evidence(page, 'phase-34-trash');
  await trash.getByRole('button', { name: 'Restore Shelf' }).click();
  await expect(page.getByRole('list', { name: 'Projects' })).toContainText('Shelf');
  await trash.getByRole('button', { name: 'Restore Assembly 1' }).click();
  await expect(trash).toHaveCount(0);
  await page.getByRole('list', { name: 'Projects' }).getByRole('link').first().click();
  await expect(documents(page).getByRole('link', { name: 'Assembly 1' })).toBeVisible();
  // With its history: the version it was deleted in, and the restore.
  await page.getByRole('button', { name: 'History of Assembly 1' }).click();
  await expect(page.getByRole('list', { name: 'Versions' })).toContainText('Restored Assembly 1 from the trash');
});

test('a project keeps a description, attached files and links, also in its archive', async ({ page }) => {
  await newProject(page, 'Robot arm');
  await page.getByRole('button', { name: 'Project notes' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Description' }).fill('# Robot arm\n\nServo **MG996R**, printed in PETG.\n\n- base\n- arm\n- gripper');
  await expect(dialog.getByRole('region', { name: 'Description as shown' }).locator('strong')).toHaveText('MG996R');
  await dialog.getByRole('button', { name: 'Save description' }).click();
  await dialog.locator('input[type=file]').setInputFiles([fixture('logo.png'), fixture('plate.svg')]);
  await dialog.getByRole('textbox', { name: 'Link address' }).fill('https://example.com/mg996r.pdf');
  await dialog.getByRole('textbox', { name: 'Link name' }).fill('Servo datasheet');
  await dialog.getByRole('button', { name: 'Add link' }).click();
  const attachments = dialog.getByRole('list', { name: 'Attachments' });
  await expect(attachments.getByRole('listitem')).toHaveCount(3);
  await expect(attachments.getByRole('img', { name: 'logo.png' })).toBeVisible();
  await expect(attachments.getByRole('link', { name: 'Servo datasheet' })).toHaveAttribute('href', 'https://example.com/mg996r.pdf');
  await evidence(page, 'phase-34-notes');
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Through an archive, the notes and files come along.
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Export Robot arm', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const archive = join(import.meta.dirname, 'evidence', 'robot-arm.cadence');
  await (await download).saveAs(archive);
  await page.locator('input[type=file][multiple]').setInputFiles(archive);
  await expect(page.getByTitle('Rename project')).toHaveText('Robot arm');
  await page.getByRole('button', { name: 'Project notes' }).click();
  await expect(page.getByRole('dialog').getByRole('region', { name: 'Description as shown' })).toContainText('printed in PETG');
  await expect(page.getByRole('dialog').getByRole('list', { name: 'Attachments' }).getByRole('listitem')).toHaveCount(3);
});

test('an open editor follows what another window changes, and asks first while the user is in a dialog', async ({ page, context }) => {
  await plateProject(page, 'Follow');
  await expect(page.getByTestId('body-size')).toHaveText('60, 30, 6 mm');
  const url = page.url();
  // Another window of the app (an agent's MCP server reaches the desktop app the same way, through its watched folders).
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.getByTestId('body-size')).toHaveText('60, 30, 6 mm');
  await setThickness(other, '10 mm');
  await expect(page.getByTestId('body-size')).toHaveText('60, 30, 10 mm');
  // A new document shows in the documents panel.
  await other.getByRole('button', { name: 'Assembly', exact: true }).click();
  await expect(documents(page).getByRole('link', { name: 'Assembly 1' })).toBeVisible();
  await expect(page.getByTestId('mode')).toHaveText('Component');

  // In the middle of a feature dialog, the user is asked first.
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await other.getByRole('link', { name: 'Component 1' }).click();
  await setThickness(other, '12 mm');
  await expect(page.getByRole('alert').filter({ hasText: 'Another program changed this document.' })).toBeVisible();
  await evidence(page, 'phase-34-follows');
  await page.getByRole('button', { name: 'Load its changes' }).click();
  await expect(page.getByTestId('body-size')).toHaveText('60, 30, 12 mm');
});

test('an assembly uses a part of a library project and follows the library when updated', async ({ page }) => {
  await plateProject(page, 'Brackets');
  await page.getByRole('button', { name: 'Project notes' }).click();
  await page.getByRole('checkbox', { name: /A library/ }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Projects' }).getByRole('listitem').filter({ hasText: 'Brackets' })).toContainText('Library');

  await newProject(page, 'Robot');
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'From a library…' }).click();
  await page.locator('#library').selectOption({ label: 'Brackets (1)' });
  await page.getByRole('list', { name: 'Library parts' }).getByRole('button', { name: 'Component 1' }).click();
  await page.getByRole('button', { name: 'Insert', exact: true }).last().click();
  await expect(page.getByTestId('instance-count')).toHaveText('1');
  await expect(documents(page).getByRole('list', { name: 'Library parts' })).toContainText('Brackets');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading');
  await page.getByRole('button', { name: 'Bill of materials' }).click();
  const bom = page.getByRole('table', { name: 'Bill of materials' });
  await expect(bom).toContainText('Component 1');
  const before = await bom.locator('tbody tr td').nth(3).textContent();

  // The library's plate gets thicker; the robot updates when asked.
  const robot = page.url();
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('list', { name: 'Projects' }).getByRole('link').filter({ hasText: 'Brackets' }).click();
  await setThickness(page, '12 mm');
  await page.goto(robot);
  await expect(page.getByRole('button', { name: 'Update Component 1' })).toBeVisible();
  await evidence(page, 'phase-34-library');
  await page.getByRole('button', { name: 'Update Component 1' }).click();
  await expect(page.getByRole('button', { name: 'Update Component 1' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading');
  await page.getByRole('button', { name: 'Bill of materials' }).click();
  await expect(bom.locator('tbody tr td').nth(3)).not.toHaveText(before ?? '');
});

test('standard parts go into holes as instances and are listed by designation', async ({ page }) => {
  await plateProject(page, 'Bracket');
  await cutHole(page);
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Component 1' }).click();
  await expect(page.getByTestId('instance-count')).toHaveText('1');
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading');

  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'From a library…' }).click();
  await page.locator('#library-search').fill('M6 16');
  await page.getByRole('list', { name: 'Library parts' }).getByRole('button', { name: 'ISO 4762 M6 × 16' }).click();
  const rim = await rimOf(page, 0, 'top');
  await page.mouse.click(rim.x, rim.y);
  await expect(page.getByTestId('library-hole')).toContainText('edge of Component 1 1');
  await page.getByRole('button', { name: 'Insert', exact: true }).last().click();
  await expect(page.getByTestId('instance-count')).toHaveText('2');
  await expect(page.getByRole('list', { name: 'Joints' })).toContainText('Revolute 1');
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading');
  await page.waitForTimeout(800);
  await evidence(page, 'phase-34-standard-parts');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Bill of materials' }).click();
  const line = page.getByRole('table', { name: 'Bill of materials' }).getByRole('row').filter({ hasText: 'ISO 4762 M6 × 16' });
  await expect(line).toContainText('Steel');
  await expect(line.locator('td').nth(1)).toHaveText('1');
});
