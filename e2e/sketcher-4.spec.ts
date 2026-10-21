import { expect, type Page, test } from '@playwright/test';
import { center, evidence, fromModelMenu, screenPositionOf, typeDimension } from './support';

/** Phase 35 (Sketcher IV) user journey: reference dimensions, sketch blocks, and sketches wrapped onto curved faces. */
test.setTimeout(240_000);

async function newProject(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);
}

/** Where a point of the edited sketch (mm) is on screen, through the sketch editor's plane matrix. */
async function sketchPoint(page: Page, [u, v]: [number, number]): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([u, v]) => {
      // Test-only introspection of Angular's dev-mode debug API.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
      const editor = document.querySelector('cad-sketch-editor') as Element;
      const m = ng.getComponent(editor).matrix();
      const rect = (editor.querySelector('svg') as SVGSVGElement).getBoundingClientRect();
      return { x: rect.left + m.a * u + m.c * v + m.e, y: rect.top + m.b * u + m.d * v + m.f };
    },
    [u, v] as const,
  );
}

async function newSketch(page: Page, plane: string): Promise<{ x: number; y: number }> {
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: plane }).click();
  await page.waitForTimeout(500);
  return center(page, 'circle.point.origin');
}

test('shows a measured value in brackets that follows the sketch, offered when a dimension would over-constrain', async ({ page }) => {
  await newProject(page, 'Reference dimensions');
  const origin = await newSketch(page, 'XY plane (top)');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.click(origin.x, origin.y);
  await page.mouse.click(origin.x + 240, origin.y - 120);
  await page.getByRole('button', { name: 'Fully define' }).click();
  const status = page.getByTestId('sketch-status');
  await expect(status).toHaveText('Fully constrained');

  // A second length of the bottom side would over-constrain: it is offered as a reference instead.
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.mouse.click(origin.x + 120, origin.y);
  await page.mouse.click(origin.x + 120, origin.y + 60);
  await page.getByRole('button', { name: 'Add as a reference dimension' }).click();
  const reference = page.locator('g.dimension.reference text');
  await expect(reference).toHaveText(/^\(\d+(\.\d+)?\)$/);
  await expect(status).toHaveText('Fully constrained');

  // The width it measures changes with the driving dimension of the same side.
  const width = await page.locator('g.dimension.reference text').textContent();
  await page.locator('g.dimension:not(.reference) text', { hasText: (width ?? '').replace(/[()]/g, '') }).click();
  await typeDimension(page, '80');
  await expect(reference).toHaveText('(80)');
  await page.getByRole('button', { name: 'Select and drag', exact: true }).click();
  await reference.click();
  await expect(page.getByTestId('dimension-value')).toHaveText('(80 mm)');
  await page.getByRole('textbox', { name: 'Name of the reference dimension' }).fill('width');
  await page.getByRole('textbox', { name: 'Name of the reference dimension' }).press('Enter');
  await evidence(page, 'phase-35-reference-dimension');

  // Parameters read it by its name.
  await page.getByRole('button', { name: 'Finish sketch' }).click();
  await page.getByRole('button', { name: /Parameters/ }).click();
  await expect(page.getByRole('table', { name: 'Measured in sketches' })).toContainText('80 mm');
  await page.getByRole('textbox', { name: 'New parameter name' }).fill('half');
  await page.getByRole('textbox', { name: 'New parameter expression' }).fill('width / 2');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Parameters', exact: true })).toContainText('40 mm');
  await evidence(page, 'phase-35-reference-parameter');
});

