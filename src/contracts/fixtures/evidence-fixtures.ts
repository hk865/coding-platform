/**
 * P1-04 shared fixtures — plan/evidence/reduction builders + the deterministic
 * scenario prepare paths (same pattern as P1-02/P1-03 fixture builders: the
 * Control handlers must fold EXACTLY these shapes given the same ids).
 *
 * FROZEN identity choices:
 *   - the P1-04 plan fixture ("plan-evidence-mvp") has NO dependsOn edges on
 *     dispatchable tasks: P1-03's frozen evaluateTaskEligibility reads the
 *     plan-snapshot phases (static "pending"), so DAG-ordered dispatch of
 *     dependent tasks is not exercisable until a later scheduling ticket;
 *     the gate carries the DAG edges (gates are never dispatched).
 *   - claim/observation/verdict evidence ids and coverage are explicit in
 *     fixtures (deterministic); the admission index order is the evidence
 *     submission order.
 */
import type { CommandIdentity } from "../command-event.js";
import { commandIdentityKey } from "../command-event.js";
import type { PlanRevisionDraft, PlanRevisionRef } from "../plan.js";
import type { ArchitectureBaselinePin, CompletionPolicyPin, VersionedCompletionPolicyFixture } from "../governance.js";
import type { ArtifactRef } from "../artifact.js";
import type { RunRef, TaskTriple } from "../dispatch.js";
import type {
  EffectivityAnchorV1,
  EvidenceAdmittedEvent,
  EvidenceCoverageV1,
  EvidenceKind,
  EvidenceOutcome,
  EvidenceSnapshot,
  EvidenceV1,
  SubmitEvidenceCommand,
  TaskEvidenceIndexSnapshot,
} from "../evidence.js";
import { evidenceRefFor, submitEvidenceFingerprint, taskEvidenceIndexRefFor } from "../evidence.js";
import type { EvidenceIntakeLedgerCommitV1 } from "../ledger.js";
import type {
  ReduceTaskCommand,
  TaskReductionRef,
  TaskReductionSnapshot,
  TaskReductionUpdatedEvent,
} from "../reduction.js";
import { reduceTaskFingerprint, taskReductionRefFor } from "../reduction.js";
import type { TaskReductionLedgerCommitV1 } from "../ledger.js";
import { canonicalJson } from "../fingerprint.js";

// ------------------------------------------------------------------------ //
// P1-04 plan fixture                                                         //
// ------------------------------------------------------------------------ //

export const P104_TASK_IMPLEMENT = "task-implement";
export const P104_TASK_REVIEW = "task-review";
export const P104_TASK_GATE = "gate-evidence";
export const P104_TASK_BLOCKED = "task-blocked-104";
export const P104_TASK_DEFERRED = "task-deferred-104";

export const P104_OBL_IMPLEMENT = "obl-implement";
export const P104_OBL_REVIEW = "obl-review";
export const P104_OBL_GATE = "obl-gate";
export const P104_OBL_BLOCKED = "obl-blocked-104";
export const P104_OBL_DEFERRED = "obl-deferred-104";

export const P104_GOAL = "goal-1";

export const P104_PLAN_ID = "plan-evidence-mvp";

