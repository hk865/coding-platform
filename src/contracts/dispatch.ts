/**
 * P1-03 dispatch / run contracts — "Eligible Task -> Fake Run view".
 *
 * Authority:
 *   - dev_docs/planning/proposed/P1-foundation/tickets/03-fake-run-visible.md
 *     (4 interfaces to freeze, 6 contracts, 8 Acceptance items)
 *   - dev_docs/interfaces/runtime-collaboration.md (minimal RoleBinding ref,
 *     outbox-before-side-effect, run facts; wire fields freeze at the FIRST
 *     consumer — this ticket)
 *   - IMPLEMENTATION-HANDOFF.md "P1-03 契约与存储语义（冻结）"
 *
 * Frozen P1-03 boundaries:
 *   - NO CompletionClaim / VerificationPlan / Goal reduction. Run end NEVER
 *     writes Task phase. crash != outcome_unknown. At most one claim per task
 *     (TaskLease CAS @0); no retry/re-claim after an attempt ended.
 *   - Runtime facts are de-duplicated by per-run monotonic sequence; run-fact
 *     commits have NO ledger-level idempotency replay (a fact with sequence <=
 *     the committed max is rejected zero-write: duplicate/stale/conflict).
 *   - RoleBinding has no full contract yet (P1-15); RoleBindingRefV1 is the
 *     MINIMAL versioned reference frozen here (template + binding version +
 *     authorization policy version). Authorization = enforced scope
 *     consistency against declared permissions; no policy registry yet.
 */
import type { ActorRef, CommandFingerprint, CommandIdentity, CommitCursor } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type {
  DependencyRequirement,
  Disposition,
  Phase,
  PlanRevisionRef,
  PlanRevisionSnapshot,
  RuntimeTask,
} from "./plan.js";
import type { ContextManifestV1, TaskEnvelopeV1 } from "./task-envelope.js";

// ------------------------------------------------------------------------ //
// Aggregate refs                                                             //
// ------------------------------------------------------------------------ //

export type TaskTriple = {
  projectId: string;
  goalId: string;
  taskId: string;
};

export type TaskLeaseRef = {
  aggregateType: "TaskLease";
  projectId: string;
  goalId: string;
  taskId: string;
};

export type TaskAttemptRef = {
  aggregateType: "TaskAttempt";
  projectId: string;
  goalId: string;
  taskId: string;
  attemptId: string;
};

export type RunRef = {
  aggregateType: "Run";
  projectId: string;
  goalId: string;
  runId: string;
};

export type DispatchOutboxRef = {
  aggregateType: "DispatchOutboxEntry";
  projectId: string;
  goalId: string;
  taskId: string;
  attemptId: string;
};

export function taskLeaseRefFor(projectId: string, goalId: string, taskId: string): TaskLeaseRef {
  return { aggregateType: "TaskLease", projectId, goalId, taskId };
}

export function taskAttemptRefFor(
  projectId: string,
  goalId: string,
  taskId: string,
  attemptId: string,
): TaskAttemptRef {
  return { aggregateType: "TaskAttempt", projectId, goalId, taskId, attemptId };
}

export function runRefFor(projectId: string, goalId: string, runId: string): RunRef {
  return { aggregateType: "Run", projectId, goalId, runId };
}

export function dispatchOutboxRefFor(
  projectId: string,
  goalId: string,
  taskId: string,
  attemptId: string,
): DispatchOutboxRef {
  return { aggregateType: "DispatchOutboxEntry", projectId, goalId, taskId, attemptId };
}

// ------------------------------------------------------------------------ //
// Shared value types                                                         //
// ------------------------------------------------------------------------ //

/** Minimal versioned RoleBinding reference (no full RoleBinding contract yet — P1-15). */
export type RoleBindingRefV1 = {
  schemaVersion: 1;
  bindingId: string;
  templateId: string;
  /** template_revision of agent/templates/short-lived-agent.md. */
  templateRevision: string;
  /** Binding instance version; the Run references the exact version used. */
  bindingVersion: number;
  /** Authorization policy version the binding was resolved under (opaque; no registry in P1-03). */
  policyRevision: string;
};

/**
 * Versioned source reference. P1-03 kinds are the sources a bounded envelope
 * can declare; further kinds extend with a versioned schema upgrade.
 */
export type SourceRefV1 = {
  kind: "plan-revision" | "workspace" | "governance" | "artifact";
  refId: string;
  revision: string;
  digest?: string;
};

