/** P1-09 evidence block (probe-gated). */
import { describe, it, expect, beforeAll } from "vitest";
import { createPersistentSqliteHarness } from "../../../src/harness/persistent-harness.js";
import { createP108ScenarioRuntime } from "../../contract-suite/p1-08-harness.js";
import { isP109Ready, runP109RestartScenario, type P109RestartEvidence } from "../p1-09-restart-fixtures.js";

const READY = await isP109Ready();

describe.skipIf(!READY)("P1-09-EVIDENCE", () => {
  let evidence: P109RestartEvidence;

  beforeAll(async () => {
    const h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    try {
      evidence = await runP109RestartScenario(h);
      console.log("P1-09-EVIDENCE-BLOCK", JSON.stringify({ cursorBefore: evidence.cursorBefore, viewBytes: Buffer.byteLength(evidence.viewBefore) }));
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  });

  it("evidence block captured", async () => {
    expect(evidence.cursorBefore).toBeTruthy();
  });
});
