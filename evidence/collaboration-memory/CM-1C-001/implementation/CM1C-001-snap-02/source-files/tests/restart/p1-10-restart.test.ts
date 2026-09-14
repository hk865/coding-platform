/** P1-10 restart equivalence (probe-gated). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP110Ready, runP110RestartScenario, verifyP110AfterRestart, type P110RestartEvidence } from "./p1-10-restart-fixtures.js";

const READY = await isP110Ready();

describe.skipIf(!READY)("P1-10 restart equivalence (SQLite)", () => {
  let h: PersistentSqliteHarness;
  let evidence: P110RestartEvidence;

  beforeAll(async () => {
    h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP110RestartScenario(h);
    await h.close();
  });

  it("reopens with the same control timeline and cursor", async () => {
    const restarted = await h.reopen();
    await verifyP110AfterRestart(restarted, evidence);
  });

  afterAll(async () => {
    await h.cleanup().catch(() => undefined);
  });
});
