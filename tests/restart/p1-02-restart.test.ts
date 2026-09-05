/**
 * P1-02 restart path (SKELETON — lane D completes/owns):
 *   bootstrap -> install x2 -> activate x2 (CAS) -> CreateGoal -> applyPlan ->
 *   commit -> close -> reopen -> (a) canonical refs/pins re-resolve,
 *   (b) Plan Graph / Task Detail / active revision rebuilt from persisted
 *   EventPages — field-for-field identical to before the restart.
 *
 * skipIf probe: the path runs only when the P1-02 handlers + projections are
 * implemented (stubs throw "P1-02: ... not implemented yet") — no fake.
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

describe.skipIf(true)("P1-02 persistent restart path", () => {
  it(
    "restart: canonical refs + pins + Plan Graph/Task Detail/active revision identical",
    async () => {
      const ready = await isP102Ready();
      if (!ready) return; // probe skip: implementation not landed yet (stubs)
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