export type TaskBudgetV1 = {
  tokenBudget: number;
  deadline: string | null;
};

// ------------------------------------------------------------------------ //
// RuntimeEvent (contract #5)                                                //
// ------------------------------------------------------------------------ //

export type RuntimeEventType =
  | "run_started"
  | "run_completed"
  | "run_crashed"
  | "run_cancelled"
  | "run_budget_exhausted";

export const RUNTIME_EVENT_TYPES: readonly RuntimeEventType[] = [
  "run_started",
  "run_completed",
  "run_crashed",
  "run_cancelled",
  "run_budget_exhausted",
];

export const TERMINAL_RUNTIME_EVENT_TYPES: readonly RuntimeEventType[] = [
  "run_completed",
  "run_crashed",
  "run_cancelled",
  "run_budget_exhausted",
];

export function isTerminalRuntimeEvent(event: RuntimeEventV1): boolean {
  return (TERMINAL_RUNTIME_EVENT_TYPES as readonly string[]).includes(event.eventType);
}

/**
 * The outcome a terminal RuntimeEvent contributes. NEVER maps to Task.phase —
 * satisfaction is P1-04 evidence reduction.
 */
export function runtimeEventTerminalOutcome(event: RuntimeEventV1): RunOutcome | null {
  switch (event.eventType) {
    case "run_completed":
      return "completed";
    case "run_crashed":
      return "crashed";
    case "run_cancelled":
      return "cancelled";
    case "run_budget_exhausted":
      return "budget_exhausted";
    case "run_started":
      return null;
  }
}

export type RuntimeEventV1 = {
  eventType: RuntimeEventType;
  schemaVersion: 1;
  /** Runtime-adapter-assigned event id (unique per run in practice). */
  eventId: string;
  runRef: RunRef;
  /** Per-run strictly increasing sequence; the ordering authority for dedupe. */
  sequence: number;
  occurredAt: string;
  payload:
    | { kind: "started"; startedAt: string }
    | { kind: "completed"; exitCode: number }
    | { kind: "crashed"; error: string }
    | { kind: "cancelled"; reason: string }
    | { kind: "budget_exhausted"; exhaustedAt: string };
};

export type RuntimeEvent = RuntimeEventV1;

// ------------------------------------------------------------------------ //
// Run / attempt / outbox status                                             //
// ------------------------------------------------------------------------ //

export type RunStatus = "starting" | "running" | "ended";
export type RunOutcome =
  | "completed"
  | "failed"
  | "cancelled"
  | "budget_exhausted"
  | "crashed"
  | "outcome_unknown";
export type TaskAttemptStatus = "claimed" | "started" | "ended";
export type DispatchOutboxStatus = "pending" | "started" | "done";

// ------------------------------------------------------------------------ //
// DispatchIntent (contract #1 — durable outbox intent)                      //
// ------------------------------------------------------------------------ //

export type DispatchIntentV1 = {
  schemaVersion: 1;
  /** 1:1 with the attempt (intentId === attemptId) — deterministic. */
  intentId: string;
  projectId: string;
  workspaceId: string;
  goalId: string;
  taskId: string;
  planRef: PlanRevisionRef;
  attemptRef: TaskAttemptRef;
  runRef: RunRef;
  roleBinding: RoleBindingRefV1;
  /** Canonical Workspace revision bound at claim (no worktree digest machinery in P1-03). */
  workspaceSnapshot: { workspaceId: string; revision: number };
  declaredPermissions: { tools: string[]; writeScope: string[] };
  budget: TaskBudgetV1;
  requestedAt: string;
  correlationId: string;
};

// ------------------------------------------------------------------------ //
// Canonical snapshots                                                        //
// ------------------------------------------------------------------------ //

export type TaskLeaseSnapshot = {
  ref: TaskLeaseRef;
  revision: number;
  schemaVersion: 1;
  holderRunId: string;
  attemptId: string;
  grantedAt: string;
  expiresAt: string | null;
};

export type TaskAttemptSnapshot = {
  ref: TaskAttemptRef;
  revision: number;
  schemaVersion: 1;
  runId: string;
  planRef: PlanRevisionRef;
  status: TaskAttemptStatus;
  startedAt: string | null;
  endedAt: string | null;
  endOutcome: RunOutcome | null;
};

