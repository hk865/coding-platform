import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { ContinuationBriefV1 } from '../../contracts/continuation-brief.js';
import type { ControlIntentSnapshotV1 } from '../../contracts/control-intent.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { WorkspaceScope } from '../../contracts/core/identity.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { OperationReceipt, Page, ReadResult } from '../../contracts/core/results.js';
import type { SessionRecord } from '../../contracts/core/session.js';
import type { TaskRequeueRef } from '../../contracts/task-requeue.js';
import type { ArchiveChangedFilesV1 } from '../../contracts/session-anomaly.js';
import type { PreparedQueryExecution, PreparedTaskExecution } from '../../contracts/core/prepared-execution.js';
import type { RuntimeCapabilities } from './contracts.js';
import type {
  ExecutionHistoryPage, ExecutionHistoryRequest, TaskExecutionHistoryRequest,
} from './execution-history-contracts.js';
import type {
  DeliverControlRequest, ObserveQueryExecutionRequest, ObserveTaskRunRequest,
  PrepareQueryExecutionRequest, PrepareTaskExecutionRequest, StartQueryExecutionRequest,
  StartTaskExecutionRequest, TaskExecutionRecord,
} from './execution-contracts.js';
import type { QueryExecutionRecord } from '../work-graph/queries/contracts.js';
import type { QueryRunRef } from '../../contracts/query-job.js';
import type { PromptRecordReadV1 } from '../../contracts/prompts/prompt-set.js';
import type { CreateSessionRequest, SessionHistoryEntry, SessionHistoryRequest } from './session-operations.js';
import type { RunActivityRead } from './run-activity-reader.js';
import type { ConsultationHistoryFailureV1 } from '../work-graph/queries/platform-facts.js';

/**
 * Formal AgentRuntime execution port (B2).
 *
 * `prepareExecution`/`startRun`/`observeRun` consume formal Task execution facts,
 * drive the fixed Kernel identity and reconcile original history. The factory
 * requires trusted execution dependencies; its no-argument form is unsupported.
 *
 * The Session/maintenance members below are the already accepted RT1/RT7/RT8
 * subset; the composition root overrides them with the real implementations and
 * they are declared here only so one port owns the whole execution surface.
 */
