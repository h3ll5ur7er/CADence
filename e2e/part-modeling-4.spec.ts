import { expect, type Page, test } from '@playwright/test';
import { center, evidence, fromModelMenu, plateProject, screenPositionOf, topPoints, typeDimension } from './support';

/** Phase 36 (Part modeling IV) user journey: ribs up to the next face, drill points, nested folders, repairs by shape, a material per body. */
test.setTimeout(180_000);

/** The numbers the bodies' rows show for `testId`, added up (`1,234.5 mm³`, `84.78 g`). */
const total = async (page: Page, testId: string) =>
  (await page.getByTestId(testId).allTextContents()).reduce((sum, text) => sum + Number(text.replace(/[^\d.]/g, '')), 0);

const timelineNames = (page: Page) => page.getByRole('list', { name: 'Timeline' }).locator('.item .item-name').allTextContents();

test('runs a rib up to the next face, and ends a blind hole in a drill point (CAD-156)', async ({ page }) => {
  await plateProject(page, 'Ribs and drill points');

  // A 40 mm line on the plate's top face, then a copy of the plate 30 mm above it.
  const top = await screenPositionOf(page, 'face', ':end$');
  await page.mouse.click(top.x, top.y);
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'Selected face' }).click();
  await page.waitForTimeout(600);
  const origin = await center(page, 'circle.point.origin');
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  for (const dx of [-90, 90]) {
    await page.mouse.move(origin.x + dx, origin.y + 20);
    await page.mouse.click(origin.x + dx, origin.y + 20);
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.mouse.click(origin.x + 40, origin.y + 20);
  await page.mouse.click(origin.x + 40, origin.y + 60);
  await typeDimension(page, '40');
  await page.getByRole('button', { name: 'Finish sketch' }).click();

  await fromModelMenu(page, 'Bodies', 'Move or copy bodies');
  await page.locator('#feature-move-x').fill('0');
  await page.locator('#feature-move-x').press('Tab');
  await page.locator('#feature-move-z').fill('30');
  await page.locator('#feature-move-z').press('Tab');
  await page.locator('#feature-copy').check();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('2');
  const plates = 2 * 60 * 30 * 6;
  await expect.poll(() => total(page, 'body-volume')).toBeCloseTo(plates, 0);

  // The rib fills the 24 mm gap between the plates: 40 × 2 × 24.
  await fromModelMenu(page, 'Create', 'Rib');
  await page.locator('#feature-sketch').selectOption({ label: 'Sketch 2' });
  await page.locator('#feature-rib-extent').selectOption('next');
  await expect(page.locator('#feature-depth')).toBeHidden();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect.poll(() => total(page, 'body-volume')).toBeCloseTo(plates + 40 * 2 * 24, 0);
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(800);
  await evidence(page, 'phase-36-rib-up-to-next-face');
});

test('drills a blind hole that ends in a 118° drill point (CAD-156)', async ({ page }) => {
  await plateProject(page, 'Drill point');
  await topPoints(page, [0]);
  const volume = await total(page, 'body-volume');
  await fromModelMenu(page, 'Create', 'Hole');
  await page.locator('#feature-extent').selectOption('blind');
  await page.locator('#feature-depth').fill('3');
  await page.locator('#feature-depth').press('Tab');
  await page.locator('#feature-drill-point').check();
  await expect(page.locator('#feature-point-angle')).toHaveValue('118 deg');
  await evidence(page, 'phase-36-drill-point');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  // ⌀5 to a depth of 3, then the cone: r / tan 59° deep.
  const tip = 2.5 / Math.tan((59 * Math.PI) / 180);
  await expect.poll(() => total(page, 'body-volume')).toBeCloseTo(volume - Math.PI * 6.25 * 3 - (Math.PI * 6.25 * tip) / 3, 0);
});

