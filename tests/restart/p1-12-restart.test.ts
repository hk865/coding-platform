/**
 * P1-12 restart equivalence: same ledger + read-model files, NEW instances —
 * the architecture inspection view rebuilds field-identically. AUTO-SKIPS
 * until the P1-12 paths are implemented (probe, no fake).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { isP112Ready, runP112RestartScenario, verifyP112AfterRestart, type P112RestartEvidence } from "./p1-12-restart-fixtures.js";

const READY = await isP112Ready();

describe.skipIf(!READY)("P1-12 restart equivalence (SQLite)", () => {
  let evidence: P112RestartEvidence;

  beforeAll(async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      evidence = await runP112RestartScenario(h);
      await h.close();
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });

  it("reopens with field-identical inspection view and the same observed cursor", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      const restarted = await h.reopen();
      await verifyP112AfterRestart(restarted, evidence);
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });
});
