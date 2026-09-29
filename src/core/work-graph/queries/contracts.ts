/**
 * R5b.1 pending QueryJob submission/read port plus the R5b.2 Query execution
 * seam.
 *
 * The pending port records ONE pending QueryJob + QueryRun pair and reads it
 * back. The execution declarations below freeze the internal QueryExecutionPort
 * that owns the Query's claim/entry/request/answer/terminal writes over the SAME
 * Store and Session records. They are stage-one declarations: the port is wired
 * with real dependencies but every algorithm entry stays explicitly unsupported
 * until the stage-two implementation lands.
 *
 * `GraphWrite`, `CoreCallContext`, `ReadResult`/`WriteResult` and the Query
 * snapshots are imported from their existing owners and never restated here.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { RunExecutionHistoryV1 } from '../../../contracts/core/execution-history.js';
import type { RoleConfigurationRef, SessionRef } from '../../../contracts/core/identity.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../../contracts/core/prepared-execution.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { GoalSnapshot, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type {
  QueryExecutionStateV1,
  QueryJobAnswerRef,
  QueryJobAnswerSnapshot,
  QueryJobAnswerV1,
  QueryJobIntentV1,
  QueryJobRef,
  QueryJobSnapshot,
  QueryModelUsageV1,
  QueryRunRef,
  QueryRunSnapshot,
} from '../../../contracts/query-job.js';
import type { RuntimeBudget } from '../../../contracts/runtime-budget.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RoleBindingFactsPort } from '../configuration/contracts.js';
import type { SessionMailboxPort } from '../communication/contracts.js';
import type { GraphWrite } from '../tasks/contracts.js';

/** The exact pending pair a submit records: both ids are independent identities. */
export type SubmitQueryJobInput = {
  queryJobId: string;
  runId: string;
  intent: QueryJobIntentV1;
};

/** The submitted Job snapshot plus the pending Run it points at. */
export type QueryJobRecord = {
  job: QueryJobSnapshot;
  run: QueryRunSnapshot;
};

/**
 * The internal execution record read by the Runtime thin path and by the Query
 * owner. Before claim there is no `session`; pending reads keep using
 * `readQueryJob`.
 */
export type QueryExecutionRecord = {
  job: QueryJobSnapshot;
  run: QueryRunSnapshot;
  session: SessionRecord;
  answer: QueryJobAnswerSnapshot | null;
};

/** The stable identity a fresh Query entry binds once, before any model request. */
export type QueryEntryIdentity = {
  queryRunRef: QueryRunRef;
  sessionRef: SessionRef;
  sessionGeneration: number;
  entryGeneration: 1;
  consumerId: string;
  kernel: RunExecutionHistoryV1['kernel'];
};

/** The exact formal facts a bounded Query preparation consumes. */
export type QueryPreparationFacts = {
  record: QueryExecutionRecord;
  goal: GoalSnapshot;
  workspace: WorkspaceSnapshot;
  focusPlan: PlanRevisionSnapshot | null;
  initiator: Extract<ActorRef, { kind: 'human' | 'system' }>;
};

export type QueryEntryTicket = QueryEntryIdentity & {
  bundleRef: ArtifactRef;
  inputDigest: string;
};

/** One original-history observation reported by the Runtime thin observer. */
export type QueryHistoryObservation = {
  entry: QueryEntryIdentity;
  history: RunExecutionHistoryV1;
  /** This round's original record position and cursor, from the Session owner. */
  source: { position: number; cursor: string };
  observation:
    | { kind: 'entered'; occurredAt: string }
    | { kind: 'progress' }
    | { kind: 'unknown'; reason: string }
    | {
        kind: 'terminal';
        occurredAt: string;
        outcome: 'answered' | 'timeout' | 'gap' | 'failed' | 'cancelled';
        answer: QueryJobAnswerV1 | null;
        reason: string | null;
      };
};

/**
 * The trusted Host projection consumed by the Query claim/prepare/begin/model
 * admission bounds. It re-reads the current formal facts and the trusted Host
 * grant; a caller-echoed manifest declaration is never accepted on its own.
 */
export type AuthorizeQueryConfiguration = (
  ctx: CoreCallContext,
  input: {
    job: QueryJobSnapshot;
    run: QueryRunSnapshot;
    sessionRole: RoleConfigurationRef;
    roleResolution: QueryExecutionStateV1['roleResolution'];
  },
) => Promise<ReadResult<{
  configurationRevision: string;
  permissions: { tools: string[]; writeScope: [] };
  hostTemplate: PreparedQueryManifestV1['hostTemplate'];
  budget: RuntimeBudget;
}>>;

/**
 * Internal Query execution writer. It is injected into the QueryJob claim/read
 * adapter and the Runtime thin path; it is NEVER published as a platform public
 * terminal port, so a Host request cannot submit terminal JSON directly.
 */
