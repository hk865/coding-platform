/** Pure initial Plan fold and commit. Domain validation precedes this file;
 * it never reads Store, resolves governance or performs a transaction.
 *
 * The protected records of an adoption (the accepted PlanProposal and the
 * moved Goal pointer), the new Plan's ref and build and the commit's CAS
 * guards come from the state machines the owner ran (STATE-MACHINES-SPEC §3
 * PLAN-04/05/08, §2 GOAL-02/03, §14.1), as one `PlanAdoptionCommit`: this
 * file builds only the compiler-owned PlanRevisionSnapshot and the
 * PlanRevisionAccepted event, and encodes the one PreparedCommit. */
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { ArchitectureBaselinePin, CompletionPolicyPin } from '../../../contracts/governance.js';
import type { GoalSnapshot } from '../../../contracts/ledger.js';
import {
  revisionAssignments,
  type PlanRevisionAcceptedEvent,
  type PlanRevisionDraft,
  type PlanRevisionRef,
  type PlanRevisionSnapshot,
  type PlanTaskAssignment,
  type TaskInputRequirementV2,
} from '../../../contracts/plan.js';
import type { PreparedCommit, RecordGuard } from '../../record-store/ports.js';
import type { PlanProposalEffect } from '../state/plan-machine.js';
import { encodeGoalSnapshot } from '../persistence/record-codecs.js';
import { buildTargetTaskBasis, isBasisUnsupported } from './plan-task-basis.js';
import type { PlanProposal } from './plan-contracts.js';
import {
  encodePlanProposal,
  encodePlanRevisionAcceptedEvent,
  encodePlanRevisionSnapshot,
} from './plan-record-codecs.js';

export type VerifiedGovernance = {
  completionPolicy: CompletionPolicyPin;
  architectureBaseline: ArchitectureBaselinePin;
  /** Aggregate revisions of the immutable revision rows, not content revision. */
  completionPolicyRecordRevision: number;
  architectureBaselineRecordRevision: number;
  policyActiveRevision: number;
  architectureActiveRevision: number;
  guards: readonly RecordGuard[];
};

/** PLAN-08: the new Plan an adoption writes, as the plan machine names it (`ref`, and `build` from the draft or the delta). */
export type PlanRevisionWrite = Extract<PlanProposalEffect, { kind: 'write_plan_revision' }>;

/** One adoption commit as the state machines named it (PLAN-04/05); the owner reads it off their effects. */
export type PlanAdoptionCommit = {
  /** `write_proposal`: the accepted candidate (`acceptProposalRecord`). */
  proposal: Extract<PlanProposal, { kind: 'candidate_v2' }>;
  /** `move_goal_pointer`: the Goal moved by GOAL-02/03 (`nextGoalPointer`). */
  nextGoal: GoalSnapshot;
  /** `write_plan_revision` (PLAN-08). */
  plan: PlanRevisionWrite;
  /** The `guard` effects as the commit's record guards, in the machine's order. */
  guards: readonly RecordGuard[];
};

export type InitialPlanAdoptionInput = {
  /** PLAN-04 + GOAL-02 + PLAN-08: the accepted candidate (its draft is written verbatim), the moved Goal,
   * the new Plan's ref and the CAS guards (origin, scope, candidate, governance, target Plan ∅). */
  commit: PlanAdoptionCommit;
  governance: VerifiedGovernance;
  ledgerHorizon: CommitCursor;
  identityKey: string;
  fingerprint: string;
  eventId: string;
  occurredAt: string;
  commandId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
};
export type CompiledPlanAdoption = { snapshot: PlanRevisionSnapshot; prepared: PreparedCommit };

function buildPlanRevisionSnapshot(input: {
  draft: PlanRevisionDraft;
  ref: PlanRevisionRef;
  goalRef: PlanRevisionSnapshot['goalRef'];
  acceptedAt: string;
  policyPin: CompletionPolicyPin;
  architecturePin: ArchitectureBaselinePin;
}): PlanRevisionSnapshot {
  const { draft } = input;
  const common = {
    ...(draft.reviewAdmissionProtocol !== undefined ? { reviewAdmissionProtocol: draft.reviewAdmissionProtocol } : {}),
    ...(draft.origin !== undefined ? { origin: draft.origin } : {}),
    ref: input.ref,
    revision: 1 as const,
    goalRef: input.goalRef,
    planId: draft.planId,
    planRevision: draft.planRevision,
    acceptedAt: input.acceptedAt,
    effectiveCompletionPolicy: { ref: input.policyPin.ref, digest: input.policyPin.digest },
    effectiveArchitectureBaseline: { ref: input.architecturePin.ref, digest: input.architecturePin.digest },
    stages: draft.stages,
    tasks: draft.tasks,
    ...(draft.assignments !== undefined ? { assignments: draft.assignments } : {}),
    obligations: draft.obligations,
    taskHierarchy: draft.taskHierarchy,
    executionDag: draft.executionDag,
  };
  // The record codec is a single stable store family (`PlanRevisionSnapshot@1`);
  // the accepted body carries its own explicit content version and the v2
  // whiteboard/exact-input fields must survive proposal -> snapshot verbatim.
  if (draft.schemaVersion === 2) {
    return { ...common, schemaVersion: 2,
      ...(draft.taskRelations !== undefined ? { taskRelations: draft.taskRelations } : {}),
      ...(draft.inputRequirements !== undefined ? { inputRequirements: draft.inputRequirements } : {}) };
  }
  return { ...common, schemaVersion: 1 };
}

