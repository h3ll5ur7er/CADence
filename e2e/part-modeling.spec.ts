import { readFileSync, statSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

/** Phase 3 (Part modeling) user journey: a parametric bracket, printed and exported. */
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const evidence = (page: Page, name: string) => page.screenshot({ path: `e2e/evidence/${name}.png` });

async function center(page: Page, selector: string, index = 0): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).nth(index).boundingBox();
  if (!box) throw new Error(`${selector} is not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function typeDimension(page: Page, value: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Dimension value' });
  await expect(input).toBeFocused();
  await input.fill(value);
  await input.press('Enter');
  await expect(input).toBeHidden();
}

/**
 * Where a named face or edge of the first body is on screen, using the viewport's own camera
 * (Angular's dev-mode `ng` global), so clicks land exactly on it.
 */
async function screenPositionOf(page: Page, kind: 'face' | 'edge', pattern: string): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ kind, pattern }) => {
      // Test-only introspection of Angular's dev-mode debug API and the viewport's three.js scene.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
      const viewport = ng.getComponent(document.querySelector('cad-viewport') as Element);
      const scene = viewport.scene();
      const mesh = viewport.bodies()[0];
      const regex = new RegExp(pattern);
      let point: number[];
      if (kind === 'face') {
        point = mesh.faces.find((f: { name: string }) => regex.test(f.name)).center;
      } else {
        const edge = mesh.edges.find((e: { name: string }) => regex.test(e.name));
        const p = mesh.edgePositions;
        point = [0, 1, 2].map((k) => (p[edge.start * 3 + k] + p[(edge.start + 1) * 3 + k]) / 2);
      }
      const v = new scene.camera.position.constructor(...point).project(scene.camera);
      const rect = scene.eventTarget.getBoundingClientRect();
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    },
    { kind, pattern },
  );
}

const volume = (page: Page) => page.getByTestId('body-volume').first();

test('a parametric bracket: extrude, hole on a face, pattern, fillet, exports', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Bracket');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);

  // A parameter drives the thickness.
  await page.getByRole('button', { name: /Parameters/ }).click();
  await page.getByRole('textbox', { name: 'New parameter name' }).fill('thickness');
  await page.getByRole('textbox', { name: 'New parameter expression' }).fill('6 mm');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('table', { name: 'Parameters' })).toContainText('6 mm');
  await page.getByRole('button', { name: 'Close parameters' }).click();

  // Base sketch: a 60 × 30 rectangle on the origin.
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'XY plane (top)' }).click();
  await page.waitForTimeout(500);
  const origin = await center(page, 'circle.point.origin');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.click(origin.x, origin.y);
  await page.mouse.click(origin.x + 240, origin.y - 120);
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.mouse.click(origin.x + 120, origin.y);
  await page.mouse.click(origin.x + 120, origin.y + 50);
  await typeDimension(page, '60');
  const right = await center(page, '.curve', 1);
  await page.mouse.click(right.x, right.y);
  await page.mouse.click(right.x + 80, right.y);
  await typeDimension(page, '30');
  await expect(page.getByTestId('sketch-status')).toHaveText('Fully constrained');
  await page.getByRole('button', { name: 'Finish sketch' }).click();

  // Extrude it by the parameter.
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await expect(page.getByTestId('profile-selection')).toHaveText('1 profile selected');
  await page.locator('#feature-distance').fill('thickness');
  await page.locator('#feature-distance').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1');
  await expect(volume(page)).toHaveText('10800.0 mm³');

  // A hole sketched on the top face, cut through.
  const top = await screenPositionOf(page, 'face', ':end$');
  await page.mouse.click(top.x, top.y);
  await expect(page.locator('.picked')).toContainText(':end');
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'Selected face' }).click();
  await page.waitForTimeout(600);
  const faceOrigin = await center(page, 'circle.point.origin');
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  await page.mouse.click(faceOrigin.x - 80, faceOrigin.y);
  await page.mouse.click(faceOrigin.x - 60, faceOrigin.y);
  await expect(page.getByTestId('profile-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.mouse.click(faceOrigin.x - 60, faceOrigin.y);
  await typeDimension(page, '8');
  await page.getByRole('button', { name: 'Finish sketch' }).click();
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await page.locator('#feature-distance').fill('thickness');
  await page.locator('#feature-distance').press('Tab');
  await page.locator('#feature-direction').selectOption('reverse');
  await page.locator('#feature-operation').selectOption('cut');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(volume(page)).toHaveText(`${(10800 - Math.PI * 16 * 6).toFixed(1)} mm³`);

  // Three holes in a row.
  await page.getByRole('button', { name: 'Linear pattern' }).click();
  await page.locator('#feature-spacing').fill('15');
  await page.locator('#feature-spacing').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(volume(page)).toHaveText(`${(10800 - 3 * Math.PI * 16 * 6).toFixed(1)} mm³`);

  // Round a vertical corner edge, seen from the home view.
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Fillet' }).click();
  await expect(page.getByTestId('edge-selection')).toHaveText('0 edges selected');
  const corner = await screenPositionOf(page, 'edge', '^e:f:[^|]*:side:[^|]*\\|f:[^|]*:side:');
  await page.mouse.click(corner.x, corner.y);
  await expect(page.getByTestId('edge-selection')).toHaveText('1 edge selected');
  await page.locator('#feature-size').fill('3');
  await page.locator('#feature-size').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Fillet 1');
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(600);
  await evidence(page, '13-part-bracket');

  // A thicker plate: every feature follows.
  await page.getByRole('button', { name: /Parameters/ }).click();
  await page.getByRole('textbox', { name: 'Expression of thickness' }).fill('10 mm');
  await page.getByRole('textbox', { name: 'Expression of thickness' }).press('Enter');
  await expect(page.getByRole('table', { name: 'Parameters' })).toContainText('10 mm');
  await page.getByRole('button', { name: 'Close parameters' }).click();
  await expect(page.locator('.item.failed')).toHaveCount(0);
  await evidence(page, '14-part-thicker');

  // Exports for printing and CAD.
  for (const [label, file] of [
    ['STEP (exact, for CAD)', 'bracket.step'],
    ['STL (for slicers)', 'bracket.stl'],
    ['3MF (for slicers)', 'bracket.3mf'],
  ] as const) {
    await page.getByRole('button', { name: 'Export' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: label }).click();
    await (await download).saveAs(`e2e/evidence/${file}`);
    expect(statSync(`e2e/evidence/${file}`).size).toBeGreaterThan(1000);
  }
  expect(readFileSync('e2e/evidence/bracket.step', 'utf8')).toContain('ISO-10303-21');
});
