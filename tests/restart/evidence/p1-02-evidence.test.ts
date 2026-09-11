/**
 * P1-02 evidence collection — owned by lane D.
 * Repeatable command: pnpm vitest run tests/restart/evidence/p1-02-evidence.test.ts
 * Runs the FULL restart-path assertions (canonical refs/pins + Plan Graph /
 * Task Detail / active revision rebuilt from persisted EventPages) and prints
 * ONE deterministic "P1-02-EVIDENCE" JSON block the integrator copies into
 *   dev_docs/verification/p1-02-implementation-evidence.md.
 * AUTO-SKIPS while the P1-02 handlers/projections are not yet implemented
 * (\`isP102Ready()\` runs the full pre-restart path; a remaining "P1-02: ... not
 * implemented yet" stub throw -> false). No fake.
 */
import { describe, it } from "vitest";
import { createPersistentSqliteHarness } from "../../../src/harness/persistent-harness.js";
import type { GoalSnapshot } from "../../../src/contracts/ledger.js";
import { resolveProjectCompletionPolicy, resolveProjectArchitectureBaseline } from "../../../src/data/state-ledger/governance-records.js";
import { isP102Ready, runP102Path, verifyP102AfterRestart } from "../p1-02-restart-fixtures.js";

const READY = await isP102Ready();

describe.skipIf(!READY)("P1-02 restart-path evidence", () => {
  it("collects the P1-02 restart evidence block", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      const before = await runP102Path(h);
      const observedBefore = h.observedCursor();

      // process restart: close both connections, reopen on the SAME ledger file
      // + a FRESH read model file (rebuild-from-events evidence path).
      await h.close();
      const restarted = await h.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
      try {
        // Full assertion set — throws if the restart path is broken.
        await verifyP102AfterRestart(restarted, before);
        const observedAfter = restarted.observedCursor();

        const { projectId, workspaceId, goalId } = before;

        // ---- post-restart re-query (for the evidence block) --------------- //
        const goalSnapshot = await restarted.ledger.load({ aggregateType: "Goal", projectId, goalId });
        const afterGoalActive = goalSnapshot.status === "found"
          ? (goalSnapshot.snapshot as GoalSnapshot).activePlanRevision
          : null;
        const afterGoalRevision = goalSnapshot.status === "found"
          ? (goalSnapshot.snapshot as GoalSnapshot).revision
          : null;

        const policy = await resolveProjectCompletionPolicy(restarted.ledger, projectId);
        const baseline = await resolveProjectArchitectureBaseline(restarted.ledger, projectId);

        const graph = await restarted.planGraph({ projectId, goalId });
        const afterGraph = graph.status === "ready" ? graph.graph : null;

        let taskDetailsMatch = true;
        let taskDetailCount = 0;
        for (const task of before.taskDetails) {
          const d = await restarted.taskDetail({ projectId, goalId, taskId: task.taskId });
          taskDetailCount += 1;
          if (d.status !== "ready" || JSON.stringify(d.task) !== JSON.stringify(task)) {
            taskDetailsMatch = false;
          }
        }

        const goalView = await restarted.collaboration.goalView({ projectId, workspaceId, goalId });
        const afterGoalViewActive = goalView.status === "ready" ? goalView.goal.activePlanRevision : null;

        const pinsUnchanged =
          afterGraph !== null &&
          afterGraph.pinnedCompletionPolicy.digest === before.planPinPolicyDigest &&
          afterGraph.pinnedArchitectureBaseline.digest === before.planPinBaselineDigest;

        const evidence = {
          ticket: "P1-02",
          path: "bootstrap -> install x2 -> activate x2 (CAS) -> CreateGoal -> applyPlan -> commit -> close -> reopen -> canonical refs/pins + Plan Graph/Task Detail/active revision identical",
          commitCursors: before.commitCursors,
          canonicalRefs: {
            completionPolicy: { ref: before.policyRef, digest: before.policyDigest },
            architectureBaseline: { ref: before.baselineRef, digest: before.baselineDigest },
          },
          activeRefs: {
            completionPolicy: {
              activeRevision: before.activePolicyRef,
              aggregateRevision: before.activePolicyAggregateRevision,
            },
            architectureBaseline: {
              activeRevision: before.activeBaselineRef,
              aggregateRevision: before.activeBaselineAggregateRevision,
            },
          },
          pins: {
            completionPolicy: before.planPinPolicy,
            architectureBaseline: before.planPinBaseline,
          },
          goalSnapshot: {
            activePlanRevision: before.goalSnapshotActivePlan,
            revision: before.goalSnapshotRevision,
          },
          planGraphFields: {
            planRef: before.graph?.planRef ?? null,
            planRevision: before.graph?.planRevision ?? null,
            acceptedAt: before.graph?.acceptedAt ?? null,
            stages: before.graph?.stages.length ?? 0,
            tasks: before.graph?.tasks.length ?? 0,
            parentOf: before.graph?.taskHierarchy.parentOf.length ?? 0,
            dependsOn: before.graph?.executionDag.dependsOn.length ?? 0,
          },
          eventTypes: before.eventTypes,
          restart: {
            observedCursorBefore: observedBefore !== null ? String(observedBefore) : null,
            observedCursorAfter: observedAfter !== null ? String(observedAfter) : null,
            cursorEqual: String(observedAfter) === String(observedBefore),
            canonicalGoalSnapshotActivePlanMatches:
              JSON.stringify(afterGoalActive) === JSON.stringify(before.goalSnapshotActivePlan),
            goalRevisionMatches: afterGoalRevision === before.goalSnapshotRevision,
            canonicalPolicyResolves: policy.status === "found",
            canonicalBaselineResolves: baseline.status === "found",
            planGraphMatches: JSON.stringify(afterGraph) === JSON.stringify(before.graph),
            taskDetailCount,
            taskDetailsMatch,
            pinsUnchanged,
            goalViewActivePlanAfterRestart: afterGoalViewActive,
          },
        };
        console.log("P1-02-EVIDENCE " + JSON.stringify(evidence, null, 2));
      } finally {
        await restarted.close();
      }
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  }, 30_000);
});
