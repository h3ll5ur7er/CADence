import { defineConfig, devices } from '@playwright/test';

// E2E_PAGES_PORT: a port of its own for each checkout running journeys at once.
const port = Number(process.env['E2E_PAGES_PORT'] ?? 4310);

/**
 * Journeys against the production build as GitHub Pages serves it: below /CADence/, with the service
 * worker. `npm run e2e:pages` builds it first (tools/pages/build.mjs).
 */
export default defineConfig({
  testDir: 'e2e/pages',
  fullyParallel: false,
  // CI runners are slower and have no GPU: one browser at a time, more patience, and software WebGL (not WebGPU).
  workers: process.env['CI'] ? 1 : undefined,
  expect: { timeout: process.env['CI'] ? 15_000 : 5_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/pages' }]],
  use: {
    baseURL: `http://localhost:${port}/CADence/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: { args: process.env['CI'] ? ['--enable-unsafe-swiftshader'] : ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'] } },
    },
  ],
  webServer: {
    command: `node tools/pages/serve.mjs ${port}`,
    url: `http://localhost:${port}/CADence/`,
    reuseExistingServer: true,
  },
});