function planRevisionAcceptedEvent(input: {
  planId: string;
  goalRef: PlanRevisionSnapshot['goalRef'];
  projectId: string;
  workspaceId: string;
  snapshot: PlanRevisionSnapshot;
  goalRevision: number;
  eventId: string;
  occurredAt: string;
  commandId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
}): PlanRevisionAcceptedEvent {
  return {
    eventId: input.eventId,
    eventType: 'PlanRevisionAccepted',
    schemaVersion: 1,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    aggregateType: 'PlanRevision',
    aggregateId: input.planId,
    aggregateRevision: 1,
    causationId: input.commandId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    actor: input.actor,
    occurredAt: input.occurredAt,
    payload: {
      goalId: input.goalRef.goalId,
      goalAggregateRevision: input.goalRevision,
      planRevision: input.snapshot,
    },
  };
}

/** Folds one accepted initial Plan, its Goal pointer and its candidate status
 * into exactly one `PreparedCommit`. Guard order/identity is the caller's input. */
export function compileInitialPlanAdoption(input: InitialPlanAdoptionInput): CompiledPlanAdoption {
  const { proposal: acceptedProposal, nextGoal, plan } = input.commit;
  const snapshot = buildPlanRevisionSnapshot({
    draft: acceptedProposal.draft,
    ref: plan.ref,
    goalRef: nextGoal.ref,
    acceptedAt: input.occurredAt,
    policyPin: input.governance.completionPolicy,
    architecturePin: input.governance.architectureBaseline,
  });
  const event = planRevisionAcceptedEvent({
    planId: acceptedProposal.draft.planId,
    goalRef: nextGoal.ref,
    projectId: nextGoal.ref.projectId,
    workspaceId: acceptedProposal.ref.workspaceId,
    snapshot,
    goalRevision: nextGoal.revision,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    actor: input.actor,
  });
  const prepared: PreparedCommit = {
    identityKey: input.identityKey,
    fingerprint: input.fingerprint,
    guards: input.commit.guards,
    records: [encodeGoalSnapshot(nextGoal), encodePlanRevisionSnapshot(snapshot), encodePlanProposal(acceptedProposal)],
    claims: [],
    indexGuards: [],
    indexChanges: [],
    events: [encodePlanRevisionAcceptedEvent(event)],
    ledgerHorizon: input.ledgerHorizon,
  };
  return { snapshot, prepared };
}

// --------------------------------------------------------------------------
// W1 future-only adoption
// --------------------------------------------------------------------------

/** ONE grouping pass for a Plan's exact inputs, keyed by consumer Task. */
function groupInputsByConsumer(
  requirements: readonly TaskInputRequirementV2[],
): ReadonlyMap<string, TaskInputRequirementV2[]> {
  const byTask = new Map<string, TaskInputRequirementV2[]>();
  for (const requirement of requirements) {
    const list = byTask.get(requirement.consumerTaskId);
    if (list === undefined) byTask.set(requirement.consumerTaskId, [requirement]);
    else list.push(requirement);
  }
  return byTask;
}

export type FuturePlanAdoptionInput = {
  /** PLAN-05 + GOAL-03 + PLAN-08: the accepted candidate (its draft is the target), the moved Goal, the new
   * Plan's ref and the validated delta, and the CAS guards (merged, ending with the target Plan ∅). */
  commit: PlanAdoptionCommit;
  source: PlanRevisionSnapshot;
  identityKey: string;
  fingerprint: string;
  eventId: string;
  occurredAt: string;
  commandId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
};

export type FuturePlanAdoptionCompile =
  | { status: 'compiled'; value: CompiledPlanAdoption }
  | { status: 'unsupported'; reason: string };

