/**
 * P1-16 restart equivalence: same ledger + read-model files, NEW instances —
 * work-context views rebuild field-identically from the persistent EventPage.
 * AUTO-SKIPS until the P1-16 paths are implemented (probe, no fake).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPersistentPlatform, type PersistentPlatform } from "../../src/composition/persistent-platform.js";
import { isP116Ready, runP116RestartScenario, verifyP116AfterRestart, type P116RestartEvidence } from "./p1-16-restart-fixtures.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";

const READY = await isP116Ready();

describe.skipIf(!READY)("P1-16 restart equivalence (SQLite)", () => {
  let h: PersistentPlatform;
  let evidence: P116RestartEvidence;

  beforeAll(async () => {
    h = await createPersistentPlatform({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP116RestartScenario(h);
    await h.close(); // process-restart emulation: SAME instance reopens fresh modules
  });

  it("reopens with field-identical work-context views and the same observed cursor", async () => {
    const restarted = await h.reopen();
    await verifyP116AfterRestart(restarted, evidence);
  });

  afterAll(async () => {
    await h.cleanup().catch(() => undefined);
  });
});
