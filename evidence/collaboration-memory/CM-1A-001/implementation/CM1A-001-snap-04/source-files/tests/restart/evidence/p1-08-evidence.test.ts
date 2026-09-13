/**
 * P1-08 evidence collection — repeatable (prints the P1-08-EVIDENCE JSON block
 * for dev_docs/verification/p1-08-implementation-evidence.md). AUTO-SKIPS until
 * the P1-08 console projections are implemented (no fake).
 */
import { describe, it } from "vitest";
import { createPersistentSqliteHarness } from "../../../src/harness/persistent-harness.js";
import { isP108Ready, runP108RestartScenario, verifyP108AfterRestart } from "../p1-08-restart-fixtures.js";
import { P108_WORKSPACE, P108_GOAL, createP108ScenarioRuntime } from "../../contract-suite/p1-08-harness.js";

const READY = await isP108Ready();

describe.skipIf(!READY)("P1-08 restart-path evidence", () => {
  it("collects the P1-08 evidence block", async () => {
    const h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    try {
      const ev = await runP108RestartScenario(h);
      await h.close();
      const restarted = await h.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
      try {
        await verifyP108AfterRestart(restarted, ev);
        console.log(
          "P1-08-EVIDENCE " +
            JSON.stringify(
              {
                ticket: "P1-08",
                path: "two-project read-only console (portfolio -> workspace summary -> plan matrix -> active agents -> task evidence -> timeline)",
                scopes: {
                  projectA: ev.before.previews[0]?.projectId,
                  projectB: ev.before.previews[1]?.projectId,
                  sharedWorkspaceId: P108_WORKSPACE,
                  sharedGoalId: P108_GOAL,
                },
                projectA: {
                  workRun: ev.before.projectA.workRun.runId,
                  extraRun: ev.before.projectA.extraRun.runId,
                  replacementRun: ev.before.projectA.extraReplacementRun.runId,
                  packet: ev.before.projectA.packetRef.packetId,
                  goalPhase: ev.before.projectA.goalPhase,
                },
                projectB: {
                  workRun: ev.before.projectB.workRun.runId,
                  extraRun: ev.before.projectB.extraRun.runId,
                  outcomeUnknownPreserved: ev.before.projectB.extraOutcomeUnknown,
                  goalPhase: ev.before.projectB.goalPhase,
                },
                restart: {
                  sixViewsFieldIdentical: true,
                  observedCursorEqual: String(restarted.observedCursor()) === ev.cursorBefore,
                },
              },
              null,
              2,
            ),
        );
      } finally {
        await restarted.close();
      }
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  }, 120_000);
});