/**
 * W1: compiles ONE accepted future-only Plan adoption. The target snapshot is
 * constructed deterministically from the trusted immutable source plus the
 * validated future-only delta; the caller Draft is NEVER written over existing
 * Tasks. It writes the new Plan, the Goal pointer, the accepted proposal and
 * the original adoption event, with the LOCAL guards PLAN-05 names (current
 * Goal/source/proposal, target Plan absence, and confirmed Lease/Reduction
 * absence for each changed or added Task).
 */
export function compileFuturePlanAdoption(input: FuturePlanAdoptionInput): FuturePlanAdoptionCompile {
  const { source } = input;
  const { proposal: acceptedProposal, nextGoal, plan } = input.commit;
  const target = acceptedProposal.draft;
  const build = plan.build;
  // PLAN-05 admits only a schemaVersion 2 draft and names the delta it validated (narrows both types).
  if (target.schemaVersion !== 2 || build.from !== 'future_delta') {
    throw new Error('a future adoption writes a schemaVersion 2 draft from its source and the validated delta');
  }
  const basis = buildTargetTaskBasis({ source, targetRef: plan.ref,
    changedTaskIds: build.changedTaskIds, addedTaskIds: build.addedTaskIds });
  if (isBasisUnsupported(basis)) return { status: 'unsupported', reason: basis.reason };
  // Deterministic source + validated delta: an unchanged Task is written from
  // its immutable source definition, never from the caller body. Only changed
  // or added Tasks take the candidate definition.
  const changed = new Set([...build.changedTaskIds, ...build.addedTaskIds]);
  const sourceTaskById = new Map(source.tasks.map((task) => [task.taskId, task]));
  const sourceAssignmentsById = new Map(revisionAssignments(source).map((assignment) => [assignment.taskId, assignment]));
  const targetAssignmentsById = new Map(revisionAssignments(target).map((assignment) => [assignment.taskId, assignment]));
  const tasks = target.tasks.map((task) => changed.has(task.taskId) ? task : sourceTaskById.get(task.taskId) ?? task);
  const assignments: PlanTaskAssignment[] = [];
  for (const task of tasks) {
    const chosen = changed.has(task.taskId) ? targetAssignmentsById.get(task.taskId) : sourceAssignmentsById.get(task.taskId);
    if (chosen !== undefined) assignments.push(chosen);
  }
  const sourceInputs = groupInputsByConsumer(source.schemaVersion === 2 ? source.inputRequirements ?? [] : []);
  const targetInputs = groupInputsByConsumer(target.inputRequirements ?? []);
  const inputRequirements: TaskInputRequirementV2[] = [];
  for (const task of tasks) {
    const list = changed.has(task.taskId) ? targetInputs.get(task.taskId) : sourceInputs.get(task.taskId);
    if (list !== undefined) inputRequirements.push(...list);
  }
  const snapshot: PlanRevisionSnapshot = {
    ...(source.reviewAdmissionProtocol !== undefined ? { reviewAdmissionProtocol: source.reviewAdmissionProtocol } : {}),
    ...(target.origin !== undefined ? { origin: target.origin }
      : source.origin !== undefined ? { origin: source.origin } : {}),
    ref: plan.ref,
    revision: 1,
    goalRef: nextGoal.ref,
    planId: target.planId,
    planRevision: target.planRevision,
    acceptedAt: input.occurredAt,
    effectiveCompletionPolicy: { ref: source.effectiveCompletionPolicy.ref, digest: source.effectiveCompletionPolicy.digest },
    effectiveArchitectureBaseline: { ref: source.effectiveArchitectureBaseline.ref, digest: source.effectiveArchitectureBaseline.digest },
    stages: target.stages,
    tasks,
    ...(assignments.length > 0 ? { assignments } : {}),
    obligations: target.obligations,
    taskHierarchy: target.taskHierarchy,
    executionDag: target.executionDag,
    schemaVersion: 2,
    ...(target.taskRelations !== undefined ? { taskRelations: target.taskRelations } : {}),
    ...(target.inputRequirements !== undefined ? { inputRequirements } : {}),
    taskStateBasis: basis,
  };
  const event = planRevisionAcceptedEvent({
    planId: target.planId,
    goalRef: nextGoal.ref,
    projectId: nextGoal.ref.projectId,
    workspaceId: acceptedProposal.ref.workspaceId,
    snapshot,
    goalRevision: nextGoal.revision,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    actor: input.actor,
  });
  const prepared: PreparedCommit = {
    identityKey: input.identityKey,
    fingerprint: input.fingerprint,
    guards: input.commit.guards,
    records: [encodeGoalSnapshot(nextGoal), encodePlanRevisionSnapshot(snapshot), encodePlanProposal(acceptedProposal)],
    claims: [],
    indexGuards: [],
    indexChanges: [],
    events: [encodePlanRevisionAcceptedEvent(event)],
  };
  return { status: 'compiled', value: { snapshot, prepared } };
}
