export default {
  test: {
    environment: 'node', include: ['docs/refactor/reviews/evidence/agent-behavior-2026-09-28/ag2b/live-harness.ts'],
    exclude: ['**/node_modules/**'], maxWorkers: 1,
    testTimeout: process.env.AG2B_KEEP_HOST === '1' ? 86400000 : 900000,
    hookTimeout: 30000,
  },
};
