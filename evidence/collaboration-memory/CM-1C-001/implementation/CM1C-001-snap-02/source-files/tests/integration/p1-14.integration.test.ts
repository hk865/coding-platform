/** P1-14 integration: real SQLite + restart (probe-gated). */
import { describe, it, beforeAll, afterAll } from "vitest";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP114Ready, runP114RestartScenario, verifyP114AfterRestart, type P114RestartEvidence } from "../restart/p1-14-restart-fixtures.js";

const READY = await isP114Ready();

describe.skipIf(!READY)("P1-14 real SQLite integration", () => {
  let closed: PersistentSqliteHarness;
  let evidence: P114RestartEvidence;
  beforeAll(async () => {
    closed = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP114RestartScenario(closed);
    await closed.close();
  });
  afterAll(async () => {
    await closed.cleanup().catch(() => undefined);
  });
  it("candidate/decision/gate/activation rebuild identically after close+reopen", async () => {
    const restarted = await closed.reopen();
    await verifyP114AfterRestart(restarted, evidence);
  });
});
