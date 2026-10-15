import { expect, type Page, test } from '@playwright/test';
import { evidence, plateProject } from './support';

/** Phase 8 (Viewport) user journey: framing, projection, vertices, section view, looks, shortcuts and control schemes. */
test.setTimeout(150_000);

/** The viewport's camera and target, read through Angular's dev-mode debug API. */
async function camera(page: Page): Promise<{ target: number[]; orthographic: boolean }> {
  return page.evaluate(() => {
    // Test-only introspection of the viewport's scene.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
    const scene = ng.getComponent(document.querySelector('cad-viewport') as Element).scene();
    return { target: scene.controls.target.toArray(), orthographic: scene.camera.isOrthographicCamera === true };
  });
}

/** Where a point of the model is on screen. */
async function screenPointOf(page: Page, point: [number, number, number]): Promise<{ x: number; y: number }> {
  return page.evaluate((point) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
    const scene = ng.getComponent(document.querySelector('cad-viewport') as Element).scene();
    const v = scene.camera.position.clone().set(...point).project(scene.camera);
    const rect = scene.eventTarget.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }, point);
}

test('fit, orthographic, vertices, section, looks, shortcuts and control schemes', async ({ page }) => {
  await plateProject(page, 'Viewing');
  const viewport = page.locator('cad-viewport');

  // Zoom to fit frames the plate from the current direction.
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await page.waitForTimeout(600);
  expect((await camera(page)).target.map((v) => Math.round(v))).toEqual([30, 15, 3]);

  // Orthographic by key (O), and back by button.
  await page.keyboard.press('o');
  await expect(viewport).toHaveAttribute('data-projection', 'orthographic');
  expect((await camera(page)).orthographic).toBe(true);
  await page.waitForTimeout(400);
  await evidence(page, '33-orthographic');

  // Measuring between two corners of the top face (M opens the measure panel).
  await page.keyboard.press('m');
  await expect(page.getByRole('heading', { name: 'Measure' })).toBeVisible();
  for (const corner of [[0, 0, 6], [60, 30, 6]] as [number, number, number][]) {
    const at = await screenPointOf(page, corner);
    await page.mouse.move(at.x + 2, at.y + 1);
    await page.mouse.click(at.x + 2, at.y + 1);
  }
  await expect(page.locator('.picks li')).toHaveCount(2);
  await expect(page.locator('.picks')).toContainText('Vertex of Extrude 1');
  await expect(page.getByTestId('measure-distance')).toHaveText(`${Math.hypot(60, 30).toFixed(3)} mm`);
  await evidence(page, '34-measure-vertices');
  await page.keyboard.press('m');
  await page.getByRole('button', { name: 'Perspective view' }).click();
  await expect(viewport).toHaveAttribute('data-projection', 'perspective');

  // A section through the middle, on the front plane.
  await page.getByRole('button', { name: 'Section view' }).click();
  await expect(viewport).toHaveAttribute('data-section', 'on');
  await expect(page.locator('#section-plane')).toHaveValue('XZ');
  await expect(page.getByTestId('section-offset')).toHaveText('15.0 mm');
  await page.locator('#section-plane').selectOption('YZ');
  await expect(page.getByTestId('section-offset')).toHaveText('30.0 mm');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await page.waitForTimeout(600);
  await evidence(page, '35-section');
  await page.keyboard.press('Shift+X');
  await expect(viewport).toHaveAttribute('data-section', 'off');

  // Colour, transparency and visibility of the body, each one undoable step.
  await page.getByRole('textbox', { name: 'Colour of Extrude 1' }).or(page.getByLabel('Colour of Extrude 1')).fill('#d9480f');
  await page.getByLabel('Opacity of Extrude 1').evaluate((input: HTMLInputElement) => {
    input.value = '0.6';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const swatch = page.getByRole('list', { name: 'Body visibility' }).locator('.swatch');
  await expect(swatch).toHaveCSS('background-color', 'rgb(217, 72, 15)');
  await expect(swatch).toHaveCSS('opacity', '0.6');
  await page.waitForTimeout(400);
  await evidence(page, '36-body-look');
  await page.getByRole('button', { name: 'Hide Extrude 1' }).click();
  await expect(page.getByRole('button', { name: 'Show Extrude 1' })).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: 'Hide Extrude 1' })).toBeVisible();

  // The shortcut reference (?), and another control scheme.
  await page.keyboard.press('?');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('region', { name: 'Part modeling shortcuts' })).toContainText('Extrude');
  await settings.locator('#settings-controls').selectOption('onshape');
  await expect(settings.getByRole('region', { name: 'Part modeling shortcuts' })).toContainText('Shift+E');
  await expect(settings.getByRole('definition').filter({ hasText: 'Right drag' }).first()).toBeVisible();
  await evidence(page, '37-shortcuts');
  await settings.getByRole('button', { name: 'Close settings' }).click();
  await page.keyboard.press('e'); // nothing in Onshape style
  await expect(page.locator('form.dialog')).toBeHidden();
  await page.keyboard.press('Shift+E');
  await expect(page.getByRole('heading', { name: 'New extrude' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('form.dialog')).toBeHidden();

  // An assembly instance in its own colour, then hidden.
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Component 1' }).click();
  await page.getByRole('button', { name: 'Select Component 1 1' }).click();
  await page.getByLabel('Colour of Component 1 1').fill('#1971c2');
  await page.getByLabel('Colour of Component 1 1').blur(); // shortcuts never fire while a field has focus
  await page.keyboard.press('f'); // Onshape style: zoom to fit
  await page.waitForTimeout(600);
  await evidence(page, '38-instance-look');
  await page.getByRole('button', { name: 'Hide Component 1 1' }).click();
  await expect(page.getByRole('button', { name: 'Show Component 1 1' })).toBeVisible();
});
