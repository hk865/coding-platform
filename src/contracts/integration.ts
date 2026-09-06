/**
 * P1-07 frozen contract: IntegrationTaskResult (Evidence join) — contract #4
 * of ticket 07. Authority: IMPLEMENTATION-HANDOFF.md "P1-07 契约与存储语义"
 * item 6 + interfaces/completion-policy.md §5.
 *
 * FROZEN semantics:
 *   - the IntegrationTask is a FORMAL dispatched Run (P1-03 path); its result
 *     joins ACCEPTED Reader outputs while PRESERVING provenance (source
 *     task/run refs, coverage, applicability).
 *   - detectEvidenceConflicts is PURE and mechanical (no semantic inference):
 *     same (obligationId, requirementId) coverage + same (planRevision,
 *     workspaceRevision) tuple + BOTH applicable + different outcomes +
 *     different source runs -> one conflict record.
 *   - A conflict is NEVER overwritten by a later result: the first record
 *     with a given conflictKey is authoritative; a later record re-using that
 *     key is rejected (conflict_duplicate, zero write).
 *   - conflicts present without explanation (non-null, <= cap) AND without
 *     escalate -> conflict_unresolved (zero write). escalate=true requires at
 *     least one conflict. P1-07 only RECORDS the escalate marker; semantic
 *     routing / human decision = P1-15.
 *   - join NEVER changes Evidence applicability/reduction semantics (P1-04/05
 *     formulas) — it only provides join facts and the conflict surface.
 */
import type { ActorRef, CommandFingerprint, CommandIdentity, CommitCursor } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { EvidenceApplicability, EvidenceCoverageV1, EvidenceOutcome, EvidenceRef } from "./evidence.js";
import type { ArtifactRef } from "./artifact.js";
import type { RunRef, TaskAttemptRef } from "./dispatch.js";
import type { HandoffPacketRef } from "./handoff.js";
import type { PlanRevisionRef } from "./plan.js";

// ------------------------------------------------------------------------ //
// Limits                                                                    //
// ------------------------------------------------------------------------ //

export const INTEGRATION_MAX_INPUTS = 64;
export const INTEGRATION_MAX_CONFLICTS = 64;
export const INTEGRATION_MAX_GAPS = 32;
export const INTEGRATION_MAX_EXPLANATION_BYTES = 4096;

// ------------------------------------------------------------------------ //
// Result record                                                             //
// ------------------------------------------------------------------------ //

export type IntegrationInputRefV1 = {
  sourceTaskId: string;
  sourceRunRef: RunRef;
  kind: "evidence" | "artifact" | "handoff";
  evidenceRef: EvidenceRef | null;
  artifactRef: ArtifactRef | null;
  handoffPacketRef: HandoffPacketRef | null;
};

export type IntegrationGapV1 = {
  gapId: string;
  kind: "missing_input" | "not_accepted" | "stale_source";
  sourceTaskId: string;
  message: string;
};

export type EvidenceConflictRecordV1 = {
  conflictId: string;
  /** sha256(canonicalJson({obligationId, requirementId, planRevision, workspaceRevision})). */
  conflictKey: string;
  kind: "outcome_disagreement";
  obligationId: string;
  requirementId: string;
  planRevision: number;
  workspaceRevision: number;
  evidence: {
    evidenceId: string;
    outcome: EvidenceOutcome;
    runRef: RunRef;
    applicability: EvidenceApplicability;
  }[];
  detectedAt: string;
};

/** Bounded join result of ONE integration dispatch run (formally a Run). */
export type IntegrationTaskResultV1 = {
  schemaVersion: 1;
  resultId: string;
  projectId: string;
  workspaceId: string;
  goalId: string;
  /** The Integration task (the join consumer). */
  taskId: string;
  planRef: PlanRevisionRef;
  /** The plan revision the integration was dispatched under. */
  taskRevision: number;
  runRef: RunRef;
  attemptRef: TaskAttemptRef;
  /** Workspace revision the join was computed under. */
  workspaceRevision: number;
  inputs: IntegrationInputRefV1[];
  conflicts: EvidenceConflictRecordV1[];
  gaps: IntegrationGapV1[];
  /** Required non-null when conflicts exist and escalate=false (<= cap). */
  explanation: string | null;
  /** "needs escalation" marker (P1-15 semantic routing — NOT this ticket). */
  escalate: boolean;
  generatedAt: string;
};

// ------------------------------------------------------------------------ //
// Conflict detection (PURE)                                                 //
// ------------------------------------------------------------------------ //

/** The evidence facts the detection needs (resolved from the ledger). */
export type EvidenceConflictFactV1 = {
  evidenceId: string;
  outcome: EvidenceOutcome;
  applicability: EvidenceApplicability;
  runRef: RunRef;
  planRevision: number;
  workspaceRevision: number;
  coverage: EvidenceCoverageV1;
};

export function evidenceConflictKeyFor(item: {
  obligationId: string;
  requirementId: string;
  planRevision: number;
  workspaceRevision: number;
}): string {
  return sha256Hex(
    canonicalJson({
      obligationId: item.obligationId,
      requirementId: item.requirementId,
      planRevision: item.planRevision,
      workspaceRevision: item.workspaceRevision,
    }),
  );
}

/**
 * FROZEN pure detection: for every PAIR of input evidence with the same
 * coverage (obligationId, requirementId) and the same (planRevision,
 * workspaceRevision) tuple where both are APPLICABLE, outcomes differ, and
 * source runs differ -> one conflict record (deterministic order by
 * conflictKey then evidenceIds; conflictId = sha256(conflictKey + sorted
 * evidenceIds)).
 */
