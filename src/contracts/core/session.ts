import type { CommitCursor } from '../command-event.js';
import type { ExecutionRef, RoleConfigurationRef, SessionAggregateRef, SessionWorkLinkRef } from './identity.js';
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
};
export type SessionWorkLink = { ref: SessionWorkLinkRef; revision: number; since: CommitCursor; until: CommitCursor | null };
