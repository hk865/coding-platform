/**
 * P1-12 restart equivalence: same ledger + read-model files, NEW instances —
 * the architecture inspection view rebuilds field-identically. AUTO-SKIPS
 * until the P1-12 paths are implemented (probe, no fake).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP112Ready, runP112RestartScenario, verifyP112AfterRestart, type P112RestartEvidence } from "./p1-12-restart-fixtures.js";

const READY = await isP112Ready();

describe.skipIf(!READY)("P1-12 restart equivalence (SQLite)", () => {
  let h: PersistentSqliteHarness;
  let evidence: P112RestartEvidence;

  beforeAll(async () => {
    h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP112RestartScenario(h);
    await h.close(); // process-restart emulation: SAME instance reopens fresh modules
  });

  it("reopens with field-identical inspection view and the same observed cursor", async () => {
    const restarted = await h.reopen();
    await verifyP112AfterRestart(restarted, evidence);
  });

  afterAll(async () => {
    await h.cleanup().catch(() => undefined);
  });
});
