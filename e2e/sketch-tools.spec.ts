import { expect, type Page, test } from '@playwright/test';
import { center, evidence, plateProject } from './support';

/** Phase 9 (Sketcher tools) user journey: new shapes, editing, selection, patterns and projected edges. */
test.setTimeout(150_000);

async function newSketch(page: Page, name: string): Promise<{ x: number; y: number }> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'XY plane (top)' }).click();
  await page.waitForTimeout(500);
  return center(page, 'circle.point.origin');
}

async function clicks(page: Page, points: readonly (readonly [number, number])[]): Promise<void> {
  for (const [x, y] of points) {
    await page.mouse.move(x, y);
    await page.mouse.click(x, y);
  }
}

const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();

/** A tool from the Shapes or Modify menu of the sketch toolbar. */
async function fromMenu(page: Page, menu: 'Shapes' | 'Modify', name: string): Promise<void> {
  await page.getByRole('button', { name: menu, exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

test('draw slots, polygons, ellipses and splines; fillet, trim, copy, mirror and pattern them', async ({ page }) => {
  const o = await newSketch(page, 'Sketch tools');
  const profiles = page.getByTestId('profile-count');

  await fromMenu(page, 'Shapes', 'Slot');
  await clicks(page, [[o.x + 60, o.y - 70], [o.x + 180, o.y - 70], [o.x + 120, o.y - 95]]);
  await expect(profiles).toHaveText('1');

  await fromMenu(page, 'Shapes', 'Polygon');
  await expect(page.getByRole('spinbutton', { name: 'Polygon sides' })).toHaveValue('6');
  await clicks(page, [[o.x - 150, o.y - 150], [o.x - 100, o.y - 150]]);
  await expect(profiles).toHaveText('2');

  await fromMenu(page, 'Shapes', 'Ellipse');
  await clicks(page, [[o.x - 150, o.y + 110], [o.x - 80, o.y + 110], [o.x - 150, o.y + 140]]);
  await expect(profiles).toHaveText('3');

  // A closed spline: back on its first point.
  await fromMenu(page, 'Shapes', 'Spline');
  await clicks(page, [[o.x + 60, o.y + 60], [o.x + 170, o.y + 70], [o.x + 150, o.y + 160], [o.x + 70, o.y + 150], [o.x + 60, o.y + 60]]);
  await expect(profiles).toHaveText('4');

  // A rectangle with one corner rounded.
  await tool(page, 'Rectangle');
  await clicks(page, [[o.x + 230, o.y - 40], [o.x + 330, o.y + 40]]);
  await expect(profiles).toHaveText('5');
  const curves = page.locator('.curve');
  const before = await curves.count();
  await fromMenu(page, 'Modify', 'Sketch fillet');
  await page.getByRole('spinbutton', { name: 'Fillet radius' }).fill('3');
  await page.getByRole('spinbutton', { name: 'Fillet radius' }).press('Tab');
  await clicks(page, [[o.x + 330, o.y + 40]]);
  await expect(curves).toHaveCount(before + 1);
  await expect(page.locator('.error, [role=alert]')).toHaveCount(0);

  // Box selection (left to right: what lies inside) of the polygon, copied and pasted at the pointer.
  await tool(page, 'Select and drag');
  await page.mouse.move(o.x - 215, o.y - 215);
  await page.mouse.down();
  await page.mouse.move(o.x - 120, o.y - 160, { steps: 4 });
  await page.mouse.move(o.x - 80, o.y - 85, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.curve.selected')).toHaveCount(7); // six sides and the construction circle
  await page.keyboard.press('Control+c');
  await page.mouse.move(o.x - 150, o.y + 250);
  await page.keyboard.press('Control+v');
  await expect(profiles).toHaveText('6');

  // A vertical line, and the slot mirrored across it.
  await page.keyboard.press('Escape');
  await tool(page, 'Line');
  await clicks(page, [[o.x + 210, o.y - 130], [o.x + 210, o.y - 10]]);
  await page.keyboard.press('Escape');
  await tool(page, 'Select and drag');
  await page.mouse.move(o.x + 20, o.y - 125);
  await page.mouse.down();
  await page.mouse.move(o.x + 225, o.y - 40, { steps: 6 }); // the line reaches outside the box, so only the slot is inside
  await page.mouse.up();
  await expect(page.locator('.curve.selected')).toHaveCount(4);
  await fromMenu(page, 'Modify', 'Mirror the selection across a line');
  await clicks(page, [[o.x + 210, o.y - 120]]);
  await expect(profiles).toHaveText('7');

  // Trim: a line through a circle, then the circle's upper half cut away.
  await tool(page, 'Circle');
  await clicks(page, [[o.x - 20, o.y + 250], [o.x + 20, o.y + 250]]);
  await tool(page, 'Line');
  await clicks(page, [[o.x - 60, o.y + 250], [o.x + 60, o.y + 250]]);
  await page.keyboard.press('Escape');
  await expect(profiles).toHaveText('9'); // the circle's two halves
  await fromMenu(page, 'Modify', 'Trim');
  await clicks(page, [[o.x, o.y + 210]]);
  await expect(profiles).toHaveText('8');

  await tool(page, 'Select and drag');
  await page.mouse.move(o.x + 400, o.y + 300);
  await page.waitForTimeout(300);
  await evidence(page, '39-sketch-tools');
  await page.getByRole('button', { name: 'Finish sketch' }).click();
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).not.toHaveText('0');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  await evidence(page, '40-sketch-tools-extruded');
});

test('projects the outline of a face into a sketch', async ({ page }) => {
  await plateProject(page, 'Projected');
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'XY plane (top)' }).click();
  await page.waitForTimeout(600);
  await fromMenu(page, 'Shapes', 'Project edges or faces of bodies');
  // Looking straight down on the plate: its top face is under the middle of its outline.
  const plate = await page.locator('cad-viewport').boundingBox();
  if (!plate) throw new Error('no viewport');
  const origin = await center(page, 'circle.point.origin');
  await page.mouse.move(origin.x + 40, origin.y - 20);
  await page.mouse.click(origin.x + 40, origin.y - 20);
  await expect(page.locator('.curve.projected')).toHaveCount(4);
  await expect(page.getByTestId('profile-count')).toHaveText('1');
  await expect(page.locator('.areas')).toContainText('1,800 mm²');
  await expect(page.getByTestId('sketch-status')).toHaveText('Fully constrained');
  await evidence(page, '41-projected-face');
});
