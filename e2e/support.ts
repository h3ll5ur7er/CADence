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

/**
 * A new project whose component is a 60 × 30 rectangle on XY extruded by the parameter `thickness` (6 mm).
 * `home` is the home page's URL (below a sub-path for the Pages build).
 */
export async function plateProject(page: Page, name: string, home = '/'): Promise<void> {
  await page.goto(home);
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);

  await page.getByRole('button', { name: /Parameters/ }).click();
  await page.getByRole('textbox', { name: 'New parameter name' }).fill('thickness');
  await page.getByRole('textbox', { name: 'New parameter expression' }).fill('6 mm');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Parameters', exact: true })).toContainText('6 mm');
  await page.getByRole('button', { name: 'Close parameters' }).click();

  await rectangleSketch(page, 'XY plane (top)', 60, 30);
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  await expect(page.getByTestId('profile-selection')).toHaveText('1 profile selected');
  await page.locator('#feature-distance').fill('thickness');
  await page.locator('#feature-distance').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1');
}

/** A finished sketch on `plane` (a sketch-plane menu item): a rectangle from the origin, `width` along the sketch's X and `height` along its Y. */
export async function rectangleSketch(page: Page, plane: string, width: number, height: number): Promise<void> {
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: plane }).click();
  await page.waitForTimeout(500);
  const origin = await center(page, 'circle.point.origin');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.click(origin.x, origin.y);
  await page.mouse.click(origin.x + 240, origin.y - 120);
  await page.getByRole('button', { name: 'Dimension', exact: true }).click();
  await page.mouse.click(origin.x + 120, origin.y);
  await page.mouse.click(origin.x + 120, origin.y + 50);
  await typeDimension(page, String(width));
  const right = await center(page, '.curve', 1);
  await page.mouse.click(right.x, right.y);
  await page.mouse.click(right.x + 80, right.y);
  await typeDimension(page, String(height));
  await expect(page.getByTestId('sketch-status')).toHaveText('Fully constrained');
  await page.getByRole('button', { name: 'Finish sketch' }).click();
}

/** Sets the `thickness` parameter. */
export async function setThickness(page: Page, expression: string): Promise<void> {
  await page.getByRole('button', { name: /Parameters/ }).click();
  await page.getByRole('textbox', { name: 'Expression of thickness' }).fill(expression);
  await page.getByRole('textbox', { name: 'Expression of thickness' }).press('Enter');
  await expect(page.getByRole('table', { name: 'Parameters', exact: true })).toContainText(expression);
  await page.getByRole('button', { name: 'Close parameters' }).click();
}

/** A ⌀8 hole through the plate, sketched on its top face 20 mm in from the left end. */
export async function cutHole(page: Page): Promise<void> {
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
  await expect(page.locator('.item.failed')).toHaveCount(0);
}

/**
 * Where the rim of an assembly part's hole is on screen: the circular edge (the one drawn with the
 * most segments) at the top or bottom of the part.
 */
export async function rimOf(page: Page, instance: number, side: 'top' | 'bottom'): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ instance, side }) => {
      // Test-only introspection of Angular's dev-mode debug API and the viewport's three.js scene.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
      const scene = ng.getComponent(document.querySelector('cad-viewport') as Element).scene();
      const entry = [...scene.partEntries.values()][instance];
      const mesh = entry.part.bodies[0];
      const p = mesh.edgePositions;
      const edges = mesh.edges.map((e: { start: number; count: number }) => {
        const zs = Array.from({ length: e.count }, (_, k) => p[(e.start + k) * 3 + 2]);
        const point = [0, 1, 2].map((k) => p[(e.start + Math.floor(e.count / 2)) * 3 + k]);
        return { count: e.count, z: Math.max(...zs) - Math.min(...zs) < 1e-6 ? zs[0] : NaN, point };
      });
      const flat = edges.filter((e: { z: number }) => !Number.isNaN(e.z));
      const level = side === 'top' ? Math.max(...flat.map((e: { z: number }) => e.z)) : Math.min(...flat.map((e: { z: number }) => e.z));
      const rim = flat.filter((e: { z: number }) => Math.abs(e.z - level) < 1e-6).sort((a: { count: number }, b: { count: number }) => b.count - a.count)[0];
      const Vector = scene.camera.position.constructor;
      const v = new Vector(...rim.point).applyMatrix4(entry.group.matrix).project(scene.camera);
      const rect = scene.eventTarget.getBoundingClientRect();
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    },
    { instance, side },
  );
}

/**
 * A screen point where a click really picks a face of the first body whose name matches `pattern`:
 * the middles of the face's triangles are tried until the viewport's own picking hits that face
 * (a hole's wall is only partly in view).
 */
