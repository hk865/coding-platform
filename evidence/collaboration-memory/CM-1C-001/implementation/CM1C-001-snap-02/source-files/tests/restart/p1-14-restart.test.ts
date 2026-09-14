/** P1-14 restart equivalence (probe-gated). */
import { describe, it, beforeAll, afterAll } from "vitest";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP114Ready, runP114RestartScenario, verifyP114AfterRestart, type P114RestartEvidence } from "./p1-14-restart-fixtures.js";

const READY = await isP114Ready();

describe.skipIf(!READY)("P1-14 restart equivalence (SQLite)", () => {
  let h: PersistentSqliteHarness;
  let evidence: P114RestartEvidence;
  beforeAll(async () => {
    h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP114RestartScenario(h);
    await h.close();
  });
  it("reopens with the same candidate/decision/gate/activation", async () => {
    const restarted = await h.reopen();
    await verifyP114AfterRestart(restarted, evidence);
  });
  afterAll(async () => {
    await h.cleanup().catch(() => undefined);
  });
});
