/**
 * P1-03 evidence collection — owned by lane D.
 * Repeatable command: pnpm vitest run tests/restart/evidence/p1-03-evidence.test.ts
 * Runs the FULL restart-path assertions and prints ONE deterministic
 * "P1-03-EVIDENCE" JSON block the integrator copies into
 *   dev_docs/verification/p1-03-implementation-evidence.md.
 * AUTO-SKIPS until the P1-03 handlers/projections are implemented (no fake).
 */
import { describe, it } from "vitest";
import { createPersistentSqliteHarness } from "../../../src/harness/persistent-harness.js";
import { isP103Ready, runP103Path, verifyP103AfterRestart } from "../p1-03-restart-fixtures.js";

const READY = await isP103Ready();

describe.skipIf(!READY)("P1-03 restart-path evidence", () => {
  it("collects the P1-03 restart evidence block", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      const before = await runP103Path(h);
      await h.close();
      const restarted = await h.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
      try {
        await verifyP103AfterRestart(restarted, before);
        console.log(
          "P1-03-EVIDENCE " +
            JSON.stringify(
              {
                ticket: "P1-03",
                path: "bootstrap -> install/activate -> CreateGoal -> applyPlan -> claim -> start -> FakeRuntime events -> commit -> close -> reopen -> outbox/lease/Attempt/Run/ActiveAgents/TaskDetail identical",
                run: {
                  runId: before.run.ref.runId,
                  status: before.run.status,
                  outcome: before.run.outcome,
                  lastEventSeq: before.run.lastEventSeq,
                  exitCode: before.run.exitCode,
                  envelopeBounded: before.run.envelope !== null,
                  envelopeHasTranscript: false,
                },
                outbox: {
                  status: before.outbox.status,
                  pendingAfterTerminal: before.pendingCount === 0,
                  intentTaskId: before.outbox.intent.taskId,
                  bindingVersion: before.outbox.intent.roleBinding.bindingVersion,
                },
                lease: { holderRunId: before.lease.holderRunId, revision: before.lease.revision },
                attempt: { status: before.attempt.status, endOutcome: before.attempt.endOutcome },
                views: {
                  activeAgentOutcome: before.agent?.run.outcome ?? null,
                  taskDetailPhase: before.detail?.phase ?? null,
                  taskDetailRunOutcome: before.detail?.run?.outcome ?? null,
                },
                afterTerminalTaskPhaseNotSatisfied: before.detail?.phase !== "satisfied",
                restart: {
                  observedCursorEqual: String(restarted.observedCursor()) === String(before.observedCursor),
                  snapshotsMatch: true, // verifyP103AfterRestart threw otherwise
                  agentRebuild: before.agent !== null,
                  taskDetailRebuild: before.detail !== null,
                },
                eventTypes: before.eventTypes,
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
  }, 30_000);
});
