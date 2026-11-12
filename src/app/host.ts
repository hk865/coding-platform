/**
 * R6.1a local workbench Host.
 *
 * The Host is the ONE place that assembles the trusted startup configuration
 * into one project runtime per project (its own store, lease, Kernel store
 * directory and `openTargetPlatform` instance, KLS-1b). Scheduling stays per
 * workspace scope: a scope's work takes its project's platform
 * (`platformFor(scope.projectId)`), and only the drivers that bind a platform
 * when they are built exist once per project (`HostProject`). It converts the
 * serializable workspace descriptions of the CLI config into the existing
 * `WorkspaceHostBindings`, owns the per-instance temporary token, and exposes
 * an idempotent `close()` that first stops new HTTP work, drains the requests
 * already accepted, then closes every project runtime.
 *
 * Local settings (`/api/real/settings/`) extend the Host at runtime: a newly
 * opened directory is registered through the real Project/Workspace owner (a
 * new project opens its runtime first) and enters `byScope`, the source/tool
 * roots, `allowedScopes`, the live bootstrap, the Kernel store registry, the
 * trusted Query profiles and the Workflow configuration without stopping the
 * Host. A settings model change is
 * delivered as a private snapshot; the Host keeps its original bindings/grants
 * and installs a NEW immutable runtime version behind the per-ref resolver
 * registry.
 *
 * Nothing in this file is reachable from an HTTP request body: the root, the
 * authorization predicate, the database path, the Kernel stores and the actor
 * come only from `options`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createBuiltinProviderRegistry, resourceCapStatus } from '../../vendor/coding-agent/dist/public-api.js';
import type { ResourceCapSource } from '../../vendor/coding-agent/dist/public-api.js';
import { totalmem } from 'node:os';
import { MIB, defaultResourceCapSettings } from '../contracts/resource-caps.js';
import { mkdirSync } from 'node:fs';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { canonicalJson, canonicalKey, sha256Hex, type JsonValue } from '../contracts/fingerprint.js';
import type { CommitCursor } from '../contracts/command-event.js';
import type { GoalRef, WorkspaceRef } from '../contracts/ledger.js';
import {
  createGoalWaitQueue, createGoalWaitWakes, GOAL_WAITS_QUEUE, GOAL_WAIT_WAKE_AGGREGATE_TYPES, WAKE_LIMIT,
  createGoalWaitRebuild, type GoalWaitRegistries, type GoalWaitWakes, type MarkerQueryCandidateV1,
  type WaitingCallV1,
} from './goal-wait-wakes.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../contracts/prompts/platform-pack.generated.js';
import { renderTemplate } from '../contracts/prompts/render-template.js';
import { COLD_START_STAGE_NOT_BOUND, openTargetPlatform, type TargetPlatformOptions } from '../composition/create-platform.js';
import { createKnowledgeWriteQueue } from '../core/work-graph/knowledge/write-queue.js';
import type { RecordCommitObserver } from '../composition/commit-observer.js';
import {
  createProjectRuntimeRegistry, type ProjectPlatform, type ProjectRuntime, type ProjectRuntimeWorkspace,
  type ProjectStoreLease,
} from '../composition/project-runtime.js';
import { kernelStoreDirectory, kernelStoreEntry } from '../composition/project-store-paths.js';
import { ensureKnowledgeDirectory, resolveKnowledgeLine } from '../composition/line-knowledge.js';
import { identifyCheckout } from '../core/workspace/workspace-change-capture.js';
import type { WorkspaceHostBindings } from '../core/workspace/access.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../contracts/core/identity.js';
import type { NoteScopeV1, NoteScribeTodoPort } from '../core/work-graph/model/note-contracts.js';
import { NOTE_LINK_VERIFY_MAX } from '../core/work-graph/model/note-contracts.js';
import type {
  HostOutboxItemV1, HostOutboxKeysetV1, HostOutboxSourceV1, HostOutboxStoredItemV1,
  SessionMailboxPort, SessionMessage, SessionMessageSendInputV1,
} from '../core/work-graph/model/communication-contracts.js';
import type { PlanProposalRef } from '../core/work-graph/model/plan-contracts.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../contracts/plan.js';
import { interventionPlanningQueryRefs, isRequestRound, queryJobRefFor, type QueryJobRef } from '../contracts/query-job.js';
import type { RunSnapshot } from '../contracts/dispatch.js';
import { planSourceLineageOf } from '../core/work-graph/tasks/plan-lineage.js';
import { waitFactsOfRecord, waitStateOf } from '../core/work-graph/state/message-machine.js';
import { QUEUE_DRAIN_BATCH } from '../core/work-graph/state/goal-adviser-queue.js';
import type { GoalDrainResultV1 } from '../core/work-graph/tasks/goal-adviser-queue-service.js';
import type { SessionMessageRef } from '../contracts/core/session-message.js';
import type { WorkspaceResult } from '../core/workspace/ports.js';
import { createPlatformCoreRouteBindings, type CoreRouteBindings, type HostReconcileReportV1 } from './core-routes.js';
import { acquireHostInstanceLease } from './host-instance-lease.js';
import { announceDisconnect, announceInterruption, interventionClosingNoticeRequest, systemNotifyRequest } from './host-notices.js';
import {
  emptyStartupReport, HOST_RECONCILE_ACTOR, runStartupReconcile, type StartupReconcileReportV1,
} from './startup-reconcile.js';
import { parseInitialPlanningResponseV2 } from '../core/work-graph/tasks/initial-plan.js';
import { DEFAULT_TASK_AUTOMATION_POLICY, type TaskRequeueRef } from '../contracts/task-requeue.js';
import { isPlatformReservedCheckId, type VerificationRoundRef } from '../contracts/verification.js';
import {
  decisionSourceKey, decisionSubjectGoalRef, type DecisionSourceV1, type NoticePositionV1,
} from '../contracts/goal-decisions.js';
import type { NoticeItemV1 } from '../core/work-graph/model/decision-contracts.js';
import { compareNoticePositions } from '../core/work-graph/views/notice-position.js';
import { createChangeFeed } from './change-feed.js';
import type { WorkflowAdvanceResult } from '../business/workflow/contracts.js';
import { createCollaborationDriver } from './collaboration-driver.js';
import { createGoalFanOutDriver } from './goal-fan-out-driver.js';
import { AUTO_CAPTURE_ACTOR, createAutoCaptureDriver } from './auto-capture-driver.js';
import { createWorkbenchTools } from './workbench-tools.js';
import {
  createHandoffQueue, createWakeLoop, LIFECYCLE_QUEUE,
  LIFECYCLE_WAKE_AGGREGATE_TYPES, notReady, MESSAGE_RELEASE_QUEUE, MESSAGE_RELEASE_WAKE_AGGREGATE_TYPES,
  type QueueHandler, type WakeLoop,
} from './wake-loop.js';
import {
  createRequestRoundQueues, REQUEST_ROUNDS_QUEUE, REQUEST_UNASSIGNED_QUEUE,
} from '../business/workflow/request-round-queue.js';
import { createQueryStageDriver, type QueryStageDriver } from '../business/workflow/query-stage-driver.js';
import { servingBinding } from '../business/workflow/role-bindings.js';
import { lineAskInputRejection } from '../business/workflow/line-ask.js';
import {
  attentionSignalToJson, createAttentionObserver, createAttentionScanner, type AttentionScopeV1, type AttentionSignal,
} from './attention-observer.js';
import { renderAttentionChanges } from '../core/agent-runtime/context-assembler.js';
import { READONLY_COMMAND_TOOL_NAME } from '../core/agent-runtime/readonly-command-tool.js';
import { GRAPH_TOOL_NAMES } from '../core/agent-runtime/graph-tools.js';
import { LINK_CHECK_TOOL_NAMES } from '../core/agent-runtime/link-check-tool.js';
import { NOTE_TOOL_NAMES } from '../core/agent-runtime/note-tool.js';
import { platformRoleProfile } from '../core/agent-runtime/role-profiles.js';
import { plainSessionRefKey } from '../core/work-graph/sessions/session-record-codecs.js';
import { sessionMessageRefKey } from '../core/work-graph/sessions/message-record-codecs.js';
import { EXPIRY_PAGE, type DueWaitPageInputV1 } from '../core/work-graph/communication/message-expiry.js';
import type { ReadonlyCommandAccessInput, RuntimeHostBindings, ResolvedRuntimeConfiguration } from '../core/agent-runtime/execution-contracts.js';
import type { ReadResult } from '../contracts/core/results.js';
import type { BootstrapExecution, BootstrapResponse, BootstrapReviewMaterial, CoreScope, WorkbenchActor } from './core-http-types.js';
import {
  createHostRuntimeResolverRegistry,
  createHostSettings,
  readPersistedWorkspaces,
  validateSettingsBaseUrl,
  type HostSettingsAssembly,
  type HostSettingsModelDefinition,
  type HostSettingsOpenedHost,
  type HostSettingsPrivateSnapshot,
  type HostSettingsStoredModel,
  type ChecksAdoptionHostCallbacks,
} from './host-settings.js';
import type {
  ChecksAdoptionEntryPort, HostSettingsPort, OpenSettingsWorkspace, SettingsResponse,
} from './host-settings-types.js';
import {
  DEFAULT_WORK_RUN_TOKEN_BUDGET,
} from './host-settings-types.js';
import { DEFAULT_PLAN_LOOP_LIMITS, type PlanLoopLimitsV1 } from '../contracts/plan-loop-limits.js';
import { createInitializationAdoptionHost, type InitializationAdoptionDependencies } from './initialization-adoption.js';
import {
  createWorkbenchRuntimeHostBindings,
  LOCAL_WORKBENCH_BUDGET,
  LOCAL_WORKBENCH_HOST_TEMPLATE,
  LOCAL_WORKBENCH_ROLE,
  LOCAL_WORKBENCH_ROLE_BINDING,
  narrowResolvedReadonlyCommands,
  planningRoundRuntimeBudget,
  PLATFORM_SKILL_RESOURCE_ROOT,
  runtimeModelId,
  settingsModelSecretVariable,
  type WorkbenchModelConfiguration,
  type WorkbenchQueryProfile,
  type WorkbenchRuntimeBinding,
  type WorkbenchRuntimeConfiguration,
  type WorkbenchRuntimeNarrowing,
  type WorkbenchRuntimeProviderDependencies,
} from './runtime-configuration.js';
import { createWorkbenchServer, type WorkbenchAddress, type WorkbenchServer } from './server.js';
import { createDiskPromptPackSource, isPathWithin } from './prompt-packs.js';
import { createSecretaryProfiles } from './secretary-profiles.js';
import { sendSystemRound } from './system-round.js';
import { exportBooks as readTaskbookExport, exportTaskbooksForPlan } from './taskbook-export.js';
import { createSessionDutyResolver } from '../composition/session-duty.js';
import type { SessionDutyResolver } from '../business/workflow/ports.js';

/** One explicitly readable workspace. `root`, `workspaceRevision` and
 * `readPrefixes` are trusted startup facts, never request input. */
export type WorkbenchWorkspaceConfig = {
  scope: CoreScope;
  name: string;
  root: string;
  /** The registered domain workspace revision the Host access checks against. */
  workspaceRevision: number;
  /** Normalized relative path prefixes; an empty array authorizes no read. */
  readPrefixes: string[];
  /** Trusted CAS write scope; absence authorizes NO write. A writable path must
   * ALSO be readable. It is never inferred from readPrefixes. */
  writePrefixes?: string[];
  /** Explicit whole-workspace command authorization; absence authorizes NO
   * command and never falls back to a host shell. */
  allowCommands?: boolean;
  /** L18: the read-only command tool is on by default when the whole workspace
   * is readable. `false` removes it from this workspace's grant. */
  allowReadonlyCommands?: boolean;
};

export type WorkbenchInputConsumer = {
  scope: CoreScope;
  sessionRef: import('../contracts/core/identity.js').SessionRef;
  goalRef: import('../contracts/ledger.js').GoalRef;
  queryProfileId: string;
  heartbeatMs: number;
};

/** The heartbeat opens at most this many Sessions. */
const CONSUME_BATCH = 8;
/** The Host's consumer status: the last heartbeat's skips; one write per heartbeat, never persisted. `unreadable` is
 *  a line the consumable view skipped because its own facts could not be read. */
export type HostConsumeSkipV1 = { sessionRef: SessionRef; reason: 'no_profile' | 'no_goal' | 'unreadable' };

export type LocalWorkbenchHostOptions = {
  storage: TargetPlatformOptions['storage'];
  actor: WorkbenchActor;
  workspaces: WorkbenchWorkspaceConfig[];
  port?: number;
  review?: BootstrapReviewMaterial;
  architectureSource?: TargetPlatformOptions['architectureSource'];
  /** L8 (book §3): the platform's existing trusted observation fault seam,
   * forwarded unchanged; a test holds a capture to prove queue behavior. */
  lightScan?: TargetPlatformOptions['lightScan'];
  /** The platform's knowledge write test seam, forwarded unchanged to every project's platform; production leaves it
   * out (a crash test stops a write at a named point in a child Host). */
  knowledgeWriteHold?: TargetPlatformOptions['knowledgeWriteHold'];
  kernelStores?: TargetPlatformOptions['kernelStores'];
  /** Serializable trusted runtime configuration. It is converted, before the
   * first await, into the existing `RuntimeHostBindings` port; it is mutually
   * exclusive with the programmatic `runtime`. */
  runtimeConfiguration?: WorkbenchRuntimeConfiguration;
  /** Programmatic trusted runtime binding, reused from the composition root.
   * Function dependencies keep their original seam and are not serialized. */
  runtime?: TargetPlatformOptions['runtime'];
  /** Trusted frozen check configuration, forwarded unchanged. */
  checks?: TargetPlatformOptions['checks'];
  /** Trusted Workflow advancement policy, forwarded unchanged. */
  workflow?: TargetPlatformOptions['workflow'];
  /**
   * The request driver switch. Absent means `'on'`: under the instance lease
   * the Host runs a wake loop and two request queues per workspace, so a
   * submitted round advances without any Query route call. `'off'` builds no
   * loop and no queue at all, so a round waits where the command left it, for
   * the Query routes (`queries/claim|prepare|start`) or a later Host with the
   * driver on. It is a start option — a change is a Host restart — with no
   * settings field and no screen: a caller that drives a round by hand must not
   * race a Host that claims and runs it on its own.
   */
  requestDriver?: 'on' | 'off';
  /** Host-internal controlled-provider seam for the normal-chain acceptance.
   * It is never a CLI or HTTP field and never changes the product default. */
  runtimeProvider?: WorkbenchRuntimeProviderDependencies;
  /**
   * Explicit Host attention scopes. Each scope carries its own watched paths,
   * dual-graph Goal, target member, thresholds and heartbeat/coalesce window; no
   * global default policy is invented. Absence runs no attention loop.
   */
  attention?: AttentionScopeV1[];
  inputConsumers?: WorkbenchInputConsumer[];
  /** Trusted Host-local settings. Settings are enabled by default beside a
   * SQLite ledger; `settingsDirectory` is only an override and an in-memory
   * store without one stays unsupported. */
  settings?: { settingsDirectory?: string; models?: HostSettingsModelDefinition[] };
  now?: () => string;
  /** Slice 4C-2 §11.5/U-4: the narrow scribe to-do read the reminder check
   * uses; absent falls back to the platform's `notes.readScribeTodos`. */
  noteScribeTodos?: NoteScribeTodoPort;
  /** The one recipient of a note scope (BK-09); absent falls back to the platform's `notes.resolveScribeRecipient`. */
  resolveScribeRecipient?: (ctx: CoreCallContext, scope: NoteScopeV1) => Promise<ReadResult<SessionRef | null>>;
  /** Slice 4C-2 §11.5: the scribe reminder heartbeat period; default 60_000 ms. */
  scribeReminderPeriodMs?: number;
  /** How long the platform must have had no Run or QueryRun in flight before the
   * Host re-checks doubtful links in the background; default 60_000 ms. */
  linkBatchIdleMs?: number;
  /** How many doubtful links have to wait before the Host re-checks a batch even
   * while a Run is in flight; default 20. */
  linkBatchBacklog?: number;
  /** The least time between backlog-triggered background batches; default 600_000 ms. */
  linkBatchBacklogGapMs?: number;
  /** Test seam over the EXISTING platform message sender; never a new sender. */
  sendScribeReminder?: SessionMailboxPort['sendMessage'];
  publicDir?: string;
  maxBodyBytes?: number;
};

export type LocalWorkbenchHost = {
  /** Returns the real loopback address. Repeated calls keep the same token. */
  listen(port?: number): Promise<WorkbenchAddress>;
  /** Idempotent: reject new requests, drain accepted ones, then close every project's platform and lease. */
  close(): Promise<void>;
  /** A.2 step 5.6 (§12.8, §12.1 step 7), per project (V7): that project's lease and its start-up reconcile report
   * (`report` null without the lease); null when the project is not open in this Host. */
  reconcileOf(projectId: string): HostReconcileReportV1 | null;
  /** the last heartbeat's skips (the unreadable lines, then the others, each in Session-key order); replaced each
   *  pass, never persisted, no route. */
  readonly consumeStatus: readonly HostConsumeSkipV1[];
  /** Resolves after the next real `consumeIdle` pass settles; it observes that pass and changes nothing. */
  consumeBarrier(): Promise<void>;
};

/**
 * One open project's drivers (S7): only what captures that project's platform when it is built. Stage one is built
 * when the runtime opens; `bindings` (stage two) once the settings exist. Everything else in the Host is shared and
 * takes a scope's platform with `platformFor(scope.projectId)`.
 */
type HostProject = {
  projectId: string;
  runtime: ProjectRuntime;
  autoCapture: ReturnType<typeof createAutoCaptureDriver>;
  /** Set only while this Host holds the project's lease: a Host without it writes nothing, so it never captures. */
  captureTrigger?: NonNullable<TargetPlatformOptions['onArchitectureCaptureTrigger']>;
  collaborationDriver: ReturnType<typeof createCollaborationDriver>;
  goalFanOut: ReturnType<typeof createGoalFanOutDriver>;
  hostNotices: Parameters<typeof announceDisconnect>[1];
  /** The request driver's pieces: with the lease and the request driver on only. */
  coldStartStages?: NonNullable<TargetPlatformOptions['coldStartStages']>;
  requestQueues?: ReturnType<typeof createRequestRoundQueues>;
  handoffOwner?: ProjectPlatform['workflow']['sessionHandoff'];
  /** Built at the first marker Query start (the goal-waits drain). */
  markerStageDriver?: QueryStageDriver;
  bindings?: CoreRouteBindings;
  report: HostReconcileReportV1;
};

const scopeKey = (scope: CoreScope): string => `${scope.projectId}\u0000${scope.workspaceId}`;

// Slice 4C-2 §11.5: the scribe reminder thresholds, default period and the body
// marker the unhandled check recognizes (the SessionMessage record carries no
// send requestId, so the reminder's own leading text is the durable marker).
const SCRIBE_PENDING_THRESHOLD = 10;
const SCRIBE_UPDATE_DUE_THRESHOLD = 5;
const SCRIBE_BROKEN_LINK_THRESHOLD = 5;
const SCRIBE_BROKEN_LINK_AGE_MS = 10 * 60_000;
const SCRIBE_REMINDER_PERIOD_MS = 60_000;
// Background link batch: re-check doubtful links when the platform has been idle
// long enough, or when enough are waiting and the last batch is old enough. A
// Run that starts and ends between two heartbeats still counts as activity, so
// idleness is read from the platform's own in-flight count and its last-empty
// moment, never sampled. The backlog gap keeps a busy Host from re-checking the
// same links on every heartbeat.
const NOTE_LINK_IDLE_MS = 60_000;
const NOTE_LINK_BACKLOG = 20;
const NOTE_LINK_BACKLOG_GAP_MS = 10 * 60_000;
const SCRIBE_REMINDER_MARKER = PLATFORM_PROMPT_PACK_V1.strings['scribe.marker'];

/** Segment-aware prefix match for trusted read prefixes; `'.'` means the whole
 * readable workspace. An empty prefix never matches. */
