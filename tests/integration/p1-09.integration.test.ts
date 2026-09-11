/** P1-09 integration: real SQLite + restart + adapter parity (probe-gated). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { toP1_09Harness, runP109QueryScenario, type P1_09HarnessLike } from "../contract-suite/p1-09-harness.js";
import { isP109Ready, runP109RestartScenario, verifyP109AfterRestart, type P109RestartEvidence } from "../restart/p1-09-restart-fixtures.js";
import { P109_PROJECT, P109_WORKSPACE, P109_QUERY } from "../contract-support/fixtures/query-job-fixtures.js";

const READY = await isP109Ready();

describe.skipIf(!READY)("P1-09 real SQLite integration", () => {
  let closed: PersistentSqliteHarness;
  let evidence: P109RestartEvidence;

  beforeAll(async () => {
    closed = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP109RestartScenario(closed);
    await closed.close();
  });

  afterAll(async () => {
    await closed.cleanup().catch(() => undefined);
  });

  it("query-job view rebuilds identically after close+reopen", async () => {
    const restarted = await closed.reopen();
    await verifyP109AfterRestart(restarted, evidence);
  });

  it("InMemory and SQLite query-job views agree", async () => {
    const mem = createInMemoryHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    const th = toP1_09Harness(mem as unknown as P1_09HarnessLike);
    const sql = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    try {
      const thSql = toP1_09Harness(sql as unknown as P1_09HarnessLike);
      await runP109QueryScenario(th);
      await runP109QueryScenario(thSql);
      const a = await th.queryJobView({ projectId: P109_PROJECT, workspaceId: P109_WORKSPACE, queryJobId: P109_QUERY });
      const b = await thSql.queryJobView({ projectId: P109_PROJECT, workspaceId: P109_WORKSPACE, queryJobId: P109_QUERY });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    } finally {
      await sql.cleanup().catch(() => undefined);
    }
  });
});
