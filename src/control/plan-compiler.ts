/**
 * P1-11 PlanCompiler entry: bounded proposal + impact analysis (never mutates).
 *
 * Frozen boundary (IMPLEMENTATION-HANDOFF.md P1-11 §1/§2 + ticket P1-11):
 *   - AmendGoalRequest is bounded and NEVER mutates; this compiler NEVER writes
 *     canonical state — reads go ONLY through deps.ledger.load; zero ledger
 *     commits on every path.
 *   - request() validates the intent (schemaVersion=1 / requestId / projectId /
 *     workspaceId / goalRef / requestedBy / submittedAt / bounded deltas: ≤64
 *     obligationDeltas each with a non-empty justification + valid
 *     objectiveDelta.kind), loads the Goal to read activePlanRevision, loads the
 *     accepted PlanRevision (sourcePlan) and derives a bounded proposal.
 *   - Rejection codes follow the P1-09/P1-11 style: invalid_request for a
 *     malformed intent, not_found for a missing goal, needs_material for a
 *     material gap (active plan missing).
 *   - proposalId is derived deterministically from requestId ("proposal-" +
 *     requestId) — same input -> same proposal (the only "volatile" fields are
 *     derived: proposalId + generatedAt=now()). No randomness.
 */
import type {
  AmendGoalRequestV1,
  ChangeImpactAnalysisV1,
  PlanPatchV1,
  PlanProposalPort,
  PlanProposalV1,
} from "../contracts/goal-change.js";
import { PLAN_CHANGE_MAX_OBLIGATION_DELTAS } from "../contracts/goal-change.js";
import type { StateLedger, GoalSnapshot } from "../contracts/ledger.js";
import type { ReadModelIndex } from "../contracts/goal-view.js";
import type { PlanRevisionSnapshot } from "../contracts/plan.js";
import type { WorkContextRef } from "../contracts/context-continuity.js";

export type PlanCompilerDeps = {
  ledger: StateLedger;
  readModel: ReadModelIndex;
  now: () => string;
};

export type PlanProposalResult =
  | { status: "proposal"; proposal: PlanProposalV1 }
  | { status: "needs_material"; gaps: string[] }
  | { status: "rejected"; code: string; message: string };

/** LANE-B implementation (ctor deps frozen; never mutates). */
export class PlanCompilerImpl implements PlanProposalPort {
  private readonly deps: PlanCompilerDeps;
  constructor(deps: PlanCompilerDeps) {
    this.deps = deps;
  }

  async request(intent: AmendGoalRequestV1): Promise<PlanProposalResult> {
    // 1) Bounded intent validation (zero-write).
    const invalid = validateAmendIntent(intent);
    if (invalid !== null) {
      return { status: "rejected", code: "invalid_request", message: invalid };
    }

    // 2) Goal must exist (authoritative refusal, P1-09 style).
    const goalResult = await this.deps.ledger.load(intent.goalRef);
    if (goalResult.status === "not_found") {
      return {
        status: "rejected",
        code: "not_found",
        message: `goal ${intent.goalRef.goalId} in project ${intent.goalRef.projectId} not found`,
      };
    }
    const goal = goalResult.snapshot;
    if (!isGoalSnapshot(goal)) {
      return {
        status: "rejected",
        code: "not_found",
        message: `goal ${intent.goalRef.goalId} in project ${intent.goalRef.projectId} is not a Goal aggregate`,
      };
    }

    // 3) The proposed change needs an ACTIVE plan revision to patch.
    if (goal.activePlanRevision === null) {
      return { status: "needs_material", gaps: ["active_plan_missing"] };
    }
    const planResult = await this.deps.ledger.load(goal.activePlanRevision);
    if (planResult.status !== "found" || !isPlanRevisionSnapshot(planResult.snapshot)) {
      return { status: "needs_material", gaps: ["active_plan_missing"] };
    }
    const sourcePlan = planResult.snapshot;

    // 4) Assemble the bounded proposal + impact analysis (read-only, derived).
    const proposal = buildProposal(this.deps.now(), intent, goal, sourcePlan);
    return { status: "proposal", proposal };
  }
}

function validateAmendIntent(intent: AmendGoalRequestV1): string | null {
  if (intent.schemaVersion !== 1) return "schemaVersion must be 1";
  if (typeof intent.requestId !== "string" || intent.requestId.length === 0) {
    return "requestId is required";
  }
  if (typeof intent.projectId !== "string" || intent.projectId.length === 0) {
    return "projectId is required";
  }
  if (typeof intent.workspaceId !== "string" || intent.workspaceId.length === 0) {
    return "workspaceId is required";
  }
  if (
    !intent.goalRef ||
    intent.goalRef.aggregateType !== "Goal" ||
    typeof intent.goalRef.projectId !== "string" ||
    typeof intent.goalRef.goalId !== "string"
  ) {
    return "goalRef must reference a Goal";
  }
  if (!intent.requestedBy || typeof intent.requestedBy !== "object") {
    return "requestedBy is required";
  }
  if (typeof intent.submittedAt !== "string") return "submittedAt is required";

  if (intent.objectiveDelta !== null) {
    if (typeof intent.objectiveDelta !== "object") return "objectiveDelta is invalid";
    if (!["change", "clarify", "restore"].includes(intent.objectiveDelta.kind)) {
      return "objectiveDelta.kind must be change | clarify | restore";
    }
  }
  if (!Array.isArray(intent.obligationDeltas)) {
    return "obligationDeltas must be an array";
  }
  if (intent.obligationDeltas.length > PLAN_CHANGE_MAX_OBLIGATION_DELTAS) {
    return `obligationDeltas must not exceed ${PLAN_CHANGE_MAX_OBLIGATION_DELTAS}`;
  }
  for (const d of intent.obligationDeltas) {
    if (typeof d.obligationId !== "string" || d.obligationId.length === 0) {
      return "each obligation delta requires a non-empty obligationId";
    }
    if (!["add", "change", "remove"].includes(d.action)) {
      return `obligation delta ${d.obligationId} action must be add | change | remove`;
    }
    if (typeof d.justification !== "string" || d.justification.length === 0) {
      return `obligation delta ${d.obligationId} requires a non-empty justification`;
    }
  }
  return null;
}

