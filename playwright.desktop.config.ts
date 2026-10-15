import { defineConfig } from '@playwright/test';

/** Smoke tests of the built desktop app (Windows): `npx tauri build --no-bundle`, then `npm run e2e:desktop`. */
export default defineConfig({
  testDir: 'e2e/desktop',
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
});
