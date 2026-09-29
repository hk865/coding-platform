import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { ControlIntentSnapshotV1 } from '../../contracts/control-intent.js';
import type { WorkspaceScope } from '../../contracts/core/identity.js';
import type { OperationReceipt, Page, ReadResult } from '../../contracts/core/results.js';
import type { SessionRecord } from '../../contracts/core/session.js';
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
import type { CreateSessionRequest, SessionHistoryEntry, SessionHistoryRequest } from './session-operations.js';

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
   */
  readCompletedBoundary?(ctx: CoreCallContext, request: { sessionRef: import('../../contracts/core/identity.js').SessionRef }): Promise<ReadResult<{ cursor: string | null; position: number }>>;
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
}

export type AgentRuntimeService = {
  port: RuntimeExecutionPort;
  initialize?(): Promise<void>;
  close?(): Promise<void>;
};

/** Compatibility aliases for the existing index export surface. The composition
 * supplies execution dependencies when a trusted Runtime Host is configured. */
export type N0RuntimeExecutionPort = RuntimeExecutionPort;
export type N0AgentRuntimeService = AgentRuntimeService;
