/** P1-15 integration: real SQLite + restart (probe-gated). */
import { describe, it, beforeAll, afterAll } from "vitest";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP115Ready, runP115RestartScenario, verifyP115AfterRestart, type P115RestartEvidence } from "../restart/p1-15-restart-fixtures.js";
const READY = await isP115Ready();
describe.skipIf(!READY)("P1-15 real SQLite integration", () => {
  let closed: PersistentSqliteHarness; let evidence: P115RestartEvidence;
  beforeAll(async () => { closed = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() }); evidence = await runP115RestartScenario(closed); await closed.close(); });
  afterAll(async () => { await closed.cleanup().catch(() => undefined); });
  it("policy + design records rebuild identically after close+reopen", async () => { const restarted = await closed.reopen(); await verifyP115AfterRestart(restarted, evidence); });
});