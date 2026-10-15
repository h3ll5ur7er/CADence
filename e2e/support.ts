import { expect, type Page } from '@playwright/test';

/** Helpers shared by the user journeys. */

export const evidence = (page: Page, name: string) => page.screenshot({ path: `e2e/evidence/${name}.png` });

/** Volumes and areas as the properties panel shows them: thousands separated, at most two decimals. */
export const shown = (value: number, unit: string) =>
  `${Number(value.toFixed(2)).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${unit}`;

export async function center(page: Page, selector: string, index = 0): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).nth(index).boundingBox();
  if (!box) throw new Error(`${selector} is not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function typeDimension(page: Page, value: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Dimension value' });
  await expect(input).toBeFocused();
  await input.fill(value);
  await input.press('Enter');
  await expect(input).toBeHidden();
}

/**
 * Where a named face or edge of the first body is on screen, using the viewport's own camera
 * (Angular's dev-mode `ng` global), so clicks land exactly on it. `pattern` is a regular expression
 * on the persistent name; of several matches, the one nearest the camera wins.
 */
export async function screenPositionOf(page: Page, kind: 'face' | 'edge', pattern: string): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ kind, pattern }) => {
      // Test-only introspection of Angular's dev-mode debug API and the viewport's three.js scene.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
      const viewport = ng.getComponent(document.querySelector('cad-viewport') as Element);
      const scene = viewport.scene();
      const mesh = viewport.bodies()[0];
      const regex = new RegExp(pattern);
      const p = mesh.edgePositions;
      const points: number[][] =
        kind === 'face'
          ? mesh.faces.filter((f: { name: string }) => regex.test(f.name)).map((f: { center: number[] }) => f.center)
          : mesh.edges
              .filter((e: { name: string }) => regex.test(e.name))
              .map((e: { start: number }) => [0, 1, 2].map((k) => (p[e.start * 3 + k] + p[(e.start + 1) * 3 + k]) / 2));
      // Of several matches, the one nearest the camera is the one most surely in view.
      const Vector = scene.camera.position.constructor;
      const [point] = points.sort((a, b) => scene.camera.position.distanceTo(new Vector(...a)) - scene.camera.position.distanceTo(new Vector(...b)));
      if (!point) throw new Error(`No ${kind} matches ${pattern}`);
      const v = new Vector(...point).project(scene.camera);
      const rect = scene.eventTarget.getBoundingClientRect();
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    },
    { kind, pattern },
  );
}

/** A new project whose component is a 60 × 30 rectangle on XY extruded by the parameter `thickness` (6 mm). */
export async function plateProject(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);

  await page.getByRole('button', { name: /Parameters/ }).click();
  await page.getByRole('textbox', { name: 'New parameter name' }).fill('thickness');
  await page.getByRole('textbox', { name: 'New parameter expression' }).fill('6 mm');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('table', { name: 'Parameters' })).toContainText('6 mm');
  await page.getByRole('button', { name: 'Close parameters' }).click();

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

  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await expect(page.getByTestId('profile-selection')).toHaveText('1 profile selected');
  await page.locator('#feature-distance').fill('thickness');
  await page.locator('#feature-distance').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1');
}

/** Sets the `thickness` parameter. */
export async function setThickness(page: Page, expression: string): Promise<void> {
  await page.getByRole('button', { name: /Parameters/ }).click();
  await page.getByRole('textbox', { name: 'Expression of thickness' }).fill(expression);
  await page.getByRole('textbox', { name: 'Expression of thickness' }).press('Enter');
  await expect(page.getByRole('table', { name: 'Parameters' })).toContainText(expression);
  await page.getByRole('button', { name: 'Close parameters' }).click();
}
