import { defineConfig, devices } from '@playwright/test';

// E2E_PORT: a port of its own for each checkout running journeys at once (the server is reused when it is up).
const port = Number(process.env['E2E_PORT'] ?? 4300);

/** End-to-end tests against the dev build. Screenshots for phase evidence land in e2e/evidence/. */
export default defineConfig({
  testDir: 'e2e',
  testIgnore: ['pages/**', 'desktop/**'], // against the production build and the desktop app: playwright.pages.config.ts, playwright.desktop.config.ts
  fullyParallel: false,
  // CI runners are slower and have no GPU: one browser at a time, more patience, and software WebGL (not WebGPU).
  workers: process.env['CI'] ? 1 : undefined,
  expect: { timeout: process.env['CI'] ? 15_000 : 5_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${port}`,
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
    command: `npx ng serve --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
