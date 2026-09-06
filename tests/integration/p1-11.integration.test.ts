/** P1-11 integration: real SQLite + restart + adapter parity (probe-gated). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { toP1_11Harness, runP111ChangeScenario, planChangeViewQueryFor, type P1_11HarnessLike } from "../contract-suite/p1-11-harness.js";
import { isP111Ready, runP111RestartScenario, verifyP111AfterRestart, type P111RestartEvidence } from "../restart/p1-11-restart-fixtures.js";
import { P111_PROJECT } from "../contract-suite/p1-11-harness.js";

const READY = await isP111Ready();

describe.skipIf(!READY)("P1-11 real SQLite integration", () => {
  let closed: PersistentSqliteHarness;
  let evidence: P111RestartEvidence;

  beforeAll(async () => {
    closed = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP111RestartScenario(closed);
    await closed.close();
  });

  afterAll(async () => {
    await closed.cleanup().catch(() => undefined);
  });

  it("plan-change view rebuilds identically after close+reopen", async () => {
    const restarted = await closed.reopen();
    await verifyP111AfterRestart(restarted, evidence);
  });

  it("InMemory and SQLite plan-change views agree", async () => {
    const mem = createInMemoryHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    const th = toP1_11Harness(mem as unknown as P1_11HarnessLike);
    const sql = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    try {
      const thSql = toP1_11Harness(sql as unknown as P1_11HarnessLike);
      await runP111ChangeScenario(th);
      await runP111ChangeScenario(thSql);
      const a = await th.planChangeView(planChangeViewQueryFor(P111_PROJECT));
      const b = await thSql.planChangeView(planChangeViewQueryFor(P111_PROJECT));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    } finally {
      await sql.cleanup().catch(() => undefined);
    }
  });
});
