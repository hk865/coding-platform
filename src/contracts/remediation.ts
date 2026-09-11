/**
 * P1-13 Remediation contracts — RemediationPlanPatch / RemediationTask /
 * RemediationDeduplicationKey.
 *
 * Authority: ticket 13-allowlisted-remediation.md Acceptance:
 *   - only local/deterministic/reversible findings hitting the allowlist AND
 *     drift budget generate a RemediationPlanPatch (verdict recorded; no
 *     RemediationTask for missing/dangling/digest-mismatch policy);
 *   - the patch fixes Finding + Workspace + evolution policy + Plan baseline +
 *     CompletionPolicy revisions; any ref change before acceptance -> CAS
 *     reject or re-evaluate;
 *   - the SAME finding/policy/workspace revision yields at most ONE effective
 *     RemediationTask (dedup key), created through ordinary Control guards
 *     (ArchitectureReconciler never writes Task state directly);
 *   - Writer uses the P1-07 conflict-scope lease; Verification uses the
 *     post-fix workspace revision + plan-pinned CompletionPolicy; FAIL/BLOCKED/
 *     outcome_unknown preserve the Finding + all historical Evidence; on verify
 *     the Finding is marked resolved via NEW Evidence (original delta kept);
 *   - ArchitectureBaseline active ref NEVER moves here.
 */
import type { CommandFingerprint, CommandIdentity, CommitCursor } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { ArchitectureFindingRef } from "./architecture-inspection.js";
import type { ArchitectureEvolutionPolicyPin } from "./architecture-evolution-policy.js";
import type { ArchitectureBaselinePin, CompletionPolicyPin } from "./governance.js";
import type { ArtifactRef } from "./artifact.js";
import type { RunRef } from "./dispatch.js";
import type { EvidenceRef } from "./evidence.js";

export const REMEDIATION_MAX_PATCH_CHANGED_PATHS = 64;
export const REMEDIATION_PATCH_SUMMARY_MAX_BYTES = 4096;

// ------------------------------------------------------------------------ //
// Deduplication key (deterministic; pure)                                    //
// ------------------------------------------------------------------------ //

export type RemediationDeduplicationKeyV1 = {
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  findingId: string;
  /** Evolution policy revision the finding was evaluated under. */
  policyRevision: number;
  /** Workspace revision the finding pinned. */
  workspaceRevision: number;
};

export function remediationDedupKeyOf(key: RemediationDeduplicationKeyV1): string {
  return sha256Hex(canonicalJson(key));
}

// ------------------------------------------------------------------------ //
// RemediationPlanPatch                                                       //
// ------------------------------------------------------------------------ //

export type RemediationPlanPatchV1 = {
  schemaVersion: 1;
  patchId: string;
  projectId: string;
  workspaceId: string;
  findingRef: ArchitectureFindingRef;
  findingId: string;
  workspaceRevision: number;
  policyPin: ArchitectureEvolutionPolicyPin;
  planBaselinePin: ArchitectureBaselinePin;
  completionPolicyPin: CompletionPolicyPin;
  verdict: { allowed: boolean; reasons: string[] };
  proposedPatch: {
    changedPaths: string[];
    changeSummary: string;
    bodyRef: ArtifactRef | null;
  };
};

export type RemediationPlanPatchRef = { aggregateType: "RemediationPlanPatch"; projectId: string; workspaceId: string; patchId: string };

export type RemediationPlanPatchSnapshot = {
  ref: RemediationPlanPatchRef;
  revision: 1;
  schemaVersion: 1;
  patch: RemediationPlanPatchV1;
  recordedAt: string;
};

export function remediationPlanPatchRefFor(projectId: string, workspaceId: string, patchId: string): RemediationPlanPatchRef {
  return { aggregateType: "RemediationPlanPatch", projectId, workspaceId, patchId };
}

// ------------------------------------------------------------------------ //
// RemediationTask                                                            //
// ------------------------------------------------------------------------ //

export type RemediationTaskStatus = "pending" | "writing" | "verifying" | "resolved" | "failed" | "blocked";

export type RemediationTaskResultV1 = {
  workspaceRevisionAfter: number;
  verified: boolean;
  outcome: "PASS" | "FAIL" | "INCONCLUSIVE";
};

export type RemediationTaskV1 = {
  schemaVersion: 1;
  taskId: string;
  projectId: string;
  workspaceId: string;
  dedupKey: RemediationDeduplicationKeyV1;
  findingRef: ArchitectureFindingRef;
  patchRef: RemediationPlanPatchRef;
  status: RemediationTaskStatus;
  writerRunRef: RunRef | null;
  evidenceRefs: EvidenceRef[];
  planBaselinePin: ArchitectureBaselinePin;
  completionPolicyPin: CompletionPolicyPin;
  result: RemediationTaskResultV1 | null;
  createdAt: string;
  updatedAt: string;
};

