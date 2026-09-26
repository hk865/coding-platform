import type { CommitCursor } from '../command-event.js';
import type { ExecutionRef, RoleConfigurationRef, SessionAggregateRef, SessionWorkLinkRef } from './identity.js';
import type { OperationRef } from './operations.js';
export type SessionOccupancy =
  | { kind: 'execution'; executionRef: ExecutionRef; generation: number }
  | { kind: 'maintenance'; operationRef: OperationRef; generation: number };
export type SessionRecord = {
  ref: SessionAggregateRef; revision: number;
  kernel: { adapterId: string; kernelSessionId: string };
  lifecycle: 'active' | 'archived'; health: 'available' | 'recoverable' | 'unavailable';
  role: RoleConfigurationRef; workspaceId: string;
  lastExecutionRef: ExecutionRef | null; occupancy: SessionOccupancy | null;
  /** Last completed-turn boundary, not the latest raw session record position. */
  historyCursor: string | null; createdAt: string; archivedAt: string | null;
};
export type SessionWorkLink = { ref: SessionWorkLinkRef; revision: number; since: CommitCursor; until: CommitCursor | null };
