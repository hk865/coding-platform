/**
 * B2 Runtime execution contracts (PHASE-1 SKELETON).
 *
 * These declarations freeze the formal `RuntimeExecutionPort` seam selected by
 * the main Agent. They deliberately contain NO execution algorithm:
 *
 *  - `prepareExecution` reads the real WG11 execution facts and returns a bounded
 *    `PreparedTaskExecution` that carries only verifiable references (fixed
 *    Run/Claim, `envelope.bundleRef`, `inputBinding`). The returned value never
 *    carries a caller-mutable root/client/hook that could grant a permission.
 *  - `startRun` returns the CURRENT formal `TaskExecutionRecord`; unknown/paused
 *    still keeps the real occupancy and is never interpreted as Task completion.
 *  - `observeRun` is the explicit observe/reconcile entry: it never starts a
 *    model, reads incremental original history along the stored locator, and
 *    submits the real observation to WorkGraph.
 *
 * `RuntimeHostBindings` is the trusted Host startup binding. It resolves the
 * exact Role configuration from the complete RunRef + RoleConfigurationRef +
 * resolved Role result, and returns the real Host grant. Nothing here is taken
 * from model JSON or echoed back from a caller-supplied Prepared value. WorkGraph
 * re-reads the persisted body and re-checks the Role/Run/Task/Plan permission
 * intersection before it authorizes anything.
 */
