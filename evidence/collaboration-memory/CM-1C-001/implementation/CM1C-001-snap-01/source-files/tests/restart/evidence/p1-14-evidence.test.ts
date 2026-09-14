/** P1-14 evidence block (probe-gated, reproducible JSON). */
import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../../src/harness/persistent-harness.js";
import { createP108ScenarioRuntime } from "../../contract-suite/p1-08-harness.js";
import { isP114Ready, runP114RestartScenario, type P114RestartEvidence } from "../p1-14-restart-fixtures.js";

const READY = await isP114Ready();

describe.skipIf(!READY)("P1-14-EVIDENCE", () => {
  let h: PersistentSqliteHarness;
  let evidence: P114RestartEvidence;
  afterAll(async () => {
    await h?.cleanup().catch(() => undefined);
  });
  it("produces the P1-14-EVIDENCE JSON block", async () => {
    h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP114RestartScenario(h);
    expect(evidence.candidateDigest.length).toBe(64);
    expect(evidence.gateStatus).toBe("pass");
    const block = { ticket: "P1-14", candidateDigest: evidence.candidateDigest, decisionOutcome: evidence.decisionOutcome, gateStatus: evidence.gateStatus, activationFrom: evidence.activationFrom };
    mkdirSync("evidence", { recursive: true });
    writeFileSync("evidence/p1-14-evidence.json", JSON.stringify(block, null, 2));
    expect(() => JSON.parse(JSON.stringify(block))).not.toThrow();
  });
});
