/**
 * P1-07 frozen contract: PatchArtifact (contract #5 of ticket 07) — the
 * single-writer output. Authority: IMPLEMENTATION-HANDOFF.md "P1-07 契约与
 * 存储语义" item 5 + invariant #7.
 *
 * FROZEN semantics:
 *   - body-first: the patch/commit body lives in the ArtifactVault; the
 *     PatchRecord carries ONLY the ArtifactRef (+ bounded metadata) — same
 *     rule as P1-03/04/06.
 *   - recordPatch guards (all zero-write except the single atomic commit):
 *     shape -> writer Run exists & ended -> active WriteLease held by this
 *     run -> every changedPath ⊆ lease.scope -> beforeWorkspaceRevision ===
 *     canonical Workspace revision -> each usedInputEvidenceRef exists and is
 *     APPLICABLE (accepted Reader output) -> atomic commit.
 *   - the atomic commit carries PatchRecorded (patch@1) + the Workspace
 *     aggregate CAS advance (N -> N+1, canonical monotonic) + the write lease
 *     release (@2) + the write-lease index clear — the post-write workspace
 *     revision is advance-by-patch-record, never by an explicit release.
 */
import type { ActorRef, CommandFingerprint, CommandIdentity, CommitCursor } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { ArtifactRef } from "./artifact.js";
import type { EvidenceRef } from "./evidence.js";
import type { PlanRevisionRef } from "./plan.js";
import type { RoleBindingRefV1, RunRef, TaskAttemptRef } from "./dispatch.js";

// ------------------------------------------------------------------------ //
// Limits                                                                    //
// ------------------------------------------------------------------------ //

export const PATCH_MAX_CHANGED_PATHS = 256;
export const PATCH_MAX_CHECK_RESULTS = 64;
export const PATCH_MAX_CHECK_SUMMARY_BYTES = 4096;
export const PATCH_MAX_USED_INPUT_EVIDENCE = 128;

// ------------------------------------------------------------------------ //
// Artifact                                                                  //
// ------------------------------------------------------------------------ //

export type PatchCheckOutcome = "PASS" | "FAIL" | "INCONCLUSIVE";

export type PatchCheckResultV1 = {
  checkId: string;
  outcome: PatchCheckOutcome;
  /** Bounded summary (utf-8 bytes <= PATCH_MAX_CHECK_SUMMARY_BYTES). */
  summary: string;
};

export type PatchArtifactV1 = {
  schemaVersion: 1;
  patchId: string;
  projectId: string;
  workspaceId: string;
  goalId: string;
  /** the Writer task. */
  taskId: string;
  planRef: PlanRevisionRef;
  /** the plan revision the writer was dispatched under. */
  taskRevision: number;
  runRef: RunRef;
  attemptRef: TaskAttemptRef;
  roleBinding: RoleBindingRefV1;
  kind: "patch" | "commit";
  title: string;
  changedPaths: string[];
  /** body-first: the patch/commit body lives in the ArtifactVault. */
  bodyRef: ArtifactRef;
  beforeWorkspaceRevision: number;
  afterWorkspaceRevision: number;
  checkResults: PatchCheckResultV1[];
  /** Accepted Reader outputs the writer actually used (<= cap, APPLICABLE). */
  usedInputEvidenceRefs: EvidenceRef[];
  generatedAt: string;
};

// ------------------------------------------------------------------------ //
// Aggregate                                                                //
// ------------------------------------------------------------------------ //

export type PatchRecordRef = {
  aggregateType: "PatchRecord";
  projectId: string;
  patchId: string;
};

export function patchRecordRefFor(projectId: string, patchId: string): PatchRecordRef {
  return { aggregateType: "PatchRecord", projectId, patchId };
}

/** Immutable per-patch aggregate (created once at revision 1). */
export type PatchRecordSnapshot = {
  ref: PatchRecordRef;
  revision: 1;
  schemaVersion: 1;
  patch: PatchArtifactV1;
  recordedAt: string;
};

export type PatchRecordedEvent = {
  eventId: string;
  eventType: "PatchRecorded";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "PatchRecord";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    patchId: string;
    goalId: string;
    taskId: string;
    runRef: RunRef;
    attemptRef: TaskAttemptRef;
    kind: "patch" | "commit";
    title: string;
    changedPaths: string[];
    beforeWorkspaceRevision: number;
    afterWorkspaceRevision: number;
    checkResults: PatchCheckResultV1[];
    usedInputEvidenceRefs: EvidenceRef[];
    generatedAt: string;
  };
};

// ------------------------------------------------------------------------ //
// Command / receipt                                                         //
// ------------------------------------------------------------------------ //

export type RecordPatchCommand = {
  commandId: string;
  commandType: "RecordPatch";
  schemaVersion: 1;
  identity: CommandIdentity;
  /** patchId — the PatchRecord aggregate. */
  aggregateId: string;
  /** expected PatchRecord revision (0 = new aggregate). */
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: {
    patch: PatchArtifactV1;
  };
};

export type RecordPatchRejectionCode =
  | "invalid"
  | "run_not_found"
  | "run_not_ended"
  | "workspace_not_found"
  | "plan_not_found"
  | "stale_plan"
  | "lease_not_found"
  | "not_holder"
  | "scope_mismatch"
  | "stale_workspace"
  | "input_not_found"
  | "input_not_accepted"
  | "revision_conflict"
  | "idempotency_conflict"
  | "unavailable";

export type RecordPatchReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      patchRef: PatchRecordRef;
      workspaceRevision: number;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | { status: "rejected"; commandId: string; code: RecordPatchRejectionCode };

// ------------------------------------------------------------------------ //
// Fingerprint                                                               //
// ------------------------------------------------------------------------ //

export function recordPatchFingerprint(command: RecordPatchCommand): CommandFingerprint {
  return sha256Hex(
    canonicalJson({
      commandType: command.commandType,
      projectId: command.identity.projectId,
      payload: command.payload,
    }),
  ) as CommandFingerprint;
}
