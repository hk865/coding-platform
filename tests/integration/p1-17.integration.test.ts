/** P1-17 integration: real SQLite + restart equivalence + adapter parity (probe-gated). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { toP1_17Harness, type P1_17HarnessLike } from "../contract-suite/p1-17-harness.js";
import { isP117Ready, runP117RestartScenario, verifyP117AfterRestart, type P117RestartEvidence } from "../restart/p1-17-restart-fixtures.js";
import { P117_WORKSPACE } from "../contract-support/fixtures/completed-work-fixtures.js";
import { P108_PROJECT_A } from "../contract-suite/p1-08-harness.js";

const READY = await isP117Ready();

describe.skipIf(!READY)("P1-17 real SQLite integration", () => {
  let closed: PersistentSqliteHarness;
  let evidence: P117RestartEvidence;

  beforeAll(async () => {
    closed = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP117RestartScenario(closed);
    await closed.close();
  });

  afterAll(async () => {
    await closed.cleanup().catch(() => undefined);
  });

  it("completed-work view rebuilds identically after close+reopen", async () => {
    const restarted = await closed.reopen();
    await verifyP117AfterRestart(restarted, evidence);
  });

  it("InMemory and SQLite completed-work views agree", async () => {
    const mem = createInMemoryHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    const th = toP1_17Harness(mem as unknown as P1_17HarnessLike);
    const sql = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    try {
      const thSql = toP1_17Harness(sql as unknown as P1_17HarnessLike);
      const a = await th.completedWorkView({ projectId: P108_PROJECT_A, workspaceId: P117_WORKSPACE });
      const b = await thSql.completedWorkView({ projectId: P108_PROJECT_A, workspaceId: P117_WORKSPACE });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    } finally {
      await sql.cleanup().catch(() => undefined);
    }
  });
});