export function detectEvidenceConflicts(
  inputs: IntegrationInputRefV1[],
  facts: (evidenceId: string) => EvidenceConflictFactV1 | null,
  detectedAt: string,
): EvidenceConflictRecordV1[] {
  const evidenceInputs = inputs
    .map((i) => ({ input: i, fact: i.kind === "evidence" && i.evidenceRef !== null ? facts(i.evidenceRef.evidenceId) : null }))
    .filter((e): e is { input: IntegrationInputRefV1; fact: EvidenceConflictFactV1 } => e.fact !== null);
  const records: EvidenceConflictRecordV1[] = [];
  const grouped = new Map<string, EvidenceConflictFactV1[]>();
  for (const { fact } of evidenceInputs) {
    for (const c of [fact.coverage] as EvidenceCoverageV1[]) {
      const key = JSON.stringify([c.obligationId, c.requirementId, fact.planRevision, fact.workspaceRevision]);
      const list = grouped.get(key) ?? [];
      list.push({ ...fact, coverage: c });
      grouped.set(key, list);
    }
  }
  const keys = Array.from(grouped.keys()).sort();
  for (const key of keys) {
    const list = grouped.get(key)!;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (
          a.applicability === "APPLICABLE" &&
          b.applicability === "APPLICABLE" &&
          a.outcome !== b.outcome &&
          canonicalJson(a.runRef) !== canonicalJson(b.runRef)
        ) {
          const conflictKey = evidenceConflictKeyFor({
            obligationId: a.coverage.obligationId,
            requirementId: a.coverage.requirementId,
            planRevision: a.planRevision,
            workspaceRevision: a.workspaceRevision,
          });
          const evidenceIds = [a.evidenceId, b.evidenceId].sort();
          records.push({
            conflictId: sha256Hex(conflictKey + "\u0000" + evidenceIds.join("\u0000")),
            conflictKey,
            kind: "outcome_disagreement",
            obligationId: a.coverage.obligationId,
            requirementId: a.coverage.requirementId,
            planRevision: a.planRevision,
            workspaceRevision: a.workspaceRevision,
            evidence: [a, b]
              .map((e) => ({
                evidenceId: e.evidenceId,
                outcome: e.outcome,
                runRef: e.runRef,
                applicability: e.applicability,
              }))
              .sort((x, y) => x.evidenceId.localeCompare(y.evidenceId)),
            detectedAt,
          });
        }
      }
    }
  }
  return records;
}

// ------------------------------------------------------------------------ //
// Aggregate                                                                //
// ------------------------------------------------------------------------ //

export type IntegrationResultRef = {
  aggregateType: "IntegrationResult";
  projectId: string;
  goalId: string;
  taskId: string;
};

export function integrationResultRefFor(projectId: string, goalId: string, taskId: string): IntegrationResultRef {
  return { aggregateType: "IntegrationResult", projectId, goalId, taskId };
}

/** Accumulating join record set per (project, goal, task) — revision == count. */
export type IntegrationResultSnapshot = {
  ref: IntegrationResultRef;
  revision: number;
  schemaVersion: 1;
  records: IntegrationTaskResultV1[];
};

export type IntegrationJoinedEvent = {
  eventId: string;
  eventType: "IntegrationJoined";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "IntegrationResult";
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    resultId: string;
    goalId: string;
    taskId: string;
    runRef: RunRef;
    attemptRef: TaskAttemptRef;
    workspaceRevision: number;
    planRef: PlanRevisionRef;
    inputs: IntegrationInputRefV1[];
    conflicts: EvidenceConflictRecordV1[];
    gaps: IntegrationGapV1[];
    explanation: string | null;
    escalate: boolean;
    generatedAt: string;
  };
};

// ------------------------------------------------------------------------ //
// Command / receipt                                                         //
// ------------------------------------------------------------------------ //

export type RecordIntegrationResultCommand = {
  commandId: string;
  commandType: "RecordIntegrationResult";
  schemaVersion: 1;
  identity: CommandIdentity;
  /** taskId of the Integration task — the IntegrationResult aggregate. */
  aggregateId: string;
  /** expected IntegrationResult revision (0 for the first join). */
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: {
    result: IntegrationTaskResultV1;
  };
};

export type RecordIntegrationResultRejectionCode =
  | "invalid"
  | "run_not_found"
  | "run_not_ended"
  | "workspace_not_found"
  | "plan_not_found"
  | "stale_source"
  | "input_not_found"
  | "input_run_mismatch"
  | "input_not_accepted"
  | "conflict_unresolved"
  | "invalid_escalate"
  | "conflict_duplicate"
  | "revision_conflict"
  | "idempotency_conflict"
  | "unavailable";

export type RecordIntegrationResultReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      resultRef: IntegrationResultRef;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | { status: "rejected"; commandId: string; code: RecordIntegrationResultRejectionCode };

// ------------------------------------------------------------------------ //
// Fingerprint                                                               //
// ------------------------------------------------------------------------ //

export function recordIntegrationFingerprint(command: RecordIntegrationResultCommand): CommandFingerprint {
  return sha256Hex(
    canonicalJson({
      commandType: command.commandType,
      projectId: command.identity.projectId,
      payload: command.payload,
    }),
  ) as CommandFingerprint;
}
