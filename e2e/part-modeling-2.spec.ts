import { expect, type Page, test } from '@playwright/test';
import { evidence, plateProject } from './support';

/** Phase 11 (Part modeling II) user journey: timeline, body operations, planes, loft and sweep, holes, draft. */
test.setTimeout(180_000);

const timelineNames = (page: Page) => page.getByRole('list', { name: 'Timeline' }).locator('.item-name').allTextContents();

test('rolls the timeline back, inserts a feature there and reorders it', async ({ page }) => {
  await plateProject(page, 'Timeline');
  const marker = page.getByRole('separator', { name: 'Rollback marker' });
  const extrude = page.getByRole('button', { name: 'Edit Extrude 1' });

  // Dragging the marker above the extrude rolls the plate away.
  await marker.dragTo(extrude, { targetPosition: { x: 20, y: 3 } });
  await expect(page.getByTestId('body-count')).toHaveText('0');
  await expect(page.locator('.item.rolled-back')).toHaveCount(1);

  // A construction plane added now goes in at the marker, before the extrude.
  await page.getByRole('button', { name: 'Construction plane', exact: true }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect.poll(() => timelineNames(page)).toEqual(['Sketch 1', 'Plane 1', 'Extrude 1']);

  // The arrow keys move the marker; the plate comes back.
  await marker.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('body-count')).toHaveText('1');
  await expect(page.locator('.item.rolled-back')).toHaveCount(0);

  // The plane moves to the top; the extrude cannot move above its sketch.
  await page.getByRole('button', { name: 'Edit Plane 1' }).dragTo(page.getByRole('button', { name: 'Edit Sketch 1' }), { targetPosition: { x: 20, y: 3 } });
  await expect.poll(() => timelineNames(page)).toEqual(['Plane 1', 'Sketch 1', 'Extrude 1']);
  await page.getByRole('button', { name: 'Edit Extrude 1' }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.getByRole('alert')).toContainText('Extrude 1 uses Sketch 1, so it has to come after it.');
  expect(await timelineNames(page)).toEqual(['Plane 1', 'Sketch 1', 'Extrude 1']);
  await evidence(page, '46-timeline');
});
