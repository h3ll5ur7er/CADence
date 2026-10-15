import { defineConfig, devices } from '@playwright/test';

const port = 4310;

/**
 * Journeys against the production build as GitHub Pages serves it: below /CADence/, with the service
 * worker. `npm run e2e:pages` builds it first (tools/pages/build.mjs).
 */
export default defineConfig({
  testDir: 'e2e/pages',
  fullyParallel: false,
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
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: { args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'] } },
    },
  ],
  webServer: {
    command: `node tools/pages/serve.mjs ${port}`,
    url: `http://localhost:${port}/CADence/`,
    reuseExistingServer: true,
  },
});
