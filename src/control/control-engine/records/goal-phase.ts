/** Control-owned canonical record construction. */
import type { PlanRevisionRef } from "../../../contracts/plan.js";
import type { GoalPhase, GoalPhaseReasonCode, GoalPhaseRef, GoalPhaseSnapshot, GoalPhaseUpdatedEvent, GoalCompletionExplanation, GoalSideEffectReconciliation } from "../../../contracts/goal-phase.js";
import { goalPhaseRefFor, reduceGoalFingerprint } from "../../../contracts/goal-phase.js";
import type { GoalReductionLedgerCommitV1 } from "../../../contracts/ledger.js";



export type BuildGoalPhaseSnapshotDeps = {
  projectId: string;
  goalId: string;
  revision: number;
  planRef: PlanRevisionRef | null;
  previousPhase: GoalPhase | null;
  phase: GoalPhase;
  reasonCodes: GoalPhaseReasonCode[];
  explanation: GoalCompletionExplanation;
  sideEffectReconciliation: GoalSideEffectReconciliation;
  reducedAt: string;
};


export function buildGoalPhaseSnapshot(deps: BuildGoalPhaseSnapshotDeps): GoalPhaseSnapshot {
  return {
    ref: goalPhaseRefFor(deps.projectId, deps.goalId),
    revision: deps.revision,
    schemaVersion: 1,
    planRef: deps.planRef === null ? null : { ...deps.planRef },
    previousPhase: deps.previousPhase,
    phase: deps.phase,
    reasonCodes: [...deps.reasonCodes],
    explanation: {
      schemaVersion: 1,
      phase: deps.explanation.phase,
      headline: deps.explanation.headline,
      items: deps.explanation.items.map((i) => ({ ...i, refs: { ...i.refs } })),
    },
    sideEffectReconciliation: {
      identified: deps.sideEffectReconciliation.identified.map((s) => ({ ...s, runRef: { ...s.runRef } })),
      unreconciled: deps.sideEffectReconciliation.unreconciled.map((s) => ({ ...s, runRef: { ...s.runRef } })),
    },
    reducedAt: deps.reducedAt,
  };
}


/** Deterministic goal-reduction fold target (fold-equality for Control). */
export function buildGoalReductionLedgerCommit(
  command: import("../../../contracts/goal-phase.js").ReduceGoalCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    workspaceId: string;
    phase: GoalPhaseSnapshot;
  },
): GoalReductionLedgerCommitV1 {
  const ref: GoalPhaseRef = deps.phase.ref;
  const event: GoalPhaseUpdatedEvent = {
    eventId: deps.eventId,
    eventType: "GoalPhaseUpdated",
    schemaVersion: 1,
    projectId: ref.projectId,
    workspaceId: deps.workspaceId,
    aggregateType: "GoalPhase",
    aggregateId: ref.goalId,
    aggregateRevision: deps.phase.revision,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: {
      goalId: ref.goalId,
      previousPhase: deps.phase.previousPhase,
      phase: deps.phase.phase,
      reasonCodes: [...deps.phase.reasonCodes],
      explanation: deps.phase.explanation,
      sideEffectReconciliation: deps.phase.sideEffectReconciliation,
      planRef: deps.phase.planRef === null ? null : { ...deps.phase.planRef },
      reducedAt: deps.phase.reducedAt,
    },
  };
  return {
    commitKind: "goal-reduction",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: reduceGoalFingerprint(command),
    expectedVersions: [{ ref, revision: deps.phase.revision - 1 }],
    events: [event],
    snapshots: [deps.phase],
    outboxIntents: [],
  };
}