import type { CommitCursor } from '../command-event.js';
import type { TaskTriple } from '../dispatch.js';
import type { SessionMessageRef } from './session-message.js';
import type { SessionArchiveRequestV1 } from './session-archive.js';
import type { ExecutionRef, RoleConfigurationRef, SessionAggregateRef, SessionRef, SessionWorkLinkRef } from './identity.js';
import type { OperationRef } from './operations.js';
import type { PlatformDutyV1 } from '../platform-duty.js';
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
 * How a Session came to be (slice 1 §2.2). `new` is the default for a creation
 * input that does not supply one; every stored Session carries a provenance.
 */
export type SessionProvenanceV1 =
  | { schemaVersion: 1; kind: 'new' }
  | { schemaVersion: 1; kind: 'continuation'; from: SessionRef;
      reason: 'interrupted' | 'archived' | 'damaged' | 'role_mismatch'; task: TaskTriple }
  | { schemaVersion: 1; kind: 'handoff'; from: SessionRef }
  | { schemaVersion: 1; kind: 'readonly_copy'; from: SessionRef;
      messageRef: SessionMessageRef };
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
  /** Required: every stored Session records how it came to be. */
  provenance: SessionProvenanceV1;
  /** Absent on records written before slice 1 and read as null; non-null only while an archive is pending. */
  archiveRequest?: SessionArchiveRequestV1 | null;
  /** The creator's accepted permissions for a member-created or inherited line; absent means no ceiling. */
  delegationCeiling?: { tools: string[]; writeScope: string[]; createMember: boolean };
  /** Present only on a secretary-created executor; every later preparation pins `createMember` false. */
  secretaryCreated?: true;
  /**
   * Wiring package 2 (spec §2.3, L10): the commit cursor of the most recent
   * available→unavailable entry. `null` is the pending placeholder written in
   * the same record and bound to that commit's cursor; recovery removes the
   * field entirely; an already-unavailable Session keeps its existing value.
   * Absent when the Session is available; entering unavailable writes the
   * placeholder or keeps the already-bound cursor.
   */
  unavailableSince?: CommitCursor | null;
};
export type SessionWorkLink = { ref: SessionWorkLinkRef; revision: number; since: CommitCursor; until: CommitCursor | null };
export type PendingSessionWorkLink = { ref: SessionWorkLinkRef; revision: number; since: CommitCursor | null; until: CommitCursor | null };
export type HandoffSeatFactsV1 = { ref: OperationRef; phase: 'accepted' | 'running' | 'completed' | 'failed' | 'unknown';
  action: { kind: 'handoff'; input: { source: SessionRef; assignments: readonly {
    target: { kind: 'create'; duty: PlatformDutyV1 } | { kind: 'existing'; session: SessionRef } }[] } };
  progress: { assignments: readonly { successor: SessionRef | null; createInput: { commandId: string } | null }[] } };