test('nests folders in folders, closes and moves them with what they hold (CAD-157)', async ({ page }) => {
  await plateProject(page, 'Nested folders');
  const timeline = page.getByRole('list', { name: 'Timeline' });
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Construction plane', exact: true }).click();
    await page.getByRole('button', { name: 'OK' }).click();
  }
  await expect.poll(() => timelineNames(page)).toEqual(['Sketch 1', 'Extrude 1', 'Plane 1', 'Plane 2']);
  const folder = async (name: string, first: string, last: string) => {
    await page.getByRole('button', { name: 'New folder' }).click();
    await page.locator('#folder-name').fill(name);
    await page.locator('#folder-first').selectOption({ label: first });
    await page.locator('#folder-last').selectOption({ label: last });
    await page.getByRole('button', { name: 'OK' }).click();
  };
  await folder('Planes', 'Plane 1', 'Plane 2');
  // A folder holding part of another is refused; one holding all of it is its outer folder.
  await folder('Across', 'Extrude 1', 'Plane 1');
  await expect(page.getByRole('alert').filter({ hasText: 'A folder holds whole folders or none of them: this one would hold part of Planes.' })).toBeVisible();
  await expect(timeline.getByRole('button', { name: /Across/ })).toHaveCount(0);
  await folder('Part', 'Sketch 1', 'Plane 2');
  const depth = (locator: ReturnType<Page['locator']>) => locator.evaluate((e) => getComputedStyle(e).getPropertyValue('--depth').trim());
  const planesRow = timeline.locator('li.folder', { hasText: 'Planes' });
  await expect.poll(() => depth(planesRow)).toBe('1');
  await expect.poll(() => depth(timeline.locator('li.item', { hasText: 'Plane 2' }))).toBe('2');
  await evidence(page, 'phase-36-nested-folders');

  // Closing the outer folder hides the inner one with its items.
  await timeline.getByRole('button', { name: 'Close Part' }).click();
  await expect(planesRow).toBeHidden();
  await expect(page.getByRole('button', { name: 'Edit Plane 1' })).toBeHidden();
  await timeline.getByRole('button', { name: 'Open Part' }).click();
  await expect(planesRow).toBeVisible();

  // Alt+↑ moves the planes' folder above the extrude, still in the outer folder; once more, out of it.
  await timeline.getByRole('button', { name: 'Close Planes' }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(() => timelineNames(page)).toEqual(['Sketch 1', 'Plane 1', 'Plane 2', 'Extrude 1']);
  await expect.poll(() => depth(planesRow)).toBe('1');
  await timeline.getByRole('button', { name: 'Close Planes' }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(() => timelineNames(page)).toEqual(['Plane 1', 'Plane 2', 'Sketch 1', 'Extrude 1']);
  await expect.poll(() => depth(planesRow)).toBe('0');
});

test('offers the same-shaped edge to repair a fillet (CAD-157)', async ({ page }) => {
  await plateProject(page, 'Repair by shape');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  const edge = await screenPositionOf(page, 'edge', '^e:f:[^|]*:side:[^|]*\\|f:[^|]*:side:');
  const pick = async () => {
    const selection = page.getByTestId('edge-selection');
    await expect(async () => {
      if ((await selection.textContent())?.trim() !== '1 edge selected') await page.mouse.click(edge.x, edge.y);
      await expect(selection).toHaveText('1 edge selected', { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
  };
  await page.getByRole('button', { name: 'Fillet' }).click();
  await pick();
  await page.locator('#feature-size').fill('0.5');
  await page.locator('#feature-size').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Fillet 1');
  // A chamfer put in before the fillet takes its edge away.
  const marker = page.getByRole('separator', { name: 'Rollback marker' });
  await marker.focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.item.rolled-back')).toHaveCount(1);
  await page.getByRole('button', { name: 'Chamfer' }).click();
  await pick();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Chamfer 1');
  await marker.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.item.failed')).toHaveCount(1);

  await page.getByRole('button', { name: 'Repair Fillet 1' }).click();
  const lost = page.getByRole('list', { name: 'Lost references' });
  const same = lost.getByRole('button', { name: /Use the same-shaped edge/ });
  await expect(same).toBeVisible();
  await evidence(page, 'phase-36-repair-by-shape');
  await same.click();
  await expect(page.getByTestId('nothing-lost')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
});

test('weighs a steel body next to a PLA one (CAD-158)', async ({ page }) => {
  await plateProject(page, 'Body materials');
  await fromModelMenu(page, 'Bodies', 'Move or copy bodies');
  await page.locator('#feature-move-y').fill('40');
  await page.locator('#feature-move-y').press('Tab');
  await page.locator('#feature-copy').check();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('2');

  const plate = 60 * 30 * 6;
  const masses = page.getByTestId('body-mass');
  await expect(masses).toHaveText([`${((plate * 1.24) / 1000).toFixed(2)} g`, `${((plate * 1.24) / 1000).toFixed(2)} g`]);
  const choices = page.getByRole('combobox', { name: /^Material of / });
  await expect(choices.nth(1)).toHaveValue('');
  await choices.nth(1).selectOption('Steel');
  await expect(masses).toHaveText([`${((plate * 1.24) / 1000).toFixed(2)} g`, `${((plate * 7.85) / 1000).toFixed(2)} g`]);
  // The component's material still sets the other body.
  await page.locator('#component-material').selectOption('PETG');
  await expect(masses).toHaveText([`${((plate * 1.27) / 1000).toFixed(2)} g`, `${((plate * 7.85) / 1000).toFixed(2)} g`]);
  await expect(choices.nth(0).locator('option:checked')).toHaveText('As the component (PETG)');
  await evidence(page, 'phase-36-body-material');
  await choices.nth(1).selectOption('');
  await expect(masses).toHaveText([`${((plate * 1.27) / 1000).toFixed(2)} g`, `${((plate * 1.27) / 1000).toFixed(2)} g`]);
});
