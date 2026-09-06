/** P1-17 evidence block (probe-gated). */
import { describe, it, expect, beforeAll } from "vitest";
import { createPersistentSqliteHarness } from "../../../src/harness/persistent-harness.js";
import { createP108ScenarioRuntime } from "../../contract-suite/p1-08-harness.js";
import { isP117Ready, runP117RestartScenario, type P117RestartEvidence } from "../p1-17-restart-fixtures.js";

const READY = await isP117Ready();

describe.skipIf(!READY)("P1-17-EVIDENCE", () => {
  let evidence: P117RestartEvidence;

  beforeAll(async () => {
    const h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    try {
      evidence = await runP117RestartScenario(h);
      console.log("P1-17-EVIDENCE-BLOCK");
      console.log(JSON.stringify({ cursorBefore: evidence.cursorBefore, viewBytes: Buffer.byteLength(evidence.viewBefore), selectionStatus: evidence.before.selection.status }, null, 2));
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });

  it("evidence block captured", async () => {
    expect(evidence.cursorBefore).toBeTruthy();
  });
});
