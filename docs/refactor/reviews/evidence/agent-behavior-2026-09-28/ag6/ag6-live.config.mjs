export default { test: { environment: 'node', include: ['.toolchain/ag6-live.test.ts'], exclude: ['**/node_modules/**'], testTimeout: 560000, hookTimeout: 30000, maxWorkers: 1 } };
