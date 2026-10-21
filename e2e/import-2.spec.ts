import { expect, type Page, test } from '@playwright/test';
import { evidence, fromModelMenu } from './support';

/** Phase 40 (Import II) user journeys: a large scan simplified into a solid, and a KiCad board for an enclosure. */
test.setTimeout(240_000);

const number = async (page: Page, testId: string) => Number(((await page.getByTestId(testId).first().textContent()) ?? '').replace(/[^\d.]/g, ''));

/**
 * A scanned ball as binary STL: a sphere of radius 20 with a little noise, `rings` × `segments` × 2
 * triangles less the poles' halves (made here, so no large file is kept in the repository).
 */
function scanStl(rings: number, segments: number): Buffer {
  const r = 20;
  let seed = 7;
  const noise = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * 0.4;
  };
  const points: [number, number, number][] = [[0, 0, -r]];
  for (let i = 1; i < rings; i++) {
    const theta = Math.PI * (i / rings) - Math.PI / 2;
    for (let j = 0; j < segments; j++) {
      const phi = (2 * Math.PI * j) / segments;
      const radius = r + noise();
      points.push([radius * Math.cos(theta) * Math.cos(phi), radius * Math.cos(theta) * Math.sin(phi), radius * Math.sin(theta)]);
    }
  }
  points.push([0, 0, r]);
  const top = points.length - 1;
  const at = (i: number, j: number) => 1 + (i - 1) * segments + (j % segments);
  const triangles: number[] = [];
  for (let j = 0; j < segments; j++) triangles.push(0, at(1, j + 1), at(1, j));
  for (let i = 1; i < rings - 1; i++) for (let j = 0; j < segments; j++) triangles.push(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i + 1, j));
  for (let j = 0; j < segments; j++) triangles.push(top, at(rings - 1, j), at(rings - 1, j + 1));
  const count = triangles.length / 3;
  const bytes = Buffer.alloc(84 + count * 50);
  bytes.writeUInt32LE(count, 80);
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const p = points[triangles[t * 3 + k] as number] as [number, number, number];
      for (let axis = 0; axis < 3; axis++) bytes.writeFloatLE(p[axis] as number, 84 + t * 50 + 12 + k * 12 + axis * 4);
    }
  }
  return bytes;
}

test('a scan too large for a solid is simplified with a preview and used as a body (CAD-169)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Scans');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);

  // 121,000 triangles: viewed, but too many for a solid.
  await page.getByLabel('Import', { exact: true }).setInputFiles({ name: 'scan.stl', mimeType: 'model/stl', buffer: scanStl(111, 550) });
  await expect(page.getByTestId('mode')).toHaveText('Imported');
  await expect(page.getByTestId('imported-contents')).toContainText('121,000', { timeout: 60_000 });
  await expect(page.getByText('Too many triangles to use as a solid')).toBeVisible();

  // Simplified to 20,000 triangles, looked at first.
  await page.getByTestId('simplify-triangles').fill('20000');
  await page.getByTestId('simplify-triangles').press('Tab');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('simplified-triangles')).toContainText('of 121,000', { timeout: 60_000 });
  const kept = Number(((await page.getByTestId('simplified-triangles').textContent()) ?? '').split(' of ')[0]?.replace(/,/g, ''));
  expect(kept).toBeLessThanOrEqual(20_000);
  expect(kept).toBeGreaterThan(18_000);
  await expect(page.getByTestId('simplified-notice')).toBeVisible();
  await page.waitForTimeout(800);
  await evidence(page, 'phase-40-simplify-preview');

  // Kept as a new file, which is usable as a solid; the original stays.
  await page.getByRole('button', { name: 'Keep as new file' }).click();
  await expect(page.getByRole('heading', { name: 'scan (simplified)' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Use it in a component with Insert body')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('link', { name: 'scan', exact: true })).toBeVisible();

  // A body of a component: the ball's volume, near 4/3 π 20³.
  await page.getByRole('link', { name: 'Component 1' }).click();
  await fromModelMenu(page, 'Create', 'Insert body');
  await page.locator('#feature-document').selectOption({ label: 'scan (simplified) (STL)' });
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 120_000 });
  await expect(page.getByTestId('body-volume')).toHaveText(/mm³/, { timeout: 60_000 });
  expect((await number(page, 'body-volume')) / ((4 / 3) * Math.PI * 20 ** 3)).toBeCloseTo(1, 1);
  await page.getByRole('button', { name: 'Home view' }).click();
  await page.waitForTimeout(800);
  await evidence(page, 'phase-40-simplified-solid');
});

test('a KiCad board is imported with its holes and parts, and placed in an assembly (CAD-170)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Enclosure');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('renderer')).toHaveText(/WebGPU|WebGL 2/);

  await page.getByLabel('Import', { exact: true }).setInputFiles('e2e/fixtures/sensor-board.kicad_pcb');
  await expect(page.getByTestId('mode')).toHaveText('Imported');
  await expect(page.getByTestId('board-holes')).toHaveText('9', { timeout: 60_000 });
  await expect(page.getByTestId('board-mounting-holes')).toHaveText('hole:H1, hole:H2, hole:H3, hole:H4');
  await expect(page.getByTestId('board-parts')).toHaveText('4');
  await expect(page.getByTestId('imported-size')).toHaveText('60, 40, 11.35 mm');
  await expect(page.getByText('its holes are named for joints')).toBeVisible();
  await page.waitForTimeout(800);
  await evidence(page, 'phase-40-kicad-board');

  // As an instance of an assembly, like any 3D file.
  await page.getByRole('button', { name: 'Assembly', exact: true }).click();
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'sensor-board' }).click();
  await expect(page.getByRole('list', { name: 'Instances' })).toContainText('sensor-board 1');
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('missing', { timeout: 60_000 });
  await expect(page.getByRole('list', { name: 'Instances' })).not.toContainText('loading', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await page.waitForTimeout(1500);
  await evidence(page, 'phase-40-kicad-board-assembly');
});
