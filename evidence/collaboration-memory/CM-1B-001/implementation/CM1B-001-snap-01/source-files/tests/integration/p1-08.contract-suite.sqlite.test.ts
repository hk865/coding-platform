/**
 * P1-08 contract-suite wiring — real SQLite implementation. AUTO-SKIPS until
 * the P1-08 console projections are implemented (probe, no fake).
 */
import { describe, it, expect } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { defineConsoleContractSuite, type P1_08FactoryOptions } from "../contract-suite/console.contract.suite.js";
import { toP1_08Harness, type P1_08HarnessLike } from "../contract-suite/p1-08-harness.js";
import { isP108Ready } from "../restart/p1-08-restart-fixtures.js";
import { runP108TwoProjectScenario, createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { P108_PROJECT_A, P108_WORKSPACE, P108_GOAL, P108_TASK_WORK } from "../contract-suite/p1-08-harness.js";

const READY = await isP108Ready();

const factory = async (options?: P1_08FactoryOptions) => {
  const h = await createPersistentSqliteHarness({
    deps: {},
    runtime: options?.runtime ?? createP108ScenarioRuntime(),
  });
  return { h, th: toP1_08Harness(h as unknown as P1_08HarnessLike) };
};

describe.skipIf(!READY)("P1-08 contract suite — SQLite", () => {
  defineConsoleContractSuite(async (options) => (await factory(options)).th);
});

describe.skipIf(!READY)("P1-08 real SQLite console acceptance", () => {
  it("the console adapter can never read/write ledger tables (read-only-adapter, sqlite path)", async () => {
    const { h, th } = await factory();
    try {
      await runP108TwoProjectScenario(th);
      // The console ONLY reads its own read-model database file(s). The ledger
      // database is a separate file — the console adapter has no table access
      // to it, so the console_* tables exist ONLY in the read-model file.
      const { DatabaseSync } = await import("node:sqlite");
      const ledgerDb = new DatabaseSync(h.ledgerPath);
      try {
        const rows = ledgerDb
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'console_%'")
          .all() as { name: string }[];
        expect(rows).toHaveLength(0);
      } finally {
        ledgerDb.close();
      }
      // Console queries create NO ledger writes (events unchanged).
      const before = await h.ledger.events({ afterCursor: null, limit: 1024 });
      await th.consolePortfolio({});
      await th.consoleSummary({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
      await th.consolePlanMatrix({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL });
      await th.consoleActiveAgents({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
      await th.consoleTaskEvidence({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, taskId: P108_TASK_WORK });
      await th.consoleTimeline({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
      const after = await h.ledger.events({ afterCursor: null, limit: 1024 });
      expect(after.events.length).toBe(before.events.length);
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  }, 120_000);
});