export const P104_PLAN_REVISION_FIXTURE_V1: PlanRevisionDraft = {
  schemaVersion: 1,
  planId: P104_PLAN_ID,
  planRevision: 1,
  goalId: P104_GOAL,
  stages: [{ stageId: "stage-evidence", title: "证据归约：实现、评审与 Gate" }],
  tasks: [
    {
      taskId: P104_TASK_IMPLEMENT,
      stageId: "stage-evidence",
      title: "实现变更：静态与动态证据齐备后归约",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "pending",
      scope: { kind: "stage", stageId: "stage-evidence" },
    },
    {
      taskId: P104_TASK_REVIEW,
      stageId: "stage-evidence",
      title: "语义变化有界评审：Reviewer Run + verdict",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "pending",
      scope: { kind: "stage", stageId: "stage-evidence" },
    },
    {
      taskId: P104_TASK_GATE,
      title: "EvidenceGate：全部义务满足且无未对账副作用",
      requirementLevel: "required",
      taskKind: "gate",
      disposition: "active",
      phase: "pending",
      scope: { kind: "goal" },
    },
    {
      taskId: P104_TASK_BLOCKED,
      stageId: "stage-evidence",
      title: "被 Blocker 阻塞（映射义务以满足 applyPlan 守卫）",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "blocked",
      scope: { kind: "stage", stageId: "stage-evidence" },
    },
    {
      taskId: P104_TASK_DEFERRED,
      stageId: "stage-evidence",
      title: "deferred 任务（映射义务；永不满足）",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "deferred",
      phase: "pending",
      scope: { kind: "stage", stageId: "stage-evidence" },
    },
  ],
  obligations: [
    {
      obligationId: P104_OBL_IMPLEMENT,
      title: "实现变更并产生静态+动态证据",
      requirementLevel: "required",
      taskIds: [P104_TASK_IMPLEMENT],
      verificationRequirements: [
        { requirementId: "vr-impl-static", requirementLevel: "required", kind: "static", description: "静态检查 PASS" },
        { requirementId: "vr-impl-dynamic", requirementLevel: "required", kind: "dynamic", description: "动态检查 PASS" },
      ],
    },
    {
      obligationId: P104_OBL_REVIEW,
      title: "语义变化有界评审并给出 verdict",
      requirementLevel: "required",
      taskIds: [P104_TASK_REVIEW],
      verificationRequirements: [
        { requirementId: "vr-review", requirementLevel: "required", kind: "reviewer", description: "Reviewer verdict 或显式快放证据" },
        { requirementId: "vr-review-static", requirementLevel: "required", kind: "static", description: "ReviewPacket 有界且无 transcript" },
      ],
    },
    {
      obligationId: P104_OBL_GATE,
      title: "Gate：归约表与验收证据完整",
      requirementLevel: "required",
      taskIds: [P104_TASK_GATE],
      verificationRequirements: [
        { requirementId: "vr-gate", requirementLevel: "required", kind: "static", description: "Gate 静态归约证据" },
      ],
    },
    {
      obligationId: P104_OBL_BLOCKED,
      title: "blocked 任务映射义务",
      requirementLevel: "required",
      taskIds: [P104_TASK_BLOCKED],
      verificationRequirements: [
        { requirementId: "vr-blocked-104", requirementLevel: "required", kind: "static", description: "blocked 任务不可领取" },
      ],
    },
    {
      obligationId: P104_OBL_DEFERRED,
      title: "deferred 任务映射义务",
      requirementLevel: "required",
      taskIds: [P104_TASK_DEFERRED],
      verificationRequirements: [
        { requirementId: "vr-deferred-104", requirementLevel: "required", kind: "static", description: "deferred 任务永不满足" },
      ],
    },
  ],
  taskHierarchy: {
    parentOf: [
      { parentTaskId: P104_TASK_GATE, childTaskId: P104_TASK_IMPLEMENT },
      { parentTaskId: P104_TASK_GATE, childTaskId: P104_TASK_REVIEW },
      { parentTaskId: P104_TASK_GATE, childTaskId: P104_TASK_BLOCKED },
      { parentTaskId: P104_TASK_GATE, childTaskId: P104_TASK_DEFERRED },
    ],
  },
  executionDag: {
    dependsOn: [
      {
        taskId: P104_TASK_GATE,
        dependsOnId: P104_TASK_REVIEW,
        requires: { kind: "gate-result", label: "证据齐全且无未对账副作用" },
      },
    ],
  },
};

/**
 * Fast-path policy fixture: same requirement kinds, PLUS an explicit
 * fastPathDiffClasses allowlist. The frozen P1-02 fixture (without the field)
 * stays digest-identical; this fixture is used ONLY by fast-path tests.
 */
export const COMPLETION_POLICY_FASTPATH_FIXTURE_V1: VersionedCompletionPolicyFixture = {
  schemaVersion: 1,
  identity: { policyId: "policy-completion-fastpath" },
  revision: 1,
  content: {
    schemaVersion: 1,
    requirementKinds: ["static", "dynamic", "reviewer"],
    minimumRequiredRequirementsPerObligation: 1,
    fastPathDiffClasses: ["docs-only"],
  },
};

// ------------------------------------------------------------------------ //
// Builders                                                                   //
// ------------------------------------------------------------------------ //

export type BuildEvidenceDeps = {
  evidenceId: string;
  kind: EvidenceKind;
  outcome: EvidenceOutcome;
  projectId: string;
  goalId: string;
  taskId: string;
  coverage: EvidenceCoverageV1[];
  anchor: EffectivityAnchorV1;
  verificationPlanRef: { planId: string; planDigest: string };
  runRef?: RunRef | null;
  checkId?: string | null;
  actor?: { kind: "human" | "system"; id: string };
  summaryText?: string;
  artifactRef?: ArtifactRef | null;
};