test('makes a block of a selection, places it twice and edits it once', async ({ page }) => {
  await newProject(page, 'Slot blocks');
  const origin = await newSketch(page, 'XY plane (top)');
  // A slot-like rectangle up and to the right of the origin.
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.click(origin.x + 40, origin.y - 40);
  await page.mouse.click(origin.x + 200, origin.y - 100);
  await page.getByRole('button', { name: 'Select and drag', exact: true }).click();
  // A box from left to right selects what lies inside it.
  await page.mouse.move(origin.x + 20, origin.y - 120);
  await page.mouse.down();
  await page.mouse.move(origin.x + 220, origin.y - 20, { steps: 5 });
  await page.mouse.up();

  await page.getByRole('button', { name: 'Blocks', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Make a block of the selection…' }).click();
  // Its insertion point: the bottom left corner.
  await page.mouse.click(origin.x + 40, origin.y - 40);
  await expect(page.getByRole('button', { name: 'Edit Block 1' })).toBeVisible();
  await expect(page.getByTestId('profile-count')).toHaveText('1');

  // Placed again, down to the left.
  const second = { x: origin.x - 330, y: origin.y + 60 };
  await page.getByRole('button', { name: 'Blocks', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Place Block 1' }).click();
  await page.mouse.click(second.x, second.y);
  await expect(page.getByTestId('profile-count')).toHaveText('2');
  await page.getByRole('button', { name: 'Select and drag', exact: true }).click();
  // Its bottom side.
  await page.mouse.click(second.x + 80, second.y);
  await expect(page.getByText('Placed block')).toBeVisible();
  await page.getByRole('textbox', { name: 'Angle of the placed block' }).fill('30 deg');
  await page.getByRole('textbox', { name: 'Angle of the placed block' }).press('Tab');
  await evidence(page, 'phase-35-blocks');
  const areas = page.locator('ul.areas li');
  const before = await areas.allTextContents();

  // Edited once, in the block: both placements follow.
  await page.getByRole('button', { name: 'Edit the block' }).click();
  await page.getByRole('button', { name: 'Fully define' }).click();
  const width = page.locator('g.dimension text').first();
  await width.click();
  await typeDimension(page, '60');
  await page.getByRole('button', { name: 'Finish sketch' }).click();
  await page.getByRole('button', { name: 'Edit Sketch 1' }).click();
  await expect(areas).toHaveCount(2);
  const after = await areas.allTextContents();
  expect(after[0]).toBe(after[1]);
  expect(after).not.toEqual(before);
  await evidence(page, 'phase-35-blocks-edited');

  // Exploded, a placement is plain curves. Its bottom side now runs up at 30°.
  await page.mouse.click(second.x + 50 * Math.cos(Math.PI / 6), second.y - 50 * Math.sin(Math.PI / 6));
  await page.getByRole('button', { name: 'Explode' }).click();
  await expect(page.getByTestId('profile-count')).toHaveText('2');
});

test('embosses text wrapped round a cylinder', async ({ page }) => {
  await newProject(page, 'Knob');
  const origin = await newSketch(page, 'XY plane (top)');
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  await page.mouse.click(origin.x, origin.y);
  await page.mouse.click(origin.x + 120, origin.y);
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.mouse.click(origin.x + 120, origin.y);
  await typeDimension(page, '30');
  await page.getByRole('button', { name: 'Finish sketch' }).click();
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await page.locator('#feature-distance').fill('24');
  await page.locator('#feature-distance').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1');

  // Letters on the front plane, along the cylinder's axis.
  await newSketch(page, 'XZ plane (front)');
  await page.getByRole('button', { name: 'Shapes' }).click();
  await page.getByRole('menuitem', { name: 'Text' }).click();
  await page.getByRole('textbox', { name: 'Text to place' }).fill('CADENCE');
  await page.getByRole('spinbutton', { name: 'Text height' }).fill('4');
  await page.getByRole('spinbutton', { name: 'Text height' }).press('Tab');
  // The baseline starts 13 mm left of the axis, 10 mm up: placed on the cylinder's front, round it.
  const start = await sketchPoint(page, [-13, 10]);
  await page.mouse.click(start.x, start.y);
  await expect(page.getByTestId('profile-count')).not.toHaveText('0');
  await page.getByRole('button', { name: 'Finish sketch' }).click();

  await fromModelMenu(page, 'Create', 'Wrap');
  await expect(page.getByTestId('profile-selection')).not.toHaveText('0 profiles selected');
  await page.getByRole('button', { name: 'Pick the face' }).click();
  // Under load the view may still be settling when the face is first clicked: click until it is picked.
  const picked = page.getByTestId('face-selection');
  await expect(async () => {
    // A second click would take the face back off: click only while none is picked.
    if ((await picked.textContent())?.trim() !== '1 face to wrap onto') {
      const side = await screenPositionOf(page, 'face', ':side:');
      await page.mouse.click(side.x, side.y);
    }
    await expect(picked).toHaveText('1 face to wrap onto', { timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await page.locator('#feature-depth').fill('0.8');
  await page.locator('#feature-depth').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  const wrap = page.getByRole('button', { name: 'Edit Wrap 1' });
  await expect(wrap).toBeVisible();
  await expect(wrap.locator('[data-status="failed"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Front view' }).dispatchEvent('click');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await page.waitForTimeout(800);
  await evidence(page, 'phase-35-wrap-emboss');

  // Engraved instead: the letters are cut into the round face.
  await wrap.click();
  await page.locator('#feature-wrap-operation').selectOption('engrave');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(wrap.locator('[data-status="failed"]')).toHaveCount(0);
  await page.waitForTimeout(800);
  await evidence(page, 'phase-35-wrap-engrave');
});
