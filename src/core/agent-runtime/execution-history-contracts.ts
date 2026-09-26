/** R4c.2a: targeted raw evidence over the existing authorized Session history.
 * Kernel identity is supplied by the trusted Host. This reader does not prove
 * its relationship to a platform Run, infer entry/completion, or authorize retry. */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { Page, ReadResult } from '../../contracts/core/results.js';
import type { SessionHistoryEntry, SessionHistoryRange, SessionOperationsPort } from './session-operations.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { ExecutionReadPort } from '../work-graph/tasks/execution-read-contracts.js';
export type KernelExecutionIdentity = { runId: string; turnId: string };
export type ExecutionHistoryRequest = {
  sessionRef: SessionRef;
  executionIdentity: KernelExecutionIdentity;
  /** Only nextCursor from this operation, not an individual raw entry cursor. */
  afterCursor: string | null;
  /** Optional original Session-history boundary, interpreted by its owner. */
  throughCursor: string | null;
  /** Maximum raw entries scanned on this call, 1..200; NOT match count. */
  limit: number;
  /** Inclusive original-history range, normally supplied by the WorkGraph locator. */
  range?: SessionHistoryRange;
};
export type ExecutionHistoryPage = Page<SessionHistoryEntry> & {
  executionIdentity: KernelExecutionIdentity;
  /** Number of raw page.items, including nonmatches; not physical DB I/O. */
  scannedCount: number;
};
export interface ExecutionHistoryPort {
  readExecutionHistory(ctx: CoreCallContext, request: ExecutionHistoryRequest): Promise<ReadResult<ExecutionHistoryPage>>;
}
export type ExecutionHistoryDependencies = {
  history: Pick<SessionOperationsPort, 'readSessionHistory'>;
};

export type TaskExecutionHistoryRequest = { runRef: RunRef; afterCursor: string | null; limit: number };
export interface GraphExecutionHistoryReadPort {
  readTaskExecutionHistory(ctx: CoreCallContext, request: TaskExecutionHistoryRequest): Promise<ReadResult<ExecutionHistoryPage>>;
}
export type GraphExecutionHistoryDependencies = {
  executions: ExecutionReadPort;
  history: ExecutionHistoryPort;
};
