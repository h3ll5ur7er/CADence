import { expect, test } from '@playwright/test';
import { evidence, plateProject } from '../support';

/** CAD-32: the web app as GitHub Pages serves it, below /CADence/, installable and working offline. */
test.setTimeout(240_000);

test('runs below a sub-path, opens deep links, and keeps working offline', async ({ page, context }) => {
  // First visit online: the service worker installs and caches the app; modeling caches the kernels.
  await page.goto('./');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.webmanifest');
  const manifest = await (await page.request.get('manifest.webmanifest')).json();
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await plateProject(page, 'Offline plate', './');
  const editor = page.url();
  expect(new URL(editor).pathname).toMatch(/^\/CADence\/projects\//);

  // A deep link opens the editor directly (the host answers with 404.html, which is the app).
  await page.goto(editor);
  await expect(page.getByTestId('body-count')).toHaveText('1', { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).length), { message: 'service worker caches' })
    .toBeGreaterThan(0);

  // Offline: the app, the sketch solver and the geometry kernel all come from the cache.
  await context.setOffline(true);
  await page.goto('./');
  await expect(page.getByRole('link', { name: /Offline plate/ })).toBeVisible();
  await plateProject(page, 'Made offline', './');
  await expect(page.getByTestId('body-volume')).toHaveText('10,800 mm³');
  await page.waitForTimeout(800);
  await evidence(page, '29-offline-pages');
  await context.setOffline(false);
});
