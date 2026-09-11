/** P1-10 integration: real SQLite + restart + adapter parity (probe-gated). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { toP1_10Harness, type P1_10HarnessLike } from "../contract-suite/p1-10-harness.js";
import { isP110Ready, runP110RestartScenario, verifyP110AfterRestart, type P110RestartEvidence } from "../restart/p1-10-restart-fixtures.js";
import { P110_PROJECT, P110_WORKSPACE } from "../../src/contracts/fixtures/control-fixtures.js";
import { runP110ControlScenario } from "../contract-suite/p1-10-harness.js";

const READY = await isP110Ready();

describe.skipIf(!READY)("P1-10 real SQLite integration", () => {
  let closed: PersistentSqliteHarness;
  let evidence: P110RestartEvidence;

  beforeAll(async () => {
    closed = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP110RestartScenario(closed);
    await closed.close();
  });

  afterAll(async () => {
    await closed.cleanup().catch(() => undefined);
  });

  it("control timeline rebuilds identically after close+reopen", async () => {
    const restarted = await closed.reopen();
    await verifyP110AfterRestart(restarted, evidence);
  });

  it("InMemory and SQLite control timelines agree", async () => {
    const mem = createInMemoryHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    const th = toP1_10Harness(mem as unknown as P1_10HarnessLike);
    const sql = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    try {
      const thSql = toP1_10Harness(sql as unknown as P1_10HarnessLike);
      await runP110ControlScenario(th);
      await runP110ControlScenario(thSql);
      const a = await th.controlTimelineView({ projectId: P110_PROJECT, workspaceId: P110_WORKSPACE });
      const b = await thSql.controlTimelineView({ projectId: P110_PROJECT, workspaceId: P110_WORKSPACE });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    } finally {
      await sql.cleanup().catch(() => undefined);
    }
  });
});
