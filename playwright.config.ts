import { defineConfig, devices } from '@playwright/test';

const port = 4300;

/** End-to-end tests against the dev build. Screenshots for phase evidence land in e2e/evidence/. */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: { args: ['--enable-unsafe-webgpu'] } },
    },
  ],
  webServer: {
    command: `npx ng serve --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
