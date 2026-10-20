/**
 * Slice 1 (Session facts, corrections and archive): the narrow Session-facts
 * read port, the responsibility/provenance basis ports injected by the
 * composition root, and the six new lookup index identifiers.
 *
 * The implementation lives in `tasks/session-facts.ts`; `sessions/` and
 * `queries/` receive the port as an injected dependency and never import
 * `tasks/` (spec §0.2 L1).
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef, WorkLinkTarget } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { SessionRecord, SessionProvenanceV1 } from '../../../contracts/core/session.js';
import type { TaskClaim } from '../../../contracts/core/task-claim.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../../contracts/dispatch.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { QueryRunSnapshot } from '../../../contracts/query-job.js';
import type { RecordGuard } from '../../record-store/ports.js';
import type { SessionPage, SessionPageRequest } from './session-contracts.js';

// ------------------------------------------------------------------------ //
// The six new lookup index identifiers (spec §2.8)                          //
// ------------------------------------------------------------------------ //

export const SESSION_BY_PROVENANCE_LOOKUP = 'session-by-provenance';
export const WORK_EXECUTION_BY_SESSION_LOOKUP = 'work-execution-by-session';
export const QUERY_RUN_BY_SESSION_LOOKUP = 'query-run-by-session';
export const SESSION_ANOMALY_BY_TASK_LOOKUP = 'session-anomaly-by-task';
export const SESSION_ANOMALY_BY_GOAL_LOOKUP = 'session-anomaly-by-goal';
export const SESSION_REPLY_BY_HANDLER_LOOKUP = 'session-reply-by-handler';

export type Slice1LookupIndexV1 = {
  name: string;
  aggregateType: string;
  /** Exact path order of the registered index. */
  paths: readonly string[];
};

/** The exact name/aggregate/paths of the six indexes, in table order. */
export const SLICE1_LOOKUP_INDEXES: readonly Slice1LookupIndexV1[] = Object.freeze([
  { name: SESSION_BY_PROVENANCE_LOOKUP, aggregateType: 'Session',
    paths: ['ref.projectId', 'workspaceId', 'provenance.from.sessionId'] },
  { name: WORK_EXECUTION_BY_SESSION_LOOKUP, aggregateType: 'DispatchOutboxEntry',
    paths: ['claim.task.projectId', 'claim.workspaceId', 'claim.sessionRef.sessionId'] },
  { name: QUERY_RUN_BY_SESSION_LOOKUP, aggregateType: 'QueryRun',
    paths: ['ref.projectId', 'ref.workspaceId', 'run.executionState.sessionRef.sessionId'] },
  { name: SESSION_ANOMALY_BY_TASK_LOOKUP, aggregateType: 'SessionAnomalyAnchor',
    paths: ['ref.projectId', 'workspaceId', 'task.goalId', 'task.taskId'] },
  { name: SESSION_ANOMALY_BY_GOAL_LOOKUP, aggregateType: 'SessionAnomalyAnchor',
    paths: ['ref.projectId', 'workspaceId', 'task.goalId'] },
  { name: SESSION_REPLY_BY_HANDLER_LOOKUP, aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'replyHandler.sessionRef.sessionId'] },
]);

// ------------------------------------------------------------------------ //
// Session facts read port                                                   //
// ------------------------------------------------------------------------ //

export type SessionWorkWaitV1 = { runRef: RunRef; messageRef: SessionMessageRef; task: TaskTriple };
export type SessionFactsV1 = {
  session: SessionRecord; latestWork: TaskClaim | null; wait: SessionWorkWaitV1 | null;
  predecessor: SessionProvenanceV1 | null; continuations: SessionRef[];
  legacyPending: boolean; sourceCursor: CommitCursor;
};
export interface SessionFactsPort {
  readSessionFacts(ctx: CoreCallContext, sessionRef: SessionRef): Promise<ReadResult<SessionFactsV1>>;
  listSessionExecutions(ctx: CoreCallContext, input: { sessionRef: SessionRef; page: SessionPageRequest }):
    Promise<ReadResult<SessionPage<TaskClaim>>>;
  listSessionQueries(ctx: CoreCallContext, input: { sessionRef: SessionRef; page: SessionPageRequest }):
    Promise<ReadResult<SessionPage<QueryRunSnapshot>>>;
  findSessionSuccessors(ctx: CoreCallContext, input: { sessionRef: SessionRef; page: SessionPageRequest }):
    Promise<ReadResult<SessionPage<SessionRecord>>>;
}

// ------------------------------------------------------------------------ //
// Responsibility basis port (implementation: tasks/plan-readers.ts)         //
// ------------------------------------------------------------------------ //

export type SessionResponsibilityBasisV1 = {
  task: TaskTriple; planRef: PlanRevisionRef;
  terminal: boolean; finishedAt: string | null;
  terminalCause: 'satisfied' | 'cancelled' | 'superseded' | null;
  sourceRun: RunSnapshot | null; writerStopped: boolean;
  guards: readonly RecordGuard[]; sourceCursor: CommitCursor;
};
export interface SessionResponsibilityBasisPort {
  readResponsibilityBasis(ctx: CoreCallContext, input: {
    sessionRef: SessionRef; target: WorkLinkTarget;
  }): Promise<ReadResult<SessionResponsibilityBasisV1>>;
}
