/** P1-11 evidence block (probe-gated, reproducible JSON). */
import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createPersistentPlatform, type PersistentPlatform } from "../../../src/composition/persistent-platform.js";
import { createP108ScenarioRuntime } from "../../contract-suite/p1-08-harness.js";
import { isP111Ready, runP111RestartScenario, type P111RestartEvidence } from "../p1-11-restart-fixtures.js";
import { P111_PROJECT } from "../../contract-suite/p1-11-harness.js";

const READY = await isP111Ready();

describe.skipIf(!READY)("P1-11-EVIDENCE", () => {
  let h: PersistentPlatform;
  let evidence: P111RestartEvidence;

  afterAll(async () => {
    await h?.cleanup().catch(() => undefined);
  });

  it("produces the P1-11-EVIDENCE JSON block", async () => {
    h = await createPersistentPlatform({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP111RestartScenario(h);
    expect(evidence.cursorBefore.length).toBeGreaterThan(0);
    expect(evidence.proposalCountBefore).toBe(1);
    expect(evidence.decisionCountBefore).toBe(1);
    const block = {
      ticket: "P1-11",
      project: P111_PROJECT,
      cursorBefore: evidence.cursorBefore,
      goalRevisionBefore: evidence.goalRevisionBefore,
      proposalCountBefore: evidence.proposalCountBefore,
      decisionCountBefore: evidence.decisionCountBefore,
      viewBytes: evidence.viewBefore.length,
    };
    const output = process.env["EVIDENCE_OUTPUT_DIR"] ?? "evidence"; mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "p1-11-evidence.json"), JSON.stringify(block, null, 2));
    expect(() => JSON.parse(JSON.stringify(block))).not.toThrow();
  });
});