export function buildEvidenceV1(deps: BuildEvidenceDeps): EvidenceV1 {
  return {
    schemaVersion: 1,
    evidenceId: deps.evidenceId,
    kind: deps.kind,
    outcome: deps.outcome,
    source: {
      actor: deps.actor ?? { kind: "human", id: "user-1" },
      runRef: deps.runRef ?? null,
      checkId: deps.checkId ?? null,
    },
    subject: { projectId: deps.projectId, goalId: deps.goalId, taskId: deps.taskId },
    coverage: deps.coverage.map((c) => ({ ...c })),
    anchor: {
      schemaVersion: 1,
      planRef: { ...deps.anchor.planRef },
      planRevision: deps.anchor.planRevision,
      workspaceRevision: deps.anchor.workspaceRevision,
      pinnedCompletionPolicy: { ...deps.anchor.pinnedCompletionPolicy },
      pinnedArchitectureBaseline: { ...deps.anchor.pinnedArchitectureBaseline },
    },
    verificationPlanRef: { ...deps.verificationPlanRef },
    summary: {
      text: deps.summaryText ?? "p1-04 evidence summary",
      artifactRef: deps.artifactRef ?? null,
    },
  };
}

export function buildEffectivityAnchorV1(deps: {
  planRef: PlanRevisionRef;
  planRevision: number;
  workspaceRevision: number;
  pinnedCompletionPolicy: CompletionPolicyPin;
  pinnedArchitectureBaseline: ArchitectureBaselinePin;
}): EffectivityAnchorV1 {
  return {
    schemaVersion: 1,
    planRef: { ...deps.planRef },
    planRevision: deps.planRevision,
    workspaceRevision: deps.workspaceRevision,
    pinnedCompletionPolicy: { ...deps.pinnedCompletionPolicy },
    pinnedArchitectureBaseline: { ...deps.pinnedArchitectureBaseline },
  };
}

export type BuildSubmitEvidenceDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  evidence: EvidenceV1;
  actor?: CommandIdentity["actor"];
  idempotencyKey?: string;
};

export function buildSubmitEvidenceCommand(deps: BuildSubmitEvidenceDeps): SubmitEvidenceCommand {
  return {
    commandId: deps.commandId,
    commandType: "SubmitEvidence",
    schemaVersion: 1,
    identity: {
      projectId: deps.evidence.subject.projectId,
      actor: deps.actor ?? { kind: "human", id: "user-1" },
      idempotencyKey: deps.idempotencyKey ?? "p1-04-evidence",
    },
    aggregateId: deps.evidence.evidenceId,
    expectedRevision: 0,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { evidence: deps.evidence },
  };
}

/** Deterministic evidence-intake fold target (fold-equality for Control). */
export function buildEvidenceIntakeLedgerCommit(
  command: SubmitEvidenceCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    workspaceId: string;
    priorIndex: TaskEvidenceIndexSnapshot | null;
  },
): EvidenceIntakeLedgerCommitV1 {
  const evidence = command.payload.evidence;
  const projectId = evidence.subject.projectId;
  const goalId = evidence.subject.goalId;
  const taskId = evidence.subject.taskId;
  const evidenceIds = [...(deps.priorIndex?.evidenceIds ?? []), evidence.evidenceId];
  const evidenceSnapshot: EvidenceSnapshot = {
    ref: evidenceRefFor(projectId, evidence.evidenceId),
    revision: 1,
    schemaVersion: 1,
    evidence,
    admittedAt: deps.occurredAt,
  };
  const indexSnapshot: TaskEvidenceIndexSnapshot = {
    ref: taskEvidenceIndexRefFor(projectId, goalId, taskId),
    revision: evidenceIds.length,
    schemaVersion: 1,
    evidenceIds,
  };
  const event: EvidenceAdmittedEvent = {
    eventId: deps.eventId,
    eventType: "EvidenceAdmitted",
    schemaVersion: 1,
    projectId,
    workspaceId: deps.workspaceId,
    aggregateType: "Evidence",
    aggregateId: evidence.evidenceId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: {
      goalId,
      taskId,
      evidence,
      admittedAt: deps.occurredAt,
      evidenceIndex: evidenceIds.length,
      evidenceCount: evidenceIds.length,
    },
  };
  return {
    commitKind: "evidence-intake",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: submitEvidenceFingerprint(command),
    expectedVersions: [
      { ref: evidenceSnapshot.ref, revision: 0 },
      { ref: indexSnapshot.ref, revision: indexSnapshot.revision - 1 },
    ],
    events: [event],
    snapshots: [evidenceSnapshot, indexSnapshot],
    outboxIntents: [],
  };
}

export function evidenceIdentityKey(command: SubmitEvidenceCommand): string {
  return commandIdentityKey(command.identity);
}

// ------------------------------------------------------------------------ //
// Reduction builders                                                         //
// ------------------------------------------------------------------------ //

