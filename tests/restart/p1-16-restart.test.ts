/**
 * P1-16 restart equivalence: same ledger + read-model files, NEW instances —
 * work-context views rebuild field-identically from the persistent EventPage.
 * AUTO-SKIPS until the P1-16 paths are implemented (probe, no fake).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { isP116Ready, runP116RestartScenario, verifyP116AfterRestart, type P116RestartEvidence } from "./p1-16-restart-fixtures.js";

const READY = await isP116Ready();

describe.skipIf(!READY)("P1-16 restart equivalence (SQLite)", () => {
  let evidence: P116RestartEvidence;

  beforeAll(async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      evidence = await runP116RestartScenario(h);
      await h.close();
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });

  it("reopens with field-identical work-context views and the same observed cursor", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      const restarted = await h.reopen();
      await verifyP116AfterRestart(restarted, evidence);
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });
});
