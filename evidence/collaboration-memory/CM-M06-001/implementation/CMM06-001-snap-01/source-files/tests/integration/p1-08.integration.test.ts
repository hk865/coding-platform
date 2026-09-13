/**
 * P1-08 real-SQLite full-path integration (no fakes): two-project console
 * scenario -> restart equivalence. AUTO-SKIPS until the P1-08 console
 * projections are implemented (probe).
 */
import { describe, it, expect } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { isP108Ready, runP108RestartScenario, verifyP108AfterRestart } from "../restart/p1-08-restart-fixtures.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";

const READY = await isP108Ready();

describe.skipIf(!READY)("P1-08 real SQLite integration", () => {
  it("full two-project console path + restart equivalence", async () => {
    const h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    try {
      const evidence = await runP108RestartScenario(h);
      expect(evidence.before.projectA.goalPhase).toBe("COMPLETED");
      expect(evidence.before.projectB.goalPhase).not.toBe("COMPLETED");
      await h.close();
      const restarted = await h.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
      try {
        await verifyP108AfterRestart(restarted, evidence);
      } finally {
        await restarted.close();
      }
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  }, 120_000);
});
