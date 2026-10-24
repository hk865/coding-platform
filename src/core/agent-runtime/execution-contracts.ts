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
import type { RoleConfigurationRef, SessionRef, WorkspaceScope } from '../../contracts/core/identity.js';
import type { ReadResult } from '../../contracts/core/results.js';
import type { PreparedQueryExecution, PreparedTaskExecution, PreparedTaskManifestV1 } from '../../contracts/core/prepared-execution.js';
import type { QueryRunRef } from '../../contracts/query-job.js';
import type { MaterialBasisV1 } from '../../contracts/material-access.js';
import type { RuntimeBudget } from '../../contracts/runtime-budget.js';
import type { PromptPackSourcePort } from '../../contracts/prompts/prompt-pack.js';
import type { RoleSpecResolutionV1 } from '../../contracts/role-spec-materials.js';
import type { PlatformDutyV1 } from '../../contracts/graph-context.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { VerificationRoundSourceResult } from '../../contracts/verification-context.js';
import type { RawArtifactStorePort } from '../record-store/body-ports.js';
import type { ContinuationWorkspaceBytes } from '../workspace/continuation-diff-reads.js';
import type { RoleBindingFactsPort } from '../work-graph/model/configuration-contracts.js';
import type { MaterialPort } from '../work-graph/model/material-contracts.js';
import type { TaskClaimPort } from '../work-graph/model/claim-contracts.js';
import type {
  UnknownCallReviewPort, UnknownCallReviewReadPort,
} from '../work-graph/model/unknown-call-review-contracts.js';
import type {
  CommandRerunRequestPort, CommandRerunRequestReadPort,
} from '../work-graph/model/command-rerun-request-contracts.js';
import type { CommandRecognizer } from '../work-graph/model/command-recognition-contracts.js';
import type { ToolCommitLookup } from '../../contracts/unknown-call-review.js';
import type { ExecutionHistoryWritePort } from '../work-graph/model/execution-history-contracts.js';
import type { ExecutionEntryPort } from '../work-graph/model/execution-entry-contracts.js';
import type { ExecutionReadPort, TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import type { GraphContextReadPort } from '../work-graph/model/graph-context-contracts.js';
import type { SecretaryPreparationFactsPort } from '../work-graph/model/secretary-contracts.js';
import type { TaskContextInputPort } from '../work-graph/model/context-input-contracts.js';
import type { NoteCheckPort, NoteMemoryMaterialPort, NoteMemoryReadPort, NoteWritePort } from '../work-graph/model/note-contracts.js';
import type { ModelRequestPort, ModelRequestReadPort } from '../work-graph/tasks/model-call-contracts.js';
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

/** R3: the ONE `readonlyCommandAccess` input. It selects the binding exactly as
 * a Work Run does (`bind(scope, role)`) so the review round's capability probe
 * reads the same trusted binding its prepare and start will use, and it never
 * resolves the model. */
export type ReadonlyCommandAccessInput = {
  workspace: WorkspaceScope;
  role: RoleConfigurationRef;
};

/** Trusted Host startup binding. The stored `runtime` option is data, never a
 * capability that the request or model can extend. `resolveQueryConfiguration`
 * is the optional R5b.2 Query branch; its absence keeps only the new Query
 * methods unsupported while Work `resolveConfiguration` is unchanged. */
export interface RuntimeHostBindings {
  resolveConfiguration(ctx: CoreCallContext, input: RuntimeConfigurationInput): Promise<ReadResult<ResolvedRuntimeConfiguration>>;
  resolveQueryConfiguration?(ctx: CoreCallContext, input: QueryRuntimeConfigurationInput): Promise<ReadResult<ResolvedRuntimeConfiguration>>;
  /**
   * K3 L13/U5/R3: the binding-level read-only command facts the Runtime's
   * `reviewCapability` probes with (the SAME `readonlyCommandAccess` and
   * `processSandboxOptions` a Run binding receives for that workspace+Role).
   * Optional so every existing Host binding keeps working; absence answers
   * `unavailable` (fail closed).
   */
  readonlyCommandAccess?(input: ReadonlyCommandAccessInput): Promise<ReadonlyCommandHostFacts | null>;
}

// ------------------------------------------------------------------------ //
// Runtime dependencies                                                       //
// ------------------------------------------------------------------------ //

/**
 * Every dependency is an existing formal port or the trusted Host binding. The
 * Runtime factory owns no store, no reducer and no second transcript: WorkGraph
 * keeps the formal facts and the kernel keeps the original history.
 */
export type ReadonlyCommandHostFacts = {
  access: 'all_except_denied' | null;
  processSandboxOptions: { readOnlyPaths?: string[]; executablePath?: string };
};

export type RuntimeExecutionDependencies = {
  claims: TaskClaimPort;
  executions: ExecutionReadPort;
  entry: ExecutionEntryPort;
  /** Existing WG12 writer for live nonterminal observed ranges. */
  historyWriter: ExecutionHistoryWritePort;
  modelRequests: ModelRequestPort;
  /** Ruling 28/29: the Work model-request read the prompt record reads. Absent
   * answers `unavailable` on a Work ref; it is never an empty permit list. */
  modelRequestReads?: ModelRequestReadPort;
  /** Ruling 30: the ONE prompt-pack source every preparation resolves through.
   * `createAgentRuntime` installs the generated platform source when absent. */
  promptPacks?: PromptPackSourcePort;
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
  /** The secretary facts read; absent fails a secretary round `unsupported` before the model. */
  secretaryFacts?: SecretaryPreparationFactsPort;
  /** The note memory-material read the notes already share; absent fails a secretary round closed. */
  memoryMaterial?: NoteMemoryMaterialPort;
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
  /**
   * L13/8D trusted analyzer resources forwarded, when a Run has a file read,
   * to the exploration tools' Python/C++ indexes. The two timeouts are the
   * §11.5 observation-runner limits and are ignored by the exploration tools.
   * Absent keeps the indexes' defaults; this never comes from model arguments.
   */
  sourceAnalyzers?: { directory?: string; pythonPath?: string; cppLibraryPath?: string;
    unitTimeoutMs?: number; languageTimeoutMs?: number };
  host: RuntimeHostBindings;
  kernel: typeof import('../../../vendor/coding-agent/dist/public-api.js');
  /**
   * L8 (spec L8; book ruling 12): the one architecture-reminder read the context
   * assembler takes before the model. Optional so an old direct Runtime caller
   * keeps working; when present, a cancelled read cancels the preparation and
   * any other rejection becomes the single `架构提醒不可用` row.
   */
  architectureReminders?: import('./context-assembler.js').ArchitectureReminderReadPort;
  /**
   * L13: the Host's live resource-cap source. The Runtime passes it to every
   * readonly-command tool it builds and merges it into the Kernel input at the
   * last hop (`runObservedModel`); it enters no configuration/authorization/
   * prepared execution/digest. Absent keeps today's uncapped path.
   */
  resourceCaps?: import('../../../vendor/coding-agent/dist/public-api.js').ResourceCapSource;
  /**
   * K3 L13/U5/R3 (`reviewCapability`): the Host's read-only command facts for
   * one workspace+Role, resolved by the composition root from the SAME Host
   * binding a Run receives (`readonlyCommandAccess` and `processSandboxOptions`).
   * It never resolves the model. Absent or a null result means the Runtime
   * answers `unavailable` (fail closed) and the Workflow settles
   * `review_unavailable` instead of opening a round.
   */
  readonlyCommandAccess?: (input: ReadonlyCommandAccessInput) => Promise<ReadonlyCommandHostFacts | null>;
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
   * Slice 4C L13/L14: the SAME `platform.notes` ports the graph tools' memory
   * branch and `record_note` call. The composition root fills a stable holder
   * after the notes are built and the tools read it at start time. Optional so
   * an old direct caller keeps compiling; a selected tool whose field is still
   * absent fails closed before the model.
   */
  notes?: {
    memory?: NoteMemoryReadPort;
    write?: NoteWritePort;
    check?: Pick<NoteCheckPort, 'checkNotes'>;
  };
  /**
   * K3 L14: the SAME UnknownCallReview owner the routes publish. The review
   * round's `record_unknown_call_review` tool binds the record and the
   * `work_run` round to it; the read half supplies the current record revision
   * the tool must pin. Absent, a review-purpose Run fails closed before the
   * model instead of exposing a tool with no owner.
   */
  unknownCallReviews?: UnknownCallReviewPort & Pick<UnknownCallReviewReadPort, 'readReview' | 'listReviews'>;
  /**
   * Rework 2 item 2: the ONE canonical Task-closure reader (`satisfied`,
   * `cancelled`, `superseded`), the same `plan-readers.readTaskClosure` the
   * work graph uses. Required: `createAgentRuntime` passes it straight to the
   * execution preparation, and the composition root always wires the real
   * reader to the same records.
   */
  readTaskClosure: (
    ctx: CoreCallContext,
    task: { projectId: string; goalId: string; taskId: string },
  ) => Promise<ReadResult<{ closed: boolean; cause: 'satisfied' | 'cancelled' | 'superseded' | null }>>;
  /**
   * L19a (item 4): the SAME CommandRerunRequest owner/read port the routes
   * publish, plus the L4 tool-commit lookup the no-write branches use. The
   * `shell` hook reads the task's requests and consumes a one-time allowance;
   * the `request_command_rerun` tool writes through the same owner. Optional so
   * an old construction with no blocked commands keeps compiling; a Run whose
   * manifest carries a non-empty binding fails closed when it is absent.
   */
  commandRerunRequests?: CommandRerunRequestReadPort & CommandRerunRequestPort & { lookupToolCommit: ToolCommitLookup };
  /**
   * L19a (item 4): the ONE recognizer (`tasks/command-recognition.ts`) the hook
   * shares with the request owner. It owns `WorkspaceToolsPort.readWorkspace`
   * in the composition closure. Optional for old constructions; the hook fails
   * closed with the fixed unconfirmed text when it is absent, so an unconfirmed
   * command never runs just because recognition is not wired.
   */
  commandRecognizer?: CommandRecognizer;
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
  /**
   * K3 L6 (optional): the raw bytes of one old side of a file diff, read with
   * `git cat-file blob` (no filters). `objectRef` is either a baseline blob id
   * (`<hex>`) or a start-HEAD tree ref (`<headCommit>:<path>`, L6 line 215).
   * Absent, a file edit gets no diff.
   */
  readBaselineBlob?(root: string, objectRef: string): Promise<ContinuationWorkspaceBytes>;
  /** K3 L6 (optional): the raw bytes of the current workspace file. */
  readCurrentFile?(root: string, path: string): Promise<ContinuationWorkspaceBytes>;
};

/**
 * K3 L6: a read-only byte read of one side of a file diff. Defined by
 * WorkspaceTools (`continuation-diff-reads.ts`); re-exported here so the
 * existing AgentRuntime/composition import sites keep working.
 */
export type { ContinuationWorkspaceBytes };

// Re-export the exact shared shapes the port consumes so callers do not import
// WorkGraph paths by accident.
export type { TaskExecutionRecord, SessionHistoryEntry, SessionHistoryRequest, ExecutionHistoryPage };
