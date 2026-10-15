import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Headless tests for the framework-free core and the repository tools (Angular tests run via `ng test`). */
export default defineConfig({
  resolve: {
    alias: { '@core': fileURLToPath(new URL('./src/core', import.meta.url)) },
  },
  test: {
    name: 'core',
    environment: 'node',
    include: ['src/core/**/*.spec.ts', 'tools/**/*.spec.ts'],
  },
});
