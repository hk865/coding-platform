import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', include: ['tests/**/*.scale.test.ts'], clearMocks: true, restoreMocks: true,
    exclude: ['**/node_modules/**', '**/.git/**'],
    // This file mirrors vitest.config.ts; the scale batch runs once before a slice merge.
    testTimeout: 30_000,
  },
});
