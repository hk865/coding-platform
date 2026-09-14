/** P1-13 evidence block (probe-gated, reproducible JSON). */
import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { createPersistentPlatform, type PersistentPlatform } from "../../../src/composition/persistent-platform.js";
import { createP108ScenarioRuntime } from "../../contract-suite/p1-08-harness.js";
import { isP113Ready, runP113RestartScenario, type P113RestartEvidence } from "../p1-13-restart-fixtures.js";

const READY = await isP113Ready();

describe.skipIf(!READY)("P1-13-EVIDENCE", () => {
  let h: PersistentPlatform;
  let evidence: P113RestartEvidence;

  afterAll(async () => {
    await h?.cleanup().catch(() => undefined);
  });

  it("produces the P1-13-EVIDENCE JSON block", async () => {
    h = await createPersistentPlatform({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP113RestartScenario(h);
    expect(evidence.policyRefBefore.length).toBeGreaterThan(0);
    expect(evidence.taskStatusBefore).toBe("resolved");
    const block = { ticket: "P1-13", cursorBefore: evidence.cursorBefore, policyDigestBefore: evidence.policyRefBefore, taskStatusBefore: evidence.taskStatusBefore, activationBefore: evidence.activationBefore };
    mkdirSync("evidence", { recursive: true });
    writeFileSync("evidence/p1-13-evidence.json", JSON.stringify(block, null, 2));
    expect(() => JSON.parse(JSON.stringify(block))).not.toThrow();
  });
});
