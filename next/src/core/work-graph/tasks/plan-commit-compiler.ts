/** Pure initial Plan fold and commit. Domain validation precedes this file;
 * it never reads Store, resolves governance or performs a transaction. */
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { ArchitectureBaselinePin, CompletionPolicyPin } from '../../../contracts/governance.js';
import type { GoalSnapshot } from '../../../contracts/ledger.js';
import {
  revisionAssignments,
  type PlanRevisionAcceptedEvent,
  type PlanRevisionDraft,
  type PlanRevisionSnapshot,
  type PlanTaskAssignment,
  type TaskInputRequirementV2,
} from '../../../contracts/plan.js';
import type { PreparedCommit, RecordGuard } from '../../record-store/ports.js';
import { encodeGoalSnapshot } from '../persistence/record-codecs.js';
import { buildTargetTaskBasis, isBasisUnsupported } from './plan-task-basis.js';
import type { PlanProposal } from './plan-contracts.js';
import {
  encodePlanProposal,
  encodePlanRevisionAcceptedEvent,
  encodePlanRevisionSnapshot,
  planRevisionRefKey,
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
export type InitialPlanAdoptionInput = {
  goal: GoalSnapshot;
  proposal: Extract<PlanProposal, { kind: 'candidate_v2' }>;
  draft: PlanRevisionDraft;
  governance: VerifiedGovernance;
  /** Scope, candidate and every prior source read, including absence guards. */
  priorGuards: readonly RecordGuard[];
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
export type CompiledInitialPlanAdoption = {
  snapshot: PlanRevisionSnapshot;
  nextGoal: GoalSnapshot;
  acceptedProposal: Extract<PlanProposal, { kind: 'candidate_v2' }>;
  prepared: PreparedCommit;
};

function buildPlanRevisionSnapshot(input: {
  draft: PlanRevisionDraft;
  goalRef: PlanRevisionSnapshot['goalRef'];
  projectId: string;
  acceptedAt: string;
  policyPin: CompletionPolicyPin;
  architecturePin: ArchitectureBaselinePin;
}): PlanRevisionSnapshot {
  const { draft } = input;
  const common = {
    ...(draft.reviewAdmissionProtocol !== undefined ? { reviewAdmissionProtocol: draft.reviewAdmissionProtocol } : {}),
    ...(draft.origin !== undefined ? { origin: draft.origin } : {}),
    ref: { aggregateType: 'PlanRevision' as const, projectId: input.projectId, planId: draft.planId },
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
export function compileInitialPlanAdoption(input: InitialPlanAdoptionInput): CompiledInitialPlanAdoption {
  const snapshot = buildPlanRevisionSnapshot({
    draft: input.draft,
    goalRef: input.goal.ref,
    projectId: input.goal.ref.projectId,
    acceptedAt: input.occurredAt,
    policyPin: input.governance.completionPolicy,
    architecturePin: input.governance.architectureBaseline,
  });
  const nextGoal: GoalSnapshot = { ...input.goal, activePlanRevision: snapshot.ref, revision: input.goal.revision + 1 };
  const acceptedProposal: Extract<PlanProposal, { kind: 'candidate_v2' }> = {
    ...input.proposal,
    revision: input.proposal.revision + 1,
    status: 'accepted',
  };
  const event = planRevisionAcceptedEvent({
    planId: input.draft.planId,
    goalRef: input.goal.ref,
    projectId: input.goal.ref.projectId,
    workspaceId: input.proposal.ref.workspaceId,
    snapshot,
    goalRevision: nextGoal.revision,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    actor: input.actor,
  });
  const guards: RecordGuard[] = [
    ...input.priorGuards,
    ...input.governance.guards,
    { refKey: planRevisionRefKey(snapshot.ref), expectedRevision: null },
  ];
  const prepared: PreparedCommit = {
    identityKey: input.identityKey,
    fingerprint: input.fingerprint,
    guards,
    records: [encodeGoalSnapshot(nextGoal), encodePlanRevisionSnapshot(snapshot), encodePlanProposal(acceptedProposal)],
    claims: [],
    indexGuards: [],
    indexChanges: [],
    events: [encodePlanRevisionAcceptedEvent(event)],
    ledgerHorizon: input.ledgerHorizon,
  };
  return { snapshot, nextGoal, acceptedProposal, prepared };
}

// --------------------------------------------------------------------------
// W1 future-only adoption (Stage 1 skeleton, no behavior)
// --------------------------------------------------------------------------

/**
 * W1: compiles ONE accepted future-only Plan adoption. The target snapshot is
 * constructed deterministically from the trusted immutable source plus the
 * validated future-only delta; the caller Draft is NEVER written over existing
 * Tasks. It writes the new Plan, the Goal pointer, the accepted proposal and
 * the original adoption event, with LOCAL guards (current Goal/source/proposal,
 * target Plan absence, and confirmed Lease/Reduction absence for each changed
 * or added Task). The initial fold above is unchanged.
 *
 * Stage 1 declares the contact point only; it returns an explicit unsupported
 * outcome and writes nothing.
 */
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
  goal: GoalSnapshot;
  source: PlanRevisionSnapshot;
  candidate: Extract<PlanProposal, { kind: 'candidate_v2' }>;
  target: PlanRevisionDraft;
  changedTaskIds: readonly string[];
  addedTaskIds: readonly string[];
  priorGuards: readonly RecordGuard[];
  identityKey: string;
  fingerprint: string;
  eventId: string;
  occurredAt: string;
  commandId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
};

export type CompiledFuturePlanAdoption = {
  snapshot: PlanRevisionSnapshot;
  nextGoal: GoalSnapshot;
  acceptedProposal: Extract<PlanProposal, { kind: 'candidate_v2' }>;
  prepared: PreparedCommit;
};

export type FuturePlanAdoptionCompile =
  | { status: 'compiled'; value: CompiledFuturePlanAdoption }
  | { status: 'unsupported'; reason: string };

export function compileFuturePlanAdoption(input: FuturePlanAdoptionInput): FuturePlanAdoptionCompile {
  const { source, target, goal, candidate } = input;
  if (target.schemaVersion !== 2) {
    return { status: 'unsupported', reason: 'W1 future-only adoption requires a schemaVersion 2 target' };
  }
  const targetRef = { aggregateType: 'PlanRevision' as const, projectId: goal.ref.projectId, planId: target.planId };
  const basis = buildTargetTaskBasis({ source, targetRef,
    changedTaskIds: input.changedTaskIds, addedTaskIds: input.addedTaskIds });
  if (isBasisUnsupported(basis)) return { status: 'unsupported', reason: basis.reason };
  // Deterministic source + validated delta: an unchanged Task is written from
  // its immutable source definition, never from the caller body. Only changed
  // or added Tasks take the candidate definition.
  const changed = new Set([...input.changedTaskIds, ...input.addedTaskIds]);
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
  const targetInputs = groupInputsByConsumer(target.schemaVersion === 2 ? target.inputRequirements ?? [] : []);
  const inputRequirements: TaskInputRequirementV2[] = [];
  for (const task of tasks) {
    const list = changed.has(task.taskId) ? targetInputs.get(task.taskId) : sourceInputs.get(task.taskId);
    if (list !== undefined) inputRequirements.push(...list);
  }
  const snapshot: PlanRevisionSnapshot = {
    ...(source.reviewAdmissionProtocol !== undefined ? { reviewAdmissionProtocol: source.reviewAdmissionProtocol } : {}),
    ...(target.origin !== undefined ? { origin: target.origin }
      : source.origin !== undefined ? { origin: source.origin } : {}),
    ref: targetRef,
    revision: 1,
    goalRef: goal.ref,
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
  const nextGoal: GoalSnapshot = { ...goal, activePlanRevision: snapshot.ref, revision: goal.revision + 1 };
  const acceptedProposal: Extract<PlanProposal, { kind: 'candidate_v2' }> = {
    ...candidate,
    revision: candidate.revision + 1,
    status: 'accepted',
  };
  const event = planRevisionAcceptedEvent({
    planId: target.planId,
    goalRef: goal.ref,
    projectId: goal.ref.projectId,
    workspaceId: candidate.ref.workspaceId,
    snapshot,
    goalRevision: nextGoal.revision,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    actor: input.actor,
  });
  const guards: RecordGuard[] = [
    ...input.priorGuards,
    { refKey: planRevisionRefKey(snapshot.ref), expectedRevision: null },
  ];
  const prepared: PreparedCommit = {
    identityKey: input.identityKey,
    fingerprint: input.fingerprint,
    guards,
    records: [encodeGoalSnapshot(nextGoal), encodePlanRevisionSnapshot(snapshot), encodePlanProposal(acceptedProposal)],
    claims: [],
    indexGuards: [],
    indexChanges: [],
    events: [encodePlanRevisionAcceptedEvent(event)],
  };
  return { status: 'compiled', value: { snapshot, nextGoal, acceptedProposal, prepared } };
}
