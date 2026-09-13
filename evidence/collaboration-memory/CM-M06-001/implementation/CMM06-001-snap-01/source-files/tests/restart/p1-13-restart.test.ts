/** P1-13 restart equivalence (probe-gated). */
import { describe, it, beforeAll, afterAll } from "vitest";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP113Ready, runP113RestartScenario, verifyP113AfterRestart, type P113RestartEvidence } from "./p1-13-restart-fixtures.js";

const READY = await isP113Ready();

describe.skipIf(!READY)("P1-13 restart equivalence (SQLite)", () => {
  let h: PersistentSqliteHarness;
  let evidence: P113RestartEvidence;

  beforeAll(async () => {
    h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP113RestartScenario(h);
    await h.close();
  });

  it("reopens with the same policy digest, activation and task status", async () => {
    const restarted = await h.reopen();
    await verifyP113AfterRestart(restarted, evidence);
  });

  afterAll(async () => {
    await h.cleanup().catch(() => undefined);
  });
});