export interface RuntimeExecutionPort {
  capabilities(ctx: CoreCallContext, workspace: WorkspaceScope): Promise<ReadResult<RuntimeCapabilities>>;
  createSession(ctx: CoreCallContext, request: CreateSessionRequest): Promise<OperationReceipt<SessionRecord>>;
  readSessionHistory(ctx: CoreCallContext, request: SessionHistoryRequest): Promise<ReadResult<Page<SessionHistoryEntry>>>;
  /**
   * The Kernel-backed last completed-turn boundary of one Session. A derived
   * isolated Query uses it as its fixed source prefix; absence of a completed
   * turn is the explicit empty baseline (`position: 0`).
   *
   * A rejection may carry the structured history failure class beside its core
   * code; existing callers read only `status`/`code`/`reason`.
   */
  readCompletedBoundary?(ctx: CoreCallContext, request: { sessionRef: import('../../contracts/core/identity.js').SessionRef }): Promise<ReadResult<{ cursor: string | null; position: number }> & { failure?: ConsultationHistoryFailureV1 }>;
  readExecutionHistory(ctx: CoreCallContext, request: ExecutionHistoryRequest): Promise<ReadResult<ExecutionHistoryPage>>;
  readTaskExecutionHistory(ctx: CoreCallContext, request: TaskExecutionHistoryRequest): Promise<ReadResult<ExecutionHistoryPage>>;
  prepareExecution(ctx: CoreCallContext, request: PrepareTaskExecutionRequest): Promise<ReadResult<PreparedTaskExecution>>;
  startRun(ctx: CoreCallContext, request: StartTaskExecutionRequest): Promise<ReadResult<TaskExecutionRecord>>;
  /** Explicit observe/reconcile entry; it never starts a model or a tool call. */
  observeRun(ctx: CoreCallContext, request: ObserveTaskRunRequest): Promise<ReadResult<TaskExecutionRecord>>;
  /**
   * R4.3a local control delivery on the SAME Runtime port. It reads the exact
   * accepted intent, finds the matching live handle and lets the fixed driver
   * consume it at a real safe point; without the trusted `controls` dependency
   * it returns an explicit `unsupported`. It is optional ONLY so an existing
   * `RuntimeExecutionPort` literal stays type-compatible; `createAgentRuntime`
   * always publishes it.
   */
  deliverControl?(ctx: CoreCallContext, request: DeliverControlRequest): Promise<ReadResult<ControlIntentSnapshotV1>>;
  /**
   * R5b.2 Query thin branch on the SAME Runtime port. It is not a second model
   * loop: the Query owner keeps the facts and `runObservedModel` stays the one
   * Kernel loop. Without the trusted Query Host/dependencies these three stay
   * explicitly unsupported while every Work member keeps its behavior.
   *
   * They are optional ONLY so an existing Work caller's port literal stays
   * type-compatible; `createAgentRuntime` always publishes all three.
   */
  prepareQuery?(ctx: CoreCallContext, request: PrepareQueryExecutionRequest): Promise<ReadResult<PreparedQueryExecution>>;
  startQuery?(ctx: CoreCallContext, request: StartQueryExecutionRequest): Promise<ReadResult<QueryExecutionRecord>>;
  observeQuery?(ctx: CoreCallContext, request: ObserveQueryExecutionRequest): Promise<ReadResult<QueryExecutionRecord>>;
  /**
   * C3: the continuation brief pinned in a Run's saved manifest, checked
   * against `inputBinding.continuationBriefDigest`. `null` = a Run without
   * `requeueRef`; a requeue Run with no pinned brief yet is `incomplete`.
   * Optional like the members above; `createAgentRuntime` publishes it.
   */
  readContinuationBrief?(ctx: CoreCallContext, request: { runRef: RunRef }): Promise<ReadResult<{ brief: ContinuationBriefV1; digest: string } | null>>;
  /**
   * Ruling 29: the frozen prompt record of one Work Run or QueryRun — the
   * manifest's set, its request rows in order and every text body the set and
   * the requests refer to, keyed by digest. Read fresh, verified against each
   * ref; no HTTP route (E3 adds one). Optional only so existing port literals
   * stay type-compatible; `createAgentRuntime` always publishes it.
   */
  readPromptRecord?(ctx: CoreCallContext, ref: RunRef | QueryRunRef): Promise<PromptRecordReadV1>;
  /**
   * Slice 1 §3.3: the exact changed-file snapshot recorded beside an archive
   * anomaly anchor (Kernel window → current worktree → unknown; §2.6 last
   * paragraph). Optional like the members above; `createAgentRuntime` publishes
   * it for the real dependency bundle.
   */
  readArchiveChangedFiles?(ctx: CoreCallContext, input: { runRef: RunRef }): Promise<ReadResult<ArchiveChangedFilesV1>>;
  /**
   * Slice 3: the same assembler instance the attention scanner reads its graph
   * facts through. Optional only so an old port literal stays type-compatible;
   * `createAgentRuntime` always publishes it.
   */
  readAttentionGraph?: import('./context-assembler.js').ContextAssembler['readAttentionGraph'];
  /**
   * K slice (L4, M1): close the dangling Kernel Turn of a Run the platform has
   * already proved ended, then hand the Session back to the SES-13 health owner.
   * Optional: without the injected `turnClosure` dependency the Runtime does not
   * install it, and the Workflow's `close_open_turn` is `unsupported`.
   */
  closeOpenTurn?(ctx: CoreCallContext, input: {
    sessionRef: SessionRef; afterRunRef: RunRef; requeueRef: TaskRequeueRef | null;
    /**
     * SES-19a (2C-22(2)): only the Workflow maintenance's dangling-Turn close
     * carries this, so an unreadable answer may replace `kernel_turn_open` with
     * the fresh probe. The Workflow's own `close_open_turn` selection and the
     * start-up reconcile leave it absent (SES-19 stays).
     */
    turnClosureCaller?: 'turn_closure';
  }): Promise<
    | { status: 'closed' | 'already_closed'; health: 'available' | 'unavailable' }
    | { status: 'refused'; reason: 'lease' | 'not_closable_run' | 'continuation_not_authorized' | 'archived'
        | 'archive_requested' | 'occupied' | 'handed_over' | 'health' }
    | { status: 'unsupported' | 'unreadable' | 'mismatch' | 'conflict' | 'transient'; reason: string }>;
  /**
   * K3 (§2 L4 item 5; G6): the read-only capability check behind RUN-25's
   * `closure_unsupported`: this Runtime publishes the closure, this Host holds
   * the instance lease, the Session is readable, and its Kernel store is not a
   * legacy reader and publishes `closeOpenTurn`. It never writes and never
   * closes; the head comparison stays the classifier's own probe.
   */
  turnClosureSupport?(ctx: CoreCallContext, input: { sessionRef: SessionRef }):
    Promise<{ status: 'supported' } | { status: 'unsupported'; reason: string }>;
  /**
   * K3 L13/U5/R3: whether the review/proposal round for this workspace+Role
   * could register the real `run_readonly_command` tool. It probes with exactly
   * the options the real tool is built with and requires the Host switch on and
   * the whole workspace readable. It selects the binding by Role and never
   * resolves the model. Read-only: it never writes and never starts a round.
   */
  reviewCapability?(ctx: CoreCallContext, input: import('./execution-contracts.js').ReadonlyCommandAccessInput):
    Promise<{ status: 'available' } | { status: 'unavailable'; reason: string }>;
  /**
   * Slice 2B L6/L8: the read-only backfill window tally for one ended Run.
   * Optional (like the members above); `createAgentRuntime` publishes it with
   * the trusted bundle. `{kind:'not_entered'}` is the L7 proof that the Run
   * never entered the Kernel. `maxPages` is the L17 test injection point.
   */
  countRunActivity?(ctx: CoreCallContext, input: { runRef: RunRef; maxPages?: number }):
    Promise<ReadResult<RunActivityRead | { kind: 'not_entered' }>>;
  /**
   * Slice 6A L16: the read-only Query activity tally for one ended QueryRun.
   * `{kind:'not_entered'}` is the proof that the QueryRun never claimed a
   * Kernel identity (QRR-01/02 wrote no record). It reads only the Kernel and
   * writes nothing; `maxPages` is the same bounded-read injection point.
   */
  countQueryActivity?(ctx: CoreCallContext, input: { queryRunRef: QueryRunRef; maxPages?: number }):
    Promise<ReadResult<RunActivityRead | { kind: 'not_entered' }>>;
}

/** What the agent factory itself publishes. The five Session/capability members
 * are the composition root's: it spreads this port and supplies the real
 * implementations, so the factory never publishes an unsupported stub of them. */
export type AgentRuntimePort = Omit<RuntimeExecutionPort,
  'capabilities' | 'createSession' | 'readSessionHistory' | 'readExecutionHistory' | 'readTaskExecutionHistory'>;

export type AgentRuntimeService = {
  port: AgentRuntimePort;
  initialize?(): Promise<void>;
  close?(): Promise<void>;
};
