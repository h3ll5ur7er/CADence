import { expect, type Page, test } from '@playwright/test';
import { center, evidence, fromModelMenu, plateProject, screenPositionOf, visiblePointOf } from './support';

/** Phase 11 (Part modeling II) user journey: timeline, body operations, planes, loft and sweep, holes, draft. */
test.setTimeout(180_000);

const number = async (page: Page, testId: string) => Number(((await page.getByTestId(testId).first().textContent()) ?? '').replace(/[^\d.]/g, ''));
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

test('copies, turns, scales and combines bodies', async ({ page }) => {
  await plateProject(page, 'Bodies');
  const bodies = page.getByTestId('body-count');

  // A copy 40 mm along Y, turned a quarter about Z.
  await fromModelMenu(page, 'Bodies', 'Move or copy bodies');
  await page.locator('#feature-move-x').fill('0');
  await page.locator('#feature-move-x').press('Tab');
  await page.locator('#feature-move-y').fill('80');
  await page.locator('#feature-move-y').press('Tab');
  await page.locator('#feature-angle').fill('90 deg');
  await page.locator('#feature-angle').press('Tab');
  await page.locator('#feature-copy').check();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(bodies).toHaveText('2');

  // The copy at half size, then joined into the plate where they touch? They do not: cut it from nothing, keep both.
  await fromModelMenu(page, 'Bodies', 'Scale bodies');
  await page.locator('#feature-factor').fill('0.5');
  await page.locator('#feature-factor').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Scale 1');

  await fromModelMenu(page, 'Bodies', 'Combine bodies');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(bodies).toHaveText('1');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  await evidence(page, '47-bodies');
});

test('places planes at an angle and midway, and exports chosen bodies with a mesh quality', async ({ page }) => {
  await plateProject(page, 'Planes');
  const plane = async (kind: string, fill: (page: Page) => Promise<void>) => {
    await page.getByRole('button', { name: 'Construction plane', exact: true }).click();
    await page.locator('#feature-plane-mode').selectOption(kind);
    await fill(page);
    await page.getByRole('button', { name: 'OK' }).click();
  };
  await plane('angle', async (p) => {
    await p.locator('#feature-angle').fill('30 deg');
    await p.locator('#feature-angle').press('Tab');
  });
  await plane('offset', async (p) => {
    await p.locator('#feature-offset').fill('40');
    await p.locator('#feature-offset').press('Tab');
  });
  await plane('midplane', async (p) => {
    await p.locator('#feature-second').selectOption({ label: 'Plane 2' });
  });
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Plane 3');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  await evidence(page, '48-planes');

  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'With options…' }).click();
  const form = page.getByRole('form', { name: 'Export options' });
  await form.locator('#export-quality').selectOption('fine');
  const download = page.waitForEvent('download');
  await form.getByRole('button', { name: 'Export' }).click();
  expect((await download).suggestedFilename()).toBe('Component 1.stl');
});

test('lofts from a rectangle to a circle on a plane above it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Loft');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);
  const draw = async (plane: string, tool: string, from: [number, number], to: [number, number]) => {
    await page.getByRole('button', { name: 'New sketch' }).click();
    await page.getByRole('menuitem', { name: plane }).click();
    await page.waitForTimeout(500);
    const origin = await center(page, 'circle.point.origin');
    await page.getByRole('button', { name: tool, exact: true }).click();
    for (const [dx, dy] of [from, to]) {
      await page.mouse.move(origin.x + dx, origin.y + dy);
      await page.mouse.click(origin.x + dx, origin.y + dy);
    }
    await expect(page.getByTestId('profile-count')).toHaveText('1');
    await page.getByRole('button', { name: 'Finish sketch' }).click();
  };
  await draw('XY plane (top)', 'Rectangle', [-80, 60], [80, -60]);
  await page.getByRole('button', { name: 'Construction plane', exact: true }).click();
  await page.locator('#feature-offset').fill('30');
  await page.locator('#feature-offset').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await draw('Plane 1', 'Circle', [0, 0], [40, 0]);

  await fromModelMenu(page, 'Create', 'Loft');
  await expect(page.getByTestId('section-count')).toHaveText('2 sections');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1');
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(800);
  await evidence(page, '49-loft');
});

test('drills counterbored holes at sketch points and threads one of them', async ({ page }) => {
  await plateProject(page, 'Holes');
  const volume = await number(page, 'body-volume');
  const top = await screenPositionOf(page, 'face', ':end$');
  await page.mouse.click(top.x, top.y);
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'Selected face' }).click();
  await page.waitForTimeout(600);
  const origin = await center(page, 'circle.point.origin');
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  for (const dx of [-60, 60]) {
    await page.mouse.move(origin.x + dx, origin.y);
    await page.mouse.click(origin.x + dx, origin.y);
  }
  await page.getByRole('button', { name: 'Finish sketch' }).click();

  await fromModelMenu(page, 'Create', 'Hole');
  await expect(page.getByTestId('point-count')).toHaveText('2 holes');
  await page.locator('#feature-hole-kind').selectOption('counterbore');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect.poll(() => number(page, 'body-volume')).toBeLessThan(volume - 300);

  // An M6 thread in the hole's wall (5 mm: the tap drill), picked looking in at an angle.
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  await fromModelMenu(page, 'Create', 'Thread');
  await expect(page.locator('#feature-thread-size')).toHaveValue('M6');
  const hole = await screenPositionOf(page, 'face', ':wall:');
  await page.mouse.move(hole.x, hole.y);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -300);
  await page.waitForTimeout(400);
  const wall = await visiblePointOf(page, ':wall:');
  await page.mouse.click(wall.x, wall.y);
  await expect(page.getByTestId('face-selection')).toHaveText('1 round face selected');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Thread 1');
  // Close up: the counterbores, and the thread shown as a helix in the hole.
  await page.mouse.move(wall.x, wall.y);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -300);
  await page.waitForTimeout(800);
  await evidence(page, '50-holes');
});

test('drafts a side face and stands a rib on the plate', async ({ page }) => {
  await plateProject(page, 'Draft and rib');
  const volume = await number(page, 'body-volume');

  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Draft', exact: true }).click();
  const side = await visiblePointOf(page, ':side:');
  await page.mouse.click(side.x, side.y);
  await expect(page.getByTestId('face-selection')).toHaveText('1 face to draft');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect.poll(() => number(page, 'body-volume')).toBeLessThan(volume);

  // A line across the top face, thickened and stood up as a rib.
  const top = await screenPositionOf(page, 'face', ':end$');
  await page.mouse.click(top.x, top.y);
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'Selected face' }).click();
  await page.waitForTimeout(600);
  const origin = await center(page, 'circle.point.origin');
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  for (const dx of [-90, 90]) {
    await page.mouse.move(origin.x + dx, origin.y + 10);
    await page.mouse.click(origin.x + dx, origin.y + 10);
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Finish sketch' }).click();
  const drafted = await number(page, 'body-volume');
  await fromModelMenu(page, 'Create', 'Rib');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await expect.poll(() => number(page, 'body-volume')).toBeGreaterThan(drafted + 100);
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(800);
  await evidence(page, '51-draft-rib');
});
