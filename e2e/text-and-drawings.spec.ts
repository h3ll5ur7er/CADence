import { expect, type Page, test } from '@playwright/test';
import { center, evidence, plateProject, screenPositionOf } from './support';

/** Phase 10 (Text and drawings) user journey: text engraved into a face; a drawing with text inserted as one piece and scaled. */
test.setTimeout(150_000);

const number = async (page: Page, testId: string) => Number(((await page.getByTestId(testId).first().textContent()) ?? '').replace(/[^\d.]/g, ''));

test('engraves text into the face of a plate', async ({ page }) => {
  await plateProject(page, 'Engraved');
  const volume = await number(page, 'body-volume');
  const top = await screenPositionOf(page, 'face', ':end$');
  await page.mouse.click(top.x, top.y);
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'Selected face' }).click();
  await page.waitForTimeout(600);

  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Text', exact: true }).click();
  await page.getByRole('textbox', { name: 'Text to place' }).fill('CAD');
  await page.getByRole('spinbutton', { name: 'Text height' }).fill('8');
  await page.getByRole('spinbutton', { name: 'Text height' }).press('Tab');
  const origin = await center(page, 'circle.point.origin');
  await page.mouse.move(origin.x - 50, origin.y + 20);
  await page.mouse.click(origin.x - 50, origin.y + 20);
  // C, A and D, the counters of A and D as profiles of their own.
  await expect(page.getByTestId('profile-count')).toHaveText('5');
  await page.getByRole('button', { name: 'Select and drag', exact: true }).click();
  await evidence(page, '42-text-sketch');

  await page.getByRole('button', { name: 'Finish sketch' }).click();
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await expect(page.getByTestId('profile-selection')).toHaveText('3 profiles selected');
  await page.locator('#feature-distance').fill('1');
  await page.locator('#feature-distance').press('Tab');
  await page.locator('#feature-direction').selectOption('reverse');
  await page.locator('#feature-operation').selectOption('cut');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect.poll(() => number(page, 'body-volume')).toBeLessThan(volume - 50);
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(800);
  await evidence(page, '43-text-engraved');
});

test('imports a drawing with text and inserts it as one piece that scales by its handle', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Sign');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);

  // The SVG's text stays text: shown with the bundled font.
  await page.getByLabel('Import', { exact: true }).setInputFiles('e2e/fixtures/sign.svg');
  await expect(page.getByTestId('mode')).toHaveText('Imported');
  await expect(page.getByTestId('imported-size')).toHaveText('60, 20, 0 mm');
  await page.waitForTimeout(800);
  await evidence(page, '44-imported-text');

  await page.getByRole('link', { name: 'Component 1' }).click();
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'XY plane (top)' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Insert drawing' }).click();
  await expect(page.getByRole('combobox', { name: 'Insert as' })).toHaveValue('piece');
  await page.getByRole('menuitem', { name: 'sign (SVG)' }).click();
  // The plate around its hole and letters, the hole, C, A and D with their counters.
  await expect(page.getByTestId('profile-count')).toHaveText('7');
  await expect(page.locator('circle.point.handle')).toHaveCount(2);

  // Dragging the handle at the bottom right outwards: the whole sign grows, in proportion.
  await page.getByRole('button', { name: 'Select and drag', exact: true }).click();
  // The sign's size on screen: the box of its largest profile, the plate.
  const size = () =>
    page.locator('path.profile').evaluateAll((paths) => {
      const boxes = paths.map((p) => p.getBoundingClientRect());
      return { width: Math.max(...boxes.map((b) => b.width)), height: Math.max(...boxes.map((b) => b.height)) };
    });
  const before = await size();
  const [origin, handle] = [await center(page, 'circle.point.handle', 0), await center(page, 'circle.point.handle', 1)];
  const [from, to] = origin.x < handle.x ? [handle, origin] : [origin, handle];
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (from.x - to.x) * 0.25, from.y, { steps: 5 });
  await page.mouse.move(from.x + (from.x - to.x) * 0.5, from.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await size()).width / before.width).toBeCloseTo(1.5, 1);
  expect((await size()).height / before.height).toBeCloseTo(1.5, 1);
  await expect(page.getByTestId('profile-count')).toHaveText('7');
  await page.mouse.move(10, 10);
  await evidence(page, '45-drawing-one-piece');

  await page.getByRole('button', { name: 'Finish sketch' }).click();
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1');
});