import type { BoundModel } from './source-tool-ports.js';
import type { CommitCursor } from '../../contracts/command-event.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { DecisionApplicationReceiptV1 } from '../../contracts/core/session-message.js';
import type { ControlIntentRef } from '../../contracts/control-intent.js';
import type { RoleConfigurationRef, SessionRef } from '../../contracts/core/identity.js';
import type { ReadResult } from '../../contracts/core/results.js';
import type { PreparedQueryExecution, PreparedTaskExecution, PreparedTaskManifestV1 } from '../../contracts/core/prepared-execution.js';
import type { QueryRunRef } from '../../contracts/query-job.js';
import type { MaterialBasisV1 } from '../../contracts/material-access.js';
import type { RuntimeBudget } from '../../contracts/runtime-budget.js';
import type { RoleSpecResolutionV1 } from '../../contracts/role-spec-materials.js';
import type { PlatformDutyV1 } from '../../contracts/graph-context.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { VerificationRoundSourceResult } from '../../contracts/verification-context.js';
import type { RawArtifactStorePort } from '../record-store/body-ports.js';
import type { RoleBindingFactsPort } from '../work-graph/model/configuration-contracts.js';
import type { MaterialPort } from '../work-graph/model/material-contracts.js';
import type { TaskClaimPort } from '../work-graph/model/claim-contracts.js';
import type { ExecutionHistoryWritePort } from '../work-graph/model/execution-history-contracts.js';
import type { ExecutionEntryPort } from '../work-graph/model/execution-entry-contracts.js';
import type { ExecutionReadPort, TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import type { GraphContextReadPort } from '../work-graph/model/graph-context-contracts.js';
import type { TaskContextInputPort } from '../work-graph/model/context-input-contracts.js';
import type { ModelRequestPort } from '../work-graph/tasks/model-call-contracts.js';
import type { PlanTaskPort } from '../work-graph/model/plan-contracts.js';
import type { ControlObservationPort, RunControlPort } from '../work-graph/tasks/control-contracts.js';
import type { SessionMailboxPort } from '../work-graph/model/communication-contracts.js';
import type { DecisionMessagePort } from '../work-graph/model/decision-contracts.js';
import type { SessionDirectoryPort } from '../work-graph/model/session-contracts.js';
import type { SourceSnapshotReads } from '../work-graph/source-authority-ports.js';
import type { QueryExecutionPort } from '../work-graph/queries/contracts.js';
import type { SessionHistoryEntry, SessionHistoryRequest, SessionOperationsPort } from './session-operations.js';
import type { ExecutionHistoryPage, ExecutionHistoryPort, GraphExecutionHistoryReadPort } from './execution-history-contracts.js';
import type { KernelStoreRegistry } from './kernel-store-locator.js';
import type { SourcePolicy } from './source-capture-access.js';
import type { WorkspaceHostBindings } from '../workspace/access.js';
import type { SessionHealthPort } from '../work-graph/sessions/session-health.js';

// ------------------------------------------------------------------------ //
// Requests / results                                                         //
// ------------------------------------------------------------------------ //

/** The caller may only name the accepted Run and its own request id. It cannot
 * supply a bundle, a role, a tool list or a Kernel identity. */
export type PrepareTaskExecutionRequest = { runRef: RunRef; requestId: string };

/** The Prepared value is passed back only as the identity of a previous
 * preparation; WorkGraph re-reads the persisted facts instead of trusting it. */
export type StartTaskExecutionRequest = {
  prepared: PreparedTaskExecution;
  consumerId: string;
  requestId: string;
};

/** Observe/reconcile only. This entry never authorizes a fresh Kernel call. */
export type ObserveTaskRunRequest = { runRef: RunRef };

/**
 * R4.3a local control delivery. The caller names only the accepted intent ref;
 * it cannot pass a replacement runId, a Kernel identity, a permission, an
 * observation or a stopped boolean. The Runtime resolves the intent's own
 * RunRef, finds its live handle and records the real original-history
 * conclusion.
 */
export type DeliverControlRequest = { intentRef: ControlIntentRef };

/** R5b.2: the caller may only name the accepted QueryRun and its own request id.
 * It cannot supply a bundle, a role, a tool list, a Kernel identity or terminal
 * facts. */
export type PrepareQueryExecutionRequest = { queryRunRef: QueryRunRef; requestId: string };
export type StartQueryExecutionRequest = {
  prepared: PreparedQueryExecution;
  consumerId: string;
  requestId: string;
};
export type ObserveQueryExecutionRequest = { queryRunRef: QueryRunRef };

// ------------------------------------------------------------------------ //
// Trusted Host bindings                                                      //
// ------------------------------------------------------------------------ //

/** The Host model binding for one resolved configuration. `BoundModel` is the
 * exact type the existing model loop already consumes. */
export type RuntimeModelBinding = BoundModel;

export type RuntimeConfigurationInput = {
  runRef: RunRef;
  role: RoleConfigurationRef;
  /** The already-resolved Role result (resolved/absent/inadmissible preserved). */
  roleResolution: RoleSpecResolutionV1;
};

/** The Host's exact, trusted grant for this Run. `configurationRevision` is the
 * version that must be re-checked when start actually consumes it. */
export type ResolvedRuntimeConfiguration = {
  configurationRevision: string;
  model: RuntimeModelBinding;
  budget: RuntimeBudget;
  /** Exact trusted legacy template identity, required only for an absent RoleSpec. */
  hostTemplate: PreparedTaskManifestV1['hostTemplate'];
  /** Declared Host tools are the real grant, still intersected with Role/Task. */
  tools: string[];
  writeScope: string[];
  /** Explicit broad process grant. An arbitrary allowsRead predicate cannot
   * prove whole-workspace shell access; absence means shell is unsupported.
   * Requires tools:shell and writeScope:["."], with Kernel denied prefixes. */
  shellWorkspaceAccess?: 'all_except_denied';
  /** L18: the Host grants the read-only process tool `run_readonly_command` when
   * the whole workspace is readable and the switch is on. Absence means the tool
   * is not granted for this Run. */
  readonlyCommandAccess?: 'all_except_denied';
  skills: { resourceRoot: string; enabledIds: string[] };
  systemInstruction: string | null;
  deniedPrefixes: string[];
  processSandboxOptions: { readOnlyPaths?: string[]; executablePath?: string };
  /** Current material basis the Host can prove, or null when it cannot. */
  materialBasis: MaterialBasisV1 | null;
  /** Slice 3 optional explicit Host duty; when present it must match the Role. */
  platformDuty?: PlatformDutyV1;
  /** Slice 3 resident budget of the four optional sections; default 4096. */
  contextResidentBytes?: number;
};

/** R5b.2 trusted Query Host configuration input. */
export type QueryRuntimeConfigurationInput = {
  queryRunRef: QueryRunRef;
  sessionRef: SessionRef;
  role: RoleConfigurationRef;
  /** The already-resolved stable Role pin (inadmissible is excluded). */
  roleResolution: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
};

/** Trusted Host startup binding. The stored `runtime` option is data, never a
 * capability that the request or model can extend. `resolveQueryConfiguration`
 * is the optional R5b.2 Query branch; its absence keeps only the new Query
 * methods unsupported while Work `resolveConfiguration` is unchanged. */
export interface RuntimeHostBindings {
  resolveConfiguration(ctx: CoreCallContext, input: RuntimeConfigurationInput): Promise<ReadResult<ResolvedRuntimeConfiguration>>;
  resolveQueryConfiguration?(ctx: CoreCallContext, input: QueryRuntimeConfigurationInput): Promise<ReadResult<ResolvedRuntimeConfiguration>>;
}

// ------------------------------------------------------------------------ //
// Runtime dependencies                                                       //
// ------------------------------------------------------------------------ //

/**
 * Every dependency is an existing formal port or the trusted Host binding. The
 * Runtime factory owns no store, no reducer and no second transcript: WorkGraph
 * keeps the formal facts and the kernel keeps the original history.
 */
export type RuntimeExecutionDependencies = {
  claims: TaskClaimPort;
  executions: ExecutionReadPort;
  entry: ExecutionEntryPort;
  /** Existing WG12 writer for live nonterminal observed ranges. */
  historyWriter: ExecutionHistoryWritePort;
  modelRequests: ModelRequestPort;
  roles: RoleBindingFactsPort;
  /** The SAME full Plan service the Host reads/writes through (W2 delegated writes). */
  plans: PlanTaskPort;
  /**
   * C1 SessionMailbox. Optional only to keep a Runtime caller that never selects a
   * communication tool working; a formal grant that selects any communication tool
   * with this dependency absent must fail closed as `unsupported` before the model.
   */
  messages?: SessionMailboxPort;
  /**
   * Slice 5 §4.6: the user-decision owner. Optional so an existing composition
   * that never selects a user-decision tool keeps working; a formal grant that
   * selects `send_user_message`/`read_user_decision`/
   * `record_decision_application` with this dependency absent fails closed as
   * `unsupported` before the model. The three tools are registered through the
   * SAME SessionMailbox tool factory only when this is present.
   */
  decisionMessages?: Pick<DecisionMessagePort,
    'sendUserMessage' | 'recordDecisionApplication' | 'readDecisionAnswer'>;
  /**
   * Slice 5 §4.5/T-R2-1: the SAME receipt reader the composition gives the
   * Workflow. The Runtime hands it to the whiteboard tool factory so an Agent
   * that acknowledged a user answer can receive the formal
   * `applicationReceipt` (identityKey/fingerprint at the plan acceptance
   * cursor) it needs for `record_decision_application`. Optional so an old
   * composition keeps the old tool result shape.
   */
  applicationReceipt?: (ctx: CoreCallContext, cursor: CommitCursor) => Promise<DecisionApplicationReceiptV1 | null>;
  sessions: SessionDirectoryPort;
  materials: MaterialPort;
  bodies: Pick<RawArtifactStorePort, 'put' | 'read'>;
  /** RT7 targeted original-history reader. */
  activity: ExecutionHistoryPort;
  /** RT8 graph-located execution history. */
  graphHistory: GraphExecutionHistoryReadPort;
  /** Existing RT1 Session operations (creation + original history). */
  sessionOperations: SessionOperationsPort;
  kernelStores: KernelStoreRegistry;
  workspaceHost: WorkspaceHostBindings;
  /** WG13 exact source facts, reused by the frozen source factory. */
  sourceAuthority: () => SourceSnapshotReads;
  /** Trusted workspace mount policy; absence keeps the frozen source unopened. */
  sourcePolicyFor?: (projectId: string, workspaceId: string) => Promise<SourcePolicy | null>;
  host: RuntimeHostBindings;
  kernel: typeof import('../../../vendor/coding-agent/dist/public-api.js');
  /**
   * R4.3a: the SAME raw control service the composition root owns. It is the
   * `RunControlPort` intersection with the internal `ControlObservationPort`,
   * so Runtime can read the accepted intent and persist the real observation
   * while the public `platform.controls` surface still publishes only
   * submit/read. Optional so an existing direct `createAgentRuntime(deps)`
   * caller keeps its old behavior; without it `deliverControl` stays an
   * explicit `unsupported` and never fabricates a delivery.
   */
  controls?: RunControlPort & ControlObservationPort;
  /** R5b.2 internal Query writer. Optional only to keep Work callers working. */
  queryExecution?: QueryExecutionPort;
  /**
   * Slice 3 read model. Optional only so a narrow old caller/test double keeps
   * compiling; a real grant that selects look/find without them fails closed.
   */
  graphContext?: GraphContextReadPort;
  /** Slice 3 exact task-input owner (the same instance the routes use). */
  taskInputs?: TaskContextInputPort;
  /**
   * C3 (spec §6.1 (e)): the verification workspace reader (the same instance
   * the evidence owner captures with) the continuation brief takes its own
   * source checkpoint and the uncommitted paths from. Absent, the brief states
   * that neither could be read.
   */
  workspaceSource?: ContinuationWorkspaceSource;
  /**
   * A.2 step 5.6: the WorkGraph writer of a Run end without a Kernel terminal,
   * for the in-process variants this Runtime proves with its exited handle:
   * RUN-16 (the Kernel call failed before `turn.started`) and RUN-23 (a cancel
   * of a Run paused at a safe point). Absent, those Runs stay as recorded until
   * the start-up reconcile.
   */
  runReconcile?: import('../work-graph/tasks/run-reconcile-contracts.js').RunReconcilePort;
  /**
   * K slice M1: the optional dangling-Turn closure dependency. It carries the
   * SES-13 health owner and this Host instance's lease. Without it the Runtime
   * does not publish `closeOpenTurn` (the Workflow takes today's fallback) and
   * maintenance treats the close as a definite failure (M1).
   */
  turnClosure?: TurnClosureDependencies;
  now: () => string;
  newId: () => string;
};

/**
 * K slice M1/L5: the closure's health owner, called with the Host's own call
 * identity (the start-up reconcile's, M3). `lease` is this Host instance's
 * lease; only `owned` may close a Turn (L4).
 */
export type TurnClosureDependencies = {
  recordSessionHealth: SessionHealthPort['recordSessionHealth'];
  lease: 'owned' | 'held_by_other' | null;
};

/** The two reads of the workspace source the continuation brief takes (digest-only and full, LA-5). */
export type ContinuationWorkspaceSource = {
  captureDigest(root: string): Promise<{ status: 'ready'; sourceDigest: string } | { status: 'unavailable'; reason: string }>;
  capture(root: string): Promise<VerificationRoundSourceResult>;
};

// Re-export the exact shared shapes the port consumes so callers do not import
// WorkGraph paths by accident.
export type { TaskExecutionRecord, SessionHistoryEntry, SessionHistoryRequest, ExecutionHistoryPage };