export async function visiblePointOf(page: Page, pattern: string): Promise<{ x: number; y: number }> {
  return page.evaluate((pattern) => {
    // Test-only introspection of Angular's dev-mode debug API and the viewport's three.js scene.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
    const viewport = ng.getComponent(document.querySelector('cad-viewport') as Element);
    const scene = viewport.scene();
    const mesh = viewport.bodies()[0];
    const regex = new RegExp(pattern);
    const rect = scene.eventTarget.getBoundingClientRect();
    const Vector = scene.camera.position.constructor;
    for (const face of mesh.faces.filter((f: { name: string }) => regex.test(f.name))) {
      for (let t = face.start; t < face.start + face.count; t += 3) {
        const corner = (k: number) => [0, 1, 2].map((a) => mesh.positions[mesh.indices[t + k] * 3 + a]);
        const [a, b, c] = [corner(0), corner(1), corner(2)];
        const v = new Vector((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3).project(scene.camera);
        const point = { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
        const pick = scene.pickUnder({ clientX: point.x, clientY: point.y });
        if (pick?.kind === 'face' && regex.test(pick.name)) return point;
      }
    }
    throw new Error(`No visible face matches ${pattern}`);
  }, pattern);
}

/** A feature from one of the model toolbar's menus (Create, Pattern, Bodies). */
export async function fromModelMenu(page: Page, menu: 'Create' | 'Pattern' | 'Bodies', item: string): Promise<void> {
  await page.getByRole('toolbar', { name: 'Model tools' }).getByRole('button', { name: menu, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

/** A sketch on the plate's top face with points `dx` pixels left and right of its origin. */
export async function topPoints(page: Page, offsets: readonly number[]): Promise<void> {
  const top = await screenPositionOf(page, 'face', ':end$');
  await page.mouse.click(top.x, top.y);
  await page.getByRole('button', { name: 'New sketch' }).click();
  await page.getByRole('menuitem', { name: 'Selected face' }).click();
  await page.waitForTimeout(600);
  const origin = await center(page, 'circle.point.origin');
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  for (const dx of offsets) {
    await page.mouse.move(origin.x + dx, origin.y);
    await page.mouse.click(origin.x + dx, origin.y);
  }
  await page.getByRole('button', { name: 'Finish sketch' }).click();
}

/** A standard view of the whole assembly. */
export const standardView = async (page: Page, name: string) => {
  await page.getByRole('button', { name: `${name} view` }).dispatchEvent('click');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await page.waitForTimeout(600);
};

/** A revolute joint from the top rim of one plate's hole to the bottom rim of another plate's. */
export async function hinge(page: Page, stays: number, instance: number): Promise<void> {
  await page.getByRole('button', { name: 'Joint', exact: true }).click();
  await standardView(page, 'Home');
  const top = await rimOf(page, stays, 'top');
  await page.mouse.click(top.x, top.y);
  await standardView(page, 'Bottom');
  const bottom = await rimOf(page, instance, 'bottom');
  await page.mouse.click(bottom.x, bottom.y);
  await page.getByRole('button', { name: 'OK' }).click();
}

/** Where an anchor of a drawing's layout is on screen: the first matching `kind` in the view (by index), by `pick`. */
export async function anchorOnScreen(page: Page, viewIndex: number, kind: 'point' | 'circle' | 'line', pick: 'left' | 'right' | 'first' | 'rim'): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ viewIndex, kind, pick }) => {
      // Test-only introspection of Angular's dev-mode debug API.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
      const mode = ng.getComponent(document.querySelector('cad-drawing-mode') as Element);
      const layout = mode.store.layout();
      const view = mode.store.document().views[viewIndex].id;
      const anchors = layout.anchors.filter((a: { view: string; kind: string; hidden?: boolean }) => a.view === view && a.kind === kind && !a.hidden);
      const sorted = [...anchors].sort((a: { at: number[] }, b: { at: number[] }) => a.at[0] - b.at[0] || a.at[1] - b.at[1]);
      const anchor = pick === 'right' ? sorted.at(-1) : sorted[0];
      const at = pick === 'rim' ? [anchor.at[0] + anchor.radius, anchor.at[1]] : anchor.at;
      const svg = document.querySelector('svg.sheet') as SVGSVGElement;
      const p = new DOMPoint(at[0], layout.height - at[1]).matrixTransform(svg.getScreenCTM() as DOMMatrix);
      return { x: p.x, y: p.y };
    },
    { viewIndex, kind, pick },
  );
}

/** A point on screen at a drawing's sheet millimetres. */
export async function sheetPoint(page: Page, at: [number, number]): Promise<{ x: number; y: number }> {
  return page.evaluate((at) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
    const layout = ng.getComponent(document.querySelector('cad-drawing-mode') as Element).store.layout();
    const svg = document.querySelector('svg.sheet') as SVGSVGElement;
    const p = new DOMPoint(at[0], layout.height - at[1]).matrixTransform(svg.getScreenCTM() as DOMMatrix);
    return { x: p.x, y: p.y };
  }, at);
}
