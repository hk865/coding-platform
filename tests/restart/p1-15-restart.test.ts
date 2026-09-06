/** P1-15 restart equivalence (probe-gated). */
import { describe, it, beforeAll, afterAll } from "vitest";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP115Ready, runP115RestartScenario, verifyP115AfterRestart, type P115RestartEvidence } from "./p1-15-restart-fixtures.js";
const READY = await isP115Ready();
describe.skipIf(!READY)("P1-15 restart equivalence (SQLite)", () => {
  let h: PersistentSqliteHarness; let evidence: P115RestartEvidence;
  beforeAll(async () => { h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() }); evidence = await runP115RestartScenario(h); await h.close(); });
  it("reopens with the same policy active ref", async () => { const restarted = await h.reopen(); await verifyP115AfterRestart(restarted, evidence); });
  afterAll(async () => { await h.cleanup().catch(() => undefined); });
});