import { defineConfig } from 'vitest/config';
export default defineConfig({
  root: '/home/hyh001/projects/coding-platform/coding-platform',
  test: { environment: 'node', include: ['tests/integration/p1-02.integration.test.ts'],
    setupFiles: ['/tmp/r3a-r4a-independent-review/trace/setup.ts'],
    maxWorkers: 1, testTimeout: 30000, clearMocks: true, restoreMocks: false }
});