function prefixMatches(prefix: string, path: string): boolean {
  if (prefix === '.') return true;
  const normalized = prefix.replace(/^\.\//, '').replace(/\/+$/, '');
  if (normalized.length === 0) return false;
  return path === normalized || path.startsWith(`${normalized}/`);
}

/** Copy the trusted startup workspace descriptions into owned values. This runs
 * before the first `await`, so a caller that later mutates its options object
 * cannot change a root, revision, read prefix, name or scope the Host
 * authorizes or publishes. */
function snapshotWorkspaces(source: readonly WorkbenchWorkspaceConfig[]): WorkbenchWorkspaceConfig[] {
  return source.map(workspace => ({
    scope: { projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId },
    name: workspace.name,
    root: workspace.root,
    workspaceRevision: workspace.workspaceRevision,
    readPrefixes: [...workspace.readPrefixes],
    ...(workspace.writePrefixes === undefined ? {} : { writePrefixes: [...workspace.writePrefixes] }),
    ...(workspace.allowCommands === undefined ? {} : { allowCommands: workspace.allowCommands }),
    ...(workspace.allowReadonlyCommands === undefined ? {} : { allowReadonlyCommands: workspace.allowReadonlyCommands }),
  }));
}
function validateWorkspaces(workspaces: WorkbenchWorkspaceConfig[], allowEmpty: boolean): void {
  if (workspaces.length === 0) {
    if (allowEmpty) return;
    throw new Error('the Host requires at least one trusted workspace scope');
  }
  const seen = new Set<string>();
  for (const workspace of workspaces) {
    if (typeof workspace.scope.projectId !== 'string' || workspace.scope.projectId.length === 0
      || typeof workspace.scope.workspaceId !== 'string' || workspace.scope.workspaceId.length === 0)
      throw new Error('every workspace requires a non-empty projectId and workspaceId');
    const key = scopeKey(workspace.scope);
    if (seen.has(key)) throw new Error(`duplicate workspace scope ${key}`);
    seen.add(key);
    if (typeof workspace.name !== 'string' || workspace.name.length === 0) throw new Error('every workspace requires a name');
    if (typeof workspace.root !== 'string' || workspace.root.length === 0) throw new Error('every workspace requires a trusted root');
    if (!Number.isSafeInteger(workspace.workspaceRevision) || workspace.workspaceRevision < 0)
      throw new Error('every workspace requires a non-negative integer workspaceRevision');
    if (!Array.isArray(workspace.readPrefixes) || workspace.readPrefixes.some(value => typeof value !== 'string'))
      throw new Error('readPrefixes must be an array of strings');
    if (workspace.writePrefixes !== undefined
      && (!Array.isArray(workspace.writePrefixes) || workspace.writePrefixes.some(value => typeof value !== 'string')))
      throw new Error('writePrefixes must be an array of strings when present');
    if (workspace.allowCommands !== undefined && typeof workspace.allowCommands !== 'boolean')
      throw new Error('allowCommands must be a boolean when present');
    if (workspace.allowReadonlyCommands !== undefined && typeof workspace.allowReadonlyCommands !== 'boolean')
      throw new Error('allowReadonlyCommands must be a boolean when present');
  }
}

/** create the one prompt directory and take its real path. */
async function preparePromptsDirectory(settingsDirectory: string): Promise<string> {
  const directory = join(settingsDirectory, 'prompts');
  await mkdir(directory, { recursive: true });
  return await realpath(directory);
}

/** A configured start-up root is compared by real path. A root whose real path
 * cannot be taken cannot be proved outside the prompt directory, so startup
 * fails instead of admitting it unchecked. */
async function assertRootOutsidePrompts(root: string, promptsRoot: string): Promise<void> {
  let realRoot: string;
  try { realRoot = await realpath(root); }
  catch {
    throw new Error(`the workspace root ${root} could not be resolved against the prompt directory ${promptsRoot}`);
  }
  if (isPathWithin(realRoot, promptsRoot))
    throw new Error(`the workspace root ${realRoot} covers the prompt directory ${promptsRoot}`);
}

/** Deterministic permission generation derived from the isolated scope and the
 * exact read prefixes. It is NOT the workspaceRevision and NOT a refresh count. */
function permissionRevision(actor: WorkbenchActor, workspace: WorkbenchWorkspaceConfig): string {
  const material = JSON.stringify({
    subject: { kind: actor.kind, id: actor.id },
    scope: { projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId },
    readPrefixes: [...new Set(workspace.readPrefixes)].sort(),
  });
  return `host-permission-v1:${createHash('sha256').update(material).digest('hex')}`;
}

/** Trusted budget for one local-workbench binding; published DeepSeek model
 * limits, checked 2026-09-29: https://api-docs.deepseek.com/quick_start/pricing/ */
function localWorkbenchBudget(model: HostSettingsStoredModel): typeof LOCAL_WORKBENCH_BUDGET {
  const contextWindowTokens = model.provider === 'deepseek'
    && ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4.1-flash'].includes(model.model)
    ? 1_000_000 : LOCAL_WORKBENCH_BUDGET.contextWindowTokens;
  return { ...LOCAL_WORKBENCH_BUDGET, contextWindowTokens };
}

/** The local grant's read tools: the Kernel file read and the read-only graph
 * and link-check tools. The read tools every built-in duty starts from. */
const LOCAL_READ_TOOL_NAMES: readonly string[] = ['read', ...GRAPH_TOOL_NAMES, ...LINK_CHECK_TOOL_NAMES];

/** The local secretary's tools: the read tools (including `check_links`) plus the note writer and the six coordination
 *  names (the mailbox sender/ack/respond/withdraw, member creation and the request read). `record_note` writes
 *  WorkGraph notes only, so the grant below keeps the file write scope empty. */
const LOCAL_SECRETARY_TOOL_NAMES: readonly string[] = [...LOCAL_READ_TOOL_NAMES, ...NOTE_TOOL_NAMES,
  'send_session_message', 'ack_session_message', 'respond_session_message', 'withdraw_session_message',
  'create_member', 'read_requests'];

// Each built-in duty's tools (book §3.8 item 6; O5b rulings 4, 5, 7, 32): the names its two skill templates
// (`platform-work` and its own) put in a tool block, the frozen v4 names and what the tested duty bindings grant,
// every one a name a Work Run knows; the adviser's `read_requests` is for the cold start's exploration Query only
// (a Work Run knows it and builds none); `read` brings `search` and `code_index` with it. The reviewer's are
// read-only, without `record_note` (PL's rule).
const LOCAL_ADVISER_TOOL_NAMES: readonly string[] = [...LOCAL_READ_TOOL_NAMES, ...NOTE_TOOL_NAMES,
  'query_task_graph', 'query_ready_tasks', 'propose_future_plan', 'find_related_sessions', 'send_session_message',
  'create_member', 'assign_module_maintainer', 'propose_role_split', 'propose_architecture_revision',
  'read_requests'];
const LOCAL_SCRIBE_TOOL_NAMES: readonly string[] = [...LOCAL_READ_TOOL_NAMES, ...NOTE_TOOL_NAMES,
  'find_related_sessions', 'send_session_message'];
const LOCAL_REVIEWER_TOOL_NAMES: readonly string[] = [...LOCAL_READ_TOOL_NAMES, 'run_readonly_command'];

/** The local workbench secretary's binding identity. Its Role is the exact
 * platform secretary legacy template, which the Session duty resolver reads as
 * `secretary`; the local binding keeps its own identity and policy revision. */
const LOCAL_SECRETARY_ROLE_BINDING_ID = 'local-workbench-secretary-binding';
const LOCAL_ADVISER_ROLE_BINDING_ID = 'local-workbench-adviser-binding';
const LOCAL_SCRIBE_ROLE_BINDING_ID = 'local-workbench-scribe-binding';
const LOCAL_REVIEWER_ROLE_BINDING_ID = 'local-workbench-reviewer-binding';
/** One Role-binding builder for every built-in duty: the exact platform duty legacy template under the duty's own
 *  local binding identity. */
function localDutyRoleBinding(duty: 'secretary' | 'adviser' | 'scribe' | 'reviewer',
  bindingId: string): WorkbenchQueryProfile['roleBinding'] {
  const template = platformRoleProfile(duty).template;
  return { schemaVersion: 1, bindingId, templateId: template.templateId,
    templateRevision: template.templateRevision, bindingVersion: 1, policyRevision: 'legacy-template' };
}

/** The secretary grant's one generalization: the same fields, the duty's Role/behaviour and a passed tool list. The
 *  adviser's `create_member` needs the delegation (the member service admits a caller Run only with it); the
 *  reviewer keeps the workspace's read-only command access, already switched by `localWorkbenchGrant`. */
function localDutyGrant(localGrant: WorkbenchRuntimeBinding['grant'],
  duty: 'secretary' | 'adviser' | 'scribe' | 'reviewer', tools: readonly string[]): WorkbenchRuntimeBinding['grant'] {
  const template = platformRoleProfile(duty).template;
  return {
    budget: structuredClone(localGrant.budget),
    hostTemplate: { templateId: template.templateId, revision: template.templateRevision,
      digest: sha256Hex(PLATFORM_PROMPT_PACK_V1.templates[`skill-platform-${duty}`]) },
    tools: [...tools], writeScope: [], skills: { bundle: 'platform', behaviors: [duty] },
    systemInstruction: null, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
    platformDuty: duty,
    ...(duty === 'adviser' ? { createMember: true } : {}),
    ...(duty === 'reviewer' && localGrant.readonlyCommandAccess !== undefined
      ? { readonlyCommandAccess: localGrant.readonlyCommandAccess } : {}),
    ...(localGrant.contextResidentBytes === undefined ? {} : { contextResidentBytes: localGrant.contextResidentBytes }),
  };
}

/** One Host configuration version over the explicit resolved fields: a change
 * to the duty, resident bytes, tools, write scope or model is a new version.
 * The prefix separates the local workbench's five bindings. */
function localBindingRevision(prefix: 'local-workbench' | 'local-secretary' | 'local-adviser' | 'local-scribe'
  | 'local-reviewer', scope: CoreScope,
  grant: WorkbenchRuntimeBinding['grant'], model: WorkbenchModelConfiguration): string {
  return `${prefix}:s3@${sha256Hex(canonicalJson({
    scope: { projectId: scope.projectId, workspaceId: scope.workspaceId },
    duty: grant.platformDuty ?? 'executor',
    residentBytes: grant.contextResidentBytes ?? 4096,
    tools: grant.tools,
    writeScope: grant.writeScope,
    modelRevision: model.revision,
  } as unknown as JsonValue)).slice(0, 16)}`;
}

/**
 * L18 layer 1 (exported so the Host grant is reachable at its own seam): the
 * read-only process tool is granted only when the switch is on (default true)
 * AND the workspace read is the whole workspace. The `shell` grant keeps its
 * existing write-required rule and is never widened by this function.
 */
export function localWorkbenchGrant(workspace: WorkbenchWorkspaceConfig, model: HostSettingsStoredModel): WorkbenchRuntimeBinding['grant'] {
  const writeAllowed = (workspace.writePrefixes?.length ?? 0) > 0;
  const commandsAllowed = workspace.allowCommands === true && writeAllowed;
  const readonlyCommandsAllowed = workspace.allowReadonlyCommands !== false && workspace.readPrefixes.includes('.');
  return {
    budget: localWorkbenchBudget(model),
    hostTemplate: { ...LOCAL_WORKBENCH_HOST_TEMPLATE },
    // Slice 3 (T5): the new grant lists the read-only graph tools `look_graph`
    // and `find_graph` and the read-only link check `check_links` instead of the
    // three old read names. The old adapters keep their exports and behavior for
    // already-bound Runs and explicit callers; the read-only Query ceiling still
    // strips every mailbox name.
    // RW-1 (4C): `record_note` is a coordination tool that writes WorkGraph
    // records, so it follows the same `writeAllowed` condition as the mailbox
    // tools; a read-only or Query ceiling still strips it.
    // The executor also requests rework/recheck but never acks, responds or withdraws: those stay on the
    // secretary grant below.
    tools: [...LOCAL_READ_TOOL_NAMES,
      ...(readonlyCommandsAllowed ? [READONLY_COMMAND_TOOL_NAME] : []),
      ...(writeAllowed ? ['write', 'record_note', 'send_session_message',
        'read_session_inbox', 'read_session_message', 'read_session_message_body',
        'request_rework', 'request_recheck'] : []),
      ...(commandsAllowed ? ['shell'] : [])],
    writeScope: writeAllowed ? ['.'] : [],
    skills: { resourceRoot: PLATFORM_SKILL_RESOURCE_ROOT, enabledIds: ['platform-work'] },
    systemInstruction: null,
    deniedPrefixes: [],
    processSandboxOptions: {},
    materialBasis: null,
    ...(commandsAllowed ? { shellWorkspaceAccess: 'all_except_denied' as const } : {}),
    ...(readonlyCommandsAllowed ? { readonlyCommandAccess: 'all_except_denied' as const } : {}),
  };
}

/**
 * D-SWITCH (L18 layer 1): the `projectId\u0000workspaceId` keys whose Host
 * `allowReadonlyCommands` switch is off. The common runtime-binding resolution
 * boundary narrows every binding of these scopes, at startup and on every
 * settings rebuild, so an explicit binding cannot re-enable the tool.
 */
export function readonlyCommandsDisabledScopes(workspaces: readonly WorkbenchWorkspaceConfig[]): Set<string> {
  return new Set(workspaces.filter(workspace => workspace.allowReadonlyCommands === false)
    .map(workspace => scopeKey(workspace.scope)));
}

export async function createLocalWorkbenchHost(options: LocalWorkbenchHostOptions): Promise<LocalWorkbenchHost> {
  // First-await snapshot of the fixed startup data. Function dependencies
  // (`now`) keep their existing seam; no hot reconfiguration or version
  // machinery is added.
  const actor: WorkbenchActor = { kind: options.actor.kind, id: options.actor.id };
  const workspaces = snapshotWorkspaces(options.workspaces);
  const review: BootstrapReviewMaterial | null = options.review === undefined ? null : structuredClone(options.review);
  const storage: TargetPlatformOptions['storage'] = options.storage.kind === 'sqlite'
    ? { kind: 'sqlite', directory: options.storage.directory }
    : { kind: 'memory' };
  // Settings are enabled by default beside a SQLite ledger; `settingsDirectory`
  // is only an override. An in-memory store with no explicit persistent
  // directory stays unsupported.
  const settingsDirectory = options.settings?.settingsDirectory
    ?? (storage.kind === 'sqlite' ? join(storage.directory, 'host-settings') : undefined);
  const settingsEnabled = settingsDirectory !== undefined;
  // The prompt directory exists before the platform is built,
  // because the disk pack source roots there. It is a sibling of the workspace
  // roots by rule, never a subtree of one.
  const promptsRoot = settingsDirectory === undefined
    ? undefined : await preparePromptsDirectory(settingsDirectory);
  validateWorkspaces(workspaces, settingsEnabled);
  if (promptsRoot !== undefined) {
    for (const workspace of workspaces) await assertRootOutsidePrompts(workspace.root, promptsRoot);
  }
  /** KLS-2: each registered workspace's checkout key (its real common git directory), or null for a folder in no git
   *  work tree or a root that cannot be read; the settings snapshot reads "kept local" by it, and the route refreshes it. */
  const knowledgeRepoKeys = new Map<string, string | null>();
  const checkoutKeyOf = (root: string): Promise<string | null> =>
    identifyCheckout(root).then(probe => probe.kind === 'git' ? probe.repoKey : null, () => null);
  // KLS-2: every start-up workspace whose root is a directory gets its knowledge directory once; a workspace opened
  // later gets it in `addWorkspaceState`.
  for (const workspace of workspaces) {
    if (await stat(workspace.root).then(info => info.isDirectory(), () => false)) ensureKnowledgeDirectory(workspace.root);
    knowledgeRepoKeys.set(scopeKey(workspace.scope), await checkoutKeyOf(workspace.root));
  }
  const architectureSource = options.architectureSource === undefined
    ? undefined
    : { provider: options.architectureSource.provider, configPath: options.architectureSource.configPath };
  if (options.runtime !== undefined && options.runtimeConfiguration !== undefined)
    throw new Error('provide either a programmatic runtime or a runtimeConfiguration, not both');
  const runtimeConfiguration: WorkbenchRuntimeConfiguration | undefined = options.runtimeConfiguration === undefined
    ? undefined : structuredClone(options.runtimeConfiguration);
  const checks: TargetPlatformOptions['checks'] = options.checks === undefined ? undefined : structuredClone(options.checks);
  const workflow: TargetPlatformOptions['workflow'] = options.workflow === undefined ? undefined : structuredClone(options.workflow);
  // The request driver is a two-valued start switch; an unreadable value fails
  // the start instead of silently driving rounds or silently dropping them.
  if (options.requestDriver !== undefined && options.requestDriver !== 'on' && options.requestDriver !== 'off') {
    throw new Error("requestDriver must be 'on' or 'off' when present");
  }
  // The live profile projection the request commands
  // read. It is declared before the platform so the profile port's getter can
  // see the settings rebuild that splices it in place.
  const runtimeProfiles: WorkbenchQueryProfile[] = (runtimeConfiguration?.queryProfiles ?? []).map(profile => structuredClone(profile));
  // The one rule for a configured Query profile: the first whose scope and Session Role match. Ruling 9 (E22: a
  // working, idle or finished line can be asked) also asks a line whose Role has no profile — a builder or a
  // goal-less line — so `askLine` falls back to the workspace's first profile; the copy runs read-only regardless.
  const queryProfileOf = (scope: { projectId: string; workspaceId: string }, role: unknown): WorkbenchQueryProfile | undefined =>
    runtimeProfiles.find(entry => entry.scope.projectId === scope.projectId
      && entry.scope.workspaceId === scope.workspaceId
      && canonicalJson(entry.sessionRole as never) === canonicalJson(role as never));
  const attentionScopes: AttentionScopeV1[] = options.attention === undefined ? [] : structuredClone(options.attention);
  const inputConsumers = structuredClone(options.inputConsumers ?? []);
  for (const entry of inputConsumers) {
    if (!Number.isSafeInteger(entry.heartbeatMs) || entry.heartbeatMs <= 0
      || entry.scope.projectId !== entry.sessionRef.projectId || entry.scope.projectId !== entry.goalRef.projectId
      || !runtimeConfiguration?.queryProfiles.some(profile => profile.id === entry.queryProfileId
        && profile.scope.projectId === entry.scope.projectId && profile.scope.workspaceId === entry.scope.workspaceId)) {
      throw new Error('inputConsumers requires a positive heartbeat, matching scope and an explicit trusted Query profile');
    }
  }
  const token = randomBytes(32).toString('hex');
  const byScope = new Map(workspaces.map(workspace => [scopeKey(workspace.scope), workspace] as const));
  // D-SWITCH (L18 layer 1): the workspace switch narrows every runtime binding
  // at the common resolution boundary, at startup and on every settings rebuild.
  const runtimeNarrowing: WorkbenchRuntimeNarrowing = {
    readonlyCommandsDisabledScopes: readonlyCommandsDisabledScopes(workspaces),
  };
  /** D-SWITCH: apply the same switch to a programmatic runtime, so an explicit
   * runtime binding can never re-enable the tool for a switch-off workspace. */
  const narrowProgrammaticRuntime = (bindings: RuntimeHostBindings): RuntimeHostBindings => {
    const narrow = (resolved: ReadResult<ResolvedRuntimeConfiguration>, ctx: { projectId: string; workspaceId?: string }) => {
      const scope = { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' };
      return narrowResolvedReadonlyCommands(resolved, scope,
        runtimeNarrowing.readonlyCommandsDisabledScopes?.has(scopeKey(scope)) === true);
    };
    return {
      async resolveConfiguration(ctx, input) { return narrow(await bindings.resolveConfiguration(ctx, input), ctx); },
      ...(bindings.resolveQueryConfiguration === undefined ? {} : {
        async resolveQueryConfiguration(ctx, input) {
          return narrow(await bindings.resolveQueryConfiguration!(ctx, input), ctx);
        },
      }),
      ...(bindings.resolveRoleConfiguration === undefined ? {} : {
        async resolveRoleConfiguration(ctx, input) {
          return narrow(await bindings.resolveRoleConfiguration!(ctx, input), ctx);
        },
      }),
      // R3 (L13/U5): forward the capability with the SAME switch narrowing, so
      // a programmatic runtime cannot report `available` for a workspace whose
      // `allowReadonlyCommands` switch is off.
      ...(bindings.readonlyCommandAccess === undefined ? {} : {
        async readonlyCommandAccess(input: ReadonlyCommandAccessInput) {
          if (runtimeNarrowing.readonlyCommandsDisabledScopes?.has(scopeKey(input.workspace)) === true) return null;
          return bindings.readonlyCommandAccess!(input);
        },
      }),
    };
  };

  // The ONE trusted runtime binding is the programmatic one or the trusted
  // factory over the serializable configuration, wrapped in a per-ref resolver
  // registry so a later settings change only ever creates a NEW immutable
  // version. With no startup runtime and settings enabled the registry starts
  // from an empty configuration and stays explicitly unconfigured until a model
  // is selected.
  const baseProvider: WorkbenchRuntimeProviderDependencies = options.runtimeProvider ?? {};
  const providerRegistry = baseProvider.registry ?? createBuiltinProviderRegistry();
  const startupCatalogOptions = new Map<string, {
    provider: string;
    options: Record<string, JsonValue>;
  }>();
  const providerSecretName = (model: WorkbenchModelConfiguration): string =>
    model.secretEnvironmentVariable ?? providerRegistry.get(model.provider).secretEnvironmentVariable;
  const baseSecretSource = baseProvider.secretSource ?? { get: (name: string) => process.env[name] };
  const startupBindings = runtimeConfiguration?.bindings ?? [];
  const startupBindingsByScope = new Map(startupBindings.map(binding => [scopeKey(binding.scope), binding] as const));
  const seedConfiguration: WorkbenchRuntimeConfiguration | undefined = runtimeConfiguration
    ?? (settingsEnabled ? { schemaVersion: 1, bindings: [], queryProfiles: [] } : undefined);
  // L13: the ONE Host resource-cap holder, built BEFORE the platform. The initial
  // value is the machine-memory default; the settings restore/reload replaces it
  // with the effective stored values. The platform, the Runtime and the workbench
  // command page all read `current()` live, so a settings change reaches the next
  // command of an already-running execution.
  const capDefaults = defaultResourceCapSettings(totalmem());
  let resourceCapsRequest: { memoryMaxBytes: number; tasksMax: number } = {
    memoryMaxBytes: capDefaults.memoryMaxMiB * MIB,
    tasksMax: capDefaults.tasksMax,
  };
  /** PL §10.3/§7.5: the effective plan-loop limits, held live beside the caps.
   * The composition's one deviation reader reads this getter, so a settings
   * push changes the next judgment without a restart; an already claimed Run
   * keeps the budget in its own record. */
  let planLoopLimits: PlanLoopLimitsV1 = structuredClone(DEFAULT_PLAN_LOOP_LIMITS);
  const resourceCaps: ResourceCapSource = { current: () => ({ ...resourceCapsRequest }) };
  /** The effective Work Run token budget. It is Host state, not part of a
   * runtime configuration version: an already claimed Run keeps its budget and
   * the next Work Run's trusted binding reads this value. */
  let workRunTokenBudget = DEFAULT_WORK_RUN_TOKEN_BUDGET;
  /** Each immutable runtime version captures its OWN fixed secret map: the saved
   * settings keys plus a snapshot of the env values its bindings reference. A
   * later settings change never re-keys an older version that has not yet built
   * one of its role clients. */
  const versionSecretSource = (
    configuration: WorkbenchRuntimeConfiguration,
    snapshot: HostSettingsPrivateSnapshot,
  ): { get: (name: string) => string | undefined } => {
    const fixed = new Map<string, string | undefined>();
    for (const model of snapshot.models) {
      if (typeof model.apiKey === 'string' && model.apiKey.length > 0)
        fixed.set(settingsModelSecretVariable(model.id), model.apiKey);
    }
    for (const binding of configuration.bindings) {
      const name = providerSecretName(binding.model);
      if (fixed.has(name)) continue;
      let value: string | undefined;
      try { value = baseSecretSource.get(name); } catch { value = undefined; }
      fixed.set(name, value);
    }
    return { get: (name: string): string | undefined => fixed.get(name) };
  };
  const versionProvider = (secretSource: { get: (name: string) => string | undefined }): WorkbenchRuntimeProviderDependencies => ({
    ...(baseProvider.registry === undefined ? {} : { registry: baseProvider.registry }),
    secretSource,
  });
  const initialBindings = options.runtime !== undefined
    ? narrowProgrammaticRuntime(options.runtime)
    : (seedConfiguration === undefined
      ? undefined : createWorkbenchRuntimeHostBindings(seedConfiguration,
        versionProvider(versionSecretSource(seedConfiguration, { models: [], selection: {}, checks: [],
          automation: { ...DEFAULT_TASK_AUTOMATION_POLICY }, resourceCaps: resourceCaps.current(),
          workRunTokenBudget, planLoopLimits: structuredClone(planLoopLimits), knowledgeLocalOnly: {} })), runtimeNarrowing));
  const resolverRegistry = initialBindings === undefined ? undefined : createHostRuntimeResolverRegistry(initialBindings);
  const runtime: TargetPlatformOptions['runtime'] = resolverRegistry ?? options.runtime;
  // Settings may rebuild the runtime only from the serializable configuration;
  // a programmatic runtime keeps its original binding untouched.
  const rebuildRuntimeFromSettings = options.runtime === undefined && resolverRegistry !== undefined;

  const sourcePolicyFor: TargetPlatformOptions['sourcePolicyFor'] = async (projectId, workspaceId) => {
    const config = byScope.get(scopeKey({ projectId, workspaceId }));
    if (config === undefined) return null;
    const prefixes = [...config.readPrefixes];
    return { root: config.root, permissionRevision: permissionRevision(actor, config),
      allowsRead: (path: string) => prefixes.some(prefix => prefixMatches(prefix, path)) };
  };
  const rejected = (code: 'not_found' | 'forbidden', reason: string): WorkspaceResult<never> =>
    ({ status: 'rejected', code, reason });

  const bindings: WorkspaceHostBindings = {
    async resolveRoot(workspace: WorkspaceRef) {
      const config = byScope.get(scopeKey(workspace));
      if (config === undefined) return rejected('not_found', 'the workspace is not registered in this Host configuration');
      return { status: 'ready', value: { root: config.root, workspaceRevision: config.workspaceRevision } };
    },
    async authorize(ctx: CoreCallContext, workspace: WorkspaceRef) {
      const config = byScope.get(scopeKey(workspace));
      if (config === undefined) return rejected('not_found', 'the workspace is not registered in this Host configuration');
      if (ctx.principal.kind !== 'host' || ctx.projectId !== workspace.projectId || ctx.workspaceId !== workspace.workspaceId)
        return rejected('forbidden', 'the workspace read is not bound to this Host principal and scope');
      const prefixes = [...config.readPrefixes];
      const subjectKey = `host:${actor.kind}:${actor.id}:${workspace.projectId}/${workspace.workspaceId}`;
      return { status: 'ready', value: {
        subjectKey,
        permissionRevision: permissionRevision(actor, config),
        allowsRead: (path: string) => prefixes.some(prefix => prefixMatches(prefix, path)),
      } };
    },
  };

  /** A project's registered workspaces for its knowledge lines, read live: the main one (its first) first. */
  const knowledgeWorkspacesOf = (projectId: string, mainWorkspaceId: string): readonly string[] => [mainWorkspaceId,
    ...workspaces.filter(workspace => workspace.scope.projectId === projectId && workspace.scope.workspaceId !== mainWorkspaceId)
      .map(workspace => workspace.scope.workspaceId)];
  /** A project's platform sees only that project's workspaces: another project's workspace is `not_found`. */
  const projectBindings = (projectId: string): WorkspaceHostBindings => ({
    async resolveRoot(workspace: WorkspaceRef) {
      if (workspace.projectId !== projectId) {
        return rejected('not_found', 'the workspace is not registered in this Host configuration');
      }
      return bindings.resolveRoot(workspace);
    },
    async authorize(ctx: CoreCallContext, workspace: WorkspaceRef) {
      if (workspace.projectId !== projectId) {
        return rejected('not_found', 'the workspace is not registered in this Host configuration');
      }
      return bindings.authorize(ctx, workspace);
    },
  });

  // Task E: the one in-process change feed. Every project store's commit observer hands its commits in (each takes the
  // Host's next sequence number, S5), and the two in-memory handle owners the page used to poll publish through it.
  const changes = createChangeFeed();
  /** Each project store's own head, kept by its commit observer: the store cursor a wait registers with (U2). */
  const databaseHeads = new Map<string, CommitCursor | null>();
  const databaseHead = (projectId: string): CommitCursor | null => databaseHeads.get(projectId) ?? null;
  // The request driver's sinks are set inside its switch below; with it off a wake or an arm starts nothing, and the
  // rounds stay on record for a later Host with the driver on.
  let requestWakeSink: ((scope: WorkspaceScope, source: 'request_command') => void) | undefined;
  let armMessageRelease: ((scope: WorkspaceScope) => void) | undefined;
  /** Every open project's drivers, by project id. */
  const projects = new Map<string, HostProject>();
  /** Set once the settings exist: from then on a project's stage two is built with its stage one. */
  let settingsReady = false;
  /**
   * One project store's commit observer: the store's head, the shared change feed, that project's Goal fan-out (a
   * fan-out pause that lands later re-drives the waiting Goal resume, GOAL-14) and the shared wake loop. No observer
   * can affect a commit or another observer.
   */
  const commitObserverFor = (projectId: string): RecordCommitObserver => ({
    started(head) { databaseHeads.set(projectId, head === 'unknown' ? null : head); },
    committed(notice) {
      databaseHeads.set(projectId, notice.cursor);
      try { changes.committed(projectId, notice); } catch { /* the change feed keeps its own state */ }
      try { projects.get(projectId)?.goalFanOut.committed(notice); } catch { /* the driver never affects a commit */ }
      try { wakeLoop.committed(notice); } catch { /* the loop never affects a commit */ }
    },
  });
  // Slice 6A §3.4.1: the Host's `SecretaryProfilePort` over its live query profiles, with the SAME duty rule the
  // composition's own instance applies; the role read goes to the context's project (one not open is unavailable).
  const hostDutyResolver: SessionDutyResolver = createSessionDutyResolver({
    readRoleSpec: (ctx, input) => projectPlatform(ctx.projectId).roles.readRoleSpec(ctx, input),
    configuration: workflow,
  });
  const secretaryProfiles = createSecretaryProfiles({
    profiles: () => runtimeProfiles,
    duty: (role, ctx) => hostDutyResolver(role, ctx),
  });
  // (W-11): one process-local closing signal, trusted option only; not a setting, route or
  // persisted field. `close()` aborts it first so live Work pauses at its next safe point.
  const hostClosing = new AbortController();
  // PL §6.4.3: the Host's one detached taskbook export set. Adoption never waits
  // for it, and `close` awaits every job before the stores go away. A failure is
  // never rethrown into the adoption; the notice's own probe re-reads the files.
  const pendingTaskbookExports = new Set<Promise<void>>();
  // PL §6.4.3: the candidate versions already exported by this Host, keyed by the source's pin so a later
  // round skips even the read. A restart empties it and exports once more: the file is rebuildable.
  const exportedCandidates = new Set<string>();
  type AdoptedPlanExport = { plan: PlanRevisionDraft | PlanRevisionSnapshot;
    scope: { projectId: string; workspaceId: string; goalId: string } };
  function scheduleTaskbookExport(work: AdoptedPlanExport): void {
    const job = exportTaskbooksForPlan({ root: settingsDirectory ?? null,
      workspaceRoots: workspaces.map(workspace => workspace.root), plan: work.plan, scope: work.scope })
      .then(() => undefined)
      .catch(() => { /* a failed export is a later probe's fact, never the adoption's result */ })
      .finally(() => { pendingTaskbookExports.delete(job); });
    pendingTaskbookExports.add(job);
  }
  /** The one adoption wrapper (§6.4.3): the project's knowledge is reconciled first; a committed result starts one
   *  export; the result is returned unchanged. */
  function adoptAndExport<A extends [CoreCallContext, ...unknown[]], R extends { status: string }>(
    adopt: (...args: A) => Promise<R>,
    adoptedPlan: (result: R, args: A) => AdoptedPlanExport | null | Promise<AdoptedPlanExport | null>,
  ): (...args: A) => Promise<R> {
    return async (...args: A) => {
      await reconcileBeforeAdopt(args[0].projectId);
      const result = await adopt(...args);
      if (result.status === 'committed') {
        const exported = await adoptedPlan(result, args);
        if (exported !== null) scheduleTaskbookExport(exported);
      }
      return result;
    };
  }
  /**
   * KLS-2c [2C1-24], split ruling 5: before every adoption each workspace of the project reconciles its knowledge as
   * the Host's system actor, so an adoption under a conflict comes with its notice. A failure does not touch the
   * adoption (the Host has no log port; the next idle round comes again).
   */
  async function reconcileBeforeAdopt(projectId: string): Promise<void> {
    const platform = platformFor(projectId);
    if (platform === null) return;
    for (const { scope } of workspaces.filter(workspace => workspace.scope.projectId === projectId)) {
      try { await platform.knowledge.reconcile(hostScopeContext(scope, HOST_RECONCILE_ACTOR), scope.workspaceId, 'before_adopt'); }
      catch { /* the adoption goes on */ }
    }
  }
  const explicitKernelEntries = options.kernelStores?.entries ?? [];
  /** Each opened project's main workspace (its first at open): the head of its knowledge workspace list, which its
   *  platform and the `knowledge-local` route read alike. */
  const mainWorkspaces = new Map<string, string>();
  const knowledgeListOf = (projectId: string, mainWorkspaceId: string): ((projectId: string) => readonly string[]) => {
    mainWorkspaces.set(projectId, mainWorkspaceId);
    return id => knowledgeWorkspacesOf(id, mainWorkspaceId);
  };
  // KLS-1b: one runtime per project (S1, T3): its own store directory, lease, Kernel store directory and platform. The
  // memory store takes the same path with one in-memory store per project (V3). A project opens at start (the list
  // and the start-up workspaces, §4.2) or when a directory opens a new one (U4); nothing else makes a runtime.
  // KLS-2b: the Host's ONE knowledge write queue; every project's platform takes it, so two projects on one checkout
  // write one at a time in this process.
  const knowledgeWriteQueue = createKnowledgeWriteQueue();
  const registry = createProjectRuntimeRegistry({
    storage: storage.kind === 'sqlite' ? { kind: 'sqlite', legacyDirectory: storage.directory } : { kind: 'memory' },
    acquireLease: directory => acquireHostInstanceLease({ directory, now: options.now ?? (() => new Date().toISOString()) }),
    createPlatform: input => openTargetPlatform({
      storage: input.storage,
      workspace: projectBindings(input.projectId),
      knowledgeWorkspaces: knowledgeListOf(input.projectId, input.workspaces[0]!.workspaceId),
      knowledgeWriteQueue,
      // A checkout's knowledge is written by one Host at a time, across processes ([2C1-05]).
      acquireKnowledgeLease: directory => acquireHostInstanceLease({ directory, now: options.now ?? (() => new Date().toISOString()) }),
      ...(options.knowledgeWriteHold === undefined ? {} : { knowledgeWriteHold: options.knowledgeWriteHold }),
      // The knowledge "kept local" is by checkout, read live from the last settings snapshot pushed to the Host.
      knowledgeLocalOnly: repoKey => lastSnapshot?.knowledgeLocalOnly[repoKey] === true,
      commitObserver: commitObserverFor(input.projectId),
      hostInstance: { hostInstanceId: input.lease.hostInstanceId, lease: input.lease.lease, takeover: input.lease.takeover },
      hostClosing: hostClosing.signal,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(architectureSource === undefined ? {} : { architectureSource }),
      ...(options.lightScan === undefined ? {} : { lightScan: options.lightScan }),
      kernelStores: { entries: explicitKernelEntries.filter(entry => entry.workspace.projectId === input.projectId) },
      ...(runtime === undefined ? {} : { runtime }),
      ...(checks === undefined ? {} : { checks }),
      ...(workflow === undefined ? {} : { workflow }),
      secretaryProfiles,
      sourcePolicyFor,
      resourceCaps,
      operatorActor: actor,
      ...(promptsRoot === undefined ? {} : { promptPacks: createDiskPromptPackSource(promptsRoot) }),
      // PL §5.2.5/§6.7.1: the Host's own system-round wrapper over the ONE mailbox
      // this root owns. Composition may not import `src/app`, so the factory is
      // supplied here; the mailbox it hands back is the same one the platform publishes.
      systemRoundSend: messages => (ctx, input) => sendSystemRound(ctx, { messages }, input),
      // PL §6.4.3: the read-only taskbook probe rooted in this Host's settings directory.
      // Without a settings directory it is the real `not_configured`, never `unavailable`.
      exportBooks: input => readTaskbookExport({
        root: settingsDirectory ?? null, plan: input.plan, scope: input.scope,
      }),
      // PL §10.3/§7.5: the one live effective-limits getter the shared deviation
      // reader reads. The settings restore/reload below replaces the holder.
      planLoopLimits: () => planLoopLimits,
      // L-02 §6.4.3: an automatic adoption runs through the SAME wrapper at the
      // commit itself; the published `platform.plans` stays raw (the route binding
      // already wraps it, so wrapping both would export one adoption twice).
      wrapPlanChange: raw => adoptAndExport(raw, (result, [ctx]) => result.status === 'committed'
        ? { plan: result.value, scope: { projectId: result.value.goalRef.projectId,
          workspaceId: ctx.workspaceId ?? '', goalId: result.value.goalRef.goalId } }
        : null),
      // L8: a formal adoption/revision/PASS reaches the trigger of the event's project (set only with its lease).
      onArchitectureCaptureTrigger: event => { projects.get(event.projectId)?.captureTrigger?.(event); },
      // A request command's commit reaches the wake loop of the workspace it
      // landed in; the sink is bound once the loop exists, and the platform
      // never drives a round by itself.
      requestWake: (scope, source) => { requestWakeSink?.(scope, source); },
      // C1: the cold start's exploration rounds run on the stage driver of the context's project; without it (no
      // request driver, no lease) those rounds wait where they are.
      coldStartStages: {
        advance: (ctx, stage) => projects.get(ctx.projectId)?.coldStartStages?.advance(ctx, stage)
          ?? Promise.resolve(COLD_START_STAGE_NOT_BOUND),
        wake: scope => { projects.get(scope.projectId)?.coldStartStages?.wake(scope); },
      },
      // A committed approval through the trusted entry arms the release queue; a replay included, and
      // arming twice is harmless (`7a2-rgp-v7.md:1076`).
      onMessageReleaseApproved: approved => { armMessageRelease?.({
        projectId: approved.messageRef.projectId, workspaceId: approved.messageRef.workspaceId,
      }); },
    }),
  });
  /** A scope's platform: its project's, or null when that project is not open in this Host. */
  const platformFor = (projectId: string): ProjectPlatform | null => registry.get(projectId)?.platform ?? null;
  /** Whether this Host holds the project's lease (U1): every execution, driver and background write checks it. */
  const ownedProject = (projectId: string): boolean => registry.get(projectId)?.lease.lease === 'owned';
  /** The platform of a project a background step or a shared read works on; one not open is a read failure. */
  const projectPlatform = (projectId: string): ProjectPlatform => {
    const platform = platformFor(projectId);
    if (platform === null) throw new Error(`the project store of ${projectId} is not available`);
    return platform;
  };

  /**
   * PL §6.4.3: a candidate result (`value.source`) exports its draft once through
   * the same scheduler. The adoption itself registers its export at the commit
   * (the Host option above); this path never reads an `adopt_plan` receipt. The
   * result itself is never changed, and a failed read only skips this export:
   * nothing is recorded, so the next round tries again. A started export is
   * recorded even if it later fails (no retry; the card shows the failure line).
   */
  async function exportAdvanceResult(platform: ProjectPlatform, ctx: CoreCallContext,
    result: WorkflowAdvanceResult): Promise<void> {
    if (result.status !== 'ready') return;
    const value = result.value;
    const source = value.source;
    if (source === undefined || source === null) return;
    const proposalPin = source.pins.find(pin => pin.ref.aggregateType === 'PlanProposal');
    const goalRef = decisionSubjectGoalRef(source);
    if (proposalPin === undefined || goalRef === null) return;
    const candidateKey = canonicalKey(proposalPin);
    if (exportedCandidates.has(candidateKey)) return;
    exportedCandidates.add(candidateKey);
    const proposal = await platform.plans.readPlanProposal(ctx, { ...proposalPin.ref as PlanProposalRef });
    if (proposal.status !== 'ready') { exportedCandidates.delete(candidateKey); return; }
    scheduleTaskbookExport({ plan: proposal.value.draft, scope: { projectId: goalRef.projectId,
      workspaceId: ctx.workspaceId ?? '', goalId: goalRef.goalId } });
  }
  /**
   * L8 (book ruling 1): the ONE shared registration step of both paths. It
   * triggers only once the scope's root is bound in this Host's `byScope`, and only
   * while this Host holds the scope's project lease; the settings path calls it
   * after `addWorkspaceState`, the route path after a non-replayed committed
   * `registerWorkspace` (wrapped below).
   */
  const captureWorkspaceRegistration = (scope: CoreScope): void => {
    const project = projects.get(scope.projectId);
    if (project === undefined || !ownedProject(scope.projectId) || !byScope.has(scopeKey(scope))) return;
    project.autoCapture.workspaceRegistered({ projectId: scope.projectId, workspaceId: scope.workspaceId });
  };

  // The Host's one goal-wait registry per start workspace scope, in start order. The
  // goal-waits queue adapter and the collaboration driver's resolver share these instances;
  // neither ever owns or forks a registry of its own.
  const goalWaitRegistries: { scope: WorkspaceScope; waits: GoalWaitWakes }[] = workspaces.map(workspace => ({
    scope: { projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId },
    waits: createGoalWaitWakes(),
  }));
  const goalWaitWakesOf = (scope: WorkspaceScope): GoalWaitWakes =>
    goalWaitRegistries.find(candidate => candidate.scope.projectId === scope.projectId
      && candidate.scope.workspaceId === scope.workspaceId)!.waits;
  const workbenchTools = createWorkbenchTools({
    workspaces: workspaces.map(workspace => ({
      scope: workspace.scope,
      root: workspace.root,
      readPrefixes: workspace.readPrefixes,
      ...(workspace.writePrefixes === undefined ? {} : { writePrefixes: workspace.writePrefixes }),
      ...(workspace.allowCommands === undefined ? {} : { allowCommands: workspace.allowCommands }),
    })),
    onCommandChange: change => changes.commandChanged(change, databaseHead(change.scope.projectId)),
    resourceCaps,
  });
  // PL §5.5.1 steps 5–6: the driver registers a wait, drains the Host's one
  // goal-waits handler, then parks/sends. The handler is created below, beside
  // the wake loop; the closure runs only after this Host has returned.
  let goalWaitQueueOwner: ReturnType<typeof createGoalWaitQueue> | undefined;
  /** One Session-page cursor per scope, kept across drain pages; no new queue or timer. */
  const admissionCursors = new Map<string, string>();
  // The one admission drain entry: the driver's running-cap hold and the start-up wake both use it.
  const drainGoalWaits = async (scope: WorkspaceScope): Promise<void> => {
    const key = scopeKey(scope);
    const page = await goalWaitQueueOwner?.drain(scope, {
      maxItems: WAKE_LIMIT, continuation: admissionCursors.get(key) ?? null,
      signal: hostClosing.signal,
    });
    if (page === undefined) return;
    if (page.continuation === null) admissionCursors.delete(key);
    else admissionCursors.set(key, page.continuation);
    if (page.more) wakeLoop.wake(scope, GOAL_WAITS_QUEUE, 'commit'); // the next page, same queue
  };
  // The marker page behind the drain: one Session page's Query marks kept at `prepared` + `running_cap`.
  async function readMarkerQueries(ctx: CoreCallContext, scope: WorkspaceScope, cursor: string | null) {
    const platform = projectPlatform(scope.projectId);
    const found = await platform.sessions.findSessions(ctx, {
      workspace: { projectId: scope.projectId }, includeArchived: false,
      // The page key is the last card's Session key: a directory cursor binds the ledger head, and this
      // drain's own start commits move it.
      page: { limit: 200, ...(cursor === null ? {} : { afterSessionKey: cursor }) },
    });
    if (found.status !== 'ready') return found;
    const items: MarkerQueryCandidateV1[] = [];
    let last: string | null = null;
    for (const card of found.value.items) {
      last = plainSessionRefKey(card.record.ref);
      const occupancy = card.record.occupancy;
      if (occupancy === null || occupancy.kind !== 'execution') continue;
      const ref = occupancy.executionRef;
      if (ref.aggregateType !== 'QueryRun') continue;
      const read = await platform.reconcile.readQueryExecution({ ...ctx, workspaceId: card.record.workspaceId }, ref);
      if (read.status !== 'ready') return read;
      const state = read.value.run.run.executionState;
      if (state?.phase !== 'prepared' || state.admissionWait !== 'running_cap') continue;
      items.push({ queryRunRef: ref, startCursor: read.value.job.since });
    }
    return { status: 'ready' as const, value: { items, nextCursor: found.value.nextCursor === null ? null : last } };
  }
  // The request driver's round-end hook (`recordRoundEnd`), set in that driver's block below when it runs: a request
  // round the drain starts records its end the same way, so the automatic-handoff trigger still reads it.
  let markerRoundEnded: ((ctx: CoreCallContext, session: SessionRef, round: QueryJobRef) => Promise<void>) | undefined;
  // The candidate's project builds its marker stage driver at the first start: the first drain runs after the request
  // driver's block, so the hook above is set by then.
  const startMarkerQuery = async (ctx: CoreCallContext, candidate: MarkerQueryCandidateV1): Promise<void> => {
    const project = projects.get(candidate.queryRunRef.projectId);
    if (project === undefined) throw new Error(`the project store of ${candidate.queryRunRef.projectId} is not available`);
    const platform = project.runtime.platform;
    project.markerStageDriver ??= createQueryStageDriver({
      queries: platform.queries, runtime: platform.runtime, facts: platform.requestFacts,
      fence: platform.readHandoffFence, consumerId: workflowConsumerId,
      ...(markerRoundEnded === undefined ? {} : { onRoundEnded: markerRoundEnded }),
    });
    // The marker page is project-wide: the start runs in the candidate's own workspace, as its read does.
    await project.markerStageDriver.advance({ ...ctx, workspaceId: candidate.queryRunRef.workspaceId }, {
      queryJobRef: { aggregateType: 'QueryJob', projectId: candidate.queryRunRef.projectId,
        workspaceId: candidate.queryRunRef.workspaceId, queryJobId: candidate.queryRunRef.queryJobId },
      expectedRunRef: candidate.queryRunRef, profile: null,
    });
  };
  // The L5 priority read (lead ruling (b), `a-a1b-l5-lead.md`): the waiting call's own persisted facts, read on
  // demand; no registry field. The class is the Runtime's L5 split: 0 = a message whose sender is the Host with a
  // human actor; 1 = a wait's reply or expiry; 2 = everything else, Host system senders included.
  /** The Runtime's L5 person test, inlined at `core/agent-runtime/execution-inputs.ts:239` and
   *  `core/work-graph/views/consumable-sessions.ts:90`; no exported helper exists. */
  const isPersonSender = (sender: { kind: string; actor?: { kind: string } } | undefined): boolean =>
    sender?.kind === 'host' && sender.actor?.kind === 'human';
  async function senderClass(ctx: CoreCallContext, ref: SessionMessageRef, part: 'message' | 'response'): Promise<0 | 2> {
    const read = await projectPlatform(ctx.projectId).messages.readMessage(ctx, ref);
    if (read.status !== 'ready') throw notReady('the L5 source message', read);
    return isPersonSender(part === 'message' ? read.value.sender : read.value.response?.sender) ? 0 : 2;
  }
  /** One `starting` scan per drain pass: the drain builds one ctx per pass and reads every priority before any start. */
  const startingRuns = new WeakMap<CoreCallContext, Promise<readonly RunSnapshot[]>>();
  const l5PriorityOf = async (ctx: CoreCallContext, call: WaitingCallV1): Promise<0 | 1 | 2> => {
    const platform = projectPlatform(ctx.projectId);
    if (call.kind === 'query') {
      const ref = call.queryRunRef;
      const qctx: CoreCallContext = { ...ctx, workspaceId: ref.workspaceId };
      const read = await platform.queries.readQueryJob(qctx, queryJobRefFor(ref.projectId, ref.workspaceId, ref.queryJobId));
      if (read.status !== 'ready') throw notReady('the marker Query', read);
      const job = read.value.job.job;
      if (job.roundKind === 'reply' || job.roundKind === 'expiry') return 1;
      // A request or follow-up round: every `submit` receipt is the person's (0); the hand-off's understanding
      // round is the system's (2). Routing/explain rounds never reach the gate.
      if (job.roundKind !== null) return job.understanding !== null ? 2 : 0;
      const execution = job.intent.execution;
      if (execution.kind === 'intervention_planning') return senderClass(qctx, execution.sourceMessageRef!, 'message');
      if (execution.consultation !== undefined) {
        return senderClass(qctx, execution.consultation.messageRef,
          execution.consultation.part === 'response' ? 'response' : 'message');
      }
      if (execution.kind === 'role_exploration') return 2;   // the cold start's round: the platform (Host system) starts it
      return 0;                                   // initial_coordination / a plain semantic_query: only `queries/submit`
    }
    let runs = startingRuns.get(ctx);
    if (runs === undefined) {
      runs = platform.reconcile.candidates.listRuns({ projectId: ctx.projectId, workspaceId: ctx.workspaceId! },
        'starting', ctx.signal).then(found => {
        if (found.status !== 'ready') throw notReady('the starting Runs', found);
        return found.value.records;
      });
      startingRuns.set(ctx, runs);
    }
    // The Goal's Runs held at the gate (`starting` + `authorized`); the smallest class wins. A person's rework
    // (`requeueRef`) and an intervention claim with no prior Run are 2 (the lead's known corners).
    let best: 0 | 1 | 2 = 2;
    for (const run of await runs) {
      if (run.ref.goalId !== call.goalRef.goalId || run.executionAuthorization?.phase !== 'authorized') continue;
      const wait = run.consumedWait;
      const own = wait?.kind === 'wait_reply' || wait?.kind === 'expiry' ? 1
        : wait?.kind === 'intervention' ? await senderClass(ctx, wait.messageRef, 'message') : 2;
      if (own < best) best = own;
    }
    return best;
  };

  // The approved repair answer is handed back through the same advance entrance
  // the other answer kinds use. The activation guard admits the configured
  // operator, so a system trigger's scope is rebuilt as that operator before the
  // answer read and the advance; only the trigger's project, workspace and
  // signal are taken from it.
  const redriveRepairAnswers = async (trigger: CoreCallContext, input: { goalRef: GoalRef }): Promise<void> => {
    const ctx: CoreCallContext = {
      ...hostScopeContext({ projectId: trigger.projectId, workspaceId: trigger.workspaceId! }, actor),
      signal: trigger.signal,
    };
    const platform = platformFor(trigger.projectId);
    if (platform === null) return;
    const read = await platform.reconcile.reviews?.readRepairAnswers?.(ctx, input);
    if (read?.status !== 'ready' || read.value.answers.length === 0) return;
    await platform.workflow.advanceWork(ctx, {
      schemaVersion: 1, goalRef: input.goalRef, flowId: `repair-answer-redrive:${input.goalRef.goalId}`,
      sessionHint: null, kind: 'select_work',
      answers: read.value.answers.map(answer => ({ kind: 'repair_approval' as const,
        answerMessageRef: answer.answerMessageRef })),
    });
  };
  // The one wake loop of this Host (U1): a pass of a workspace runs only while this Host holds that workspace's project
  // lease. The goal-waits queue is registered on it in every case; the two request queues, the lifecycle and release
  // queues and their sinks stay inside the request-driver switch, so with it off a submitted round waits where the
  // command left it but a goal wait still wakes. The queues are shells: a pass takes its scope's project.
  const wakeLoop: WakeLoop = createWakeLoop({ driving: scope => ownedProject(scope.projectId) });
  let lifecycleQueue: ReturnType<typeof createHandoffQueue> | undefined;
  // The Host consumer id a plain Query start records; the request driver's stage driver below reads it too.
  const workflowConsumerId = workflow?.consumerId ?? 'local-workbench-consumer';
  const goalWaitRegistriesV1: GoalWaitRegistries = { all: () => goalWaitRegistries };
  const goalWaitQueue = createGoalWaitQueue({
    registries: goalWaitRegistriesV1,
    // BW's one Workflow advance for the goal; the same host context every consume pass uses.
    wake: async (scope, goalRef) => { await projects.get(scope.projectId)?.collaborationDriver.wake(hostContext(scope), goalRef); },
    ctx: scope => hostScopeContext(scope, actor),
    readMarkerQueries,
    startMarkerQuery,
    l5PriorityOf,
    // The restart composition over the scope's own project.
    rebuild: async (scope, registry) => {
      const project = projects.get(scope.projectId);
      if (project === undefined) throw new Error(`the project store of ${scope.projectId} is not available`);
      const platform = project.runtime.platform;
      await createGoalWaitRebuild({ ctx: target => hostScopeContext(target, actor), sessions: platform.sessions, facts: platform.sessionFacts, released: platform.messageRelease,
        // The goal loop's own candidate reads (§6.1.6); the accepted arm walks the source lineage with the
        // same mailbox/Query/Plan reads the readers use.
        planCandidates: platform.planReaders.planCandidates.bind(platform.planReaders),
        acceptedCandidatesOf: platform.planReaders.acceptedCandidatesOf.bind(platform.planReaders),
        messages: platform.messages, queries: platform.queries, plans: platform.plans,
        held: async (ctx, goalRef) => {
          if (platform.automationPolicy().resumeOnStartup === 'auto') return false;
          const read = await project.goalFanOut.readGoalDisplay(ctx, { goalRef });
          if (read.status !== 'ready') throw notReady('the Goal interruption read', read);
          return read.value.display.causes.some(cause => 'interruption' in cause);
        } })(scope, registry);
    },
  });
  goalWaitQueueOwner = goalWaitQueue;
  wakeLoop.register(GOAL_WAITS_QUEUE, goalWaitQueue, {
    aggregateTypes: GOAL_WAIT_WAKE_AGGREGATE_TYPES, maxItems: WAKE_LIMIT,
  });
  if (options.requestDriver !== 'off') {
    const loop = wakeLoop;
    // The round-end sources waiting for their basis read and start. Memory only: a crash between a round end and
    // its read loses one check until that line's next round end, which records it again.
    const pendingRoundEnds = new Map<string, Map<string, SessionRef>>();
    // The ended request rounds that may write their request's plan candidate. A separate memory-only table: a
    // crash between the round end and this read loses one candidate until the person selects an idea or speaks again.
    const pendingPlanTurns = new Map<string, Map<string, QueryJobRef>>();
    /** The round-end hook: record both sources for this workspace and wake its lifecycle queue. It never throws. */
    const recordRoundEnd = async (ctx: CoreCallContext, session: SessionRef, round: QueryJobRef): Promise<void> => {
      const key = scopeKey({ projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' });
      const sources = pendingRoundEnds.get(key) ?? new Map<string, SessionRef>();
      sources.set(plainSessionRefKey(session), session);
      pendingRoundEnds.set(key, sources);
      const turns = pendingPlanTurns.get(key) ?? new Map<string, QueryJobRef>();
      turns.set(round.queryJobId, round);
      pendingPlanTurns.set(key, turns);
      loop.wake({ projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' }, LIFECYCLE_QUEUE, 'advance_settled');
    };
    markerRoundEnded = recordRoundEnd;                  // A1b: the drain's marker driver ends a request round the same way
    // Both queues are registered once per loop: a handler takes the scope and hands the pass to the request queues of
    // the scope's project (built with its stage driver, `buildStageOne`), so every workspace the loop covers runs the
    // same two. The loop covers the start-up workspaces in `start` and a later one in `addWorkspace`.
    const requestQueue = (pick: 'rounds' | 'unassigned'): QueueHandler => ({
      async rebuild(scope) { await projects.get(scope.projectId)?.requestQueues?.[pick].rebuild(scope); },
      async drain(scope, input) {
        const queues = projects.get(scope.projectId)?.requestQueues;
        if (queues === undefined) throw new Error(`the request queues of ${scope.projectId} are not available`);
        return await queues[pick].drain(scope, input);
      },
    });
    loop.register(REQUEST_ROUNDS_QUEUE, requestQueue('rounds'),
      { aggregateTypes: ['QueryJob', 'QueryRun', 'Session', 'SessionMessage'] });
    loop.register(REQUEST_UNASSIGNED_QUEUE, requestQueue('unassigned'),
      { aggregateTypes: ['QueryJob', 'QueryRun', 'Session', 'ProjectRoleLimits'] });
    // A request command's commit reaches every queue of its workspace: the round it appended needs a claim or a
    // drain, a waiting request needs the unassigned pass, and an arming command reaches the lifecycle work at once.
    requestWakeSink = (scope, source) => {
      loop.wake(scope, REQUEST_ROUNDS_QUEUE, source);
      loop.wake(scope, REQUEST_UNASSIGNED_QUEUE, source);
      loop.wake(scope, LIFECYCLE_QUEUE, source);
    };
    /** A transient failure: a thrown call, or a read that is not ready / unavailable. Everything else is a wait. */
    const transient = (result: { status: string; code?: string }): boolean =>
      result.status === 'not_ready' || (result.status === 'rejected' && result.code === 'unavailable');
    const failureText = (error: unknown): string => error instanceof Error ? error.message : String(error);
    /**
     * Phase 1: each pending round-end source gets one basis read and one `startHandoff`; a business answer removes it.
     * Phase 1 counts nothing: a start may continue an operation that is already waiting without writing, and the same
     * traversal's operation read (phase 2) is where a revision that really moved is seen.
     */
    type HandoffOwner = NonNullable<HostProject['handoffOwner']>;
    const startPendingHandoffs = async (platform: ProjectPlatform, handoffOwner: HandoffOwner, ctx: CoreCallContext,
      failures: string[]): Promise<void> => {
      const workspaceKey = scopeKey({ projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' });
      const sources = pendingRoundEnds.get(workspaceKey);
      if (sources === undefined) return;
      for (const [key, source] of [...sources]) {
        try {
          const basis = await platform.readSecretaryHandoffBasis(ctx, source);
          if (basis.status !== 'ready' && transient(basis)) {
            failures.push(notReady('the handoff basis read', basis).message);
            continue;
          }
          if (basis.status !== 'ready' || basis.value.tooLong !== true) { sources.delete(key); continue; }
          const started = await handoffOwner.startHandoff(ctx, { source, basis: basis.value });
          if (started.status !== 'ready' && transient(started)) {
            failures.push(notReady('the handoff start', started).message);
            continue;
          }
          sources.delete(key);
        } catch (error) {
          failures.push(`the handoff trigger of ${key} failed: ${failureText(error)}`);
        }
      }
      if (sources.size === 0) pendingRoundEnds.delete(workspaceKey);
    };
    /**
     * S1: each ended request round gets one plan-turn attempt. The Host reads only the round; the entry reads the
     * answer. A non-plan followup answers `skipped/no_plan` and writes nothing. A failed turn stays for the next
     * pass; a transient skip does too, every other outcome removes the entry.
     */
    const startPendingPlanTurns = async (platform: ProjectPlatform, ctx: CoreCallContext,
      failures: string[]): Promise<void> => {
      const workspaceKey = scopeKey({ projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' });
      const turns = pendingPlanTurns.get(workspaceKey);
      if (turns === undefined) return;
      const propose = platform.workflow.proposeFromPlanTurn;
      if (propose === undefined) { pendingPlanTurns.delete(workspaceKey); return; }
      for (const [key, round] of [...turns]) {
        try {
          const read = await platform.queries.readQueryJob(ctx, round);
          if (read.status !== 'ready') {
            if (read.status === 'not_found') { turns.delete(key); continue; }
            if (transient(read)) { failures.push(`the plan-turn round read of ${key} is not ready`); continue; }
            turns.delete(key);
            continue;
          }
          const job = read.value.job;
          if (!isRequestRound(job) || job.job.roundKind !== 'followup' || job.job.requestRoot === null
            || job.job.goalId === null || job.job.status !== 'answered') {
            turns.delete(key);
            continue;
          }
          const answerRef = job.job.answerRefs.at(-1);
          if (answerRef === undefined) { turns.delete(key); continue; }
          // The plan-turn write is the request's own candidate, not a fresh person command: the request's
          // initiator authorizes the slot (the same actor the request's first round was submitted under).
          const requestFacts = await platform.requestFacts.readFacts(ctx, { requestRoot: job.job.requestRoot });
          if (requestFacts.status !== 'ready') {
            if (transient(requestFacts)) { failures.push(`the plan-turn request facts of ${key} are not ready`); continue; }
            turns.delete(key);
            continue;
          }
          const turnCtx: CoreCallContext = ctx.principal.kind === 'host'
            ? { ...ctx, principal: { kind: 'host', actor: { ...requestFacts.value.initiator } },
              materialReader: ctx.materialReader.kind === 'host'
                ? { ...ctx.materialReader, actor: { ...requestFacts.value.initiator } } : ctx.materialReader }
            : ctx;
          const result = await propose.call(platform.workflow, turnCtx, { ref: round, answerRef,
            requestRoot: job.job.requestRoot, goalId: job.job.goalId });
          if (result.status === 'done') { turns.delete(key); continue; }
          if (result.status === 'skipped') {
            if (!result.transient) turns.delete(key);
            continue;
          }
          // A failed turn stays for the next pass; only a retryable one is reported so the loop backs off.
          if (result.transient) failures.push(`the plan-turn candidate of ${key} failed: ${result.reason}`);
        } catch (error) {
          failures.push(`the plan-turn candidate of ${key} failed: ${failureText(error)}`);
        }
      }
      if (turns.size === 0) pendingPlanTurns.delete(workspaceKey);
    };
    /** Phase 2: every unfinished operation once, through its own arm; a wait or a failure never stops the next. */
    const continueUnfinished = async (platform: ProjectPlatform, handoffOwner: HandoffOwner, ctx: CoreCallContext,
      failures: string[]): Promise<{ continued: number; blocked: number }> => {
      let continued = 0;
      let blocked = 0;
      let unfinished: Awaited<ReturnType<typeof platform.listUnfinishedOperations>>;
      try {
        unfinished = await platform.listUnfinishedOperations(ctx);
      } catch (error) {
        failures.push(`the unfinished operation read failed: ${failureText(error)}`);
        return { continued, blocked };
      }
      if (unfinished.status !== 'ready') {
        if (transient(unfinished)) failures.push(notReady('the unfinished operation read', unfinished).message);
        else blocked += 1;
        return { continued, blocked };
      }
      for (const { operation, revision, kind } of unfinished.value) {
        try {
          // b02: the `role_line` arm also resumes `action.action === 'role_line_split'`; no second kind branch.
          const result = kind === 'handoff' ? await handoffOwner.continueHandoff(ctx, { operation })
            : kind === 'role_line' ? await platform.roleLineOperations.continueOperation(ctx, { operation })
              : await handoffOwner.manualArchive(ctx, { operation });
          if (result.status === 'ready') {
            if (result.value.revision > revision) continued += 1;
            // A normal wait (a person's answer, a card, a candidate) is not a left-behind operation.
            else if (!('state' in result.value && result.value.state === 'waiting')) blocked += 1;
          } else if (transient(result)) {
            failures.push(notReady(`the ${kind} operation ${operation.operationId}`, result).message);
          } else {
            blocked += 1;
          }
        } catch (error) {
          failures.push(`the ${kind} operation ${operation.operationId} failed: ${failureText(error)}`);
        }
      }
      return { continued, blocked };
    };
    /**
     * One whole lifecycle traversal: pending round ends, every unfinished operation once, then one bounded page of the
     * project's Goal adviser queue. A transient item is recorded and stepped past; only a traversal that progressed
     * nothing throws, so the loop's own back-off reruns the whole traversal. The drain runs after
     * `continueUnfinished`, so a `role_line_add` the previous drain accepted is driven first; `more` is the next
     * pass's continuation, never a loop inside this one. It runs on the context's project; a project without its
     * lifecycle owner here (not open, or no lease) has nothing to traverse.
     */
    const runLifecyclePass = async (ctx: CoreCallContext):
      Promise<{ continued: number; blocked: number; queue: GoalDrainResultV1 | null }> => {
      const project = projects.get(ctx.projectId);
      if (project?.handoffOwner === undefined) return { continued: 0, blocked: 0, queue: null };
      const platform = project.runtime.platform;
      const failures: string[] = [];
      await startPendingHandoffs(platform, project.handoffOwner, ctx, failures);
      await startPendingPlanTurns(platform, ctx, failures);
      let { continued, blocked } = await continueUnfinished(platform, project.handoffOwner, ctx, failures);
      const drained = await platform.goalAdviserQueue.drain(ctx, { limit: QUEUE_DRAIN_BATCH });
      let queue: GoalDrainResultV1 | null = null;
      if (drained.status !== 'ready') {
        if (transient(drained)) failures.push(notReady('the goal adviser queue drain', drained).message);
        else blocked += 1;
      } else {
        queue = drained.value;
        continued += queue.assigned;               // a blocked/queued entry is not progress
      }
      if (continued === 0 && failures.length > 0) {
        throw new Error(`the lifecycle pass failed: ${failures.join('; ')}`);
      }
      return { continued, blocked, queue };
    };
    // The lifecycle queue: one handler call is one whole traversal. The composition binds the reads and the
    // Workflow owners.
    const lifecycle = createHandoffQueue({
      pass: async ctx => await runLifecyclePass(ctx),
    });
    const lifecycleHandler: QueueHandler = {
      async rebuild() {},
      async drain(scope, input) {
        const ctx: CoreCallContext = { ...hostScopeContext(scope, HOST_RECONCILE_ACTOR), signal: input.signal };
        const project = projects.get(scope.projectId);
        const announceDisconnections = async (): Promise<void> => {
          if (project === undefined) return;
          let cursor: string | null = null;
          do {
            const page = await project.runtime.platform.sessions.findSessions(ctx, { workspace: scope, includeArchived: true,
              page: { limit: 200, ...(cursor === null ? {} : { cursor }) } });
            if (page.status !== 'ready') return;                       // the next Session commit / start retries
            for (const card of page.value.items) {
              if (card.availability !== 'unavailable') continue;       // the one derived gone test
              await announceDisconnect(ctx, project.hostNotices, { scope,
                sessionRef: { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId } });
            }
            cursor = page.value.nextCursor;
          } while (cursor !== null);
        };
        const pass = await lifecycle.run(ctx);
        // The third step, after `continueUnfinished`: `scope` is `drain`'s own, and N's request ids make a repeat a no-op.
        await announceDisconnections();
        // The progress is the pass's, and `more` is the queue drain's continuation.
        return { progressed: pass.continued, more: pass.queue?.more ?? false, continuation: null,
          wrapped: true, blocked: pass.blocked };
      },
    };
    loop.register(LIFECYCLE_QUEUE, lifecycleHandler, { aggregateTypes: LIFECYCLE_WAKE_AGGREGATE_TYPES });
    // The release queue: ONE pass per wake. It chooses no message and no page — the Workflow's own release step
    // does that (`book-7a.md:380–:381`); the pass asks each active Goal's one selection and performs what the step
    // names, until that Goal has nothing left in THIS pass. A pass that released nothing reports no progress and
    // the loop parks the pair until the next wake; a blocked item is never a handler failure (`:386–:389`;
    // `wake-loop.ts:19–:24`).
    const runReleasePass = async (ctx: CoreCallContext): Promise<{ released: number; blocked: number }> => {
      const platform = projectPlatform(ctx.projectId);
      const goals = await platform.reconcile.candidates.listGoals(
        { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' }, ctx.signal);
      // A Goals read failure is the failure: the loop's own back-off retries it (`wake-loop.ts:194`, `:22–:24`).
      if (goals.status !== 'ready') throw notReady('the release pass Goals', goals);
      let released = 0;
      let blocked = 0;
      for (const goal of goals.value.records) {
        if (goal.desiredState !== 'active') continue;
        // This Goal's own copies of the items this pass refused (`7a2-rgp-v7.md:750–:752`); empty on entry.
        const skip = new Set<string>();
        for (;;) {
          // The pass's skip set travels in the Host-driver-only third argument, never in the input.
          const selected = await platform.workflow.advanceWork(ctx, {
            schemaVersion: 1, goalRef: goal.ref, flowId: `release:${goal.ref.goalId}`, sessionHint: null,
            kind: 'select_work',
          }, { releaseSkip: [...skip] });
          // A selection that is not ready is the failure, never "no candidate" (rd7a2a-05, D8-10 (a)).
          if (selected.status !== 'ready') throw notReady('the release selection', selected);
          const next = selected.value.next;
          if (next === null || next.kind !== 'perform' || next.operation.kind !== 'release_message') break;
          const performed = await platform.workflow.advanceWork(ctx, next);
          // A refused call (bad input or scope) is a failure too, not a blocked item: the item's own refusals
          // arrive as the `waiting` step result below.
          if (performed.status !== 'ready') throw notReady('the release performance', performed);
          if (performed.value.state === 'advance') { released += 1; continue; }
          // Blocked this pass: an activity-only conflict after R2's bound, `revision_conflict`, `busy` (the Goal
          // is not active) or `not_found`. A change of its message, Goal, plan pointer, understanding pointer,
          // counter or activity record wakes the queue again (`book-7a.md:386–:391`); the next item follows in
          // this same pass.
          skip.add(sessionMessageRefKey(next.operation.request.messageRef));
          blocked += 1;
        }
      }
      return { released, blocked };
    };
    const releaseHandler: QueueHandler = {
      async rebuild() {},
      async drain(scope, input) {
        // The same system actor as the other queue passes (`HOST_RECONCILE_ACTOR`, imported above).
        const pass = await runReleasePass({ ...hostScopeContext(scope, HOST_RECONCILE_ACTOR), signal: input.signal });
        // No `more`: the inner loop above already exhausted this pass's items of every active Goal, so the
        // loop's own rule parks the pair after the wrap and the next wake is a real change (`wake-loop.ts:19–:21`).
        return { progressed: pass.released, more: false, continuation: null, wrapped: true,
          blocked: pass.blocked };
      },
    };
    loop.register(MESSAGE_RELEASE_QUEUE, releaseHandler, { aggregateTypes: MESSAGE_RELEASE_WAKE_AGGREGATE_TYPES });
    // The explicit arm (`book-7a.md:382–:383`): the person's approval, a Goal resume or an explicit advance. A
    // commit notice alone never arms it, which is why `resumeOnStartup: 'off'` is respected (`:383–:384`).
    armMessageRelease = scope => loop.wake(scope, MESSAGE_RELEASE_QUEUE, 'release_armed');
    lifecycleQueue = lifecycle;
  }

  /**
   * Stage one of a project's drivers (§4.4, S7): built once when its runtime opens, over that runtime's platform. A
   * project opened after the settings exist also gets the last settings snapshot here.
   */
  function buildStageOne(runtime: ProjectRuntime): HostProject {
    const { projectId, platform } = runtime;
    const owned = runtime.lease.lease === 'owned';
    // PL §6.4.3: the driver's advance takes the same candidate export path as the public advance.
    const workflowForDriver = { ...platform.workflow,
      advanceWork: async (ctx: CoreCallContext, input: Parameters<typeof platform.workflow.advanceWork>[1],
        internal?: Parameters<typeof platform.workflow.advanceWork>[2]) => {
        const result = await platform.workflow.advanceWork(ctx, input, internal);
        await exportAdvanceResult(platform, ctx, result);
        return result;
      } };
    // L8 (book ruling 2): one automatic-capture driver per project, so at most one capture runs per project (S7),
    // over the platform's observed/catalog ports. Its detached work is the platform's own tracked work, so
    // `platform.close()` waits for exactly the same set.
    const autoCapture = createAutoCaptureDriver({
      architecture: platform.architecture,
      boundWorkspaces: () => workspaces.filter(workspace => workspace.scope.projectId === projectId).map(workspace => ({
        projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId,
      })),
      actor: AUTO_CAPTURE_ACTOR,
      ...(platform.trackDetached === undefined ? {} : { track: platform.trackDetached }),
    });
    // The AG2b collaboration driver over this project's platform. Newly opened scopes append their trusted profiles at
    // runtime.
    const collaborationDriver = createCollaborationDriver({
      workflow: workflowForDriver,
      runtime: platform.runtime,
      sessions: platform.sessions,
      executions: platform.executions,
      mailbox: platform.messages,
      controls: platform.controls,
      profiles: runtimeProfiles.filter(profile => profile.scope.projectId === projectId),
      // The same per-scope registries the goal-waits queue drains: one instance per scope,
      // shared with the adapter, and the project store's head stamped before the fact read (U2).
      goalWaits: goalWaitWakesOf,
      // The one admission drain entry: merge the marked Goals with the marker Queries, order and page.
      drainGoalWaits,
      observedCursor: () => databaseHead(projectId),
      // The one activation owner and the common answer hand-over this Goal-level
      // start runs after the seed is accepted and before the driver starts.
      repairs: platform.repairs,
      redriveRepairAnswers,
      onChange: change => changes.driverChanged(change, databaseHead(projectId)),
      // The Goal interruption is resolved only once a driver actually starts: a same-seed replay never reaches here.
      onStarted: async (ctx, goalRef) => {
        try { await platform.reconcile.recordGoalInterruption?.(ctx, { goalRef, to: 'resumed' }); }
        catch { /* a failed resolve leaves the record pending, so the cause stays visible */ }
      },
    });
    // A.2 step 5.5 (G7): the Goal-control fan-out over the same platform; its
    // commits reach the change feed through the platform's commit observer, and
    // it watches the commits for a fan-out pause a waiting resume follows.
    const goalFanOut = createGoalFanOutDriver({ goals: platform.goals, plans: platform.plans,
      executions: platform.executions, controls: platform.controls, runtime: platform.runtime,
      // GOAL-29 (A.2 step 5.6): the continuation of a fan-out-paused Task goes through the requeue owner.
      claims: { requeueTask: (...args) => platform.claims.requeueTask!(...args) },
      // L-10: only the Host holding the project's lease reaches the Runs.
      driving: () => ownedProject(projectId),
      // The resumed Goal's staged repairs and its approved answer get one retry
      // before the pass reports; neither changes the report.
      repairs: platform.repairs,
      redriveRepairAnswers });
    const lease = runtime.lease;
    const project: HostProject = { projectId, runtime, autoCapture, collaborationDriver, goalFanOut,
      // The project's system-notice bag: the published send/fact/line-detail ports and the same `{records, sessions}`
      // bag the disconnect projection reads.
      hostNotices: { messages: platform.messages, facts: platform.sessionFacts, nodeDetail: platform.nodeDetail,
        disconnect: platform.disconnect },
      // A project opened after the start-up reconcile starts from an empty report (with its lease).
      report: { hostInstanceId: lease.hostInstanceId, lease: lease.lease, leaseRow: lease.row, leaseReason: lease.reason,
        report: owned && reconcileAddedScope !== null ? emptyStartupReport(lease.hostInstanceId) : null } };
    // The platform's formal triggers reach the driver. A Host without the lease writes nothing (HL-02, HL-07), so it
    // never captures.
    if (owned) project.captureTrigger = event => autoCapture.projectChanged(event.projectId, event.kind);
    if (owned && options.requestDriver !== 'off') {
      // The automatic entry after a secretary round: the published Workflow's own two entries.
      project.handoffOwner = platform.workflow.sessionHandoff;
      // The project's Query stage driver: a request round starts under its claimed profile's consumer id, a cold-start
      // exploration round (through the platform's stage port) under the Host's.
      const stageDriver = createQueryStageDriver({
        queries: platform.queries, runtime: platform.runtime, facts: platform.requestFacts,
        fence: platform.readHandoffFence, consumerId: workflowConsumerId,
        ...(markerRoundEnded === undefined ? {} : { onRoundEnded: markerRoundEnded }),
      });
      project.coldStartStages = {
        advance: (ctx, stage) => stageDriver.advance(ctx, stage),
        wake: scope => { wakeLoop.wake(scope, LIFECYCLE_QUEUE, 'advance_settled'); },
      };
      project.requestQueues = createRequestRoundQueues({
        rounds: platform.requestRounds,
        facts: platform.requestFacts,
        sessions: platform.sessionFacts,
        profiles: platform.secretaryProfiles,
        drain: platform.requestIntake.drainUnassigned,
        driver: stageDriver,
        // Every pass runs as the Host's own system actor; the loop's abort signal
        // goes into the context, so closing stops a pass at its next request.
        context: (scope: WorkspaceScope, signal: AbortSignal) =>
          ({ ...hostScopeContext(scope, HOST_RECONCILE_ACTOR), signal }),
        // An advance settling can make the next round of that workspace runnable
        // at once; a `blocked` advance leaves it for the next commit notice, the
        // next request command or a line registration.
        wake: (scope: WorkspaceScope) => { wakeLoop.wake(scope, REQUEST_ROUNDS_QUEUE, 'advance_settled'); },
      });
    }
    if (lastSnapshot !== undefined) installIntoProject(project, lastSnapshot);
    return project;
  }
  /** U4: a project's drivers, built once: stage one when its runtime opens, stage two once the settings exist. */
  function ensureHostProject(runtime: ProjectRuntime): HostProject {
    let project = projects.get(runtime.projectId);
    if (project === undefined) {
      project = buildStageOne(runtime);
      projects.set(runtime.projectId, project);
    }
    if (project.bindings === undefined && settingsReady) buildStageTwo(project);
    return project;
  }

  // Live projections the Host rebuilds for every bootstrap read / settings open.
  // `runtimeProfiles` itself is declared before the platform (the request
  // profile port reads it live through a getter).
  const publishedProfileIds = new Set(runtimeProfiles.map(profile => profile.id));
  const workflowScopes: CoreScope[] = workflow === undefined ? []
    : [...new Map(workflow.bindings.map(binding => [scopeKey(binding.workspace), { ...binding.workspace }])).values()];

  const buildBootstrap = (): BootstrapResponse => {
    const execution: BootstrapExecution = {
      queryProfiles: runtimeProfiles.map(profile => ({
        id: profile.id,
        label: profile.label,
        scope: { projectId: profile.scope.projectId, workspaceId: profile.scope.workspaceId },
        sessionRole: structuredClone(profile.sessionRole),
        roleBinding: structuredClone(profile.roleBinding),
        runtimeBudget: structuredClone(profile.runtimeBudget),
        budget: structuredClone(profile.budget),
        consumerId: profile.consumerId,
      })),
      workflowScopes: workflowScopes.map(scope => ({ ...scope })),
    };
    return {
      workspaces: workspaces.map(workspace => ({
        scope: { projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId },
        name: workspace.name,
        workspaceRevision: workspace.workspaceRevision,
        ...(workspace.writePrefixes === undefined || workspace.writePrefixes.length === 0 ? {} : { writeAllowed: true }),
        ...(workspace.allowCommands === true ? { commandsAllowed: true } : {}),
      })),
      review,
      execution,
    };
  };

  const settingsContext = (scope: CoreScope): CoreCallContext => ({
    projectId: scope.projectId, workspaceId: scope.workspaceId,
    principal: { kind: 'host', actor: { ...actor } },
    materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor: { ...actor } },
    signal: new AbortController().signal,
  });

  const canonicalExisting = async (root: string): Promise<string> => {
    try { return await realpath(root); } catch { return root; }
  };

  /** U5: a workspace's Kernel store goes into its project's Kernel directory (memory: beside the settings), and only
   *  when the platform has none for it yet (an explicit entry or an earlier registration). */
  async function registerKernelStore(runtime: ProjectRuntime, scope: CoreScope): Promise<void> {
    const stores = runtime.platform.kernelStores;
    if (stores.registerCurrent === undefined || stores.forWorkspace(scope) !== null) return;
    const directory = runtime.paths !== null
      ? kernelStoreDirectory(runtime.paths)
      : join(settingsDirectory as string, 'kernel-stores');
    mkdirSync(directory, { recursive: true });
    await stores.registerCurrent(kernelStoreEntry(directory, scope.projectId, scope.workspaceId));
  }

  function builtinQueryProfile(scope: CoreScope, bindingId: string, idPrefix: string, label: string,
    sessionRole: WorkbenchQueryProfile['sessionRole'], roleBinding: WorkbenchQueryProfile['roleBinding'],
    model: HostSettingsStoredModel): WorkbenchQueryProfile {
    return {
      id: `${idPrefix}-${sha256Hex(scopeKey(scope)).slice(0, 16)}`,
      label,
      scope: { projectId: scope.projectId, workspaceId: scope.workspaceId },
      runtimeBindingId: bindingId,
      sessionRole: structuredClone(sessionRole),
      roleBinding: structuredClone(roleBinding),
      runtimeBudget: localWorkbenchBudget(model),
      budget: { maxTokens: null, deadline: null },
      consumerId: workflowConsumerId,
    };
  }

  function localWorkbenchProfile(scope: CoreScope, bindingId: string, model: HostSettingsStoredModel): WorkbenchQueryProfile {
    return builtinQueryProfile(scope, bindingId, 'local-workbench-query', 'Local workbench',
      LOCAL_WORKBENCH_ROLE, LOCAL_WORKBENCH_ROLE_BINDING, model);
  }

  function localSecretaryProfile(scope: CoreScope, bindingId: string, model: HostSettingsStoredModel): WorkbenchQueryProfile {
    return builtinQueryProfile(scope, bindingId, 'local-secretary-query', 'Local secretary',
      platformRoleProfile('secretary').template, localDutyRoleBinding('secretary', LOCAL_SECRETARY_ROLE_BINDING_ID), model);
  }
  function localAdviserProfile(scope: CoreScope, bindingId: string, model: HostSettingsStoredModel): WorkbenchQueryProfile {
    return builtinQueryProfile(scope, bindingId, 'local-adviser-query', 'Local adviser',
      platformRoleProfile('adviser').template, localDutyRoleBinding('adviser', LOCAL_ADVISER_ROLE_BINDING_ID), model);
  }
  function localScribeProfile(scope: CoreScope, bindingId: string, model: HostSettingsStoredModel): WorkbenchQueryProfile {
    return builtinQueryProfile(scope, bindingId, 'local-scribe-query', 'Local scribe',
      platformRoleProfile('scribe').template, localDutyRoleBinding('scribe', LOCAL_SCRIBE_ROLE_BINDING_ID), model);
  }
  function localReviewerProfile(scope: CoreScope, bindingId: string, model: HostSettingsStoredModel): WorkbenchQueryProfile {
    return builtinQueryProfile(scope, bindingId, 'local-reviewer-query', 'Local reviewer',
      platformRoleProfile('reviewer').template, localDutyRoleBinding('reviewer', LOCAL_REVIEWER_ROLE_BINDING_ID), model);
  }

  function settingsModelBinding(model: HostSettingsStoredModel): WorkbenchModelConfiguration {
    const variable = typeof model.apiKey === 'string' && model.apiKey.length > 0
      ? settingsModelSecretVariable(model.id)
      : (model.secretEnvironmentVariable ?? settingsModelSecretVariable(model.id));
    const original = startupCatalogOptions.get(model.id);
    const restored = original !== undefined && original.provider === model.provider ? original : undefined;
    const options: Record<string, JsonValue> = restored === undefined ? {} : structuredClone(restored.options);
    if (model.thinking !== undefined) options['thinking'] = model.thinking;
    if (model.reasoningEffort !== undefined) options['reasoningEffort'] = model.reasoningEffort;
    return {
      revision: `host-settings:${model.id}`,
      modelId: model.id,
      provider: model.provider,
      model: model.model,
      ...(model.baseUrl === undefined || model.baseUrl.length === 0 ? {} : { baseUrl: model.baseUrl }),
      ...(Object.keys(options).length === 0 ? {} : { options }),
      // Ruling 7: the stored model is the only source of these two; a save that
      // omitted them already cleared them, so the startup catalog never wins.
      ...(model.promptPack === undefined ? {} : { promptPack: model.promptPack }),
      ...(model.reasoningReplay === undefined ? {} : { reasoningReplay: model.reasoningReplay }),
      secretEnvironmentVariable: variable,
    };
  }

  function buildRuntimeConfiguration(snapshot: HostSettingsPrivateSnapshot): WorkbenchRuntimeConfiguration {
    // Start from the ORIGINAL trusted configuration so every startup binding and
    // profile (a scope may legitimately carry a Work and a Query binding) keeps
    // its id, role, grant and profile. A workspace-level model selection only
    // replaces the model of that scope's existing bindings; it never adds a
    // binding, widens a grant or changes another workspace.
    const base: WorkbenchRuntimeConfiguration = runtimeConfiguration
      ?? { schemaVersion: 1, bindings: [], queryProfiles: [] };
    const nextBindings: WorkbenchRuntimeBinding[] = base.bindings.map(binding => {
      const selectedId = snapshot.selection[scopeKey(binding.scope)] ?? null;
      const selected = selectedId === null ? undefined : snapshot.models.find(entry => entry.id === selectedId);
      // The grant is ALWAYS the original startup grant; a model save never
      // widens any workspace.
      return selected === undefined
        ? structuredClone(binding)
        : { ...structuredClone(binding), model: settingsModelBinding(selected) };
    });
    const nextProfiles: WorkbenchQueryProfile[] = base.queryProfiles.map(profile => structuredClone(profile));
    // A newly opened scope gets the builtin local-workbench binding/profile only
    // once a model is selected for it.
    for (const workspace of workspaces) {
      const key = scopeKey(workspace.scope);
      if (startupBindingsByScope.has(key)) continue;
      const selectedId = snapshot.selection[key] ?? null;
      const selected = selectedId === null ? undefined : snapshot.models.find(entry => entry.id === selectedId);
      if (selected === undefined) continue;
      const bindingId = `local-workbench-binding-${sha256Hex(key).slice(0, 16)}`;
      const grant = localWorkbenchGrant(workspace, selected);
      const boundModel = settingsModelBinding(selected);
      nextBindings.push({
        id: bindingId,
        label: 'Local workbench',
        scope: { projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId },
        role: structuredClone(LOCAL_WORKBENCH_ROLE),
        configurationRevision: localBindingRevision('local-workbench', workspace.scope, grant, boundModel),
        model: boundModel,
        grant,
      });
      // After the local profile, the same directory also publishes a secretary
      // profile, so a request written there finds a secretary binding while the
      // local profile stays first for every caller that takes one profile.
      const secretaryBindingId = `local-secretary-binding-${sha256Hex(key).slice(0, 16)}`;
      const secretaryGrant = localDutyGrant(grant, 'secretary', LOCAL_SECRETARY_TOOL_NAMES);
      nextBindings.push({
        id: secretaryBindingId,
        label: 'Local secretary',
        scope: { projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId },
        role: platformRoleProfile('secretary').template,
        configurationRevision: localBindingRevision('local-secretary', workspace.scope, secretaryGrant, boundModel),
        model: boundModel,
        grant: secretaryGrant,
      });
      nextProfiles.push(localWorkbenchProfile(workspace.scope, bindingId, selected));
      nextProfiles.push(localSecretaryProfile(workspace.scope, secretaryBindingId, selected));
      // After the secretary, the same directory publishes the built-in adviser, scribe and reviewer (book §3.8
      // item 6; O5b ruling 5), so a role line of any of them opened there finds its binding; the local profile
      // stays first.
      for (const [duty, label, tools, profileOf] of [
        ['adviser', 'Local adviser', LOCAL_ADVISER_TOOL_NAMES, localAdviserProfile],
        ['scribe', 'Local scribe', LOCAL_SCRIBE_TOOL_NAMES, localScribeProfile],
        ['reviewer', 'Local reviewer', LOCAL_REVIEWER_TOOL_NAMES, localReviewerProfile],
      ] as const) {
        const dutyBindingId = `local-${duty}-binding-${sha256Hex(key).slice(0, 16)}`;
        const dutyGrant = localDutyGrant(grant, duty, tools);
        nextBindings.push({
          id: dutyBindingId,
          label,
          scope: { projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId },
          role: platformRoleProfile(duty).template,
          configurationRevision: localBindingRevision(`local-${duty}`, workspace.scope, dutyGrant, boundModel),
          model: boundModel,
          grant: dutyGrant,
        });
        nextProfiles.push(profileOf(workspace.scope, dutyBindingId, selected));
      }
    }
    // slice-K2-SPEC: the startup compaction ratios are not a setting; every rebuilt version keeps them.
    return { schemaVersion: 1, bindings: nextBindings, queryProfiles: nextProfiles,
      ...(base.compaction === undefined ? {} : { compaction: structuredClone(base.compaction) }) };
  }

  /** The one trusted checks configuration of a saved or adopted source: its revision is a function of the exact
   *  checks AND their saved-Answer digest, so a re-approval of other content or source is a new version. The settings
   *  restore and the adoption's checks stage both build through it. */
  const buildCheckConfiguration: ChecksAdoptionHostCallbacks['buildConfiguration'] = input => {
    const workspace = workspaces.find(candidate => scopeKey(candidate.scope) === scopeKey(input.scope));
    if (workspace === undefined) throw new Error('the checks scope has no workspace');
    return {
      configurationRevision: `host-settings-checks:${sha256Hex(canonicalJson({
        answerDigest: input.source.answerDigest, checks: input.checks,
      } as unknown as JsonValue)).slice(0, 16)}`,
      workspace: { aggregateType: 'Workspace', projectId: input.scope.projectId, workspaceId: input.scope.workspaceId },
      executor: { ...actor },
      permissionRevision: permissionRevision(actor, workspace),
      sourceAccess: 'verification_workspace',
      processAccess: 'all_except_denied',
      deniedPrefixes: ['.git'],
      checks: structuredClone([...input.checks]),
    };
  };

  /** The last settings snapshot this Host installed: a project opened later gets it when its drivers are built. */
  let lastSnapshot: HostSettingsPrivateSnapshot | undefined;
  /** The parts of a settings snapshot that live in one project's platform. */
  const installIntoProject = (project: HostProject, snapshot: HostSettingsPrivateSnapshot): void => {
    const platform = project.runtime.platform;
    // C8 (A.2 step 5.6): the Host setting `automation` (defaults 3 / ask) governs the
    // requeue owner, the read model and the start-up re-drive (`resumeOnStartup`).
    platform.registerAutomationPolicy(snapshot.automation);
    // The platform's Workflow configuration reads the binding live, so
    // re-registering each scope with the current budget makes the next Work Run
    // use it without a restart; an already claimed Run keeps the budget in its own
    // record. An existing binding keeps its role and deadline; a scope with no
    // startup binding uses the local workbench role and no deadline.
    for (const scope of workflowScopes) {
      if (scope.projectId !== project.projectId) continue;
      const original = workflow?.bindings.find(binding => scopeKey(binding.workspace) === scopeKey(scope));
      platform.registerWorkflowBinding({
        consumerId: workflowConsumerId,
        binding: original === undefined ? {
          workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId },
          sessionRole: structuredClone(LOCAL_WORKBENCH_ROLE),
          roleBinding: structuredClone(LOCAL_WORKBENCH_ROLE_BINDING),
          budget: { tokenBudget: workRunTokenBudget, deadline: null },
        } : { ...original, budget: { ...original.budget, tokenBudget: workRunTokenBudget } },
      });
    }
    // R6 cold-start: restore/refresh the trusted check configuration for every
    // scope whose saved checks were explicitly approved. It replaces only the
    // per-scope registration; an already-open round keeps its frozen config.
    // An approved empty array installs too: it replaces the old configuration
    // and the static fallback (AM1 A3).
    for (const entry of snapshot.checks) {
      if (entry.scope.projectId !== project.projectId
        || !workspaces.some(candidate => scopeKey(candidate.scope) === scopeKey(entry.scope))) continue;
      platform.registerCheckConfiguration({ configuration: buildCheckConfiguration({ scope: entry.scope,
        source: { answerRef: entry.answerRef, answerDigest: entry.answerDigest }, checks: entry.checks }) });
    }
  };

  const installFromSettings = (snapshot: HostSettingsPrivateSnapshot): void => {
    lastSnapshot = snapshot;
    // L13: install the effective resource-cap values into the ONE holder. The
    // already-built platform, Runtime and workbench page read `current()` live,
    // so the next command of an already-running execution uses the new values.
    resourceCapsRequest = { memoryMaxBytes: snapshot.resourceCaps.memoryMaxBytes, tasksMax: snapshot.resourceCaps.tasksMax };
    // PL §10.3: the same one holder for the plan-loop limits; the reader's getter
    // already points at it, so this push reaches the next judgment.
    planLoopLimits = structuredClone(snapshot.planLoopLimits ?? DEFAULT_PLAN_LOOP_LIMITS);
    // The Work Run token budget is installed here, on the first settings push and
    // every later one, before each project registers its scopes' bindings with it.
    workRunTokenBudget = snapshot.workRunTokenBudget;
    for (const project of projects.values()) installIntoProject(project, snapshot);
    if (!rebuildRuntimeFromSettings || resolverRegistry === undefined) return;
    const configuration = buildRuntimeConfiguration(snapshot);
    const installed = createWorkbenchRuntimeHostBindings(configuration,
      versionProvider(versionSecretSource(configuration, snapshot)), runtimeNarrowing);
    resolverRegistry.install(installed);
    // Only a SUCCESSFUL install publishes executable profiles: the live
    // bootstrap projection becomes exactly the installed configuration's
    // queryProfiles (every startup profile is preserved). A newly selected
    // workspace joins the collaboration driver only now, after the binding
    // exists; an already-running handle keeps its pinned version.
    const nextProfiles = configuration.queryProfiles.map(profile => structuredClone(profile));
    const added = nextProfiles.filter(profile => !publishedProfileIds.has(profile.id));
    runtimeProfiles.splice(0, runtimeProfiles.length, ...nextProfiles);
    for (const profile of added) publishedProfileIds.add(profile.id);
    for (const project of projects.values()) {
      const own = added.filter(profile => profile.scope.projectId === project.projectId);
      if (own.length > 0) project.collaborationDriver.addProfiles(own);
    }
  };

  /** Project the trusted startup runtime configuration into the settings model
   * catalog and per-scope selection WITHOUT copying any resolved key: only the
   * environment-variable NAMES are preserved. A scope whose bindings all share
   * one model gets that modelId; an inconsistent scope stays null so its
   * original per-role configuration is kept until the user selects one. */
  function projectSettingsCatalog(configuration: WorkbenchRuntimeConfiguration | undefined): {
    models: HostSettingsModelDefinition[];
    seedSelection: Record<string, string | null>;
  } {
    if (configuration === undefined) return { models: [], seedSelection: {} };
    const modelsById = new Map<string, HostSettingsModelDefinition>();
    const idsByScope = new Map<string, Set<string>>();
    for (const binding of configuration.bindings) {
      const provider = binding.model.provider;
      if (provider !== 'deepseek' && provider !== 'openai') continue;
      const baseUrl = binding.model.baseUrl !== undefined && validateSettingsBaseUrl(binding.model.baseUrl) === null
        ? binding.model.baseUrl : undefined;
      const secretEnvironmentVariable = providerSecretName(binding.model);
      const id = runtimeModelId({
        provider,
        model: binding.model.model,
        ...(baseUrl === undefined ? {} : { baseUrl }),
        secretEnvironmentVariable,
        ...(binding.model.options === undefined ? {} : { options: binding.model.options }),
        ...(binding.model.promptPack === undefined ? {} : { promptPack: binding.model.promptPack }),
        ...(binding.model.reasoningReplay === undefined ? {} : { reasoningReplay: binding.model.reasoningReplay }),
      });
      startupCatalogOptions.set(id, {
        provider,
        options: structuredClone(binding.model.options ?? {}),
      });
      if (!modelsById.has(id)) {
        modelsById.set(id, {
          id, label: `${provider} ${binding.model.model}`, provider, model: binding.model.model,
          ...(baseUrl === undefined ? {} : { baseUrl }),
          secretEnvironmentVariable,
          ...(binding.model.promptPack === undefined ? {} : { promptPack: binding.model.promptPack }),
          ...(binding.model.reasoningReplay === undefined ? {} : { reasoningReplay: binding.model.reasoningReplay }),
          ...(binding.model.options?.['thinking'] === 'enabled' || binding.model.options?.['thinking'] === 'disabled'
            ? { thinking: binding.model.options['thinking'] } : {}),
          ...(binding.model.options?.['reasoningEffort'] === 'low' || binding.model.options?.['reasoningEffort'] === 'high' || binding.model.options?.['reasoningEffort'] === 'max'
            ? { reasoningEffort: binding.model.options['reasoningEffort'] } : {}),
        });
      }
      const key = scopeKey(binding.scope);
      const set = idsByScope.get(key) ?? new Set<string>();
      set.add(id);
      idsByScope.set(key, set);
    }
    const seedSelection: Record<string, string | null> = {};
    for (const [key, ids] of idsByScope) seedSelection[key] = ids.size === 1 ? ([...ids][0] ?? null) : null;
    return { models: [...modelsById.values()], seedSelection };
  }

  /**
   * A.2 step 5.6 (§12.1): set once the start-up reconcile ran; a workspace opened later is reconciled
   * by it before `addWorkspaceState` returns. The workspaces restored before the start-up reconcile
   * are part of that reconcile.
   */
  let reconcileAddedScope: ((scope: CoreScope) => Promise<void>) | null = null;
  async function addWorkspaceState(runtime: ProjectRuntime, config: WorkbenchWorkspaceConfig): Promise<void> {
    const key = scopeKey(config.scope);
    if (byScope.has(key)) return;
    workspaces.push(config);
    byScope.set(key, config);
    ensureKnowledgeDirectory(config.root);
    knowledgeRepoKeys.set(key, await checkoutKeyOf(config.root));
    workbenchTools.addWorkspace({
      scope: config.scope, root: config.root, readPrefixes: config.readPrefixes,
      ...(config.writePrefixes === undefined ? {} : { writePrefixes: config.writePrefixes }),
      ...(config.allowCommands === undefined ? {} : { allowCommands: config.allowCommands }),
    });
    await registerKernelStore(runtime, config.scope);
    // A newly opened workspace publishes NO executable profile here: until a
    // model is selected and the settings install succeeds there is no installed
    // runtime binding for this scope. The workflow binding below is role/grant
    // metadata, not a model binding, and stays.
    runtime.platform.registerWorkflowBinding({
      consumerId: workflowConsumerId,
      binding: {
        workspace: { projectId: config.scope.projectId, workspaceId: config.scope.workspaceId },
        sessionRole: structuredClone(LOCAL_WORKBENCH_ROLE),
        roleBinding: structuredClone(LOCAL_WORKBENCH_ROLE_BINDING),
        // A Work reuses the investigation/planning Session. Its cumulative
        // budget must admit that normal history before the first model call.
        budget: { tokenBudget: workRunTokenBudget, deadline: null },
      },
    });
    workflowScopes.push({ projectId: config.scope.projectId, workspaceId: config.scope.workspaceId });
    goalWaitRegistries.push({ scope: config.scope, waits: createGoalWaitWakes() });
    if (reconcileAddedScope !== null) await reconcileAddedScope(config.scope);
    // A workspace opened later joins the request driver only after its
    // reconcile, in the same order the start takes, so the reconcile's own
    // commits wake nothing; its rounds then stand where the records leave them.
    // Only a workspace of a project this Host holds the lease of joins the loop.
    if (runtime.lease.lease === 'owned') {
      await wakeLoop.addWorkspace({ projectId: config.scope.projectId, workspaceId: config.scope.workspaceId });
    }
  }

  async function openWorkspaceImpl(request: OpenSettingsWorkspace & { workspaceId?: string }): Promise<SettingsResponse<HostSettingsOpenedHost>> {
    const requestedProjectId = request.projectId;
    const isRestore = request.workspaceId !== undefined;
    // A listed workspace whose project store could not be opened has no runtime here. A root that no longer resolves
    // is kept as the listed scope without a proof; one that still resolves is still checked against the prompt
    // directory, so a covering root cannot be admitted through an unavailable project.
    const unavailableRestore = isRestore && requestedProjectId !== undefined && registry.get(requestedProjectId) === null;
    let canonical: string;
    if (unavailableRestore) {
      canonical = request.path;
      try {
        const resolved = await realpath(request.path);
        if (promptsRoot !== undefined && isPathWithin(resolved, promptsRoot)) {
          return { status: 'rejected', code: 'invalid',
            reason: `the workspace root ${resolved} would cover the prompt directory ${promptsRoot}` };
        }
      } catch { /* a missing root has no proof to make; the scope-only branch below keeps it */ }
    } else {
      try {
        const resolved = await realpath(request.path);
        const info = await stat(resolved);
        if (!info.isDirectory()) throw new Error('not a directory');
        canonical = resolved;
      } catch {
        return { status: 'rejected', code: 'not_found', reason: 'the requested directory does not exist or is not a directory' };
      }
      // a new root may not equal or cover the prompt directory;
      // this runs before the existing-root shortcut and any registration.
      if (promptsRoot !== undefined && isPathWithin(canonical, promptsRoot)) {
        return { status: 'rejected', code: 'invalid',
          reason: `the workspace root ${canonical} would cover the prompt directory ${promptsRoot}` };
      }
    }
    // A PUBLIC explicit projectId must be a CURRENT Host project. The private
    // restore path (identified only by the internal `workspaceId` parameter,
    // which the HTTP route never carries) may re-attach an original ledger
    // record the Host has not rebound yet.
    if (requestedProjectId !== undefined && !isRestore
      && !workspaces.some(workspace => workspace.scope.projectId === requestedProjectId))
      return { status: 'rejected', code: 'invalid', reason: 'the target project is not a Host project' };
    // Idempotent lookup by canonical root: without an explicit project search
    // every current workspace; with one search only that project. A root that no
    // longer resolves compares by its listed path, so a repeated entry still
    // returns the scope it already has.
    for (const workspace of workspaces) {
      if (requestedProjectId !== undefined && workspace.scope.projectId !== requestedProjectId) continue;
      if (await canonicalExisting(workspace.root) === canonical)
        return { status: 'ready', value: { scope: { ...workspace.scope } } };
    }
    // R6 [2C2-10]: a root another project already has is joined, never copied: the projects share its `.workbench/`,
    // and this one reads that line's notes as needing verification. A restore is no join (it joined when first opened).
    let sharedWith = false;
    if (requestedProjectId !== undefined && !isRestore) {
      for (const workspace of workspaces) {
        if (workspace.scope.projectId !== requestedProjectId && await canonicalExisting(workspace.root) === canonical) {
          sharedWith = true;
          break;
        }
      }
    }
    const projectId = requestedProjectId ?? randomBytes(16).toString('hex');
    const workspaceId = request.workspaceId ?? randomBytes(16).toString('hex');
    const scope: CoreScope = { projectId, workspaceId };
    // U4: a new project opens its own runtime, and its drivers and route bindings, before its records are written;
    // a workspace of an existing project uses that project's open runtime.
    let runtime: ProjectRuntime | null;
    if (requestedProjectId === undefined) {
      const opened = await registry.open(projectId, [{ workspaceId, root: canonical }], { create: true });
      if (opened.status !== 'ready') return { status: 'rejected', code: 'unavailable', reason: 'the project store could not be opened' };
      // The close snapshot was taken before this open was accepted; a project that finished opening after the
      // closing signal keeps no drivers or bindings, and `registry.closeAll()` closes the runtime it registered.
      if (hostClosing.signal.aborted)
        return { status: 'rejected', code: 'unavailable', reason: 'the project store is not available' };
      runtime = opened.value;
      ensureHostProject(runtime);
    } else {
      runtime = registry.get(projectId);
    }
    if (runtime === null) {
      if (!isRestore) return { status: 'rejected', code: 'unavailable', reason: 'the project store is not available' };
      // A listed workspace of a project whose store is not available: only its scope is known here, so the restore
      // goes on and every request of it answers `unavailable`; no tool, Kernel store or loop entry is registered.
      // A scope already present from a start-up workspace keeps its one entry.
      if (!byScope.has(scopeKey(scope))) {
        const config: WorkbenchWorkspaceConfig = { scope, name: request.name ?? basename(canonical), root: canonical,
          workspaceRevision: 0, readPrefixes: ['.'], ...(request.writeAllowed ? { writePrefixes: ['.'] } : {}),
          ...(request.commandsAllowed && request.writeAllowed ? { allowCommands: true } : {}) };
        workspaces.push(config);
        byScope.set(scopeKey(scope), config);
      }
      return { status: 'ready', value: { scope: { ...scope } } };
    }
    const platform = runtime.platform;
    const ctx = settingsContext(scope);
    try {
      let projectRevision: number;
      if (requestedProjectId === undefined) {
        const created = await platform.projects.createProject(ctx, {
          input: { projectId },
          meta: { requestId: `host-settings-project:${projectId}`,
            expected: [{ ref: { aggregateType: 'Project', projectId }, revision: 0 }] },
        });
        if (created.status !== 'committed') return { status: 'rejected', code: 'unavailable', reason: 'the project could not be registered' };
        projectRevision = created.value.revision;
      } else {
        const projectRead = await platform.projects.readProject?.(ctx, projectId);
        if (projectRead === undefined || projectRead.status !== 'ready')
          return { status: 'rejected', code: 'invalid', reason: 'the target project is not registered' };
        projectRevision = projectRead.value.revision;
      }
      const existingRegistration = await platform.projects.readWorkspaceRegistration(ctx, scope);
      // L8 (book ruling 1): only a registration THIS call wrote triggers a
      // capture. A start-up restore finds the existing registration ready and
      // is handled by `retryPending` alone.
      let registeredNow = false;
      if (existingRegistration.status !== 'ready') {
        const registered = await platform.projects.registerWorkspace(ctx, {
          input: { workspace: scope },
          meta: { requestId: `host-settings-workspace:${workspaceId}`, expected: [
            { ref: { aggregateType: 'Project', projectId }, revision: projectRevision },
            { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 0 },
          ] },
        });
        if (registered.status !== 'committed') return { status: 'rejected', code: 'unavailable', reason: 'the workspace could not be registered' };
        registeredNow = !registered.replayed;
      }
      const registration = await platform.projects.readWorkspaceRegistration(ctx, scope);
      const workspaceRevision = registration.status === 'ready' ? registration.value.workspace.revision : 0;
      await addWorkspaceState(runtime, {
        scope,
        name: request.name ?? basename(canonical),
        root: canonical,
        workspaceRevision,
        readPrefixes: ['.'],
        ...(request.writeAllowed ? { writePrefixes: ['.'] } : {}),
        ...(request.commandsAllowed && request.writeAllowed ? { allowCommands: true } : {}),
      });
      // L8: the settings path's registration step, after the root is bound,
      // and only when this call performed a non-replayed registration.
      if (registeredNow) captureWorkspaceRegistration(scope);
      // R6 [2C2-10]: the shared files into this project's index, then its notes marked; neither changes the open.
      if (sharedWith) {
        try { await platform.knowledge.reconcile(ctx, workspaceId, 'joined'); } catch { /* the next round indexes */ }
        try { await platform.knowledge.markJoinedCheckout(ctx, workspaceId); } catch { /* the open stands */ }
      }
      return { status: 'ready', value: { scope: { ...scope } } };
    } catch {
      return { status: 'rejected', code: 'unavailable', reason: 'the workspace could not be opened' };
    }
  }

  /**
   * R6 cold-start: the saved Answer is model output, so its suggested checks
   * are re-validated structurally before they can become a trusted
   * configuration. A malformed candidate is an explicit failure, never a
   * silently trusted check.
   */
  function validProposalCheck(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const check = value as Record<string, unknown>;
    return typeof check.checkId === 'string' && check.checkId.length > 0
      && !isPlatformReservedCheckId(check.checkId)
      && (check.kind === 'static' || check.kind === 'dynamic')
      && typeof check.command === 'string' && check.command.length > 0
      && typeof check.cwd === 'string'
      && typeof check.timeoutMs === 'number' && Number.isSafeInteger(check.timeoutMs) && check.timeoutMs > 0
      && (check.taskIds === 'all'
        || (Array.isArray(check.taskIds) && check.taskIds.every(id => typeof id === 'string' && id.length > 0)));
  }

  const storeLocationOf = (projectId: string): { place: 'git-common' | 'workspace-local' | 'user-data';
    reason: string | null } | null => {
    const location = registry.get(projectId)?.storeLocation ?? null;
    return location === null ? null : { place: location.place, reason: location.reason };
  };
  const hostAssembly: HostSettingsAssembly = {
    listWorkspaces: () => workspaces.map(workspace => ({
      scope: { projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId },
      name: workspace.name,
      root: workspace.root,
      workspaceRevision: workspace.workspaceRevision,
      modelId: null,
      writeAllowed: (workspace.writePrefixes?.length ?? 0) > 0,
      commandsAllowed: workspace.allowCommands === true,
      // U8: where the workspace's project store lives (no directory); a memory store or a project not open has none.
      storeLocation: storeLocationOf(workspace.scope.projectId),
      knowledgeRepoKey: knowledgeRepoKeys.get(scopeKey(workspace.scope)) ?? null,
    })),
    // KLS-2: the checkout through the one line resolution (the workspace must be the project's); the key the snapshot
    // reads is refreshed with it, so a folder made a git repository after it opened reads right from here on.
    knowledgeCheckout: async scope => {
      const main = mainWorkspaces.get(scope.projectId);
      const resolved = await resolveKnowledgeLine({ resolveRoot: projectBindings(scope.projectId).resolveRoot,
        workspacesOf: projectId => main === undefined ? [] : knowledgeWorkspacesOf(projectId, main) }, scope, scope.workspaceId);
      // The one line resolution answers only `unavailable`.
      if (resolved.status !== 'ready') return { status: 'rejected', code: 'unavailable', reason: resolved.reason };
      // A folder gone since the resolution throws here; the route answers that as `unavailable`.
      const probe = await identifyCheckout(resolved.value.line.folder);
      const repoKey = probe.kind === 'git' ? probe.repoKey : null;
      knowledgeRepoKeys.set(scopeKey(scope), repoKey);
      return { status: 'ready', value: repoKey === null ? { notGit: true } : { repoKey } };
    },
    readCheckProposal: async (scope, answerRef) => {
      if (answerRef.projectId !== scope.projectId || answerRef.workspaceId !== scope.workspaceId) {
        return { status: 'rejected', code: 'not_found', reason: 'the saved Answer is outside this workspace scope' };
      }
      const platform = platformFor(scope.projectId);
      if (platform === null) return { status: 'rejected', code: 'unavailable', reason: 'the project store is not available' };
      const answer = await platform.queries.readQueryAnswer(settingsContext(scope), answerRef);
      if (answer.status !== 'ready') {
        return answer.status === 'not_found'
          ? { status: 'rejected', code: 'not_found', reason: 'the saved initial-plan Answer was not found in this scope' }
          : { status: 'rejected', code: 'unavailable', reason: 'the saved initial-plan Answer could not be read' };
      }
      const parsed = parseInitialPlanningResponseV2(answer.value.answer.answer);
      if (parsed.status !== 'parsed' || parsed.response.kind !== 'plan' || parsed.response.setup === undefined) {
        return { status: 'rejected', code: 'not_found', reason: 'the saved Answer carries no initial-plan setup proposal' };
      }
      const checks = parsed.response.setup.checks;
      if (!Array.isArray(checks) || !checks.every(validProposalCheck)) {
        return { status: 'rejected', code: 'invalid', reason: 'the saved Answer setup checks are malformed' };
      }
      return { status: 'ready', value: {
        answerRef: structuredClone(answerRef),
        answerDigest: sha256Hex(answer.value.answer.answer),
        checks: structuredClone(checks),
      } };
    },
    openWorkspace: openWorkspaceImpl,
    bootstrap: buildBootstrap,
    secretConfigured: (name: string): boolean => {
      try {
        const value = baseSecretSource.get(name);
        return typeof value === 'string' && value.length > 0;
      } catch { return false; }
    },
    // L13: the settings page's machine status reads the Kernel cache directly;
    // it never starts a probe. `main.ts` warms the cache in the background.
    resourceCapStatus: () => resourceCapStatus(),
  };

  // §4.2: the start opens every declared project: the project list (`host-settings.json`, in file order) and then the
  // start-up workspaces not on it, grouped by project; a project's first workspace is its main one. A project with no
  // listed workspace is declared by the person now and may be created (U3); a listed one whose store is missing stays
  // unavailable and is never rebuilt. The old single-store layout stops the start (U6). A store directory not on the
  // list is never opened or scanned.
  const manifest = settingsEnabled ? await readPersistedWorkspaces(settingsDirectory as string) : [];
  const declared = new Map<string, { inManifest: boolean; workspaces: ProjectRuntimeWorkspace[] }>();
  for (const [scope, root, listed] of [
    ...manifest.map(entry => [entry.scope, entry.root, true] as const),
    ...workspaces.map(workspace => [workspace.scope, workspace.root, false] as const),
  ]) {
    const project = declared.get(scope.projectId) ?? { inManifest: false, workspaces: [] };
    if (listed) project.inManifest = true;
    if (!project.workspaces.some(entry => entry.workspaceId === scope.workspaceId)) {
      project.workspaces.push({ workspaceId: scope.workspaceId, root });
    }
    declared.set(scope.projectId, project);
  }
  for (const [projectId, project] of declared) {
    const opened = await registry.open(projectId, project.workspaces, { create: !project.inManifest });
    if (opened.status === 'rejected' && opened.code === 'unsupported') {
      await registry.closeAll();
      throw new Error(opened.reason);
    }
    if (opened.status === 'ready') ensureHostProject(opened.value);
  }
  // V12: a start-up workspace not on the list joins it once its project opened and holds its Project record; the
  // next start then opens that project from the list.
  const declareWorkspaces = [];
  for (const workspace of settingsEnabled ? workspaces : []) {
    if (manifest.some(entry => scopeKey(entry.scope) === scopeKey(workspace.scope))) continue;
    const platform = platformFor(workspace.scope.projectId);
    if (platform === null) continue;
    const read = await platform.projects.readProject?.(settingsContext(workspace.scope), workspace.scope.projectId);
    if (read?.status !== 'ready') continue;
    declareWorkspaces.push({ scope: { ...workspace.scope }, name: workspace.name, root: workspace.root,
      writeAllowed: (workspace.writePrefixes?.length ?? 0) > 0, commandsAllowed: workspace.allowCommands === true });
  }

  // The awaited startup restore of every persisted directory registration
  // happens here, before the server exists and before `listen`.
  const settingsCatalog = settingsEnabled
    ? projectSettingsCatalog(runtimeConfiguration)
    : { models: [] as HostSettingsModelDefinition[], seedSelection: {} as Record<string, string | null> };
  const hostSettings: (HostSettingsPort & ChecksAdoptionEntryPort) | undefined = settingsEnabled
    ? await createHostSettings({
      settingsDirectory: settingsDirectory as string,
      ...(promptsRoot === undefined ? {} : { promptsRoot }),
      models: [
        ...settingsCatalog.models,
        ...((options.settings?.models ?? []).map(model => structuredClone(model))),
      ],
      seedSelection: settingsCatalog.seedSelection,
      declareWorkspaces,
      assembly: hostAssembly,
    }, {
      onConfigurationChanged: installFromSettings,
      adoption: { buildConfiguration: buildCheckConfiguration,
        confirmInstalledChecks: (ctx, input) => projectPlatform(ctx.projectId).confirmInstalledChecks(ctx, input) },
    })
    : undefined;
  // Every open project's stage two (its route bindings) now that the settings exist; a project opened later builds
  // both stages at once.
  settingsReady = true;
  for (const project of projects.values()) buildStageTwo(project);

  // A.2 step 5.6 (§12.1 steps 1..7): the start-up reconcile, on the Host holding the instance lease only,
  // after the settings restore registered every workspace's Kernel Store and installed the automation
  // policy, and before any execution driver, the attention delivery or the HTTP server starts.
  // The reconcile writes as the Host's own system actor (R source, §12.1; VR-04 "Host system actor +
  // hostInstanceId"); the start-up re-drive starts the driver as `workflow/driver-start` does, as the Host actor.
  function hostScopeContext(scope: CoreScope, as: WorkbenchActor): CoreCallContext {
    return {
      projectId: scope.projectId, workspaceId: scope.workspaceId,
      principal: { kind: 'host', actor: { ...as } },
      materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor: { ...as } },
      signal: new AbortController().signal,
    };
  }
  const reconcileContext = (scope: CoreScope): CoreCallContext => hostScopeContext(scope, HOST_RECONCILE_ACTOR);
  /** The workspaces of the projects this Host holds the lease of (U1), in start order. */
  const ownedScopes = (): CoreScope[] => workspaces.filter(workspace => ownedProject(workspace.scope.projectId))
    .map(workspace => ({ projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId }));
  // KLS-2c [2C1-24]: every served workspace's knowledge is reconciled before any start-up step that may write
  // knowledge (the Run start-up reconcile's repair activations, the redrive), so a write a crash left pending is
  // seen before a newer write changes its file. A failure does not stop the start; the next idle round comes again.
  for (const scope of ownedScopes()) {
    try { await projectPlatform(scope.projectId).knowledge.reconcile(reconcileContext(scope), scope.workspaceId, 'startup'); }
    catch { /* the next idle round reconciles */ }
  }
  // Slice 2B L7: with its project's lease, every served workspace records its
  // start-of-recording epoch BEFORE the start-up reconcile, so a Run that ends
  // after this instant and has no tally reads `not_recorded` (an error) rather
  // than an old `not_backfilled` one. A Host without the lease writes nothing.
  for (const scope of ownedScopes()) {
    const recorded = await projectPlatform(scope.projectId).runActivity.ensureActivityRecording(
      hostScopeContext(scope, actor), {
        input: { workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId } },
        meta: { requestId: `host-activity-recording:${scopeKey(scope)}`, expected: [] },
      });
    if (recorded.status !== 'committed') {
      throw new Error(`the start-of-recording write failed: ${JSON.stringify(recorded)}`);
    }
  }
  // The reconcile still runs scope by scope (R4); each scope takes its project's platform, lease facts and drivers
  // (U1), and a scope of a project not open or held by another Host is skipped. One report per project.
  const reconcileScopes = (scopes: readonly CoreScope[]) => runStartupReconcile({
    scopes: scopes.map(scope => ({ projectId: scope.projectId, workspaceId: scope.workspaceId })),
    context: reconcileContext,
    forScope: scope => {
      const project = projects.get(scope.projectId);
      if (project === undefined || project.runtime.lease.lease !== 'owned') return null;
      const { platform, lease } = project.runtime;
      return {
        platform: { sessions: platform.sessions, executions: platform.executions, controls: platform.controls,
          plans: platform.plans, reconcile: platform.reconcile,
          repairs: platform.repairs, redriveRepairAnswers },
        hostInstanceId: lease.hostInstanceId,
        resumeOnStartup: platform.automationPolicy().resumeOnStartup,
        takeover: lease.takeover,
        members: platform.memberCreations,
        fanOut: (ctx, goalRef, options) => project.goalFanOut.fanOut(ctx, goalRef, options),
        wakeRounds: async target => { await drainGoalWaits(target); },
        ...(lifecycleQueue === undefined ? {} : { handoffQueue: lifecycleQueue }),
      };
    },
  });
  const startupReports = await reconcileScopes(workspaces.map(workspace => workspace.scope));
  for (const project of projects.values()) {
    const report = startupReports.get(project.projectId);
    if (report !== undefined) project.report.report = report;
  }
  // L8 (book ruling 5): after the workspaces are bound (settings restore included)
  // every pending bound workspace gets a `startup_retry`; detached, and a pending
  // workspace not bound in this Host is simply not passed here. Like the start-up
  // re-drive below it needs the project's lease and `automation.resumeOnStartup`: only `'off'`
  // stops the retry, as a start then only reconciles (§12.10 step 5) and the next trigger retries.
  for (const project of projects.values()) {
    if (project.runtime.lease.lease !== 'owned'
      || project.runtime.platform.automationPolicy().resumeOnStartup === 'off') continue;
    project.autoCapture.retryPending(workspaces.filter(workspace => workspace.scope.projectId === project.projectId)
      .map(workspace => ({ projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId })));
  }
  // The one start both the start-up re-drive and an adopted first plan use: the Goal's own profile ids, the Host
  // actor's scope context, and a `select_work` advance. A refused start leaves the Goal for the next
  // `workflow/advance` or `driver-start`.
  const startGoalDriver = async (scope: CoreScope, goalRef: GoalRef, flowId: string,
    answers?: StartupReconcileReportV1['redriveGoals'][number]['answers']): Promise<void> => {
    const profileIds = runtimeProfiles.filter(profile => profile.scope.projectId === scope.projectId
      && profile.scope.workspaceId === scope.workspaceId).map(profile => profile.id);
    try {
      await projects.get(scope.projectId)?.collaborationDriver.start(hostScopeContext(scope, actor), {
        advance: { schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work',
          ...(answers === undefined || answers.length === 0 ? {} : { answers }) },
        queryProfileIds: profileIds,
      });
    } catch { /* a refused start leaves the Goal for the next workflow/advance or driver-start */ }
  };
  // §12.1 step 6b (LA-6): the start-up re-drive starts the existing collaboration driver for each selected
  // Goal (a pending automation verdict or a not-entered Run), gated by `automation.resumeOnStartup` being `'auto'`; every
  // step it takes is judged by the owners, and its rework steps run as the Workflow's automation actor.
  const startRedrive = async (project: HostProject, report: StartupReconcileReportV1): Promise<void> => {
    if (project.runtime.platform.automationPolicy().resumeOnStartup !== 'auto') return;
    // The 6b selection keeps its own entries and their answers; a candidate-only Goal is driven once, with no answers.
    const byGoal = new Map<string, StartupReconcileReportV1['redriveGoals'][number]>();
    for (const goal of report.redriveGoals) byGoal.set(canonicalKey(goal.goalRef), goal);
    for (const entry of report.interruptedGoals) {
      if (byGoal.has(canonicalKey(entry.goalRef))) continue;
      byGoal.set(canonicalKey(entry.goalRef), { goalRef: entry.goalRef, scope: entry.scope, taskIds: entry.taskIds });
    }
    for (const goal of byGoal.values()) {
      await startGoalDriver(goal.scope, goal.goalRef, `startup-redrive:${goal.goalRef.goalId}`, goal.answers);
    }
  };
  for (const project of projects.values()) {
    if (project.report.report !== null) await startRedrive(project, project.report.report);
  }
  // The request driver starts only now, after the start-up reconcile and its
  // re-drive: their commits must not wake a pass, and both queues rebuild
  // read-only from the records. With `resumeOnStartup` off each workspace's
  // queues stay unarmed until the first request command wakes them, so nothing
  // starts on its own after a restart. Only the workspaces of the projects this
  // Host holds the lease of join it.
  await wakeLoop.start(ownedScopes(),
    { resumeOnStartup: (lastSnapshot?.automation ?? DEFAULT_TASK_AUTOMATION_POLICY).resumeOnStartup !== 'off' });
  // Slice 2B L8/B2: after the start-up reconcile, the leased Host backfills the
  // last 14 days in the background, one batch at a time, until done, a
  // `retry_later` or close. The cursor is memory-only: the records are the
  // progress, so nothing is written when nothing needs doing.
  const backfillAbort = new AbortController();
  const backfillDone: Promise<void> = (async () => {
    for (const scope of ownedScopes()) {
      if (backfillAbort.signal.aborted) return;
      const ctx: CoreCallContext = { ...hostScopeContext(scope, actor), signal: backfillAbort.signal };
      let cursor: string | null = null;
      try {
        for (;;) {
          if (backfillAbort.signal.aborted) return;
          const batch: ReadResult<import('../business/workflow/contracts.js').ActivityBackfillBatchV1> | undefined =
            await projectPlatform(scope.projectId).workflow.backfillRecentActivity?.(ctx, { workspace: scope, cursor });
          if (batch === undefined || batch.status !== 'ready') return;
          if (batch.value.done || batch.value.next === null) break;
          cursor = batch.value.next;
        }
      } catch { /* a failed batch leaves the missing tallies for the next Host start */ }
    }
  })();
  // A workspace this Host opens after its start is reconciled the same way before it serves an execution
  // (§12.1): its lines join the report, and its re-drive follows the same switch.
  reconcileAddedScope = async (scope: CoreScope): Promise<void> => {
    // The project's report is null without its lease.
    const project = projects.get(scope.projectId);
    const report = project?.report.report ?? null;
    if (project === undefined || report === null) return;
    try { await project.runtime.platform.knowledge.reconcile(reconcileContext(scope), scope.workspaceId, 'startup'); }
    catch { /* the next idle round reconciles */ }
    const recorded = await project.runtime.platform.runActivity.ensureActivityRecording(hostScopeContext(scope, actor), {
      input: { workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId } },
      meta: { requestId: `host-activity-recording:${scopeKey(scope)}`, expected: [] },
    });
    if (recorded.status !== 'committed') return;
    const added = (await reconcileScopes([scope])).get(scope.projectId);
    if (added === undefined) return;
    report.sessions.push(...added.sessions);
    report.runs.push(...added.runs);
    report.queries.push(...added.queries);
    report.checks.push(...added.checks);
    report.controls.push(...added.controls);
    // K3 L28 step 2b: the late-opened workspace's open review records join the
    // same report (the main start path wires `reconcile.reviews` identically).
    report.reviews.push(...added.reviews);
    report.fanOut.push(...added.fanOut);
    report.redriveGoals.push(...added.redriveGoals);
    report.interruptedGoals.push(...added.interruptedGoals);
    report.problems.push(...added.problems);
    await startRedrive(project, added);
  };

  // Explicit mechanical attention: the Host scans the configured real sources on
  // the configured heartbeat, delivers a real mailbox input to the target member,
  // and advances processing only after the accepting execution has a formal result.
  const attentionAbort = new AbortController();
  const sleepUntilAbort = (ms: number, signal: AbortSignal): Promise<void> => new Promise(resolve => {
    const onAbort = (): void => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  for (const scope of attentionScopes) {
    if (scope.pathsKind !== undefined && scope.pathsKind !== 'files') {
      throw new Error('attention scope only supports fixed files');
    }
    if (scope.paths.some(path => path.endsWith('/'))) {
      throw new Error('attention scope paths must be fixed files, not directories');
    }
  }
  const inputJobs = new Map<string, Promise<void>>();
  const consumeBarrierWaiters: Array<() => void> = [];
  /** Per workspace: the Session-key continuation C's view returned last, null at a wrapped end. */
  const consumeCursors = new Map<string, string | null>();
  /** The last heartbeat's skips, replaced by every ready pass; memory only, no record and no route. */
  let lastConsumeSkips: HostConsumeSkipV1[] = [];
  const hostContext = (scope: CoreScope): CoreCallContext => ({
    ...scope, principal: { kind: 'host', actor: { ...actor } },
    materialReader: { kind: 'host', ...scope, actor: { ...actor } }, signal: attentionAbort.signal,
  });
  /** Rework 2 item 2: "handled?" keeps THREE answers, never a silent `false`.
   * A failed Run or Query read is `unknown`; only a real not-completed fact is
   * `not_completed`. */
  type InputCompletion = 'completed' | 'not_completed' | 'unknown';
  async function inputCompletion(ctx: CoreCallContext, message: import('../core/work-graph/model/communication-contracts.js').SessionMessage): Promise<InputCompletion> {
    const platform = projectPlatform(ctx.projectId);
    let sawUnknown = false;
    for (const accepted of message.acceptedInputs ?? []) {
      if (accepted.part !== 'message') continue;
      const ref = accepted.executionRef;
      if (ref.aggregateType === 'Run') {
        const read = await platform.executions.readExecution(ctx, ref);
        if (read.status !== 'ready') { sawUnknown = true; continue; }
        if (read.value.run.status === 'ended' && read.value.run.outcome === 'completed') return 'completed';
      } else {
        const read = await platform.queries.readQueryJob(ctx, { aggregateType: 'QueryJob', projectId: ref.projectId, workspaceId: ref.workspaceId, queryJobId: ref.queryJobId });
        if (read.status !== 'ready') { sawUnknown = true; continue; }
        if (read.value.run.ref.runId === ref.runId && read.value.job.job.answerRefs.length > 0) {
          const answer = await platform.queries.readQueryAnswer(ctx, read.value.job.job.answerRefs.at(-1)!);
          if (answer.status !== 'ready') { sawUnknown = true; continue; }
          return 'completed';
        }
      }
    }
    return sawUnknown ? 'unknown' : 'not_completed';
  }
  /** The narrowed boolean the other callers keep (`consumeIdle`, attention). */
  async function inputCompleted(ctx: CoreCallContext, message: import('../core/work-graph/model/communication-contracts.js').SessionMessage): Promise<boolean> {
    return (await inputCompletion(ctx, message)) === 'completed';
  }
  /**
   * C-25/DR-P2-01: is the message this closing would reply to an executor's
   * still-open wait? The target is the source Query's `repliesToMessageRef`, else
   * the one lineage root for a Host system round, else the source itself. A read
   * failure counts as "still waiting", so a candidate/questions close-out never
   * replies the executor M by accident; the reason alone never decides.
   */
  async function executorWaitOf(ctx: CoreCallContext, message: SessionMessage): Promise<boolean> {
    const executorSender = (sender: SessionMessage['sender']): boolean =>
      sender.kind === 'work_run' || sender.kind === 'secretary_round';
    const platform = projectPlatform(ctx.projectId);
    let targetRef = message.ref;
    if (message.sender.kind === 'host' && message.sender.actor.kind === 'system') {
      const query = await platform.queries.readQueryJob(ctx,
        interventionPlanningQueryRefs(message.ref).queryJobRef);
      if (query.status !== 'ready') return true;
      const execution = query.value.job.job.intent.execution;
      const repliesTo = execution.kind === 'intervention_planning' ? execution.repliesToMessageRef : undefined;
      if (repliesTo !== undefined) {
        targetRef = repliesTo;
      } else {
        const lineage = await planSourceLineageOf(ctx,
          { messages: platform.messages, queries: platform.queries, plans: platform.plans }, message.ref);
        if (lineage.status !== 'ready') return true;
        targetRef = lineage.value.rootMessage;
      }
    } else if (!executorSender(message.sender)) {
      return false;
    }
    const same = targetRef.projectId === message.ref.projectId
      && targetRef.workspaceId === message.ref.workspaceId
      && targetRef.messageId === message.ref.messageId;
    const target = same ? null : await platform.messages.readMessage(ctx, targetRef);
    if (target !== null && target.status !== 'ready') return true;
    const targetMessage = target === null ? message : (target as { status: 'ready'; value: SessionMessage }).value;
    if (!executorSender(targetMessage.sender)) return false;
    if (targetMessage.response !== null) return false;
    return waitStateOf(targetMessage, waitFactsOfRecord(targetMessage)).state === 'open';
  }
  /**
   * One workspace's consume batch over C's published view: up to `CONSUME_BATCH` candidate Sessions in
   * Session-key order, each at most one turn, and the next continuation key. A Session with no matching
   * profile or no Goal is skipped with its reason and stays queued; `notify` never reaches this loop because
   * C's `nextMessage` is never a notify. A non-ready page returns the same `after` so the next heartbeat
   * retries it, never "nothing to do". The view's unreadable lines come first in the skips, then the others.
   */
  async function consumeIdle(scope: WorkspaceScope, after: string | null): Promise<string | null> {
    const ctx = hostContext(scope);
    const project = projects.get(scope.projectId);
    if (project === undefined) return after;
    const platform = project.runtime.platform;
    const page = await platform.consumableSessions.readConsumableSessions(ctx,
      { workspace: scope, after, limit: CONSUME_BATCH });
    if (page.status !== 'ready') return after;
    const skips: HostConsumeSkipV1[] = page.value.skipped.map(skip =>
      ({ sessionRef: skip.session, reason: 'unreadable' as const }));
    for (const candidate of page.value.items) {
      // notify-only (and every other no-offer candidate): no turn, zero model calls.
      const offer = candidate.nextMessage;
      if (offer === null) continue;
      // Never guess the model: the first configured profile whose scope and sessionRole match this Session.
      const profile = queryProfileOf(scope, candidate.role);
      if (profile === undefined) {
        skips.push({ sessionRef: candidate.session, reason: 'no_profile' });
        continue;
      }
      const read = await platform.messages.readMessage(ctx, offer.messageRef);
      if (read.status !== 'ready') continue;                       // the next heartbeat re-reads
      const goalRef = read.value.goalRef
        ?? (read.value.taskRef === null ? null : { aggregateType: 'Goal' as const,
          projectId: read.value.taskRef.projectId, goalId: read.value.taskRef.goalId });
      if (offer.kind === 'person_message' || offer.kind === 'action_request') {
        // §5.3.5: only a Host system round is the planning-round profile; its reserve is
        // the one formula against this profile's own window, frozen as the request-side budget.
        const planningRound = offer.kind === 'action_request'
          && read.value.sender.kind === 'host' && read.value.sender.actor.kind === 'system';
        // The one public intervention dispatch; a claimed turn ends this Session's scan, and every
        // other message of the Session stays queued for a later safe point.
        const interventionInput = {
          messageRef: offer.messageRef, roleBinding: profile.roleBinding,
          runtimeBudget: planningRound ? planningRoundRuntimeBudget(profile) : profile.runtimeBudget,
          budget: profile.budget, consumerId: profile.consumerId,
        };
        const claimed = await platform.workflow.handleIntervention?.(ctx, interventionInput);
        if (claimed?.status === 'claimed') {
          const addressed = claimed.claim.task;
          await announceInterruption({ ...reconcileContext(scope), signal: ctx.signal }, project.hostNotices, {
            scope: { projectId: addressed.projectId, workspaceId: read.value.ref.workspaceId },
            sessionRef: candidate.session,
            personMessageRef: offer.messageRef,
          });
          await project.collaborationDriver.start(hostScopeContext({ projectId: addressed.projectId,
            workspaceId: read.value.ref.workspaceId }, actor), {
            advance: { schemaVersion: 1, flowId: `intervention:${claimed.claim.runRef.runId}`,
              goalRef: { aggregateType: 'Goal' as const, projectId: addressed.projectId, goalId: addressed.goalId },
              sessionHint: claimed.claim.sessionRef, kind: 'select_work', taskId: addressed.taskId },
            queryProfileIds: [profile.id],
          });
        } else if (claimed?.status === 'answer_ready') {
          // The closing's one notice is committed BEFORE the reply; a failed notice leaves the next pass to retry,
          // never a reply without its explanation. `questions` sends no notice: the cards carry the questions.
          if (claimed.reason !== 'questions') {
            const notice = await platform.messages.sendMessage(ctx, interventionClosingNoticeRequest({
              recipient: candidate.session, messageRef: offer.messageRef, reason: claimed.reason,
              goalRef: read.value.goalRef,
            }));
            if (notice.status !== 'committed') continue;
          }
          // §5.2.4/C-25: only an executor's open wait defers M on a candidate/question close-out;
          // every terminal answer still replies it. R itself is associated in both cases.
          const candidateOrQuestions = claimed.reason === 'candidate' || claimed.reason === 'questions';
          const executorWait = candidateOrQuestions && await executorWaitOf(ctx, read.value);
          await platform.workflow.handleIntervention?.(ctx, { ...interventionInput,
            completion: 'associate_answer', replyToOriginal: !executorWait });
        } else if (claimed?.status === 'no_answer') {
          // The third ending is a real termination: the fixed notice, then the source withdrawal. Both carry the
          // fixed identities, so a crash between them replays the one already committed and finishes the other.
          const key = sessionMessageRefKey(offer.messageRef);
          const notice = await platform.messages.sendMessage(ctx, interventionClosingNoticeRequest({
            recipient: candidate.session, messageRef: offer.messageRef, reason: 'no_answer',
            goalRef: read.value.goalRef,
          }));
          if (notice.status !== 'committed') continue;
          await platform.messages.withdrawMessage(ctx, { input: { messageRef: offer.messageRef },
            meta: { requestId: `intervention:${key}:withdraw`, expected: [] } });
        } else if (goalRef === null) {
          skips.push({ sessionRef: candidate.session, reason: 'no_goal' });
        }
        continue;
      }
      if (goalRef === null) { skips.push({ sessionRef: candidate.session, reason: 'no_goal' }); continue; }
      // An ordinary late reply is the existing consultation's response input; an inquiry keeps no part.
      const part = offer.kind === 'late_reply' ? 'response' as const : undefined;
      await platform.workflow.consumeConsultation?.(ctx, {
        schemaVersion: 1, ...(part === undefined ? {} : { part }), messageRef: offer.messageRef, goalRef,
        roleBinding: profile.roleBinding, runtimeBudget: profile.runtimeBudget, budget: profile.budget,
        consumerId: profile.consumerId });
      continue;                                                     // a consultation ends this Session's scan
    }
    lastConsumeSkips = skips;
    return page.value.next;
  }
  // Slice 4C-2 §11.5/U-10: the scribe reminder shell. One check per configured
  // workspace per heartbeat; the to-do port and the recipient resolver are the
  // narrow seams (by default those of the context's project platform), and the
  // send reuses the EXISTING platform sender, never a second one.
  const noteScribeTodos: NoteScribeTodoPort | undefined = options.noteScribeTodos ?? {
    readScribeTodos: (ctx, input) => projectPlatform(ctx.projectId).notes.readScribeTodos(ctx, input),
    readLedgerCursor: ctx => projectPlatform(ctx.projectId).notes.readLedgerCursor(ctx),
  };
  const resolveScribeRecipient = options.resolveScribeRecipient
    ?? ((ctx: CoreCallContext, scope: NoteScopeV1) => projectPlatform(ctx.projectId).notes.resolveScribeRecipient(ctx, scope));
  const sendScribeReminder: SessionMailboxPort['sendMessage'] = options.sendScribeReminder
    ?? ((ctx, input) => projectPlatform(ctx.projectId).messages.sendMessage(ctx, input));
  const scribeReminderPeriodMs = options.scribeReminderPeriodMs ?? SCRIBE_REMINDER_PERIOD_MS;
  const linkBatchIdleMs = options.linkBatchIdleMs ?? NOTE_LINK_IDLE_MS;
  const linkBatchBacklog = options.linkBatchBacklog ?? NOTE_LINK_BACKLOG;
  const linkBatchBacklogGapMs = options.linkBatchBacklogGapMs ?? NOTE_LINK_BACKLOG_GAP_MS;
  const nowIso = options.now ?? (() => new Date().toISOString());
  const clockMs = (): number => Date.parse(nowIso());
  /** The Host is idle for a project: no Run or Query call in flight, and none for `linkBatchIdleMs`. */
  const runtimeIdle = (platform: ProjectPlatform, now: number): boolean => platform.runtimeInFlight.count() === 0
    && now - Date.parse(platform.runtimeInFlight.idleSince()) >= linkBatchIdleMs;

  /**
   * §11.5/§11.7: the per-workspace reminder memory. It lasts for the life of
   * this Host only; after a restart the first check rebuilds the unhandled
   * state by paging each recipient's whole inbox once in the recipient line's
   * own workspace, while the reminder is sent as the Host system identity.
   *
   * Rework 2 item 2: the memory is PER RECIPIENT (a single `sentReminder` lost
   * the recipient change). Each entry keeps the last sent ref and whether that
   * recipient's inbox was RECOVERED (the whole inbox paged once; an EMPTY inbox
   * also counts as recovered).
   */
  type ScribeRecipientMemory = {
    /** U-7: the last reminder actually sent to this recipient, checked with `readMessage`. */
    ref: SessionMessageRef | null;
    /** True once this recipient's whole inbox has been paged once since start. */
    recovered: boolean;
  };
  type BrokenTiming = {
    noteId: string;
    version: number;
    firstSeenMs: number;
    /** null = 还没开始计时（heldByRun 还在跑）。 */
    startedAtMs: number | null;
  };
  type ScribeReminderBucket = {
    scope: NoteScopeV1;
    pendingCount: number; updateDueCount: number; immediate: boolean;
    identities: Set<string>; anchorNames: Set<string>;
    brokenIdentities: Set<string>;
    brokenCount: number; agedCount: number;
  };
  type ScribeReminderState = {
    lastCheckAtMs: number;
    /** `undefined` = no check computed yet; otherwise the cursor of the last check. */
    computedAtCursor: string | null | undefined;
    /** BK-09: one pending send and one last-sent request id per recipient, keyed by the recipient's `sessionId`. */
    pendingSendByRecipient: Map<string, SessionMessageSendInputV1>;
    sentRequestIdByRecipient: Map<string, string>;
    recipients: Map<string, ScribeRecipientMemory>;
    brokenTiming: Map<string, BrokenTiming>;   // key = `${noteId}@${version}`
    brokenKeys: Map<string, string>;           // key = canonicalJson(scope) -> that bucket's brokenKey
    bucketRecipients: Map<string, string | null>; // bucket -> recipient sessionId; null = no scribe
  };
  const scribeReminderStates = new Map<string, ScribeReminderState>();
  function scribeReminderState(key: string): ScribeReminderState {
    const existing = scribeReminderStates.get(key);
    if (existing !== undefined) return existing;
    const created: ScribeReminderState = { lastCheckAtMs: Number.NEGATIVE_INFINITY,
      computedAtCursor: undefined, pendingSendByRecipient: new Map(), sentRequestIdByRecipient: new Map(),
      recipients: new Map(), brokenTiming: new Map(), brokenKeys: new Map(), bucketRecipients: new Map() };
    scribeReminderStates.set(key, created);
    return created;
  }
  function recipientMemory(state: ScribeReminderState, recipient: SessionRef): ScribeRecipientMemory {
    const existing = state.recipients.get(recipient.sessionId);
    if (existing !== undefined) return existing;
    const created: ScribeRecipientMemory = { ref: null, recovered: false };
    state.recipients.set(recipient.sessionId, created);
    return created;
  }

  /**
   * U-7: whether this recipient has an unhandled scribe reminder. When the
   * in-memory ref is present it is checked first (`readMessage` + the
   * three-state completion): `unknown` sends nothing and leaves
   * `computedAtCursor` unset, `not_completed` stays unhandled, `completed`
   * clears the ref and continues. If no ref and the inbox has not been
   * recovered, the WHOLE inbox is paged once (following `nextCursor` to the
   * end) for a not-completed Host `notify` message whose body starts with the
   * marker. ANY page/body/message read failure is `unknown`: nothing is sent
   * and the caller leaves `computedAtCursor` unset.
   */
  type ReminderDisposition = 'clear' | 'unhandled' | 'unknown';
  /**
   * The recipient line's own workspace. The sending workspace is read first (a
   * single-workspace project only has that one, byte-identical to before); on
   * `not_found` every other workspace of the same project is read, and the one
   * that holds the line is its home. A failed read, or none holding it, is
   * `unknown`: nothing is sent and no cursor is recorded.
   */
  async function scribeRecipientWorkspace(ctx: CoreCallContext, recipient: SessionRef):
  Promise<CoreScope | 'unknown'> {
    const sending: CoreScope = { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' };
    const platform = projectPlatform(ctx.projectId);
    const here = await platform.sessions.readSession(ctx, recipient);
    if (here.status === 'ready') return sending;
    if (here.status !== 'not_found') return 'unknown';
    for (const workspace of workspaces) {
      if (workspace.scope.projectId !== ctx.projectId) continue;
      if (workspace.scope.workspaceId === sending.workspaceId) continue;
      const read = await platform.sessions.readSession(hostContext(workspace.scope), recipient);
      if (read.status === 'ready') return workspace.scope;
      if (read.status !== 'not_found') return 'unknown';
    }
    return 'unknown';
  }
  async function scribeReminderDisposition(ctx: CoreCallContext, recipient: SessionRef,
    state: ScribeReminderState): Promise<ReminderDisposition> {
    const platform = projectPlatform(ctx.projectId);
    const memory = recipientMemory(state, recipient);
    if (memory.ref !== null) {
      // The memory ref is checked in the workspace the message record lives in.
      const refCtx = hostContext({ projectId: memory.ref.projectId, workspaceId: memory.ref.workspaceId });
      const read = await platform.messages.readMessage(refCtx, memory.ref);
      if (read.status !== 'ready') return 'unknown';
      const completion = await inputCompletion(refCtx, read.value);
      if (completion === 'unknown') return 'unknown';
      if (completion === 'not_completed') return 'unhandled';
      memory.ref = null; // handled: fall through to a fresh inbox page
    }
    if (!memory.recovered) {
      // The one recovery scan pages the recipient's inbox in the recipient
      // line's own workspace.
      const home = await scribeRecipientWorkspace(ctx, recipient);
      if (home === 'unknown') return 'unknown';
      const inboxCtx = hostContext(home);
      let cursor: string | undefined;
      do {
        const inbox = await platform.messages.readInbox(inboxCtx, { recipient,
          page: { limit: 100, ...(cursor === undefined ? {} : { cursor }) } });
        if (inbox.status !== 'ready') return 'unknown';
        for (const message of inbox.value.items) {
          if (message.sender.kind !== 'host' || message.intent !== 'notify') continue;
          const completion = await inputCompletion(inboxCtx, message);
          if (completion === 'unknown') return 'unknown';
          if (completion === 'completed') continue;
          const body = await platform.messages.readMessageBody(inboxCtx, { messageRef: message.ref, part: 'message' });
          if (body.status !== 'ready') return 'unknown';
          if (body.value.text.startsWith(SCRIBE_REMINDER_MARKER)) {
            memory.ref = message.ref;
            return 'unhandled';
          }
        }
        cursor = inbox.value.nextCursor ?? undefined;
      } while (cursor !== undefined && !attentionAbort.signal.aborted);
      // Only a COMPLETE page counts as recovered; an early `unhandled` return
      // above keeps the flag false so a later handled ref resumes the scan.
      memory.recovered = true;
    }
    return 'clear';
  }

  /** One send of a pending notice through the caller's EXISTING sender (C19); the optional callback runs only on
   *  `committed`, with the saved message ref. A thrown or non-committed send is `failed` and the caller keeps its
   *  pending record for the next period. */
  async function sendPendingNotice(
    ctx: CoreCallContext,
    send: SessionMailboxPort['sendMessage'],
    input: SessionMessageSendInputV1,
    onCommitted?: (ref: SessionMessageRef) => void,
  ): Promise<'sent' | 'failed'> {
    try {
      const sent = await send(ctx, input);
      if (sent.status !== 'committed') return 'failed';
      onCommitted?.(sent.value.ref);
      return 'sent';
    } catch { return 'failed'; }
  }

  /** §11.5 step 5: send the pending request through the shared helper; on
   * `committed` record it so the next period does not send it again. A
   * thrown/failed send keeps that recipient's pending send, so the next period retries the SAME
   * requestId. */
  async function sendPendingScribeReminder(ctx: CoreCallContext, state: ScribeReminderState, key: string,
    pending: SessionMessageSendInputV1): Promise<void> {
    await sendPendingNotice(ctx, sendScribeReminder, pending, (ref) => {
      state.pendingSendByRecipient.delete(key);
      state.sentRequestIdByRecipient.set(key, pending.meta.requestId);
      recipientMemory(state, pending.input.recipient).ref = ref;
    });
  }

  /**
   * The rework notifier's memory. One cursor per workspace holds the last confirmed SOURCE position; the person's
   * watermark is never read. One saved-delivery map per workspace holds every outbox record keyed by source key +
   * branch: the first notifier pass pages the Host system outbox to its end, and the lease-holding Host (the outbox's
   * only writer) records each later commit into the same map. A start and a retry therefore replay the SAVED input,
   * never a recipient or text recomputed from the current facts.
   */
  type SavedReworkDelivery = SessionMessageSendInputV1 | DecisionSourceV1;
  type SavedReworkDeliveries = Map<string, SavedReworkDelivery>;
  const reworkCursors = new Map<string, NoticePositionV1 | null>();
  const savedReworkByScope = new Map<string, SavedReworkDeliveries>();
  /** The projection's own canonical key of the trigger ref (the same key it uses for its item keys). */
  const reworkSourceKeyOf = (source: HostOutboxSourceV1): string => canonicalJson(source.ref as unknown as JsonValue);
  const savedDeliveryKeyOf = (source: HostOutboxSourceV1, branch: HostOutboxItemV1['branch']): string =>
    `${reworkSourceKeyOf(source)}\u0000${branch}`;

  /** The workspace's saved deliveries. A failed page returns `null` and is never cached, so the caller returns and
   *  the next heartbeat reads the whole outbox again. */
  async function savedReworkDeliveries(ctx: CoreCallContext, scope: CoreScope): Promise<SavedReworkDeliveries | null> {
    const key = scopeKey(scope);
    const existing = savedReworkByScope.get(key);
    if (existing !== undefined) return existing;
    const built: SavedReworkDeliveries = new Map();
    const platform = projectPlatform(scope.projectId);
    let after: HostOutboxKeysetV1 | null = null;
    for (;;) {
      const page = await platform.messages.readHostSystemOutbox(ctx,
        { workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId }, after, limit: 100 });
      if (page.status !== 'ready') return null;
      for (const item of page.value.items) {
        built.set(savedDeliveryKeyOf(item.source, item.branch),
          item.branch === 'no_adviser_card' ? item.cardSource : item.request);
      }
      if (page.value.next === null) break;
      after = page.value.next;
    }
    savedReworkByScope.set(key, built);
    return built;
  }

  /** One delivery = one outbox record, written ONCE, BEFORE the send on a message branch and BEFORE the card read on
   *  the card branch, with the saved input. The Store's real result decides: a not-committed write sends nothing and
   *  advances nothing. On commit the map the current pass reads learns the item, so a retry reuses the saved input and
   *  there is no post-send write and no `delivered` flag. */
  async function appendReworkDelivery(ctx: CoreCallContext, scope: CoreScope, item: NoticeItemV1,
    source: HostOutboxSourceV1, branch: HostOutboxItemV1['branch'],
    input: SessionMessageSendInputV1 | DecisionSourceV1, saved: SavedReworkDeliveries): Promise<boolean> {
    const stored: HostOutboxStoredItemV1 = branch === 'no_adviser_card'
      ? { source, branch, cardSource: input as DecisionSourceV1 }
      : { source, branch, request: input as SessionMessageSendInputV1 };
    const written = await projectPlatform(scope.projectId).messages.appendHostSystemOutbox(ctx, {
      input: { workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId }, item: stored },
      meta: { requestId: `rework-outbox:${item.itemKey}:${branch}`, expected: [] },
    });
    if (written.status !== 'committed') return false;
    saved.set(savedDeliveryKeyOf(source, branch), input);
    return true;
  }

  /**
   * One counted automatic rework: a passive notify to the Goal's secretary always, and on the second (and each later)
   * counted rework ALSO a notify to the Goal's adviser, or, when no adviser exists, the derived 要决定 card. Both
   * extra arms are mutually exclusive. Every branch reads the saved input first; only a branch with no saved record
   * resolves a recipient and builds its input, and the record is committed before the send/card read. Returns whether
   * every branch of THIS source is confirmed; a failed/absent delivery or read leaves it for the next pass.
   */
  async function deliverReworkNotice(ctx: CoreCallContext, scope: CoreScope, item: NoticeItemV1,
    saved: SavedReworkDeliveries): Promise<boolean> {
    const platform = projectPlatform(scope.projectId);
    const rework = item.rework!;
    const source: HostOutboxSourceV1 = rework.operation === 'requeue'
      ? { kind: 'requeue', ref: rework.sourceRef as TaskRequeueRef, position: item.position }
      : { kind: 'round', ref: rework.sourceRef as VerificationRoundRef, position: item.position };
    // One counting chain across both arms: this item's OWN counted arm plus the Task's counted total. A recovery
    // keeps the previous total, so the plain count can neither send the adviser arm nor derive another card.
    const second = rework.counted && rework.taskCount >= 2;
    // The automatic_rework projection always builds `subject.kind: 'goal'`; no project arm exists.
    const goalRef = (item.subject as { kind: 'goal'; goalRef: GoalRef }).goalRef;
    const sourceKey = reworkSourceKeyOf(source);

    const notifyOnly = saved.get(savedDeliveryKeyOf(source, 'notify_only')) as SessionMessageSendInputV1 | undefined;
    let request = notifyOnly;
    if (request === undefined) {
      const secretary = await platform.recipients.resolveGoalSecretary(ctx, { goalRef });
      if (secretary.status !== 'ready') return false;                 // a failed read: retry next heartbeat
      if (secretary.value === null) return false;                      // absent delivery: no advance
      request = systemNotifyRequest({ recipient: secretary.value, text: item.summary,
        requestId: `rework-notice:${sourceKey}` });
      if (!(await appendReworkDelivery(ctx, scope, item, source, 'notify_only', request, saved))) return false;
    }
    if (await sendPendingNotice(ctx, platform.messages.sendMessage.bind(platform.messages), request) !== 'sent') {
      return false;                                                    // the saved item stays; the next pass re-sends it
    }
    if (!second) return true;

    const savedAdviser = saved.get(savedDeliveryKeyOf(source, 'adviser_delivery')) as
      SessionMessageSendInputV1 | undefined;
    const savedCard = saved.get(savedDeliveryKeyOf(source, 'no_adviser_card')) as DecisionSourceV1 | undefined;
    if (savedAdviser !== undefined) {
      return await sendPendingNotice(ctx, platform.messages.sendMessage.bind(platform.messages), savedAdviser) === 'sent';
    }
    if (savedCard !== undefined) {
      const card = await platform.decisions.readDecisionCard(ctx, { source: savedCard });
      return card.status === 'ready';                                  // readable is the card branch's confirmation
    }
    const recipient = await platform.recipients.resolveRecipient(ctx, { projectId: scope.projectId, goalRef, moduleRef: null, kind: 'general', asker: null });
    if (recipient.status !== 'ready') return false;
    const adviser = recipient.value.kind === 'session' ? recipient.value.session : null;
    if (adviser !== null) {
      const adviserRequest = systemNotifyRequest({ recipient: adviser, text: item.summary,
        requestId: `rework-notice-adviser:${sourceKey}` });
      if (!(await appendReworkDelivery(ctx, scope, item, source, 'adviser_delivery', adviserRequest, saved))) return false;
      return await sendPendingNotice(ctx, platform.messages.sendMessage.bind(platform.messages), adviserRequest) === 'sent';
    }
    // No adviser: the outbox carries the derived card's source only; the card itself is derived by the C3 facts
    // handler. The key is `decisionSourceKey` of the identity arm, never a hand-built string.
    const cardSource: DecisionSourceV1 = {
      kind: 'adviser_creation',
      key: decisionSourceKey({ kind: 'adviser_creation',
        trigger: source.kind === 'requeue'
          ? { kind: 'requeue', ref: source.ref }
          : { kind: 'round', ref: source.ref } }),
      subject: item.subject, pins: [],
    };
    if (!(await appendReworkDelivery(ctx, scope, item, source, 'no_adviser_card', cardSource, saved))) return false;
    const card = await platform.decisions.readDecisionCard(ctx, { source: cardSource });
    return card.status === 'ready';
  }

  /** One passive notify pass per workspace, over the tracked projection read (no `after`: the person's seen position
   *  is never the notifier's cursor). The cursor advances only after every branch of the source is confirmed, and it
   *  stores the SOURCE position. A failed outbox read or projection page returns and is retried next heartbeat. */
  async function runReworkNoticeCheck(scope: CoreScope): Promise<void> {
    const ctx: CoreCallContext = { ...reconcileContext(scope), signal: attentionAbort.signal };
    const workspace = { projectId: scope.projectId, workspaceId: scope.workspaceId };
    const saved = await savedReworkDeliveries(ctx, scope);
    if (saved === null) return;
    const platform = projectPlatform(scope.projectId);
    let cursor: string | undefined;
    do {
      const page = await platform.reworkNotices.readPage(ctx, { workspace,
        page: { limit: 100, ...(cursor === undefined ? {} : { cursor }) } });
      if (page.status !== 'ready') return;                             // failed page: retry next heartbeat
      for (const item of page.value.items) {
        if (item.rework === null) continue;
        const confirmed = reworkCursors.get(scopeKey(scope)) ?? null;
        if (confirmed !== null && compareNoticePositions(item.position, confirmed) <= 0) continue;
        if (!(await deliverReworkNotice(ctx, scope, item, saved))) return;   // no advance on a failed/absent delivery
        reworkCursors.set(scopeKey(scope), item.position);             // only after the whole source is confirmed
      }
      cursor = page.value.nextCursor ?? undefined;
    } while (cursor !== undefined && !attentionAbort.signal.aborted);
  }

  async function runScribeReminderCheck(scope: CoreScope): Promise<void> {
    if (noteScribeTodos === undefined) return;
    const platform = projectPlatform(scope.projectId);
    const state = scribeReminderState(scopeKey(scope));
    // 1. the reminder's OWN period, on the INJECTED clock.
    const atMs = clockMs();
    if (atMs - state.lastCheckAtMs < scribeReminderPeriodMs) return;
    state.lastCheckAtMs = atMs;
    const ctx = hostContext(scope);
    // The send uses the Host system identity (like the rework and attention
    // notices), so a reminder can reach a scribe in another workspace. Every
    // read keeps the configured Host identity.
    const sendCtx: CoreCallContext = { ...reconcileContext(scope), signal: attentionAbort.signal };

    // 2. the ledger cursor. A failed read does nothing this pass and leaves
    // `computedAtCursor` unset, so the next period retries.
    const cursorRead = await noteScribeTodos.readLedgerCursor(ctx);
    if (cursorRead.status !== 'ready') return;
    const cursor = cursorRead.value;

    // S1: a broken head-version link starts timing at max(first seen, the end of the Run holding it); a
    // Run still in flight does not count this round. Every round recomputes this from the CURRENT
    // `heldByRun` (a later Run may hold the same version), and entries no longer listed are dropped.
    const broken = platform.notes.brokenLinks(scope);
    for (const entry of broken) {
      const key = `${entry.noteId}@${entry.version}`;
      const timing = state.brokenTiming.get(key) ?? { noteId: entry.noteId, version: entry.version,
        firstSeenMs: atMs, startedAtMs: null };
      state.brokenTiming.set(key, timing);
      if (entry.heldByRun === null) {
        timing.startedAtMs = timing.firstSeenMs;
      } else if (platform.runtimeInFlight.has(entry.heldByRun)) {
        timing.startedAtMs = null;
      } else {
        const ended = platform.runtimeInFlight.endedAt(entry.heldByRun);
        timing.startedAtMs = ended === null ? timing.firstSeenMs
          : Math.max(timing.firstSeenMs, Date.parse(ended));
      }
    }
    const listed = new Set(broken.map(entry => `${entry.noteId}@${entry.version}`));
    for (const key of [...state.brokenTiming.keys()]) if (!listed.has(key)) state.brokenTiming.delete(key);

    // S2/L3: a broken link joins the bucket of its head's own managing scope, exactly as a to-do does.
    // A version that is no longer current (or whose head is not accepted/reviewed) is not counted; a
    // failed scope read returns without a cursor or prune.
    const brokenBuckets = new Map<string, { scope: NoteScopeV1; ids: string[]; aged: number }>();
    for (const timing of state.brokenTiming.values()) {
      if (timing.startedAtMs === null) continue;
      const scopeRead = await platform.notes.brokenLinkScope(ctx,
        { noteId: timing.noteId, version: timing.version });
      if (scopeRead.status !== 'ready') return;
      if (scopeRead.value === null) continue;
      const key = canonicalJson(scopeRead.value as never);
      const bucket = brokenBuckets.get(key) ?? { scope: scopeRead.value, ids: [], aged: 0 };
      bucket.ids.push(`${timing.noteId}@${timing.version}`);
      if (atMs - timing.startedAtMs >= SCRIBE_BROKEN_LINK_AGE_MS) bucket.aged += 1;
      brokenBuckets.set(key, bucket);
    }
    const brokenKeyOf = (bucket: { ids: string[]; aged: number }): string =>
      sha256Hex(canonicalJson([[...bucket.ids].sort(), bucket.aged] as never));
    const EMPTY_BROKEN_KEY = sha256Hex(canonicalJson([[], 0] as never));

    // S2/L5: the per-bucket gate. A bucket whose broken key did not move only retries its own pending
    // request; a changed bucket is recomputed alone, and one bucket's failed recipient read or
    // `unknown` disposition does not block the others (the round then writes no cursor and prunes
    // nothing).
    let todoBuckets: Map<string, ScribeReminderBucket> | null = null;
    const readTodoBuckets = async (): Promise<Map<string, ScribeReminderBucket> | null> => {
      // BK-09 (v4 :6623–:6686): put each to-do in the bucket of its own managing scope (O2's rule, the
      // same basis as `countCurrentNotes` and the write path), then send each scope's reminder to that
      // scope's own scribe. `group.goalId` is a bucket of the to-do read, never a scope.
      const goalIds = await platform.notes.goalIdsForWorkspace(ctx);
      if (goalIds.status !== 'ready') return null;
      const todos = await noteScribeTodos.readScribeTodos(ctx, { goalIds: goalIds.value });
      if (todos.status !== 'ready') return null;
      const byScope = new Map<string, ScribeReminderBucket>();
      for (const group of todos.value) {
        for (const [todo, updateDue] of [...group.pending.map((t) => [t, false] as const),
          ...group.updateDueTodos.map((t) => [t, true] as const)]) {
          const scopeRead = await platform.notes.managingScopeOf(ctx, { todo, goalId: group.goalId });
          if (scopeRead.status !== 'ready') return null;
          const key = canonicalJson(scopeRead.value as never);
          const bucket = byScope.get(key) ?? { scope: scopeRead.value, pendingCount: 0, updateDueCount: 0,
            immediate: false, identities: new Set<string>(), anchorNames: new Set<string>(),
            brokenIdentities: new Set<string>(), brokenCount: 0, agedCount: 0 };
          if (updateDue) bucket.updateDueCount += 1; else bucket.pendingCount += 1;
          if (group.immediate) bucket.immediate = true;
          bucket.identities.add(todo.identity);
          bucket.anchorNames.add(todo.anchorKey);
          byScope.set(key, bucket);
        }
      }
      return byScope;
    };

    const cursorChanged = state.computedAtCursor === undefined || cursor !== state.computedAtCursor;
    if (cursorChanged) {
      todoBuckets = await readTodoBuckets();
      if (todoBuckets === null) return;
    }
    const keys = new Set<string>(state.bucketRecipients.keys());
    for (const key of brokenBuckets.keys()) keys.add(key);
    if (todoBuckets !== null) for (const key of todoBuckets.keys()) keys.add(key);
    let incomplete = false;
    for (const key of keys) {
      const brokenBucket = brokenBuckets.get(key);
      const nextKey = brokenBucket === undefined ? EMPTY_BROKEN_KEY : brokenKeyOf(brokenBucket);
      if (!cursorChanged && state.brokenKeys.get(key) === nextKey) {
        const recipient = state.bucketRecipients.get(key);
        if (recipient !== undefined && recipient !== null) {
          const pending = state.pendingSendByRecipient.get(recipient);
          if (pending !== undefined) await sendPendingScribeReminder(sendCtx, state, recipient, pending);
        }
        continue;
      }
      // A bucket changed before the to-dos were read (the cursor did not move): read them once now.
      if (todoBuckets === null) {
        todoBuckets = await readTodoBuckets();
        if (todoBuckets === null) return;
      }
      const todoBucket = todoBuckets.get(key);
      if (todoBucket === undefined && brokenBucket === undefined) {
        // Neither a to-do nor a started broken link remains: drop the bucket's key, recipient and pending.
        const oldRecipient = state.bucketRecipients.get(key);
        if (oldRecipient !== undefined && oldRecipient !== null) state.pendingSendByRecipient.delete(oldRecipient);
        state.brokenKeys.delete(key);
        state.bucketRecipients.delete(key);
        continue;
      }
      // Merge keeps the to-do fields and adds the broken fields; a broken-only bucket has no to-dos.
      const bucket: ScribeReminderBucket = todoBucket === undefined
        ? { scope: brokenBucket!.scope, pendingCount: 0, updateDueCount: 0, immediate: false,
          identities: new Set<string>(), anchorNames: new Set<string>(),
          brokenIdentities: new Set<string>(), brokenCount: 0, agedCount: 0 }
        : { ...todoBucket };
      if (brokenBucket !== undefined) {
        for (const id of brokenBucket.ids) bucket.brokenIdentities.add(`broken:${id}`);
        bucket.brokenCount = brokenBucket.ids.length;
        bucket.agedCount = brokenBucket.aged;
      }
      const oldRecipient = state.bucketRecipients.get(key);
      const recipient = await resolveScribeRecipient(ctx, bucket.scope);   // the scope's OWN scribe
      // A failed read is not "no scribe": keep the old key and pending, and retry next round.
      if (recipient.status !== 'ready') { incomplete = true; continue; }
      if (recipient.value === null) {
        if (oldRecipient !== undefined && oldRecipient !== null) state.pendingSendByRecipient.delete(oldRecipient);
        state.brokenKeys.set(key, nextKey);
        state.bucketRecipients.set(key, null);
        continue;
      }
      // The resolver may hand back the Session AGGREGATE ref; the mailbox address is the plain `{ projectId, sessionId }`.
      const recipientRef: SessionRef = { projectId: recipient.value.projectId,
        sessionId: recipient.value.sessionId };
      if (oldRecipient !== undefined && oldRecipient !== null
        && oldRecipient !== recipientRef.sessionId) state.pendingSendByRecipient.delete(oldRecipient);
      const disposition = await scribeReminderDisposition(ctx, recipientRef, state);
      if (disposition === 'unknown') { incomplete = true; continue; }
      // The bucket is recomputed: its old pending no longer stands for this round's gate.
      if (oldRecipient !== undefined && oldRecipient !== null) state.pendingSendByRecipient.delete(oldRecipient);
      state.brokenKeys.set(key, nextKey);
      state.bucketRecipients.set(key, recipientRef.sessionId);
      if (disposition === 'unhandled') continue;
      if (!(bucket.immediate || bucket.pendingCount >= SCRIBE_PENDING_THRESHOLD
        || bucket.updateDueCount >= SCRIBE_UPDATE_DUE_THRESHOLD
        || bucket.brokenCount >= SCRIBE_BROKEN_LINK_THRESHOLD || bucket.agedCount > 0)) continue;
      const identities = [...bucket.identities];
      if (bucket.brokenCount > 0) identities.push(...bucket.brokenIdentities);
      const requestId = 'scribe-reminder:' + scope.workspaceId + ':' + recipientRef.sessionId + ':'
        + sha256Hex(canonicalJson(identities.sort() as never));
      if (state.sentRequestIdByRecipient.get(recipientRef.sessionId) === requestId) continue;
      const text = renderTemplate(PLATFORM_PROMPT_PACK_V1, 'scribe-reminder', {
        marker: SCRIBE_REMINDER_MARKER,
        pendingCount: String(bucket.pendingCount),
        updateDueCount: String(bucket.updateDueCount),
        brokenCount: String(bucket.brokenCount),
        anchors: [...bucket.anchorNames].slice(0, 20).join('、'),
      }, []).text;
      const pending = systemNotifyRequest({ recipient: recipientRef, text, requestId });
      state.pendingSendByRecipient.set(recipientRef.sessionId, pending);
      await sendPendingScribeReminder(sendCtx, state, recipientRef.sessionId, pending);
    }
    if (incomplete) return;
    state.computedAtCursor = cursor;
    // S1/L6: prune after the gate and send, and only on a complete round, so the round that first
    // reaches AGE still sends; a pruning round that remains broken starts timing again at that moment.
    for (const [key, timing] of [...state.brokenTiming]) {
      if (timing.startedAtMs !== null && atMs - timing.startedAtMs >= SCRIBE_BROKEN_LINK_AGE_MS) {
        state.brokenTiming.delete(key);
      }
    }
  }

  // The background link batch: one batch per workspace at a time, run from the
  // heartbeat loop so only the lease-holding Host does it. A batch is due when
  // the platform has been idle for `linkBatchIdleMs`, or when `linkBatchBacklog`
  // links wait and the last batch (or the Host start) is `linkBatchBacklogGapMs`
  // old. The check's own failures leave the links queued for the next trigger;
  // nothing is recorded, no event is written and no scribe is woken.
  const lastLinkBatch = new Map<string, number>();
  const linkBatchFrom = clockMs();
  async function runLinkBatchCheck(scope: CoreScope): Promise<void> {
    const platform = projectPlatform(scope.projectId);
    const queued = platform.notes.doubtfulLinks(scope, Math.max(NOTE_LINK_VERIFY_MAX, linkBatchBacklog));
    if (queued.length === 0) return;
    const now = clockMs();
    const idle = runtimeIdle(platform, now);
    const backlog = queued.length >= linkBatchBacklog
      && now - (lastLinkBatch.get(scopeKey(scope)) ?? linkBatchFrom) >= linkBatchBacklogGapMs;
    if (!idle && !backlog) return;
    lastLinkBatch.set(scopeKey(scope), now);
    await platform.notes.checkNotes(hostContext(scope),
      { items: queued.slice(0, NOTE_LINK_VERIFY_MAX), verifyLinks: { priority: 'background' } });
  }

  // L-10: without a project's lease this Host delivers no attention and wakes no consumer there (no execution
  // driver); every step below skips a workspace of such a project.
  const attentionDone: Promise<void> = (async () => {
    type AttentionScanner = ReturnType<typeof createAttentionScanner>;
    const entries = attentionScopes.map(scope => {
      const platform = ownedProject(scope.scope.projectId) ? platformFor(scope.scope.projectId) : null;
      return {
        scope, observer: createAttentionObserver(scope.config),
        // The scanner over the scope's project platform; none without that project's lease.
        scanner: platform === null ? null : createAttentionScanner({ workspace: platform.workspace,
          messages: platform.messages, readAttentionGraph: platform.runtime.readAttentionGraph.bind(platform.runtime) }),
        confirmedSequences: new Map<string, number>(), nextSequence: 0,
        pending: [] as { signals: readonly import('./attention-observer.js').AttentionSignal[]; sequence: number; messageRef: import('../contracts/core/session-message.js').SessionMessageRef; snapshot: Awaited<ReturnType<AttentionScanner['scan']>> }[],
      };
    });
    const period = Math.max(1, Math.min(...attentionScopes.map(scope => scope.config.heartbeatMs),
      ...inputConsumers.map(entry => entry.heartbeatMs), scribeReminderPeriodMs));
    const lastInputScan = new Map<string, number>();
    const expiryCursors = new Map<string, DueWaitPageInputV1['after']>();
    const expireDueWaits = async (): Promise<void> => {
      for (const workspace of workspaces) {
        if (!ownedProject(workspace.scope.projectId)) continue;
        const platform = projectPlatform(workspace.scope.projectId);
        const key = scopeKey(workspace.scope);
        const ctx = hostContext(workspace.scope);
        const before = expiryCursors.get(key) ?? null;
        const due = await platform.messageExpiry.readDueWaits(ctx, {
          workspace: workspace.scope,
          page: { limit: EXPIRY_PAGE, after: before } });
        if (due.status !== 'ready') continue;                       // a failed page is retried next heartbeat, never "no due"
        let previous = before;
        let notDue = false;
        for (const item of due.value.items) {
          const written = await platform.messageExpiry.recordExpiry(ctx, { messageRef: item.messageRef });
          if (written.status === 'skipped' && written.reason === 'not_due') {
            expiryCursors.set(key, previous);                       // the exclusive cursor stays before this item
            notDue = true;
            break;
          }
          previous = item.after;
        }
        if (!notDue) expiryCursors.set(key, due.value.next);
      }
    };
    while (!attentionAbort.signal.aborted) {
      await expireDueWaits();
      // One consume batch per workspace, the same list the expiry pass walks. The throttle
      // stays on the wall clock: the fixtures inject a FIXED `now`, and gating this scan on
      // it would stop an idle Session from ever re-scanning. One `inputJobs` key per
      // workspace keeps a slow pass from overlapping the next heartbeat.
      for (const workspace of workspaces) {
        if (!ownedProject(workspace.scope.projectId)) continue;
        const key = scopeKey(workspace.scope);
        if (inputJobs.has(key) || Date.now() - (lastInputScan.get(key) ?? 0) < period) continue;
        lastInputScan.set(key, Date.now());
        const after = consumeCursors.get(key) ?? null;
        const job = consumeIdle(workspace.scope, after)
          .then(next => { consumeCursors.set(key, next); })
          // 7D2 O2 (book :395-:400): one bounded maintenance page in the same idle job; no second loop or timer.
          .then(async () => { await projectPlatform(workspace.scope.projectId).workflow.maintainSessions?.(
            hostContext(workspace.scope), { workspace: workspace.scope, after: null }); })
          .catch(() => { /* original facts remain retryable */ })
          // KLS-2c [2C1-24]: when idle, the workspace's knowledge reconciliation rides its consume job (so the consume
          // barrier covers it), git or not; it holds the workspace's next consume until done.
          .then(async () => {
            try {
              const platform = projectPlatform(workspace.scope.projectId);
              if (!runtimeIdle(platform, clockMs())) return;
              await platform.knowledge.reconcile({ ...reconcileContext(workspace.scope), signal: attentionAbort.signal },
                workspace.scope.workspaceId, 'idle');
            } catch { /* the next idle heartbeat reconciles again */ }
          })
          .finally(() => inputJobs.delete(key))
          .finally(() => { for (const resolve of consumeBarrierWaiters.splice(0)) resolve(); });
        inputJobs.set(key, job);
      }
      for (const entry of entries) {
        if (attentionAbort.signal.aborted) break;
        if (entry.scanner === null) continue;
        const scope = entry.scope.scope;
        const platform = projectPlatform(scope.projectId);
        const hostCtx: CoreCallContext = {
          projectId: scope.projectId, workspaceId: scope.workspaceId,
          principal: { kind: 'host', actor: { ...actor } },
          materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor: { ...actor } },
          signal: attentionAbort.signal,
        };
        if (entry.pending.length > 0) {
          const remaining: typeof entry.pending = [];
          for (const item of entry.pending) {
            // The pending notice is read in the message's OWN workspace: a Host
            // system notify may have been delivered to another workspace.
            const msgCtx = hostContext({ projectId: item.messageRef.projectId, workspaceId: item.messageRef.workspaceId });
            try {
              const read = await platform.messages.readMessage(msgCtx, item.messageRef);
              if (read.status === 'ready' && await inputCompleted(msgCtx, read.value)) {
                const confirmed = item.signals.filter(signal => item.sequence > (entry.confirmedSequences.get(signal.kind) ?? 0));
                if (confirmed.length > 0) {
                  entry.observer.markProcessed(item.snapshot, confirmed);
                  for (const signal of confirmed) entry.confirmedSequences.set(signal.kind, item.sequence);
                }
              }
              else remaining.push(item);
            } catch { remaining.push(item); }
          }
          entry.pending = remaining;
        }
        let snapshot;
        try { snapshot = await entry.scanner.scan(hostCtx, entry.scope); }
        catch { continue; }
        if (attentionAbort.signal.aborted) break;
        if (entry.observer.processed === null) entry.observer.prime(snapshot);
        const delivery = entry.observer.observe(snapshot, clockMs());
        // The Goal's responsible adviser (the one L35 read) receives attention first; with no adviser the configured
        // target keeps today's value. A failed adviser read leaves the input unprocessed and is retried next heartbeat.
        let recipient: SessionRef | null = entry.scope.targetSession;
        if (delivery !== null) {
          const read = await platform.recipients.resolveRecipient(hostCtx, { projectId: scope.projectId, goalRef: entry.scope.goalRef, moduleRef: null, kind: 'general', asker: null });
          if (read.status !== 'ready') continue;
          if (read.value.kind === 'session') recipient = read.value.session;
        }
        if (delivery === null || recipient === null) continue;
        // Slice 3 C8 (§4.5): the notification text carries only the CHANGES of
        // this delivery, never the full snapshot or every file. The same
        // snapshot therefore renders the same text and the same requestId.
        const graphSignal = delivery.signals.find((signal): signal is Extract<AttentionSignal, { kind: 'graph_delta' }> => signal.kind === 'graph_delta');
        const fileSignal = delivery.signals.find((signal): signal is Extract<AttentionSignal, { kind: 'file_delta' }> => signal.kind === 'file_delta');
        const heartbeatSignal = delivery.signals.find((signal): signal is Extract<AttentionSignal, { kind: 'heartbeat' }> => signal.kind === 'heartbeat');
        const feedbackSignal = delivery.signals.find((signal): signal is Extract<AttentionSignal, { kind: 'member_feedback' }> => signal.kind === 'member_feedback');
        const text = renderAttentionChanges({
          scope,
          goalRef: entry.scope.goalRef,
          nodes: graphSignal?.changes?.nodes ?? [],
          edges: graphSignal?.changes?.edges ?? [],
          revision: graphSignal?.changes?.revision ?? null,
          files: (fileSignal?.changedFiles ?? []).map(path => ({
            path, version: snapshot.files.find(file => file.path === path)?.version ?? null,
          })),
          heartbeat: heartbeatSignal === undefined ? null
            : { pendingInputs: heartbeatSignal.pendingInputs, messageCursor: heartbeatSignal.messageCursor },
          feedbackIds: [...(feedbackSignal?.items ?? [])],
        });
        const requestId = 'attention:' + scope.workspaceId + ':' + sha256Hex(canonicalJson({
          targetSession: recipient, paths: entry.scope.paths,
          files: snapshot.files.map(file => ({ path: file.path, version: file.version })),
          graph: snapshot.graph,
          signals: delivery.signals.map(attentionSignalToJson),
        } as never));
        // C20: the send runs as the Host reconcile actor; the reads above keep the configured Host context. A
        // rejected or thrown send is `failed`, so the input stays unprocessed and is retried next heartbeat.
        const noticeCtx: CoreCallContext = { ...reconcileContext(scope), signal: attentionAbort.signal };
        await sendPendingNotice(noticeCtx, platform.messages.sendMessage.bind(platform.messages),
          systemNotifyRequest({ recipient, text, requestId }), (messageRef) => {
            entry.observer.markDelivered(snapshot, delivery.signals);
            entry.pending.push({ signals: delivery.signals, sequence: ++entry.nextSequence, messageRef, snapshot });
          });
      }
      // Slice 4C-2 §11.5: every configured workspace, whether or not attention
      // or input consumers are configured. A failed check records nothing and
      // is retried on the next heartbeat.
      for (const workspace of workspaces) {
        if (attentionAbort.signal.aborted) break;
        if (!ownedProject(workspace.scope.projectId)) continue;
        try { await runScribeReminderCheck(workspace.scope); } catch { /* retried next heartbeat */ }
        try { await runReworkNoticeCheck(workspace.scope); } catch { /* retried next heartbeat */ }
        try { await runLinkBatchCheck(workspace.scope); } catch { /* retried next heartbeat */ }
      }
      if (attentionAbort.signal.aborted) break;
      await sleepUntilAbort(period, attentionAbort.signal);
    }
  })();

  /**
   * HL-07 (L-1, L-10), per project (U1): a Host without a project's lease keeps
   * every read and owner write of that project, but each entry that would enter
   * the Kernel or start an execution driver, and the attestations, answer `busy`:
   * only the Host that holds the lease enters the Kernel, so its reconcile proofs
   * stay sound.
   */
  function leaseGated(lease: ProjectStoreLease, bindings: CoreRouteBindings): CoreRouteBindings {
    if (lease.lease === 'owned') return bindings;
    const busy = (what: string) => async () => ({ status: 'rejected' as const, code: 'busy' as const,
      reason: `another Host holds the instance lease of this store; ${what} runs only there (${lease.reason})` });
    const gated: CoreRouteBindings = { ...bindings,
      startRun: busy('executions/start') as unknown as CoreRouteBindings['startRun'],
      startQuery: busy('queries/start') as unknown as CoreRouteBindings['startQuery'],
      advanceWork: busy('workflow/advance') as unknown as CoreRouteBindings['advanceWork'],
      consumeConsultation: busy('workflow/consultation') as unknown as CoreRouteBindings['consumeConsultation'],
      askLine: busy('queries/ask') as unknown as CoreRouteBindings['askLine'],
      driverStart: busy('workflow/driver-start') as unknown as CoreRouteBindings['driverStart'],
      resolveUnknownRun: busy('the unknown-outcome attestation') as unknown as CoreRouteBindings['resolveUnknownRun'],
      resolveUnknownQueryRun: busy('the unknown-outcome attestation') as unknown as CoreRouteBindings['resolveUnknownQueryRun'] };
    // Slice 2B L8/L15: the human backfill reads the Kernel, so only the leased
    // Host runs it. The route binding may not exist yet in an older route table;
    // installing it by name keeps the gate exact either way.
    (gated as unknown as Record<string, unknown>)['backfillActivityRange'] = busy('activity/backfill');
    return gated;
  }

  /**
   * Stage two of a project's drivers (§4.4): its adoption composite and its route bindings over its own platform and
   * drivers, behind its own lease gate. It needs the settings object, so it runs after them; a project opened later
   * builds it with stage one.
   */
  function buildStageTwo(project: HostProject): void {
    const platform = project.runtime.platform;
    const lease = project.runtime.lease;
  // The adoption composite over J's operation owner and the settings object J publishes (its entry, saved read,
  // serial gate and the forwarded confirmation); a Host without settings publishes no adoption (`unsupported`).
  const adoptionHost = hostSettings === undefined ? undefined : createInitializationAdoptionHost({
    operations: platform.initializationAdoption,
    checks: hostSettings, savedChecks: hostSettings, settingsGate: hostSettings, confirmChecks: hostSettings,
    plans: platform.plans as InitializationAdoptionDependencies['plans'],
    architecture: platform.architecture,
    policies: platform.completionPolicies as InitializationAdoptionDependencies['policies'],
    registration: platform.projects,
    leaseOwned: lease.lease === 'owned',
    buildConfiguration: buildCheckConfiguration,
  });
  // The real route bindings over this project's platform; `host/reconcile-report` answers this project's report.
  const routeBindings = createPlatformCoreRouteBindings(platform, project.collaborationDriver, workbenchTools.tools,
    project.goalFanOut, { readReconcileReport: async () => ({ status: 'ready', value: structuredClone(project.report) }) },
    adoptionHost, scope => { armMessageRelease?.(scope); }, platform.readArchitectureProposal);
  // L8 (book ruling 1): the route-registration path uses the SAME shared step as
  // the settings flow, only after a NON-REPLAYED committed registration. The
  // step itself triggers only when `byScope` already holds the scope.
  const registerWorkspace: CoreRouteBindings['registerWorkspace'] = async (ctx, request) => {
    const written = await routeBindings.registerWorkspace(ctx, request);
    if (written.status === 'committed' && !written.replayed) {
      const ref = written.value.ref;
      captureWorkspaceRegistration({ projectId: ref.projectId, workspaceId: ref.workspaceId });
    }
    return written;
  };
  // `queries/ask` is the person's command: read the line once, select the one
  // profile by the same `scope + sessionRole` rule the consume loop uses, then
  // hand the projected command to the Workflow's one ask entry.
  const askLine: CoreRouteBindings['askLine'] = async (ctx, input) => {
    if (ctx.principal.kind !== 'host' || ctx.principal.actor.kind !== 'human') {
      return { status: 'rejected', code: 'forbidden', reason: 'only the person may call this route' };
    }
    const inputRejection = lineAskInputRejection(ctx.projectId, input);
    if (inputRejection !== null) return inputRejection;
    const card = await platform.sessions.readSession(ctx, input.sessionRef);
    if (card.status === 'not_found') return { status: 'rejected', code: 'not_found', reason: 'the requested record does not exist' };
    if (card.status !== 'ready') {
      return card.status === 'rejected' ? card
        : { status: 'rejected', code: 'incomplete', reason: `the requested record is not ready (${card.status})` };
    }
    const scope = { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' };
    // Ruling 9 (E22): a builder or goal-less line has no profile of its own, so the read-only copy runs on the
    // workspace's first profile instead of refusing the person's question. Ruling 33 keeps the two roles apart:
    // the first profile supplies the budgets, while the copy's `roleBinding` must come from a trusted Work
    // binding of the line's own Role (the copy keeps the source Role and its claim checks it).
    const sameRole = queryProfileOf(scope, card.value.record.role);
    const limits = sameRole ?? runtimeProfiles.find(entry => entry.scope.projectId === scope.projectId
      && entry.scope.workspaceId === scope.workspaceId);
    if (limits === undefined) {
      return { status: 'rejected', code: 'unavailable', reason: 'the Session role has no query profile' };
    }
    const roleId = card.value.record.role.kind === 'legacy_template'
      ? card.value.record.role.templateId : card.value.record.role.pin.ref.roleId;
    const workBinding = sameRole === undefined
      ? servingBinding(workflow?.bindings ?? [], scope.projectId, scope.workspaceId, roleId)
      : null;
    if (sameRole === undefined && workBinding === null) {
      return { status: 'rejected', code: 'unavailable', reason: 'the Session role has no trusted work binding' };
    }
    const roleBinding = sameRole?.roleBinding ?? workBinding!.roleBinding;
    const ask = platform.workflow.askLine;
    if (ask === undefined) {
      return { status: 'rejected', code: 'unsupported', reason: 'the Workflow does not publish the ask entry' };
    }
    return ask(ctx, { ...input, roleBinding, runtimeBudget: limits.runtimeBudget,
      budget: limits.budget, consumerId: limits.consumerId });
  };
  // PL §6.4.3 adoption point 1: the committed first plan exports before the driver starts;
  // the result is unchanged and the export is detached.
  const adoptInitializationWithExport = adoptAndExport(
    (ctx: CoreCallContext, input: Parameters<CoreRouteBindings['adoptInitialization']>[1]) =>
      routeBindings.adoptInitialization(ctx, input),
    async (result, [ctx, input]) => {
      if (result.status !== 'committed') return null;
      const graph = await platform.plans.queryTaskGraph(ctx,
        { goalRef: input.expectedGoal.ref, planRef: result.receipt.plan });
      return graph.status === 'ready' ? { plan: graph.value.plan, scope: {
        projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '',
        goalId: input.expectedGoal.ref.goalId } } : null;
    });
  // An adopted first plan starts its Goal's collaboration driver, replayed commits included (the driver's seed
  // dedupes them); only a context with a workspace starts. The adoption answer is unchanged.
  const adoptInitialization: CoreRouteBindings['adoptInitialization'] = async (ctx, input) => {
    const result = await adoptInitializationWithExport(ctx, input);
    if (result.status === 'committed' && ctx.workspaceId !== undefined) {
      await startGoalDriver({ projectId: ctx.projectId, workspaceId: ctx.workspaceId },
        input.expectedGoal.ref, `plan-adopted:${input.expectedGoal.ref.goalId}:${result.receipt.plan.planId}`);
    }
    return result;
  };
  // PL §6.4.3 adoption point 2: the `plans/apply` binding is the same wrapper; the
  // accepted snapshot is the export input, and the route result is unchanged.
  const applyPlanChangeWithExport = adoptAndExport(
    (...args: Parameters<CoreRouteBindings['applyPlanChange']>) => routeBindings.applyPlanChange(...args),
    (result, [ctx]) => result.status === 'committed'
      ? { plan: result.value, scope: { projectId: result.value.goalRef.projectId,
        workspaceId: ctx.workspaceId ?? '', goalId: result.value.goalRef.goalId } }
      : null);
  // PL §6.4.3: the public advance takes the same candidate/adoption export path as the
  // driver; the route's own release arming stays inside `routeBindings.advanceWork`.
  const advanceWorkWithExport: CoreRouteBindings['advanceWork'] = async (ctx, input, internal) => {
    const advanced = await routeBindings.advanceWork(ctx, input, internal);
    await exportAdvanceResult(platform, ctx, advanced);
    return advanced;
  };
  project.bindings = leaseGated(lease, { ...routeBindings, registerWorkspace, adoptInitialization,
    applyPlanChange: applyPlanChangeWithExport, advanceWork: advanceWorkWithExport, askLine });
  }
  const server: WorkbenchServer = createWorkbenchServer({
    token,
    // V13: a request takes its project's bindings; a project not open answers `unavailable`.
    bindings: projectId => projects.get(projectId)?.bindings ?? null,
    actor,
    bootstrap: buildBootstrap,
    changes,
    allowsScope: scope => byScope.has(scopeKey(scope)),
    ...(hostSettings === undefined ? {} : { settings: hostSettings }),
    ...(options.publicDir === undefined ? {} : { publicDir: options.publicDir }),
    ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
  });

  let listenPromise: Promise<WorkbenchAddress> | undefined;
  let closePromise: Promise<void> | undefined;

  return {
    reconcileOf(projectId: string): HostReconcileReportV1 | null {
      const project = projects.get(projectId);
      return project === undefined ? null : structuredClone(project.report);
    },
    get consumeStatus(): readonly HostConsumeSkipV1[] { return lastConsumeSkips; },
    consumeBarrier(): Promise<void> {
      return new Promise<void>(resolve => { consumeBarrierWaiters.push(() => resolve()); });
    },
    listen(port?: number): Promise<WorkbenchAddress> {
      if (closePromise !== undefined) return Promise.reject(new Error('the workbench Host is closed'));
      listenPromise ??= server.listen(port ?? options.port ?? 0);
      return listenPromise;
    },
    close(): Promise<void> {
      closePromise ??= (async () => {
        // L8 (P11, book ruling 5): stop the queue and abort the running capture
        // FIRST, before the other drains. A queued B accepted just before the
        // close must not start while those drains run; the cancelled capture
        // writes nothing, so its request stays pending for the next start.
        const open = [...projects.values()];
        const autoCaptureClosed = Promise.all(open.map(project => project.autoCapture.close()));
        // the closing signal goes before the HTTP drain (an in-flight `executions/start`
        // must see it), and the driver's `stopRequested` before its loop reads the unavailable result.
        hostClosing.abort('host_closing');
        const collaborationClosed = Promise.all(open.map(project => project.collaborationDriver.close()));
        await server.close();
        const workbenchToolsClosed = workbenchTools.close();
        attentionAbort.abort('host_closing');
        backfillAbort.abort('host_closing');
        await backfillDone;
        await attentionDone.catch(() => { /* the loop records its own state */ });
        await Promise.all([...inputJobs.values()]);
        // The request driver goes before the other drivers and the platform: a
        // pass would otherwise start a round on a platform that is draining.
        // The loop stops scheduling, aborts the signal every drain and every
        // in-flight advance got, and waits for them; the queues then settle
        // what they launched, so no advance is left running into `close`.
        await wakeLoop.close();
        if (lifecycleQueue !== undefined) await lifecycleQueue.close();
        for (const project of open) await project.requestQueues?.settle();
        await goalWaitQueue.settle();
        await collaborationClosed;
        for (const project of open) await project.goalFanOut.close();
        await workbenchToolsClosed;
        await autoCaptureClosed;
        // PL §6.4.3: every detached taskbook write finishes before the stores go away.
        await Promise.all([...pendingTaskbookExports]);
        // Each runtime closes its platform, then releases its lease (HL-06: the lock file goes only while it still
        // names this instance; a Host that never held it never touches it).
        await registry.closeAll();
      })();
      return closePromise;
    },
  };
}
