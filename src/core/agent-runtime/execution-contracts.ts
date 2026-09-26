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
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { ControlIntentRef } from '../../contracts/control-intent.js';
import type { RoleConfigurationRef, SessionRef } from '../../contracts/core/identity.js';
import type { Page, ReadResult } from '../../contracts/core/results.js';
import type { PreparedQueryExecution, PreparedTaskExecution, PreparedTaskManifestV1 } from '../../contracts/core/prepared-execution.js';
import type { QueryRunRef } from '../../contracts/query-job.js';
import type { MaterialBasisV1 } from '../../contracts/material-access.js';
import type { RuntimeBudget } from '../../contracts/runtime-budget.js';
import type { RoleSpecResolutionV1 } from '../../contracts/role-spec-materials.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { RawArtifactStorePort } from '../record-store/body-ports.js';
import type { RoleBindingFactsPort } from '../work-graph/configuration/contracts.js';
import type { MaterialPort } from '../work-graph/materials/contracts.js';
import type { TaskClaimPort } from '../work-graph/tasks/claim-contracts.js';
import type { ExecutionHistoryWritePort } from '../work-graph/tasks/execution-history-contracts.js';
import type { ExecutionEntryPort } from '../work-graph/tasks/execution-entry-contracts.js';
import type { ExecutionReadPort, TaskExecutionRecord } from '../work-graph/tasks/execution-read-contracts.js';
import type { ModelRequestPort } from '../work-graph/tasks/model-call-contracts.js';
import type { PlanTaskPort } from '../work-graph/tasks/plan-contracts.js';
import type { ControlObservationPort, RunControlPort } from '../work-graph/tasks/control-contracts.js';
import type { SessionMailboxPort } from '../work-graph/communication/contracts.js';
import type { SessionDirectoryPort } from '../work-graph/sessions/contracts.js';
import type { SourceSnapshotReads } from '../work-graph/source-authority-ports.js';
import type { QueryExecutionPort, QueryExecutionRecord } from '../work-graph/queries/contracts.js';
import type { SessionHistoryEntry, SessionHistoryRequest, SessionOperationsPort } from './session-operations.js';
import type { ExecutionHistoryPage, ExecutionHistoryPort, GraphExecutionHistoryReadPort } from './execution-history-contracts.js';
import type { KernelStoreRegistry } from './kernel-store-locator.js';
import type { SourcePolicy } from './source-capture-access.js';
import type { WorkspaceHostBindings } from '../workspace/access.js';

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
  skills: { resourceRoot: string; enabledIds: string[] };
  systemInstruction: string | null;
  deniedPrefixes: string[];
  processSandboxOptions: { readOnlyPaths?: string[]; executablePath?: string };
  /** Current material basis the Host can prove, or null when it cannot. */
  materialBasis: MaterialBasisV1 | null;
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
  now: () => string;
  newId: () => string;
};

// Re-export the exact shared shapes the port consumes so callers do not import
// WorkGraph paths by accident. These are type-only aliases, not second shapes.
export type { TaskExecutionRecord, SessionHistoryEntry, SessionHistoryRequest, ExecutionHistoryPage };
export type RuntimePreparedExecution = PreparedTaskExecution;
export type RuntimePreparedQueryExecution = PreparedQueryExecution;
export type RuntimeQueryExecutionRecord = QueryExecutionRecord;
export type RuntimeExecutionRecord = TaskExecutionRecord;
export type RuntimeSessionRef = SessionRef;
export type RuntimeReadPage<T> = Page<T>;
