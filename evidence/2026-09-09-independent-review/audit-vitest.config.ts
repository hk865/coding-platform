import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['evidence/2026-09-09-independent-review/audit-*.test.ts'], maxWorkers: 1 } });