export type RunSnapshot = {
  ref: RunRef;
  revision: number;
  schemaVersion: 1;
  task: TaskTriple;
  attemptId: string;
  planRef: PlanRevisionRef;
  roleBinding: RoleBindingRefV1;
  budget: TaskBudgetV1;
  workspaceSnapshot: { workspaceId: string; revision: number };
  status: RunStatus;
  outcome: RunOutcome | null;
  /** exitCode of the LAST run_completed event (null until then). NEVER a satisfaction signal. */
  exitCode: number | null;
  /** Highest runtime event sequence applied so far (0 before any fact). */
  lastEventSeq: number;
  /** Runtime-event id with lastEventSeq ("" before any fact). */
  lastRuntimeEventId: string;
  /** Domain event id of the run-fact commit that applied lastEventSeq ("" before any fact). */
  lastFactEventId: string;
  /** The bounded envelope recorded at start (the Run input). */
  envelope: TaskEnvelopeV1 | null;
  startedAt: string | null;
  endedAt: string | null;
};

export type DispatchOutboxEntrySnapshot = {
  ref: DispatchOutboxRef;
  revision: number;
  schemaVersion: 1;
  status: DispatchOutboxStatus;
  intent: DispatchIntentV1;
  pendingAt: string;
  startedAt: string | null;
  doneAt: string | null;
};

// ------------------------------------------------------------------------ //
// Domain events (P1-03 v1)                                                  //
// ------------------------------------------------------------------------ //

export type TaskClaimedEvent = {
  eventId: string;
  eventType: "TaskClaimed";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "TaskLease";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    goalId: string;
    taskId: string;
    attemptRef: TaskAttemptRef;
    runRef: RunRef;
    planRef: PlanRevisionRef;
    roleBinding: RoleBindingRefV1;
    declaredPermissions: { tools: string[]; writeScope: string[] };
    budget: TaskBudgetV1;
    intentId: string;
    claimedAt: string;
  };
};

export type RunStartedEvent = {
  eventId: string;
  eventType: "RunStarted";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "Run";
  aggregateId: string;
  aggregateRevision: 2;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    taskId: string;
    attemptId: string;
    envelope: TaskEnvelopeV1;
    manifest: ContextManifestV1;
    startedAt: string;
  };
};

export type RunEventRecordedEvent = {
  eventId: string;
  eventType: "RunEventRecorded";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "Run";
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    taskId: string;
    runtimeEvent: RuntimeEventV1;
  };
};

/** Explicit "no terminal signal" fact — projected SEPARATELY from crash. */
export type RunOutcomeUnknownEvent = {
  eventId: string;
  eventType: "RunOutcomeUnknown";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "Run";
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    taskId: string;
    reason: string;
    observedAt: string;
  };
};

// ------------------------------------------------------------------------ //
// Eligibility (readiness) — PURE decision, table-testable                    //
// ------------------------------------------------------------------------ //

export type DispatchReadinessFacts = {
  projectId: string;
  goalId: string;
  goalDesiredState: string;
  goalActivePlanRevision: PlanRevisionRef | null;
  plan: PlanRevisionSnapshot | null;
  lease: { status: "none" } | { status: "leased"; holderRunId: string; grantedAt: string };
  resource: { tokenBudget: number; deadline: string | null; now: string };
};

export type TaskIneligibilityReason =
  | { code: "goal_not_active"; message: string }
  | { code: "plan_not_accepted"; message: string }
  | { code: "task_not_found"; taskId: string; message: string }
  | { code: "task_kind_not_work"; taskId: string; taskKind: string; message: string }
  | { code: "task_not_active"; taskId: string; disposition: Disposition; message: string }
  | {
      code: "task_phase_not_dispatchable";
      taskId: string;
      phase: Phase;
      blocked: boolean;
      message: string;
    }
  | {
      code: "deps_unsatisfied";
      taskId: string;
      deps: { dependsOnId: string; requires: DependencyRequirement; phase: Phase | "missing" }[];
      message: string;
    }
  | {
      code: "resource_unavailable";
      taskId: string;
      detail: "leased" | "budget_exhausted" | "deadline_passed";
      message: string;
    };

export type TaskEligibility =
  | { eligible: true; reasons: [] }
  | { eligible: false; reasons: TaskIneligibilityReason[] };

/**
 * Frozen eligibility rule (Acceptance 1):
 *   - goal desiredState active;
 *   - an accepted PlanRevision exists;
 *   - task is in the plan, taskKind = work (gates are reduced by evidence, P1-04);
 *   - disposition = active (desired state);
 *   - no Blocker: phase !== blocked, and phase is dispatchable (pending|ready);
 *   - EVERY explicit DAG hard dependency (dependsOn) target phase === "satisfied";
 *   - resource available: no active lease, positive tokenBudget, deadline not passed.
 * Reasons are accumulated in deterministic order; eligible <=> reasons = [].
 */
