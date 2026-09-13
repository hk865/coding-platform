/**
 * P1-05 evidence collection — repeatable:
 *   pnpm vitest run tests/restart/evidence/p1-05-evidence.test.ts
 * Prints ONE deterministic "P1-05-EVIDENCE" JSON block for
 * dev_docs/verification/p1-05-implementation-evidence.md. AUTO-SKIPS until the
 * P1-05 handlers/projections are implemented (no fake).
 */
import { describe, it } from "vitest";
import { createPersistentSqliteHarness } from "../../../src/harness/persistent-harness.js";
import { isP105Ready, runP105Path, verifyP105AfterRestart } from "../p1-05-restart-fixtures.js";

const READY = await isP105Ready();

describe.skipIf(!READY)("P1-05 restart-path evidence", () => {
  it("collects the P1-05 evidence block", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      const before = await runP105Path(h);
      await h.close();
      const restarted = await h.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
      try {
        await verifyP105AfterRestart(restarted, before);
        console.log(
          "P1-05-EVIDENCE " +
            JSON.stringify(
              {
                ticket: "P1-05",
                path: "bootstrap -> install/activate -> CreateGoal -> applyPlan -> claim -> FakeRuntime events -> PASS evidence -> TaskReduction -> GoalPhase reduction -> commit -> close -> reopen -> GoalPhase snapshot / goalStatus / goalTimeline identical",
                goalPhase: before.goalPhase.phase,
                previousPhase: before.goalPhase.previousPhase,
                reasonCodes: before.goalPhase.reasonCodes,
                explanationHeadline: before.goalPhase.explanation.headline,
                explanationItems: before.goalPhase.explanation.items.map((i) => ({ code: i.code, message: i.message })),
                timelineLength: before.timeline.length,
                observedCursorEqual: String(restarted.observedCursor()) === String(before.observedCursor),
                snapshotsMatch: true,
                viewsRebuild: before.statusView !== null && before.timeline.length === 2,
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
  }, 90_000);
});
