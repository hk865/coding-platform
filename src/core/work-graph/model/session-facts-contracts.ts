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
import type { MessageRecipient, SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { SessionRecord, SessionProvenanceV1 } from '../../../contracts/core/session.js';
import type { TaskClaim } from '../../../contracts/core/task-claim.js';
import type { RunRef, RunSnapshot, RunStatus, TaskTriple } from '../../../contracts/dispatch.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { QueryExecutionStateV1, QueryJobRef, QueryRunRef, QueryRunSnapshot } from '../../../contracts/query-job.js';
import type { RecordGuard } from '../../record-store/ports.js';
import type { DeliveryBaseFactsV1, WaitStateV1 } from '../state/message-machine.js';
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
export type SessionWaitV1 = {
  messageRef: SessionMessageRef;
  /** The wait's own message. `rootRef = messageRef`; no forward walk (D8). */
  rootRef: SessionMessageRef;
  waitingSession: SessionRef;
  originalRun: RunRef | null;
  requestRoot: QueryJobRef | null;
  recipient: MessageRecipient;
  state: WaitStateV1;
  deadline: string | null;
  expiredAt: string | null;
  /** The page budget's verdict: `true` on every returned row; a hit is the read's `incomplete` (D8). */
  complete: boolean;
};
/** The facts a Runtime/Query admission cannot read from the message alone. */
export type DeliveryEligibilityFactsV1 = Pick<DeliveryBaseFactsV1, 'goal' | 'taskBlocked' | 'recipientOutcomeUnknown'>;
export interface DeliveryEligibilityFactsPort {
  readDeliveryEligibilityFacts(ctx: CoreCallContext, input: { messageRef: SessionMessageRef }):
    Promise<ReadResult<DeliveryEligibilityFactsV1>>;
}
export type SessionFactsV1 = {
  session: SessionRecord; latestWork: TaskClaim | null; wait: SessionWorkWaitV1 | null;
  /** S's one addition: all open/answered/expired waits of the line, oldest first by the message's `since`. */
  waits: SessionWaitV1[]; predecessor: SessionProvenanceV1 | null; continuations: SessionRef[];
  sourceCursor: CommitCursor;
};
export interface SessionFactsPort {
  readSessionFacts(ctx: CoreCallContext, sessionRef: SessionRef): Promise<ReadResult<SessionFactsV1>>;
  listSessionExecutions(ctx: CoreCallContext, input: { sessionRef: SessionRef; page: SessionPageRequest }):
    Promise<ReadResult<SessionPage<TaskClaim>>>;
  listSessionQueries(ctx: CoreCallContext, input: { sessionRef: SessionRef; page: SessionPageRequest }):
    Promise<ReadResult<SessionPage<QueryRunSnapshot>>>;
  findSessionSuccessors(ctx: CoreCallContext, input: { sessionRef: SessionRef; page: SessionPageRequest }):
    Promise<ReadResult<SessionPage<SessionRecord>>>;
  /** Required, not optional; 7C's handoff and 7D2's idle check consume it. */
  readWait(ctx: CoreCallContext, input: { messageRef: SessionMessageRef }):
    Promise<ReadResult<SessionWaitV1>>;
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

// ------------------------------------------------------------------------ //
// The withdraw's open-execution port                                        //
// ------------------------------------------------------------------------ //

/** One execution the recipient line still has open, with the run facts read beside the enumeration. */
export type RecipientOpenExecutionV1 =
  | { kind: 'work'; ref: RunRef; stage: RunStatus; startedAt: string | null }
  | { kind: 'query'; ref: QueryRunRef; stage: QueryExecutionStateV1['phase']; startedAt: string | null };

/** A Work Run is open while it is `starting` or `running`; `ended` is terminal. */
export const OPEN_WORK_STAGES = ['starting', 'running'] as const satisfies readonly RunStatus[];
/** A QueryRun is open while it is claimed, prepared, entering, entered or unknown; `settled` is terminal. */
export const OPEN_QUERY_PHASES = ['claimed', 'prepared', 'entering', 'entered', 'unknown'] as const satisfies readonly QueryExecutionStateV1['phase'][];

export type RecipientOpenExecutionsV1 = {
  executions: readonly RecipientOpenExecutionV1[];
  /** The ledger horizon taken BEFORE the first enumeration; every page and execution read is checked at it. */
  readCursor: CommitCursor;
};
export interface RecipientExecutionsPort {
  readRecipientOpenExecutions(ctx: CoreCallContext, input: { sessionRef: SessionRef; messageRef: SessionMessageRef }):
    Promise<ReadResult<RecipientOpenExecutionsV1>>;
}