export interface QueryExecutionPort {
  readQueryExecution(ctx: CoreCallContext, ref: QueryRunRef): Promise<ReadResult<QueryExecutionRecord>>;
  readPreparationFacts(ctx: CoreCallContext, ref: QueryRunRef): Promise<ReadResult<QueryPreparationFacts>>;
  claimQuery(ctx: CoreCallContext, request: GraphWrite<{
    queryRunRef: QueryRunRef;
    sessionRef: SessionRef;
  }>): Promise<WriteResult<QueryExecutionRecord>>;
  bindPreparedQuery(ctx: CoreCallContext, request: GraphWrite<{
    prepared: PreparedQueryExecution;
  }>): Promise<WriteResult<QueryExecutionRecord>>;
  beginQueryEntry(ctx: CoreCallContext, request: GraphWrite<{
    prepared: PreparedQueryExecution;
    consumerId: string;
    kernel: RunExecutionHistoryV1['kernel'];
  }>): Promise<WriteResult<QueryEntryTicket>>;
  recordQueryUsage(ctx: CoreCallContext, request: GraphWrite<{
    entry: QueryEntryIdentity;
    entries: QueryModelUsageV1[];
  }>): Promise<WriteResult<QueryRunSnapshot>>;
  admitQueryModelRequest(ctx: CoreCallContext, request: GraphWrite<{
    entry: QueryEntryIdentity;
    requestId: string;
    requestDigest: string;
    contextInputDigest: string;
    manifestDigest: string;
  }>): Promise<WriteResult<QueryRunSnapshot>>;
  recordQueryObservation(ctx: CoreCallContext, request: GraphWrite<QueryHistoryObservation>): Promise<WriteResult<QueryExecutionRecord>>;
  readQueryAnswer(ctx: CoreCallContext, ref: QueryJobAnswerRef): Promise<ReadResult<QueryJobAnswerSnapshot>>;
}

/**
 * Trusted deps. `records` is the same physical WorkGraph backend the Goal/Plan
 * writers use; `roles` is the real Role facts reader; `bodies` is the same raw
 * body store; `authorizeConfiguration` projects the trusted Query Host
 * configuration. `now`/`eventId` are materialized only for a fresh request.
 */
export type QueryExecutionDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  roles: RoleBindingFactsPort;
  bodies: Pick<RawArtifactStorePort, 'read'>;
  authorizeConfiguration: AuthorizeQueryConfiguration;
  now(): string;
  eventId(): string;
};

/**
 * Trusted Host pending QueryJob capability plus the R5b.2 claim/read seams.
 *
 * `submitQueryJob` is desired-state-first: it records QueryJob (pending) and
 * QueryRun (pending) atomically; it opens no Session and starts no model.
 * `readQueryJob` is a Host-scope exact read; it does not require the Goal to
 * still be Plan-less or a source to still be current. `claimQuery` and
 * `readQueryAnswer` forward to the internal QueryExecutionPort when it is
 * injected; without it they stay explicitly `unsupported`.
 */
export interface QueryJobPort {
  submitQueryJob(
    ctx: CoreCallContext,
    request: GraphWrite<SubmitQueryJobInput>,
  ): Promise<WriteResult<QueryJobRecord>>;
  readQueryJob(
    ctx: CoreCallContext,
    ref: QueryJobRef,
  ): Promise<ReadResult<QueryJobRecord>>;
  claimQuery(
    ctx: CoreCallContext,
    request: GraphWrite<{ queryRunRef: QueryRunRef; sessionRef: SessionRef }>,
  ): Promise<WriteResult<QueryExecutionRecord>>;
  readQueryAnswer(
    ctx: CoreCallContext,
    ref: QueryJobAnswerRef,
  ): Promise<ReadResult<QueryJobAnswerSnapshot>>;
}

/**
 * Trusted deps. `records` is the same physical WorkGraph backend the Goal/Plan
 * writers use; `now`/`eventId` are materialized only for a request that is not
 * an exact replay. The optional `execution` is the ONE internal Query writer
 * created by the composition root; without it only the new Query methods are
 * unsupported and the pending submit/read behavior is unchanged.
 */
export type QueryJobDependencies = {
  records: GoalRecordTransactionPort;
  now(): string;
  eventId(): string;
  execution?: Pick<QueryExecutionPort, 'claimQuery' | 'readQueryAnswer'>;
  /**
   * Optional read-only mailbox seam used ONLY to admit a consultation submit:
   * it proves the original message/body/recipient/scope and the verbatim
   * question. It exposes no send/ack/respond capability and never becomes a
   * second mailbox.
   */
  consultations?: Pick<SessionMailboxPort, 'readMessage' | 'readMessageBody'>;
};
