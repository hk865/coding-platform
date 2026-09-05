/**
 * P1-02 evidence collection (SKELETON — lane D completes/owns).
 * Repeatable command: pnpm vitest run tests/restart/evidence/p1-02-evidence.test.ts
 * Prints a "P1-02-EVIDENCE" JSON block with the restart evidence.
 */
import { it } from "vitest";
import { createPersistentSqliteHarness } from "../../../src/harness/persistent-harness.js";
import { isP102Ready, runP102Path } from "../p1-02-restart-fixtures.js";

it("collects the P1-02 restart evidence block", async () => {
  const ready = await isP102Ready();
  if (!ready) return;
  const h = await createPersistentSqliteHarness({ deps: {} });
  try {
    const before = await runP102Path(h);
    const pre = {
      cursor: h.observedCursor(),
      policyRef: before.policyRef,
      baselineRef: before.baselineRef,
      activePolicyRef: before.activePolicyRef,
      activeBaselineRef: before.activeBaselineRef,
      goalSnapshotActivePlan: before.goalSnapshotActivePlan,
      goalSnapshotRevision: before.goalSnapshotRevision,
      graph: before.graph,
      taskDetails: before.taskDetails,
      goalView: before.goalView,
    };
    await h.close();
    const restarted = await h.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
    try {
      const after = {
        cursor: restarted.observedCursor(),
        graph: await restarted.planGraph({ projectId: before.projectId, goalId: before.goalId }),
        goalView: await restarted.collaboration.goalView({
          projectId: before.projectId,
          workspaceId: before.workspaceId,
          goalId: before.goalId,
        }),
      };
      const block = {
        eventTypes: before.eventTypes,
        commitCursors: { bootstrap: null },
        pins: {
          completionPolicyDigest: before.planPinPolicyDigest,
          architectureBaselineDigest: before.planPinBaselineDigest,
        },
        graphFields: {
          stages: before.graph?.stages.length ?? 0,
          tasks: before.graph?.tasks.length ?? 0,
          parentOf: before.graph?.taskHierarchy.parentOf.length ?? 0,
          dependsOn: before.graph?.executionDag.dependsOn.length ?? 0,
        },
        restart: {
          cursorBefore: pre.cursor,
          cursorAfter: after.cursor,
          planGraphMatches: JSON.stringify(after.graph) === JSON.stringify({
            status: "ready",
            graph: before.graph,
            observedCursor: before.graph ? (before.graph.sourceCursor as never) : null,
          }) as never,
          goalViewActivePlan: (after.goalView as { goal?: { activePlanRevision: unknown } }).goal?.activePlanRevision ?? null,
        },
      };
      console.log("P1-02-EVIDENCE " + JSON.stringify(block, null, 2));
    } finally {
      await restarted.close();
    }
  } finally {
    await h.cleanup().catch(() => undefined);
  }
}, 30_000);
