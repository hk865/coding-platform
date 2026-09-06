/**
 * P1-08 restart equivalence (real SQLite, no fakes): full two-project console
 * scenario -> close -> reopen -> the six console views field-for-field
 * identical + observedCursor identical. AUTO-SKIPS until the P1-08 console
 * projections are implemented (probe).
 */
import { describe, it, expect } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { isP108Ready, runP108RestartScenario, verifyP108AfterRestart } from "./p1-08-restart-fixtures.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";

const READY = await isP108Ready();

describe.skipIf(!READY)("P1-08 restart", () => {
  it("six views + cursor identical after close/reopen (rebuild from persisted events)", async () => {
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
