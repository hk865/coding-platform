import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    // Heavy suites (real SQLite ledger, real application host, real kernel) take
    // 1-3s each; vitest's 5s default produced false failures that moved between
    // files on each full run while every file passed alone. scripts/test-wsl.sh
    // carries the same budget for the Linux runner.
    testTimeout: 30_000,
  },
});
