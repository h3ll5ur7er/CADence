import { expect, type Page, test } from '@playwright/test';
import { cutHole, evidence, plateProject, rimOf, setThickness } from './support';

/** Phase 20 (Assemblies II) user journey: dragging parts, joint offsets, measuring and weighing, patterns, live updates. */
test.setTimeout(180_000);

const view = async (page: Page, name: string) => {
  await page.getByRole('button', { name: `${name} view` }).dispatchEvent('click');
  await page.waitForTimeout(800);
};

/** Where on screen the move handle's arrow along `axis` is. */
async function handleArrow(page: Page, axis: 'X' | 'Y' | 'Z'): Promise<{ x: number; y: number }> {
  return page.evaluate((axis) => {
    // Test-only introspection of Angular's dev-mode debug API and the viewport's three.js scene.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
    const scene = ng.getComponent(document.querySelector('cad-viewport') as Element).scene();
    const helper = scene.handle.controls.getHelper();
    helper.updateMatrixWorld(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const picker = helper.children[0].picker.translate.children.find((o: any) => o.name === axis);
    picker.geometry.computeBoundingSphere();
    const Vector = scene.camera.position.constructor;
    const v = new Vector().copy(picker.geometry.boundingSphere.center).applyMatrix4(picker.matrixWorld).project(scene.camera);
    const rect = scene.eventTarget.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }, axis);
}

/** Where the centre of a face of an assembly part (its first body) is on screen. */
async function faceOf(page: Page, instance: number, pattern: string): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ instance, pattern }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
      const scene = ng.getComponent(document.querySelector('cad-viewport') as Element).scene();
      const entry = [...scene.partEntries.values()][instance];
      const face = entry.part.bodies[0].faces.find((f: { name: string }) => new RegExp(pattern).test(f.name));
      const Vector = scene.camera.position.constructor;
      const v = new Vector(...face.center).applyMatrix4(entry.group.matrix).project(scene.camera);
      const rect = scene.eventTarget.getBoundingClientRect();
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    },
    { instance, pattern },
  );
}

const number = async (page: Page, testId: string) => Number(((await page.getByTestId(testId).textContent()) ?? '').replace(/[^\d.]/g, ''));

test('drags a part, offsets a joint, measures between parts, repeats them and weighs the assembly', async ({ page }) => {
  await plateProject(page, 'Assembly II');
  await setThickness(page, '4 mm');
  await cutHole(page);
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  for (const expected of ['1', '2']) {
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Component 1' }).click();
    await expect(page.getByTestId('instance-count')).toHaveText(expected);
  }
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading');
  await view(page, 'Home');

  // The second plate is free: its arrows drag it along X.
  const x = page.getByRole('spinbutton', { name: 'X (mm) of Component 1 2' });
  const before = Number(await x.inputValue());
  const arrow = await handleArrow(page, 'X');
  await page.mouse.move(arrow.x, arrow.y);
  await page.mouse.down();
  await page.mouse.move(arrow.x + 40, arrow.y + 10, { steps: 8 });
  await page.mouse.move(arrow.x + 80, arrow.y + 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Number(await x.inputValue())).toBeGreaterThan(before + 5);
  await evidence(page, '80-drag-handle');

  // Hinged at the holes, then lifted 10 mm off the first plate by an offset.
  await page.getByRole('button', { name: 'Joint', exact: true }).click();
  await view(page, 'Home');
  await page.mouse.click(...Object.values(await rimOf(page, 0, 'top')) as [number, number]);
  await view(page, 'Bottom');
  await page.mouse.click(...Object.values(await rimOf(page, 1, 'bottom')) as [number, number]);
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('list', { name: 'Joints' })).toContainText('Revolute 1');
  await page.getByRole('spinbutton', { name: 'Angle value of Revolute 1' }).fill('60');
  await page.getByRole('spinbutton', { name: 'Angle value of Revolute 1' }).press('Tab');
  await page.getByRole('textbox', { name: 'Z offset of stays' }).fill('10');
  await page.getByRole('textbox', { name: 'Z offset of stays' }).press('Tab');
  await expect(page.locator('.item.failed')).toHaveCount(0);

  // The gap between the first plate's top and the second's bottom.
  await view(page, 'Front');
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  await view(page, 'Home');
  await page.mouse.click(...Object.values(await faceOf(page, 0, ':end$')) as [number, number]);
  await view(page, 'Bottom');
  await page.mouse.click(...Object.values(await faceOf(page, 1, ':start$')) as [number, number]);
  await expect(page.getByTestId('measure-distance')).toHaveText('10 mm');
  await expect(page.getByTestId('measure-angle')).toHaveText('0°');
  await view(page, 'Home');
  await evidence(page, '81-assembly-measure');
  await page.getByRole('button', { name: 'Close measure' }).click();

  // The assembly's mass, then three times the pair in a row.
  const mass = await number(page, 'assembly-mass');
  expect(mass).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pattern', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Linear pattern' }).click();
  await page.getByRole('checkbox', { name: 'Component 1 2', exact: true }).check();
  await page.locator('#pattern-axis').selectOption({ label: 'Y' });
  await page.locator('#pattern-spacing').fill('80');
  await page.locator('#pattern-spacing').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('list', { name: 'Patterns' })).toContainText('Linear pattern 1');
  await expect.poll(() => number(page, 'assembly-mass')).toBeCloseTo(mass * 3, 0);
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await page.waitForTimeout(600);
  await evidence(page, '82-instance-pattern');
});

test('updates an open assembly when its component changes in another tab', async ({ page, context }) => {
  await plateProject(page, 'Live');
  const component = page.url();
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Component 1' }).click();
  await expect(page.getByTestId('instance-count')).toHaveText('1');
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading');
  // Opened again with nothing selected, the assembly's own properties show its mass.
  await page.goto(page.url());
  const mass = await number(page, 'assembly-mass');

  const other = await context.newPage();
  await other.goto(component);
  await setThickness(other, '12 mm');
  await expect.poll(() => number(page, 'assembly-mass'), { timeout: 30_000 }).toBeCloseTo(mass * 2, 0);
  await other.close();
});