export type RemediationTaskRef = { aggregateType: "RemediationTask"; projectId: string; workspaceId: string; taskId: string };

export type RemediationTaskSnapshot = {
  ref: RemediationTaskRef;
  revision: number;
  schemaVersion: 1;
  task: RemediationTaskV1;
};

export function remediationTaskRefFor(projectId: string, workspaceId: string, taskId: string): RemediationTaskRef {
  return { aggregateType: "RemediationTask", projectId, workspaceId, taskId };
}

// ------------------------------------------------------------------------ //
// Commands / receipts                                                        //
// ------------------------------------------------------------------------ //

export type SubmitRemediationPlanPatchCommand = {
  commandId: string;
  commandType: "SubmitRemediationPlanPatch";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string;
  expectedRevision: 0;
  correlationId: string;
  submittedAt: string;
  payload: { patch: RemediationPlanPatchV1 };
};

export type CreateRemediationTaskCommand = {
  commandId: string;
  commandType: "CreateRemediationTask";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string;
  expectedRevision: 0;
  correlationId: string;
  submittedAt: string;
  payload: { patchRef: RemediationPlanPatchRef; taskId: string };
};

export type AdvanceRemediationTaskCommand = {
  commandId: string;
  commandType: "AdvanceRemediationTask";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string;
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: {
    status: "writing" | "verifying" | "resolved" | "failed" | "blocked";
    writerRunRef: RunRef | null;
    evidenceRefs: EvidenceRef[];
    result: RemediationTaskResultV1 | null;
  };
};

export type SubmitRemediationPlanPatchRejectionCode = "invalid" | "not_found" | "policy_unresolved" | "allowlist_rejected" | "stale_finding" | "revision_conflict" | "idempotency_conflict" | "unavailable";
export type SubmitRemediationPlanPatchReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; patchRef: RemediationPlanPatchRef; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: SubmitRemediationPlanPatchRejectionCode; issues?: string[] };

export type CreateRemediationTaskRejectionCode = "invalid" | "not_found" | "patch_not_found" | "policy_unresolved" | "allowlist_rejected" | "stale_finding" | "revision_conflict" | "idempotency_conflict" | "unavailable";
export type CreateRemediationTaskReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; taskRef: RemediationTaskRef; deduplicated: boolean; existingTaskRef: RemediationTaskRef | null; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: CreateRemediationTaskRejectionCode; issues?: string[] };

export type AdvanceRemediationTaskRejectionCode = "invalid" | "not_found" | "terminal_status" | "evidence_mismatch" | "revision_conflict" | "idempotency_conflict" | "unavailable";
export type AdvanceRemediationTaskReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; taskRef: RemediationTaskRef; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: AdvanceRemediationTaskRejectionCode; issues?: string[] };

// ------------------------------------------------------------------------ //
// Events                                                                    //
// ------------------------------------------------------------------------ //

export type RemediationPlanPatchRecordedEvent = {
  eventId: string;
  eventType: "RemediationPlanPatchRecorded";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "RemediationPlanPatch";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: import("./command-event.js").ActorRef;
  occurredAt: string;
  payload: { patch: RemediationPlanPatchV1; recordedAt: string };
};

export type RemediationTaskCreatedEvent = {
  eventId: string;
  eventType: "RemediationTaskCreated";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "RemediationTask";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: import("./command-event.js").ActorRef;
  occurredAt: string;
  payload: { task: RemediationTaskV1 };
};

export type RemediationTaskAdvancedEvent = {
  eventId: string;
  eventType: "RemediationTaskAdvanced";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "RemediationTask";
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: import("./command-event.js").ActorRef;
  occurredAt: string;
  payload: { task: RemediationTaskV1 };
};

// ------------------------------------------------------------------------ //
// Fingerprints                                                               //
// ------------------------------------------------------------------------ //

export function submitRemediationPlanPatchFingerprint(command: SubmitRemediationPlanPatchCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    projectId: command.identity.projectId,
    aggregateId: command.aggregateId,
    expectedRevision: command.expectedRevision,
    payload: { patch: command.payload.patch },
  })) as CommandFingerprint;
}

export function createRemediationTaskFingerprint(command: CreateRemediationTaskCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    projectId: command.identity.projectId,
    aggregateId: command.aggregateId,
    expectedRevision: command.expectedRevision,
    payload: { patchRef: command.payload.patchRef, taskId: command.payload.taskId },
  })) as CommandFingerprint;
}

export function advanceRemediationTaskFingerprint(command: AdvanceRemediationTaskCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    projectId: command.identity.projectId,
    aggregateId: command.aggregateId,
    expectedRevision: command.expectedRevision,
    payload: { status: command.payload.status, writerRunRef: command.payload.writerRunRef, evidenceRefs: command.payload.evidenceRefs, result: command.payload.result },
  })) as CommandFingerprint;
}

