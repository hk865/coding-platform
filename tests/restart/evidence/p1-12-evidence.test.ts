/**
 * P1-12 evidence block: deterministic inspection scenario evidence (executed
 * by the integrator after acceptance; AUTO-SKIPS until the P1-12 paths exist).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createPersistentSqliteHarness } from "../../../src/harness/persistent-harness.js";
import { isP112Ready, runP112RestartScenario, type P112RestartEvidence } from "../p1-12-restart-fixtures.js";

const READY = await isP112Ready();

describe.skipIf(!READY)("P1-12-EVIDENCE", () => {
  let evidence: P112RestartEvidence;

  beforeAll(async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      evidence = await runP112RestartScenario(h);
      console.log("P1-12-EVIDENCE-BLOCK");
      console.log(JSON.stringify({
        cursorBefore: evidence.cursorBefore,
        ledgerEventIds: evidence.ledgerEventIds.length,
        viewBytes: Buffer.byteLength(evidence.viewBefore),
        deltaChanges: evidence.before.delta.changes.length,
        proposalDigest: evidence.before.proposal.proposalDigest,
      }, null, 2));
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });

  it("evidence block captured", async () => {
    expect(evidence.ledgerEventIds.length).toBeGreaterThan(0);
  });
});