export function evaluateTaskEligibility(
  facts: DispatchReadinessFacts,
  taskId: string,
): TaskEligibility {
  const reasons: TaskIneligibilityReason[] = [];

  if (facts.goalDesiredState !== "active") {
    reasons.push({
      code: "goal_not_active",
      message: "goal desiredState is not active: " + String(facts.goalDesiredState),
    });
  }
  if (facts.goalActivePlanRevision === null || facts.plan === null) {
    reasons.push({ code: "plan_not_accepted", message: "goal has no accepted PlanRevision" });
  }

  const plan = facts.plan;
  if (plan !== null) {
    const task = plan.tasks.find((t) => t.taskId === taskId);
    if (task === undefined) {
      reasons.push({
        code: "task_not_found",
        taskId,
        message: "task is not part of the accepted plan",
      });
    } else {
      if (task.taskKind !== "work") {
        reasons.push({
          code: "task_kind_not_work",
          taskId,
          taskKind: task.taskKind,
          message: "only work tasks are dispatched; gate evidence reduction is P1-04",
        });
      }
      if (task.disposition !== "active") {
        reasons.push({
          code: "task_not_active",
          taskId,
          disposition: task.disposition,
          message: "task disposition is not active (desired state)",
        });
      }
      if (task.phase === "blocked") {
        reasons.push({
          code: "task_phase_not_dispatchable",
          taskId,
          phase: task.phase,
          blocked: true,
          message: "task is blocked",
        });
      } else if (task.phase !== "pending" && task.phase !== "ready") {
        reasons.push({
          code: "task_phase_not_dispatchable",
          taskId,
          phase: task.phase,
          blocked: false,
          message: "task phase is not dispatchable (pending|ready)",
        });
      }

      const unsatisfied = plan.executionDag.dependsOn
        .filter((edge) => edge.taskId === taskId)
        .map((edge) => {
          const dep = plan.tasks.find((t) => t.taskId === edge.dependsOnId);
          return {
            dependsOnId: edge.dependsOnId,
            requires: edge.requires,
            phase: (dep?.phase ?? "missing") as Phase | "missing",
          };
        })
        .filter((dep) => dep.phase !== "satisfied");
      if (unsatisfied.length > 0) {
        reasons.push({
          code: "deps_unsatisfied",
          taskId,
          deps: unsatisfied,
          message: unsatisfied.map((d) => d.dependsOnId + ":" + d.phase).join(", "),
        });
      }
    }
  }

  if (facts.lease.status === "leased") {
    reasons.push({
      code: "resource_unavailable",
      taskId,
      detail: "leased",
      message: "task already has an active lease (holder run " + facts.lease.holderRunId + ")",
    });
  }
  if (!Number.isSafeInteger(facts.resource.tokenBudget) || !(facts.resource.tokenBudget > 0)) {
    reasons.push({
      code: "resource_unavailable",
      taskId,
      detail: "budget_exhausted",
      message: "tokenBudget is not a positive integer",
    });
  }
  if (facts.resource.deadline !== null && facts.resource.deadline < facts.resource.now) {
    reasons.push({
      code: "resource_unavailable",
      taskId,
      detail: "deadline_passed",
      message: "deadline " + facts.resource.deadline + " is before now",
    });
  }

  return reasons.length === 0 ? { eligible: true, reasons: [] } : { eligible: false, reasons };
}

// ------------------------------------------------------------------------ //
// Readiness query (Control read-only entry)                                  //
// ------------------------------------------------------------------------ //

export type DispatchReadinessQuery = {
  projectId: string;
  goalId: string;
  taskId: string;
  /** Declared budget for the resource check (optional; the lease is always checked). */
  budget?: TaskBudgetV1;
};

export type DispatchReadinessResult =
  | {
      status: "ready";
      eligibility: TaskEligibility;
      goalRevision: number;
      workspaceRevision: number;
      planRef: PlanRevisionRef;
    }
  | { status: "not_found"; code: "goal" | "workspace" | "plan" };

// ------------------------------------------------------------------------ //
// Commands / receipts                                                        //
// ------------------------------------------------------------------------ //

