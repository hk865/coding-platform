/** P1-13 integration: real SQLite + restart (probe-gated). */
import { describe, it, beforeAll, afterAll } from "vitest";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP113Ready, runP113RestartScenario, verifyP113AfterRestart, type P113RestartEvidence } from "../restart/p1-13-restart-fixtures.js";

const READY = await isP113Ready();

describe.skipIf(!READY)("P1-13 real SQLite integration", () => {
  let closed: PersistentSqliteHarness;
  let evidence: P113RestartEvidence;

  beforeAll(async () => {
    closed = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP113RestartScenario(closed);
    await closed.close();
  });

  afterAll(async () => {
    await closed.cleanup().catch(() => undefined);
  });

  it("policy + activation + task rebuild identically after close+reopen", async () => {
    const restarted = await closed.reopen();
    await verifyP113AfterRestart(restarted, evidence);
  });
});