function buildProposal(
  now: string,
  intent: AmendGoalRequestV1,
  goal: GoalSnapshot,
  sourcePlan: PlanRevisionSnapshot,
): PlanProposalV1 {
  const proposalId = "proposal-" + intent.requestId;
  const patchId = "patch-" + proposalId;

  // The objective comes from the intent delta when present, otherwise it keeps
  // the CURRENT goal objective (PlanRevisionSnapshot carries no objective).
  const objective = intent.objectiveDelta?.newObjective ?? goal.objective;

  const patch: PlanPatchV1 = {
    schemaVersion: 1,
    patchId,
    projectId: intent.projectId,
    workspaceId: intent.workspaceId,
    goalRef: intent.goalRef,
    sourcePlanRef: sourcePlan.ref,
    sourcePlanRevision: sourcePlan.planRevision,
    patchDraft: {
      objective,
      obligationDeltas: intent.obligationDeltas,
      taskHierarchy: null,
    },
    inScope: deriveInScope(intent),
    outOfScope: ["task set changes", "new domain modules", "dispatch semantics"],
    generatedAt: now,
  };

  const impact: ChangeImpactAnalysisV1 = {
    schemaVersion: 1,
    analysisId: "impact-" + proposalId,
    patchRef: sourcePlan.ref,
    affectedWorks: deriveAffectedWorks(intent, sourcePlan),
    staleAssumptions: [
      {
        assumption: "active plan revision 将被替换",
        reason: "本次变更会创建新的 plan revision 并替换当前 active revision（旧 revision 保留）",
      },
      {
        assumption: "affected obligations 的 evidence 适用性需重算",
        reason: "obligation 变化后，相关 evidence 在新 binding 锚点下的适用性需重算",
      },
    ],
    materialsToRefresh: ["planContext", "evidenceBindings"],
    independentWork: [],
    generatedAt: now,
  };

  return {
    schemaVersion: 1,
    proposalId,
    projectId: intent.projectId,
    workspaceId: intent.workspaceId,
    sourceGoalRef: intent.goalRef,
    sourcePlanRef: sourcePlan.ref,
    sourcePlanRevision: sourcePlan.planRevision,
    patch,
    impact,
    alternatives: [],
    generatedAt: now,
  };
}

function deriveInScope(intent: AmendGoalRequestV1): string[] {
  const inScope: string[] = [];
  if (intent.objectiveDelta !== null) inScope.push("goal objective");
  for (const d of intent.obligationDeltas) {
    inScope.push(`acceptance obligation ${d.obligationId} (${d.action})`);
  }
  // Always present so the bounded proposal carries a concrete in-scope set.
  inScope.push("affected task dispositions");
  return inScope;
}

function deriveAffectedWorks(
  intent: AmendGoalRequestV1,
  sourcePlan: PlanRevisionSnapshot,
): { workRef: WorkContextRef; refreshRequired: boolean; reason: string }[] {
  const rows: { workRef: WorkContextRef; refreshRequired: boolean; reason: string }[] = [];
  const seen = new Set<string>();
  for (const delta of intent.obligationDeltas) {
    // The affected tasks are the source obligation's taskIds. An "add" delta
    // has no source obligation yet — mirror the P1-11 fixture clone default
    // (a new required obligation reuses the first source obligation's tasks).
    let taskIds: string[] = [];
    if (delta.action === "add") {
      const first = sourcePlan.obligations[0];
      taskIds = first ? first.taskIds : [];
    } else {
      const ob = sourcePlan.obligations.find((o) => o.obligationId === delta.obligationId);
      taskIds = ob ? ob.taskIds : [];
    }
    for (const taskId of taskIds) {
      const workId = "work-" + taskId;
      // Dedupe so affectedWorks stays <= the bounded cap; a binding that does
      // not yet exist is still recorded as affected (no readModel query).
      if (seen.has(workId)) continue;
      seen.add(workId);
      rows.push({
        workRef: {
          aggregateType: "WorkContextBinding",
          projectId: intent.projectId,
          workspaceId: intent.workspaceId,
          workId,
        },
        refreshRequired: delta.action !== "remove",
        reason: `obligation ${delta.obligationId} ${delta.action} 影响 task ${taskId}`,
      });
    }
  }
  return rows;
}

function isGoalSnapshot(snapshot: unknown): snapshot is GoalSnapshot {
  const s = snapshot as GoalSnapshot;
  return (
    s !== null &&
    typeof s === "object" &&
    (s as { ref?: { aggregateType?: string } }).ref?.aggregateType === "Goal"
  );
}

function isPlanRevisionSnapshot(snapshot: unknown): snapshot is PlanRevisionSnapshot {
  const s = snapshot as { ref?: { aggregateType?: string } };
  return s?.ref?.aggregateType === "PlanRevision";
}
