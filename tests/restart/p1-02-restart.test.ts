/**
 * P1-02 restart path — owned by lane D.
 *   bootstrap -> install x2 -> activate x2 (CAS) -> CreateGoal -> applyPlan ->
 *   commit -> close -> reopen -> (a) canonical refs/pins re-resolve,
 *   (b) Plan Graph / Task Detail / active revision rebuilt from persisted
 *   EventPages — field-for-field identical to before the restart.
 *
 * Readiness probe (never fake): the suite only RUNS when the P1-02 handlers
 * (install/activate/applyPlan) AND projections (planGraph/taskDetail/goalView)
 * are implemented — \`isP102Ready()\` runs the full pre-restart path and any
 * remaining "P1-02: ... not implemented yet" stub throw makes it false, so the
 * test SKIPs until the lanes land (same auto-enable pattern as P1-01).
 */
import { describe, expect, it } from "vitest";
import {
  createPersistentSqliteHarness,
} from "../../src/harness/persistent-harness.js";
import {
  isP102Ready,
  runP102Path,
  verifyP102AfterRestart,
} from "./p1-02-restart-fixtures.js";

const READY = await isP102Ready();

describe.skipIf(!READY)("P1-02 persistent restart path", () => {
  it(
    "restart: canonical refs + pins + Plan Graph/Task Detail/active revision identical",
    async () => {
      const h = await createPersistentSqliteHarness({ deps: {} });
      try {
        const before = await runP102Path(h);
        const cursorBefore = h.observedCursor();
        // process restart: close both connections
        await h.close();
        // reopen on the SAME ledger file + a FRESH read model file (rebuild path)
        const restarted = await h.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
        try {
          await verifyP102AfterRestart(restarted, before);
          const cursorAfter = restarted.observedCursor();
          expect(cursorAfter).toEqual(cursorBefore);
          // distinct event-type set — NO TaskAttempt / AgentRun / dispatch.
          expect(before.eventTypes).toEqual([
            "ProjectBootstrapped",
            "WorkspaceBootstrapped",
            "CompletionPolicyInstalled",
            "ArchitectureBaselineInstalled",
            "CompletionPolicyActivated",
            "ArchitectureBaselineActivated",
            "GoalCreated",
            "PlanRevisionAccepted",
          ]);
        } finally {
          await restarted.close();
        }
      } finally {
        await h.cleanup().catch(() => undefined);
      }
    },
    30_000,
  );
});
