/** P1-15 evidence block (probe-gated). */
import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../../src/harness/persistent-harness.js";
import { createP108ScenarioRuntime } from "../../contract-suite/p1-08-harness.js";
import { isP115Ready, runP115RestartScenario, type P115RestartEvidence } from "../p1-15-restart-fixtures.js";
const READY = await isP115Ready();
describe.skipIf(!READY)("P1-15-EVIDENCE", () => {
  let h: PersistentSqliteHarness; let evidence: P115RestartEvidence;
  afterAll(async () => { await h?.cleanup().catch(() => undefined); });
  it("produces the P1-15-EVIDENCE JSON block", async () => { h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() }); evidence = await runP115RestartScenario(h); expect(evidence.proposalDigest.length).toBe(64); const block = { ticket: "P1-15", proposalDigest: evidence.proposalDigest, policyActive: evidence.policyActive }; mkdirSync("evidence", { recursive: true }); writeFileSync("evidence/p1-15-evidence.json", JSON.stringify(block, null, 2)); expect(() => JSON.parse(JSON.stringify(block))).not.toThrow(); });
});