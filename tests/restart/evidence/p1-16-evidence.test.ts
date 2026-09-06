/**
 * P1-16 evidence block: same restart scenario, printed as a machine-readable
 * evidence block (executed by the integrator after acceptance; AUTO-SKIPS
 * until the P1-16 paths are implemented).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createPersistentSqliteHarness } from "../../../src/harness/persistent-harness.js";
import { isP116Ready, runP116RestartScenario, type P116RestartEvidence } from "../p1-16-restart-fixtures.js";

const READY = await isP116Ready();

describe.skipIf(!READY)("P1-16-EVIDENCE", () => {
  let evidence: P116RestartEvidence;

  beforeAll(async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      evidence = await runP116RestartScenario(h);
      console.log("P1-16-EVIDENCE-BLOCK");
      console.log(JSON.stringify({
        cursorBefore: evidence.cursorBefore,
        ledgerCurve: evidence.ledgerEventIds.length,
        workAViewBytes: Buffer.byteLength(evidence.w1aBefore),
        workCoordViewBytes: Buffer.byteLength(evidence.w2Before),
        workBViewBytes: Buffer.byteLength(evidence.w1bBefore),
        bindingSnapshotBytes: Buffer.byteLength(evidence.bindingSnapshot),
      }, null, 2));
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });

  it("evidence block captured", async () => {
    expect(evidence.ledgerEventIds.length).toBeGreaterThan(0);
  });
});
