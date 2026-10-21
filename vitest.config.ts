import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', include: ['tests/**/*.test.ts'], clearMocks: true, restoreMocks: true,
    exclude: ['**/node_modules/**', '**/.git/**', 'tests/**/*.scale.test.ts'],
    // Real SQLite, sandboxed checks and Host round trips run serially (maxWorkers=1);
    // the 5 s default is too tight on CI runners and WSL (see cc-baseline-2026-10-02).
    testTimeout: 30_000,
  },
});
