/** P1-09 restart equivalence (probe-gated). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPersistentPlatform, type PersistentPlatform } from "../../src/composition/persistent-platform.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP109Ready, runP109RestartScenario, verifyP109AfterRestart, type P109RestartEvidence } from "./p1-09-restart-fixtures.js";

const READY = await isP109Ready();

describe.skipIf(!READY)("P1-09 restart equivalence (SQLite)", () => {
  let h: PersistentPlatform;
  let evidence: P109RestartEvidence;

  beforeAll(async () => {
    h = await createPersistentPlatform({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP109RestartScenario(h);
    await h.close();
  });

  it("reopens with the same query-job view and cursor", async () => {
    const restarted = await h.reopen();
    await verifyP109AfterRestart(restarted, evidence);
  });

  afterAll(async () => {
    await h.cleanup().catch(() => undefined);
  });
});
