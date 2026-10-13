import type { ArtifactRef } from '../artifact.js';
import type { CommitCursor } from '../command-event.js';
import type { DispatchOutboxRef, RunRef, TaskTriple } from '../dispatch.js';
import type { SessionMessageRef } from './session-message.js';
import type { TaskRequeueRef } from '../task-requeue.js';
import type { SessionArchiveRequestV1 } from './session-archive.js';
import type { ExecutionRef, RoleConfigurationRef, SessionAggregateRef, SessionRef, SessionWorkLinkRef } from './identity.js';
import type { OperationRef } from './operations.js';
export type SessionOccupancy =
  | { kind: 'execution'; executionRef: ExecutionRef; generation: number }
  | { kind: 'maintenance'; operationRef: OperationRef; generation: number };
/**
 * Why `health` is `unavailable` (SD-2); not a separate dimension.
 * `kernel_turn_open`: released while the Kernel's last Turn has no Kernel
 * terminal, so the frozen Kernel refuses a new Turn there (LA-1).
 */
export type SessionHealthConclusion = 'missing' | 'damaged' | 'kernel_turn_open';
export const SESSION_HEALTH_CONCLUSIONS: readonly SessionHealthConclusion[] =
  Object.freeze(['missing', 'damaged', 'kernel_turn_open']);
/**
 * How a Session came to be (slice 1 §2.2). `new` is the default for a caller
 * that does not supply one; absent on legacy records decodes as null and is
 * backfilled once from reliable facts.
 */
export type SessionProvenanceV1 =
  | { schemaVersion: 1; kind: 'new' }
  | { schemaVersion: 1; kind: 'continuation'; from: SessionRef;
      reason: 'interrupted' | 'archived' | 'damaged' | 'role_mismatch'; task: TaskTriple }
  | { schemaVersion: 1; kind: 'handoff'; from: SessionRef }
  | { schemaVersion: 1; kind: 'readonly_copy'; from: SessionRef;
      messageRef: SessionMessageRef };
/**
 * Reliable basis of a one-time legacy provenance backfill (slice 1 §2.2).
 * Recorded in the `SessionProvenanceBackfilled` event; never a migration table.
 */
export type LegacyProvenanceBasisV1 =
  | { kind: 'consultation'; messageRef: SessionMessageRef }
  | { kind: 'requeue_creation'; operationRef: OperationRef; creationCursor: CommitCursor; requeueRef: TaskRequeueRef;
      firstClaimRef: DispatchOutboxRef }
  | { kind: 'manifest_seed'; operationRef: OperationRef; creationCursor: CommitCursor; runRef: RunRef;
      manifestRef: ArtifactRef }
  | { kind: 'no_reliable_predecessor' };
export type SessionRecord = {
  ref: SessionAggregateRef; revision: number;
  kernel: { adapterId: string; kernelSessionId: string };
  lifecycle: 'active' | 'archived'; health: 'available' | 'recoverable' | 'unavailable';
  /** Absent on records written before A.2 and read as null; null whenever health is available. */
  healthConclusion?: SessionHealthConclusion | null;
  role: RoleConfigurationRef; workspaceId: string;
  lastExecutionRef: ExecutionRef | null; occupancy: SessionOccupancy | null;
  /** Last completed-turn boundary, not the latest raw session record position. */
  historyCursor: string | null; createdAt: string; archivedAt: string | null;
  /** Absent on records written before slice 1 and read as null. */
  provenance?: SessionProvenanceV1 | null;
  /** Absent on records written before slice 1 and read as null; non-null only while an archive is pending. */
  archiveRequest?: SessionArchiveRequestV1 | null;
  /**
   * Wiring package 2 (spec §2.3, L10): the commit cursor of the most recent
   * available→unavailable entry. `null` is the pending placeholder written in
   * the same record and bound to that commit's cursor; recovery removes the
   * field entirely; an already-unavailable Session keeps its existing value.
   * Absent on records written before this package (legacy, reads as undefined).
   */
  unavailableSince?: CommitCursor | null;
};
export type SessionWorkLink = { ref: SessionWorkLinkRef; revision: number; since: CommitCursor; until: CommitCursor | null };