export type DispatchClaimCommand = {
  commandId: string;
  commandType: "DispatchClaimTask";
  schemaVersion: 1;
  identity: CommandIdentity;
  /** taskId — the TaskLease aggregate. */
  aggregateId: string;
  /** expected TaskLease revision (P1-03: the first claim is always @0). */
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: {
    goalId: string;
    attemptId: string;
    runId: string;
    roleBinding: RoleBindingRefV1;
    declaredPermissions: { tools: string[]; writeScope: string[] };
    budget: TaskBudgetV1;
  };
};

export type DispatchClaimReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      leaseRef: TaskLeaseRef;
      attemptRef: TaskAttemptRef;
      runRef: RunRef;
      outboxRef: DispatchOutboxRef;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | {
      status: "rejected";
      commandId: string;
      code:
        | "invalid"
        | "ineligible"
        | "not_found"
        | "revision_conflict"
        | "idempotency_conflict"
        | "unavailable";
      issues?: TaskIneligibilityReason[];
      currentRevision?: number;
    };

export type DispatchStartCommand = {
  commandId: string;
  commandType: "DispatchStartRun";
  schemaVersion: 1;
  identity: CommandIdentity;
  /** runId — the Run aggregate. */
  aggregateId: string;
  /** expected Run revision (1 right after claim). */
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: {
    envelope: TaskEnvelopeV1;
    manifest: ContextManifestV1;
  };
};

export type DispatchStartReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      runRef: RunRef;
      outboxRef: DispatchOutboxRef;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | {
      status: "rejected";
      commandId: string;
      code:
        | "invalid"
        | "not_found"
        | "stale_binding"
        | "revision_conflict"
        | "idempotency_conflict"
        | "unavailable";
      currentRevision?: number;
    };

export type RunFactV1 =
  | { kind: "runtime_event"; event: RuntimeEventV1 }
  | { kind: "outcome_unknown"; reason: string };

export type RunFactCommand = {
  commandId: string;
  commandType: "RunFact";
  schemaVersion: 1;
  identity: CommandIdentity;
  /** runId — the Run aggregate. */
  aggregateId: string;
  /** Run revision the caller observed (single-writer CAS; stale -> revision_conflict). */
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: { fact: RunFactV1 };
};

export type RunFactRejectionCode =
  | "invalid"
  | "not_found"
  | "duplicate_event"
  | "stale_event"
  | "conflict_event"
  | "after_terminal"
  | "revision_conflict"
  | "unavailable";

export type RunFactReceipt =
  | {
      status: "committed";
      commandId: string;
      /** Always false: run-fact commits have no ledger-level idempotency replay. */
      replayed: false;
      runRef: RunRef;
      runRevision: number;
      applied:
        | { kind: "runtime_event"; runtimeEventId: string; sequence: number }
        | { kind: "outcome_unknown" };
      /** true when the fact ended the Run (terminal event / outcome_unknown). */
      terminal: boolean;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | {
      status: "rejected";
      commandId: string;
      code: RunFactRejectionCode;
      currentRevision?: number;
    };

// ------------------------------------------------------------------------ //
// Fingerprints (JCS + SHA-256; volatile ids excluded — P1-00/02 convention)  //
// ------------------------------------------------------------------------ //

export function dispatchClaimFingerprint(command: DispatchClaimCommand): CommandFingerprint {
  const shape = {
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    projectId: command.identity.projectId,
    aggregateId: command.aggregateId,
    expectedRevision: command.expectedRevision,
    payload: {
      goalId: command.payload.goalId,
      attemptId: command.payload.attemptId,
      runId: command.payload.runId,
      roleBinding: command.payload.roleBinding,
      declaredPermissions: command.payload.declaredPermissions,
      budget: command.payload.budget,
    },
  };
  return sha256Hex(canonicalJson(shape)) as CommandFingerprint;
}

export function dispatchStartFingerprint(command: DispatchStartCommand): CommandFingerprint {
  const shape = {
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    projectId: command.identity.projectId,
    aggregateId: command.aggregateId,
    expectedRevision: command.expectedRevision,
    payload: {
      envelope: command.payload.envelope,
      manifest: command.payload.manifest,
    },
  };
  return sha256Hex(canonicalJson(shape)) as CommandFingerprint;
}

export function runFactFingerprint(command: RunFactCommand): CommandFingerprint {
  const shape = {
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    projectId: command.identity.projectId,
    aggregateId: command.aggregateId,
    expectedRevision: command.expectedRevision,
    payload: command.payload,
  };
  return sha256Hex(canonicalJson(shape)) as CommandFingerprint;
}
