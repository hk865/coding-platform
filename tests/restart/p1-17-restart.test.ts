/** P1-17 restart equivalence (probe-gated). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP117Ready, runP117RestartScenario, verifyP117AfterRestart, type P117RestartEvidence } from "./p1-17-restart-fixtures.js";

const READY = await isP117Ready();

describe.skipIf(!READY)("P1-17 restart equivalence (SQLite)", () => {
  let h: PersistentSqliteHarness;
  let evidence: P117RestartEvidence;

  beforeAll(async () => {
    h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP117RestartScenario(h);
    await h.close();
  });

  it("reopens with the same completed-work view and cursor", async () => {
    const restarted = await h.reopen();
    await verifyP117AfterRestart(restarted, evidence);
  });

  afterAll(async () => {
    await h.cleanup().catch(() => undefined);
  });
});