export type BuildReduceTaskDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  expectedRevision: number;
  projectId: string;
  goalId: string;
  taskId: string;
  actor?: CommandIdentity["actor"];
  idempotencyKey?: string;
};

export function buildReduceTaskCommand(deps: BuildReduceTaskDeps): ReduceTaskCommand {
  return {
    commandId: deps.commandId,
    commandType: "ReduceTask",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor ?? { kind: "system", id: "control-engine" },
      idempotencyKey: deps.idempotencyKey ?? "p1-04-reduce",
    },
    aggregateId: deps.taskId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { goalId: deps.goalId },
  };
}

export function buildTaskReductionSnapshot(
  deps: {
    projectId: string;
    goalId: string;
    taskId: string;
    revision: number;
    planRef: PlanRevisionRef;
    planRevision: number;
    taskKind: "work" | "gate";
    requirementLevel: "required" | "optional";
    disposition: "active" | "deferred" | "cancelled" | "superseded";
    phase: "verifying" | "blocked" | "failed" | "satisfied";
    currentAnchor: EffectivityAnchorV1;
    effectiveEvidenceIds: string[];
    blockingEvidenceIds: string[];
    staleEvidenceIds: string[];
    outOfScopeEvidenceIds: string[];
    satisfiedObligationIds: string[];
    causes: TaskReductionSnapshot["causes"];
    reducedAt: string;
  },
): TaskReductionSnapshot {
  return {
    ref: taskReductionRefFor(deps.projectId, deps.goalId, deps.taskId),
    revision: deps.revision,
    schemaVersion: 1,
    planRef: { ...deps.planRef },
    planRevision: deps.planRevision,
    taskKind: deps.taskKind,
    requirementLevel: deps.requirementLevel,
    disposition: deps.disposition,
    phase: deps.phase,
    currentAnchor: {
      schemaVersion: 1,
      planRef: { ...deps.currentAnchor.planRef },
      planRevision: deps.currentAnchor.planRevision,
      workspaceRevision: deps.currentAnchor.workspaceRevision,
      pinnedCompletionPolicy: { ...deps.currentAnchor.pinnedCompletionPolicy },
      pinnedArchitectureBaseline: { ...deps.currentAnchor.pinnedArchitectureBaseline },
    },
    effectiveEvidenceIds: [...deps.effectiveEvidenceIds],
    blockingEvidenceIds: [...deps.blockingEvidenceIds],
    staleEvidenceIds: [...deps.staleEvidenceIds],
    outOfScopeEvidenceIds: [...deps.outOfScopeEvidenceIds],
    satisfiedObligationIds: [...deps.satisfiedObligationIds],
    causes: deps.causes.map((c) => ({ ...c })),
    reducedAt: deps.reducedAt,
  };
}

/** Deterministic verification-result fold target (fold-equality for Control). */
export function buildTaskReductionLedgerCommit(
  command: ReduceTaskCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    workspaceId: string;
    reduction: TaskReductionSnapshot;
  },
): TaskReductionLedgerCommitV1 {
  const ref: TaskReductionRef = deps.reduction.ref;
  const event: TaskReductionUpdatedEvent = {
    eventId: deps.eventId,
    eventType: "TaskReductionUpdated",
    schemaVersion: 1,
    projectId: ref.projectId,
    workspaceId: deps.workspaceId,
    aggregateType: "TaskReduction",
    aggregateId: ref.taskId,
    aggregateRevision: deps.reduction.revision,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: { goalId: ref.goalId, taskId: ref.taskId, reduction: deps.reduction },
  };
  return {
    commitKind: "verification-result",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: reduceTaskFingerprint(command),
    expectedVersions: [{ ref, revision: deps.reduction.revision - 1 }],
    events: [event],
    snapshots: [deps.reduction],
    outboxIntents: [],
  };
}

// ------------------------------------------------------------------------ //
// Small deterministic helpers                                                //
// ------------------------------------------------------------------------ //

export function taskTriple(projectId: string, goalId: string, taskId: string): TaskTriple {
  return { projectId, goalId, taskId };
}

export function coverage(obligationId: string, requirementId: string): EvidenceCoverageV1 {
  return { obligationId, requirementId };
}

export function artifactRefFor(digest: string, sourceRefId = "plan-evidence-mvp"): ArtifactRef {
  return {
    kind: "artifact",
    contentType: "text/plain",
    digest,
    sizeBytes: 16,
    source: { kind: "plan-revision", refId: sourceRefId, revision: "1" },
  };
}

export function canonicalEquivalentCauses(causes: TaskReductionSnapshot["causes"]): boolean {
  return typeof canonicalJson(causes) === "string";
}
