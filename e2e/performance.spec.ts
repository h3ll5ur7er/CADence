import { expect, test } from '@playwright/test';
import { evidence, plateProject } from './support';

/** Phase 25 (Performance) user journey: an assembly of many copies of one part stays light to draw. */
test.setTimeout(180_000);

test('sixty instances of one part share their geometry on the graphics card', async ({ page }) => {
  await plateProject(page, 'Rack');
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Component 1' }).click();
  await expect(page.getByTestId('instance-count')).toHaveText('1');
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading');

  await page.getByRole('button', { name: 'Pattern', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Linear pattern' }).click();
  await page.getByRole('checkbox', { name: 'Component 1 1', exact: true }).check();
  await page.locator('#pattern-axis').selectOption({ label: 'Z' });
  await page.locator('#pattern-count').fill('60');
  await page.locator('#pattern-count').press('Tab');
  await page.locator('#pattern-spacing').fill('10');
  await page.locator('#pattern-spacing').press('Tab');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('list', { name: 'Patterns' })).toContainText('Linear pattern 1');
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await page.waitForTimeout(800);

  // Test-only access to the viewport's scene: how many parts it draws, and how many geometries the renderer holds.
  const drawn = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ng = (window as unknown as { ng: { getComponent(e: Element): any } }).ng;
    const scene = ng.getComponent(document.querySelector('cad-viewport') as Element).scene();
    return { parts: scene.partEntries.size as number, geometries: scene.renderer.info.memory.geometries as number };
  });
  expect(drawn.parts).toBe(60);
  // One plate's faces and edges, plus the grid, axes and helpers: not two per instance.
  expect(drawn.geometries).toBeLessThan(40);
  await evidence(page, '93-sixty-instances');
});
