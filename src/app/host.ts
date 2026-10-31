/**
 * R6.1a local workbench Host.
 *
 * The Host is the ONE place that assembles the trusted startup configuration
 * into the single `createTargetPlatform` instance. It converts the serializable
 * workspace descriptions of the CLI config into the existing
 * `WorkspaceHostBindings`, owns the per-instance temporary token, and exposes
 * an idempotent `close()` that first stops new HTTP work, drains the requests
 * already accepted, then closes the platform.
 *
 * Local settings (`/api/real/settings/`) extend the SAME instance at runtime:
 * a newly opened directory is registered through the real Project/Workspace
 * owner and enters `byScope`, the source/tool roots, `allowedScopes`, the live
 * bootstrap, the Kernel store registry, the trusted Query profiles and the
 * Workflow configuration without stopping the Host. A settings model change is
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
import { makeCommitCursor, seqOfCommitCursor, type GoalRef, type WorkspaceRef } from '../contracts/ledger.js';
import {
  createGoalWaitQueue, createGoalWaitWakes, GOAL_WAITS_QUEUE, GOAL_WAIT_WAKE_AGGREGATE_TYPES, WAKE_LIMIT,
  createGoalWaitRebuild, type GoalWaitRegistries, type GoalWaitWakes,
} from './goal-wait-wakes.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../contracts/prompts/platform-pack.generated.js';
import { renderTemplate } from '../contracts/prompts/render-template.js';
import { createTargetPlatform, type TargetPlatformOptions } from '../composition/create-platform.js';
import type { RecordCommitNotice, RecordCommitObserver } from '../composition/commit-observer.js';
import type { WorkspaceHostBindings } from '../core/workspace/access.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../contracts/core/identity.js';
import type { NoteScribeTodoPort } from '../core/work-graph/model/note-contracts.js';
import type { SessionMailboxPort, SessionMessageSendInputV1 } from '../core/work-graph/model/communication-contracts.js';
import type { SessionMessageRef } from '../contracts/core/session-message.js';
import type { WorkspaceResult } from '../core/workspace/ports.js';
import { createPlatformCoreRouteBindings, type CoreRouteBindings, type HostReconcileReportV1 } from './core-routes.js';
import { acquireHostInstanceLease } from './host-instance-lease.js';
import { announceDisconnect, announceInterruption, systemNotifyRequest } from './host-notices.js';
import { HOST_RECONCILE_ACTOR, runStartupReconcile, type StartupReconcileReportV1 } from './startup-reconcile.js';
import { parseInitialPlanningResponseV2 } from '../core/work-graph/tasks/initial-plan.js';
import { DEFAULT_TASK_AUTOMATION_POLICY } from '../contracts/task-requeue.js';
import { createChangeFeed } from './change-feed.js';
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
import { createQueryStageDriver } from '../business/workflow/query-stage-driver.js';
import {
  attentionSignalToJson, createAttentionObserver, createAttentionScanner, type AttentionScopeV1, type AttentionSignal,
} from './attention-observer.js';
import { renderAttentionChanges } from '../core/agent-runtime/context-assembler.js';
import { READONLY_COMMAND_TOOL_NAME } from '../core/agent-runtime/readonly-command-tool.js';
import { GRAPH_TOOL_NAMES } from '../core/agent-runtime/graph-tools.js';
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
import { createInitializationAdoptionHost, type InitializationAdoptionDependencies } from './initialization-adoption.js';
import {
  createWorkbenchRuntimeHostBindings,
  LOCAL_WORKBENCH_BUDGET,
  LOCAL_WORKBENCH_HOST_TEMPLATE,
  LOCAL_WORKBENCH_ROLE,
  LOCAL_WORKBENCH_ROLE_BINDING,
  narrowResolvedReadonlyCommands,
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
/** The Host's consumer status: the last heartbeat's skips; one write per heartbeat, never persisted. */
export type HostConsumeSkipV1 = { sessionRef: SessionRef; reason: 'no_profile' | 'no_goal' };

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
   * Slice 6A §3.4.7 (book ruling 4.7): the open-secretary cap. Unset means no
   * real cap in 6A (the production adapter always admits). A positive integer
   * selects the adapter that counts the workspace's live secretary Sessions
   * (lifecycle `active`, duty `secretary`) and refuses a new line at the cap.
   * A change is a Host restart with a new option value (the next Host's own
   * profile list and cap are what that open uses).
   */
  secretaryOpenCap?: number;
  /**
   * The request driver switch. Absent means `'on'`: under the instance lease
   * the Host runs a wake loop and two request queues per workspace, so a
   * submitted round advances without any Query route call. `'off'` builds no
   * loop and no queue at all, so a round waits where the command left it, for
   * the Query routes (`queries/claim|prepare|start`) or a later Host with the
   * driver on. Like `secretaryOpenCap` it is a start option — a change is a
   * Host restart — with no settings field and no screen: a caller that drives
   * a round by hand must not race a Host that claims and runs it on its own.
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
  /** Slice 4C-2 §11.5: the one scribe-recipient resolver (7D replaces it);
   * absent falls back to the platform's project-scribe resolver. */
  resolveScribeRecipient?: (ctx: CoreCallContext) => Promise<ReadResult<SessionRef | null>>;
  /** Slice 4C-2 §11.5: the scribe reminder heartbeat period; default 60_000 ms. */
  scribeReminderPeriodMs?: number;
  /** Test seam over the EXISTING platform message sender; never a new sender. */
  sendScribeReminder?: SessionMailboxPort['sendMessage'];
  publicDir?: string;
  maxBodyBytes?: number;
};

export type LocalWorkbenchHost = {
  /** Returns the real loopback address. Repeated calls keep the same token. */
  listen(port?: number): Promise<WorkbenchAddress>;
  /** Idempotent: reject new requests, drain accepted ones, then close the platform. */
  close(): Promise<void>;
  /** A.2 step 5.6 (§12.8, §12.1 step 7): the instance lease and the start-up reconcile report (null without the lease). */
  readonly reconcile: HostReconcileReportV1;
  /** the last heartbeat's skips, in Session-key order; replaced each pass, never persisted, no route. */
  readonly consumeStatus: readonly HostConsumeSkipV1[];
  /** Resolves after the next real `consumeIdle` pass settles; it observes that pass and changes nothing. */
  consumeBarrier(): Promise<void>;
};

const scopeKey = (scope: CoreScope): string => `${scope.projectId}\u0000${scope.workspaceId}`;

// Slice 4C-2 §11.5: the scribe reminder thresholds, default period and the body
// marker the unhandled check recognizes (the SessionMessage record carries no
// send requestId, so the reminder's own leading text is the durable marker).
const SCRIBE_PENDING_THRESHOLD = 10;
const SCRIBE_UPDATE_DUE_THRESHOLD = 5;
const SCRIBE_REMINDER_PERIOD_MS = 60_000;
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

/** A configured/restored root is compared by real path. A root whose real path
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
    && ['deepseek-flash', 'deepseek-v4-pro'].includes(model.model)
    ? 1_000_000 : LOCAL_WORKBENCH_BUDGET.contextWindowTokens;
  return { ...LOCAL_WORKBENCH_BUDGET, contextWindowTokens };
}

/** The local grant's read tools: the Kernel file read and the two read-only
 * graph tools. The local secretary gets these only. */
const LOCAL_READ_TOOL_NAMES: readonly string[] = ['read', ...GRAPH_TOOL_NAMES];

/** The local secretary's tools: the read tools plus the note writer. `record_note` writes WorkGraph notes only, so it
 * needs no file write scope; the grant below keeps that scope empty. */
const LOCAL_SECRETARY_TOOL_NAMES: readonly string[] = [...LOCAL_READ_TOOL_NAMES, ...NOTE_TOOL_NAMES];

/** The local workbench secretary's binding identity. Its Role is the exact
 * platform secretary legacy template, which the Session duty resolver reads as
 * `secretary`; the local binding keeps its own identity and policy revision. */
const LOCAL_SECRETARY_ROLE_BINDING_ID = 'local-workbench-secretary-binding';

function localSecretaryRoleBinding(): WorkbenchQueryProfile['roleBinding'] {
  const template = platformRoleProfile('secretary').template;
  return {
    schemaVersion: 1, bindingId: LOCAL_SECRETARY_ROLE_BINDING_ID,
    templateId: template.templateId, templateRevision: template.templateRevision,
    bindingVersion: 1, policyRevision: 'legacy-template',
  };
}

/** The local secretary's grant: the local grant's model and budget with its read
 * tools and the note writer, the platform secretary duty and the secretary behavior. It never
 * carries a write scope, a command tool or command access. */
function localSecretaryGrant(localGrant: WorkbenchRuntimeBinding['grant']): WorkbenchRuntimeBinding['grant'] {
  const template = platformRoleProfile('secretary').template;
  return {
    budget: structuredClone(localGrant.budget),
    hostTemplate: {
      templateId: template.templateId, revision: template.templateRevision,
      digest: sha256Hex(PLATFORM_PROMPT_PACK_V1.templates['skill-platform-secretary']),
    },
    tools: [...LOCAL_SECRETARY_TOOL_NAMES],
    writeScope: [],
    skills: { bundle: 'platform', behaviors: ['secretary'] },
    systemInstruction: null,
    deniedPrefixes: [],
    processSandboxOptions: {},
    materialBasis: null,
    platformDuty: 'secretary',
    ...(localGrant.contextResidentBytes === undefined ? {} : { contextResidentBytes: localGrant.contextResidentBytes }),
  };
}

/** One Host configuration version over the explicit resolved fields: a change
 * to the duty, resident bytes, tools, write scope or model is a new version.
 * The prefix separates the local workbench's two bindings. */
function localBindingRevision(prefix: 'local-workbench' | 'local-secretary', scope: CoreScope,
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
    // and `find_graph` instead of the three old read names. The old adapters
    // keep their exports and behavior for already-bound Runs and explicit
    // callers; the read-only Query ceiling still strips every mailbox name.
    // RW-1 (4C): `record_note` is a coordination tool that writes WorkGraph
    // records, so it follows the same `writeAllowed` condition as the mailbox
    // tools; a read-only or Query ceiling still strips it.
    tools: [...LOCAL_READ_TOOL_NAMES,
      ...(readonlyCommandsAllowed ? [READONLY_COMMAND_TOOL_NAME] : []),
      ...(writeAllowed ? ['write', 'record_note', 'send_session_message',
        'read_session_inbox', 'read_session_message', 'read_session_message_body'] : []),
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
  const architectureSource = options.architectureSource === undefined
    ? undefined
    : { provider: options.architectureSource.provider, configPath: options.architectureSource.configPath };
  if (options.runtime !== undefined && options.runtimeConfiguration !== undefined)
    throw new Error('provide either a programmatic runtime or a runtimeConfiguration, not both');
  const runtimeConfiguration: WorkbenchRuntimeConfiguration | undefined = options.runtimeConfiguration === undefined
    ? undefined : structuredClone(options.runtimeConfiguration);
  const checks: TargetPlatformOptions['checks'] = options.checks === undefined ? undefined : structuredClone(options.checks);
  const workflow: TargetPlatformOptions['workflow'] = options.workflow === undefined ? undefined : structuredClone(options.workflow);
  // Slice 6A §3.4.7: a cap is a positive integer or absent (no cap). A bad
  // value fails startup instead of silently admitting everything.
  if (options.secretaryOpenCap !== undefined
    && (!Number.isSafeInteger(options.secretaryOpenCap) || options.secretaryOpenCap < 1)) {
    throw new Error('secretaryOpenCap must be a positive integer when present');
  }
  // The request driver is a two-valued start switch; an unreadable value fails
  // the start instead of silently driving rounds or silently dropping them.
  if (options.requestDriver !== undefined && options.requestDriver !== 'on' && options.requestDriver !== 'off') {
    throw new Error("requestDriver must be 'on' or 'off' when present");
  }
  // The live profile projection the request commands
  // read. It is declared before the platform so the profile port's getter can
  // see the settings rebuild that splices it in place.
  const runtimeProfiles: WorkbenchQueryProfile[] = (runtimeConfiguration?.queryProfiles ?? []).map(profile => structuredClone(profile));
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
  const resourceCaps: ResourceCapSource = { current: () => ({ ...resourceCapsRequest }) };
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
          automation: { ...DEFAULT_TASK_AUTOMATION_POLICY }, resourceCaps: resourceCaps.current() })), runtimeNarrowing));
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

  // Task E: the one in-process change feed. It observes every RecordStore
  // commit of the platform below and the two in-memory handle owners the page
  // used to poll, and publishes change NOTIFICATIONS only.
  const changes = createChangeFeed();
  // A.2 step 5.5: the Goal fan-out driver (assembled below, over this
  // platform) also observes the commits, so a fan-out pause that lands later
  // re-drives the waiting Goal resume (GOAL-14). Neither observer can affect a
  // commit or the other observer.
  let goalFanOutCommitted: ((notice: RecordCommitNotice) => void) | undefined;
  // The request driver's wake loop is built over the platform's published
  // owners, so it exists only after the platform. Both bindings below are set
  // right after it: until then a wake or a notice starts nothing, and the
  // rounds stay on record for the start-up rebuild.
  let requestDriverCommitted: ((notice: RecordCommitNotice) => void) | undefined;
  let requestWakeSink: ((scope: WorkspaceScope, source: 'request_command') => void) | undefined;
  let armMessageRelease: ((scope: WorkspaceScope) => void) | undefined;
  // L8 (book ruling 1): the mutable trigger sink handed to the platform BEFORE
  // the driver exists; each formal adoption/revision/PASS calls it after its
  // non-replayed commit, and the driver is installed right after the platform.
  let architectureCaptureTrigger:
    ((event: { kind: 'catalog_adopted' | 'catalog_revised' | 'check_passed'; projectId: string }) => void) | undefined;
  const commitObserver: RecordCommitObserver = {
    started(head) { changes.started(head); },
    committed(notice) {
      try { changes.committed(notice); } catch { /* the change feed keeps its own state */ }
      try { goalFanOutCommitted?.(notice); } catch { /* the driver never affects a commit */ }
      try { requestDriverCommitted?.(notice); } catch { /* the loop never affects a commit */ }
    },
  };
  // A.2 step 5.6 (§12.1 step 0, §12.8): the Host instance lease is taken BEFORE the platform. Without it
  // this Host serves reads and owner writes only: no reconcile, no execution driver, no Kernel entry (L-10).
  if (storage.kind === 'sqlite') mkdirSync(storage.directory, { recursive: true });
  const instanceLease = await acquireHostInstanceLease({ directory: storage.kind === 'sqlite' ? storage.directory : null,
    now: options.now ?? (() => new Date().toISOString()) });
  const leaseOwned = instanceLease.lease === 'owned';
  // Slice 6A §3.4.1: the Host's `SecretaryProfilePort` over its live query
  // profiles. The duty resolver is installed below, once the platform's role
  // read exists; a command can only run after this function returns.
  let hostDutyResolver: SessionDutyResolver | undefined;
  const secretaryProfiles = createSecretaryProfiles({
    profiles: () => runtimeProfiles,
    duty: async (role, ctx) => hostDutyResolver === undefined
      ? { status: 'rejected' as const, code: 'unavailable' as const, reason: 'the Host duty resolver is not ready' }
      : await hostDutyResolver(role, ctx),
  });
  // (W-11): one process-local closing signal, trusted option only; not a setting, route or
  // persisted field. `close()` aborts it first so live Work pauses at its next safe point.
  const hostClosing = new AbortController();
  let platform: Awaited<ReturnType<typeof createTargetPlatform>>;
  try {
    platform = await createTargetPlatform({
      storage,
      workspace: bindings,
      commitObserver,
      hostInstance: { hostInstanceId: instanceLease.hostInstanceId, lease: instanceLease.lease, takeover: instanceLease.takeover },
      hostClosing: hostClosing.signal,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(architectureSource === undefined ? {} : { architectureSource }),
      ...(options.lightScan === undefined ? {} : { lightScan: options.lightScan }),
      ...(options.kernelStores === undefined ? {} : { kernelStores: options.kernelStores }),
      ...(runtime === undefined ? {} : { runtime }),
      ...(checks === undefined ? {} : { checks }),
      ...(workflow === undefined ? {} : { workflow }),
      secretaryProfiles,
      ...(options.secretaryOpenCap === undefined ? {} : { secretaryOpenCap: options.secretaryOpenCap }),
      sourcePolicyFor,
      resourceCaps,
      operatorActor: actor,
      ...(promptsRoot === undefined ? {} : { promptPacks: createDiskPromptPackSource(promptsRoot) }),
      // L8: the sink exists before the driver; its calls are ignored until then.
      onArchitectureCaptureTrigger: event => { architectureCaptureTrigger?.(event); },
      // A request command's commit reaches the wake loop of the workspace it
      // landed in; the sink is bound once the loop exists, and the platform
      // never drives a round by itself.
      requestWake: (scope, source) => { requestWakeSink?.(scope, source); },
      // A committed approval through the trusted entry arms the release queue; a replay included, and
      // arming twice is harmless (`7a2-rgp-v7.md:1076`).
      onMessageReleaseApproved: approved => { armMessageRelease?.({
        projectId: approved.messageRef.projectId, workspaceId: approved.messageRef.workspaceId,
      }); },
    });
  } catch (error) {
    await instanceLease.release().catch(() => undefined);
    throw error;
  }
  // Slice 6A §3.4.1: the SAME resolver rule the composition's own instance
  // applies, over this Host's platform role read and Workflow configuration.
  hostDutyResolver = createSessionDutyResolver({
    readRoleSpec: platform.roles.readRoleSpec.bind(platform.roles),
    configuration: workflow,
  });

  // L8 (book ruling 2): ONE automatic-capture driver for this Host, over the
  // platform's observed/catalog ports. Its detached work is the platform's own
  // tracked work, so `platform.close()` waits for exactly the same set.
  const autoCapture = createAutoCaptureDriver({
    architecture: platform.architecture,
    catalog: platform.architecture,
    boundWorkspaces: () => workspaces.map(workspace => ({
      projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId,
    })),
    actor: AUTO_CAPTURE_ACTOR,
    ...(platform.trackDetached === undefined ? {} : { track: platform.trackDetached }),
  });
  // The platform's formal triggers now reach the driver, everywhere in this Host.
  // A Host without the lease writes nothing (HL-02, HL-07), so it never captures.
  if (leaseOwned) architectureCaptureTrigger = event => autoCapture.projectChanged(event.projectId, event.kind);
  /**
   * L8 (book ruling 1): the ONE shared registration step of both paths. It
   * triggers only once the scope's root is bound in this Host's `byScope`; the
   * settings path calls it after `addWorkspaceState`, the route path after a
   * non-replayed committed `registerWorkspace` (wrapped below).
   */
  const captureWorkspaceRegistration = (scope: CoreScope): void => {
    if (!leaseOwned || !byScope.has(scopeKey(scope))) return;
    autoCapture.workspaceRegistered({ projectId: scope.projectId, workspaceId: scope.workspaceId });
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
  /** `ChangeFeed.head()` is the feed's already-typed commit cursor, but its public type erases the brand; the one
   *  ledger codec turns it back into the cursor the driver registers with. A null head stays null (nothing seen yet). */
  const observedCursor = (): CommitCursor | null => {
    const head = changes.head();
    return head === null ? null : makeCommitCursor(seqOfCommitCursor(head as CommitCursor));
  };
  // The AG2b collaboration driver is a Host-layer handle over the ONE platform
  // above. Newly opened scopes append their trusted profiles at runtime.
  const workbenchTools = createWorkbenchTools({
    workspaces: workspaces.map(workspace => ({
      scope: workspace.scope,
      root: workspace.root,
      readPrefixes: workspace.readPrefixes,
      ...(workspace.writePrefixes === undefined ? {} : { writePrefixes: workspace.writePrefixes }),
      ...(workspace.allowCommands === undefined ? {} : { allowCommands: workspace.allowCommands }),
    })),
    onCommandChange: changes.commandChanged,
    resourceCaps,
  });
  const collaborationDriver = createCollaborationDriver({
    workflow: platform.workflow,
    runtime: platform.runtime,
    sessions: platform.sessions,
    executions: platform.executions,
    mailbox: platform.messages,
    controls: platform.controls,
    profiles: runtimeConfiguration?.queryProfiles ?? [],
    // The same per-scope registries the goal-waits queue drains: one instance per scope,
    // shared with the adapter, and the Host's observed head stamped before the fact read.
    goalWaits: goalWaitWakesOf,
    observedCursor,
    onChange: changes.driverChanged,
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
    // L-10: only the Host holding the instance lease reaches the Runs.
    driving: () => leaseOwned });
  goalFanOutCommitted = notice => goalFanOut.committed(notice);

  // The Host's one system-notice bag: the published send/fact/line-detail ports and the same `{records, sessions}` bag
  // the disconnect projection reads. Declared before the wake loop, so every drain sees it initialized.
  const hostNotices = { messages: platform.messages, facts: platform.sessionFacts, nodeDetail: platform.nodeDetail, disconnect: platform.disconnect };

  // The one wake loop exists whenever the Host owns the instance lease. The goal-waits
  // queue is registered on it in every case; the two request queues, the lifecycle and
  // release queues and their sinks stay inside the request-driver switch, so with it off
  // a submitted round waits where the command left it but a goal wait still wakes.
  let wakeLoop: WakeLoop | undefined;
  let requestQueues: ReturnType<typeof createRequestRoundQueues> | undefined;
  let lifecycleQueue: ReturnType<typeof createHandoffQueue> | undefined;
  if (leaseOwned) {
    const loop = createWakeLoop({ driving: () => leaseOwned });
    // The queue must see a commit even when the request driver is off, or a goal parked
    // on a registration would never be woken by the Host's own consume turns.
    requestDriverCommitted = notice => loop.committed(notice);
    const goalWaitRegistriesV1: GoalWaitRegistries = { all: () => goalWaitRegistries };
    const goalWaitQueue = createGoalWaitQueue({
      registries: goalWaitRegistriesV1,
      // BW's one Workflow advance for the goal; the same host context every consume pass uses.
      wake: (scope, goalRef) => collaborationDriver.wake(hostContext(scope), goalRef),
      rebuild: createGoalWaitRebuild({ ctx: scope => hostScopeContext(scope, actor), sessions: platform.sessions, facts: platform.sessionFacts, released: platform.messageRelease,
        held: async (ctx, goalRef) => {
          if (platform.automationPolicy().resumeOnStartup === 'auto') return false;
          const read = await goalFanOut.readGoalDisplay(ctx, { goalRef });
          if (read.status !== 'ready') throw notReady('the Goal interruption read', read);
          return read.value.display.causes.some(cause => 'interruption' in cause);
        } }),
    });
    loop.register(GOAL_WAITS_QUEUE, goalWaitQueue, {
      aggregateTypes: GOAL_WAIT_WAKE_AGGREGATE_TYPES, maxItems: WAKE_LIMIT,
    });
    if (options.requestDriver !== 'off') {
      // The automatic entry after a secretary round: the published Workflow's own two entries.
      const handoffOwner = platform.workflow.sessionHandoff;
    // The round-end sources waiting for their basis read and start. Memory only: a crash between a round end and
    // its read loses one check until that line's next round end, which records it again.
    const pendingRoundEnds = new Map<string, Map<string, SessionRef>>();
    /** The round-end hook: record the source for this workspace and wake its lifecycle queue. It never throws. */
    const recordRoundEnd = async (ctx: CoreCallContext, session: SessionRef): Promise<void> => {
      const key = scopeKey({ projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' });
      const sources = pendingRoundEnds.get(key) ?? new Map<string, SessionRef>();
      sources.set(plainSessionRefKey(session), session);
      pendingRoundEnds.set(key, sources);
      loop.wake({ projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' }, LIFECYCLE_QUEUE, 'advance_settled');
    };
    const queues = createRequestRoundQueues({
      rounds: platform.requestRounds,
      facts: platform.requestFacts,
      sessions: platform.sessionFacts,
      profiles: platform.secretaryProfiles,
      drain: platform.requestIntake.drainUnassigned,
      driver: createQueryStageDriver({
        queries: platform.queries, runtime: platform.runtime, facts: platform.requestFacts,
        fence: platform.readHandoffFence,
        onRoundEnded: recordRoundEnd,
      }),
      // Every pass runs as the Host's own system actor; the loop's abort signal
      // goes into the context, so closing stops a pass at its next request. A
      // pass starts only at `start`, `addWorkspace` or a wake, all of which come
      // after the Host's context builder below exists.
      context: (scope: WorkspaceScope, signal: AbortSignal) =>
        ({ ...hostScopeContext(scope, HOST_RECONCILE_ACTOR), signal }),
      // An advance settling can make the next round of that workspace runnable
      // at once; a `blocked` advance leaves it for the next commit notice, the
      // next request command or a line registration.
      wake: (scope: WorkspaceScope) => { loop.wake(scope, REQUEST_ROUNDS_QUEUE, 'advance_settled'); },
    });
    // Both queues are registered once per loop: a handler takes the scope, so
    // every workspace the loop covers runs the same two. The loop covers the
    // start-up workspaces in `start` and a later one in `addWorkspace`.
    loop.register(REQUEST_ROUNDS_QUEUE, queues.rounds,
      { aggregateTypes: ['QueryJob', 'QueryRun', 'Session', 'SessionMessage'] });
    loop.register(REQUEST_UNASSIGNED_QUEUE, queues.unassigned);
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
    const startPendingHandoffs = async (ctx: CoreCallContext, failures: string[]): Promise<void> => {
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
    /** Phase 2: every unfinished operation once, through its own arm; a wait or a failure never stops the next. */
    const continueUnfinished = async (ctx: CoreCallContext, failures: string[]):
      Promise<{ continued: number; blocked: number }> => {
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
          const result = kind === 'handoff'
            ? await handoffOwner.continueHandoff(ctx, { operation })
            : await handoffOwner.manualArchive(ctx, { operation });
          if (result.status === 'ready') {
            if (result.value.revision > revision) continued += 1;
            else blocked += 1;
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
     * One whole lifecycle traversal: pending round ends, then every unfinished operation once. A transient item is
     * recorded and stepped past; only a traversal that progressed nothing throws, so the loop's own back-off reruns the
     * whole traversal.
     */
    const runLifecyclePass = async (ctx: CoreCallContext): Promise<{ continued: number; blocked: number }> => {
      const failures: string[] = [];
      await startPendingHandoffs(ctx, failures);
      const { continued, blocked } = await continueUnfinished(ctx, failures);
      if (continued === 0 && failures.length > 0) {
        throw new Error(`the lifecycle pass failed: ${failures.join('; ')}`);
      }
      return { continued, blocked };
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
        const announceDisconnections = async (): Promise<void> => {
          let cursor: string | null = null;
          do {
            const page = await platform.sessions.findSessions(ctx, { workspace: scope, includeArchived: true,
              page: { limit: 200, ...(cursor === null ? {} : { cursor }) } });
            if (page.status !== 'ready') return;                       // the next Session commit / start retries
            for (const card of page.value.items) {
              if (card.availability !== 'unavailable') continue;       // the one derived gone test
              await announceDisconnect(ctx, hostNotices, { scope,
                sessionRef: { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId } });
            }
            cursor = page.value.nextCursor;
          } while (cursor !== null);
        };
        const pass = await lifecycle.run(ctx);
        // The third step, after `continueUnfinished`: `scope` is `drain`'s own, and N's request ids make a repeat a no-op.
        await announceDisconnections();
        return { progressed: pass.continued, more: false, continuation: null, wrapped: true, blocked: pass.blocked };
      },
    };
    loop.register(LIFECYCLE_QUEUE, lifecycleHandler, { aggregateTypes: LIFECYCLE_WAKE_AGGREGATE_TYPES });
    // The release queue: ONE pass per wake. It chooses no message and no page — the Workflow's own release step
    // does that (`book-7a.md:380–:381`); the pass asks each active Goal's one selection and performs what the step
    // names, until that Goal has nothing left in THIS pass. A pass that released nothing reports no progress and
    // the loop parks the pair until the next wake; a blocked item is never a handler failure (`:386–:389`;
    // `wake-loop.ts:19–:24`).
    const runReleasePass = async (ctx: CoreCallContext): Promise<{ released: number; blocked: number }> => {
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
    requestQueues = queues;
    lifecycleQueue = lifecycle;
    }
    wakeLoop = loop;
  }

  // Live projections the Host rebuilds for every bootstrap read / settings open.
  // `runtimeProfiles` itself is declared before the platform (the request
  // profile port reads it live through a getter).
  const publishedProfileIds = new Set(runtimeProfiles.map(profile => profile.id));
  const workflowScopes: CoreScope[] = workflow === undefined ? []
    : [...new Map(workflow.bindings.map(binding => [scopeKey(binding.workspace), { ...binding.workspace }])).values()];
  const workflowConsumerId = workflow?.consumerId ?? 'local-workbench-consumer';

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

  async function registerKernelStore(scope: CoreScope): Promise<void> {
    if (platform.kernelStores.registerCurrent === undefined) return;
    const directory = storage.kind === 'sqlite'
      ? join(storage.directory, 'kernel-stores')
      : join(settingsDirectory as string, 'kernel-stores');
    mkdirSync(directory, { recursive: true });
    const suffix = sha256Hex(scopeKey(scope)).slice(0, 32);
    await platform.kernelStores.registerCurrent({
      adapterId: `host-settings-kernel-${suffix}`, storeKey: `host-settings-kernel-${suffix}`,
      workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId },
      databasePath: join(directory, `${suffix}.sqlite`),
    });
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
      platformRoleProfile('secretary').template, localSecretaryRoleBinding(), model);
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
      const secretaryGrant = localSecretaryGrant(grant);
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
    }
    return { schemaVersion: 1, bindings: nextBindings, queryProfiles: nextProfiles };
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

  const installFromSettings = (snapshot: HostSettingsPrivateSnapshot): void => {
    // C8 (A.2 step 5.6): the Host setting `automation` (defaults 3 / ask) governs the
    // requeue owner, the read model and the start-up re-drive (`resumeOnStartup`).
    platform.registerAutomationPolicy(snapshot.automation);
    // L13: install the effective resource-cap values into the ONE holder. The
    // already-built platform, Runtime and workbench page read `current()` live,
    // so the next command of an already-running execution uses the new values.
    resourceCapsRequest = { memoryMaxBytes: snapshot.resourceCaps.memoryMaxBytes, tasksMax: snapshot.resourceCaps.tasksMax };
    // R6 cold-start: restore/refresh the trusted check configuration for every
    // scope whose saved checks were explicitly approved. It replaces only the
    // per-scope registration; an already-open round keeps its frozen config.
    // An approved empty array installs too: it replaces the old configuration
    // and the static fallback (AM1 A3).
    for (const entry of snapshot.checks) {
      if (!workspaces.some(candidate => scopeKey(candidate.scope) === scopeKey(entry.scope))) continue;
      platform.registerCheckConfiguration({ configuration: buildCheckConfiguration({ scope: entry.scope,
        source: { answerRef: entry.answerRef, answerDigest: entry.answerDigest }, checks: entry.checks }) });
    }
    if (!rebuildRuntimeFromSettings || resolverRegistry === undefined) return;
    const configuration = buildRuntimeConfiguration(snapshot);
    resolverRegistry.install(createWorkbenchRuntimeHostBindings(configuration,
      versionProvider(versionSecretSource(configuration, snapshot)), runtimeNarrowing));
    // Only a SUCCESSFUL install publishes executable profiles: the live
    // bootstrap projection becomes exactly the installed configuration's
    // queryProfiles (every startup profile is preserved). A newly selected
    // workspace joins the collaboration driver only now, after the binding
    // exists; an already-running handle keeps its pinned version.
    const nextProfiles = configuration.queryProfiles.map(profile => structuredClone(profile));
    const added = nextProfiles.filter(profile => !publishedProfileIds.has(profile.id));
    runtimeProfiles.splice(0, runtimeProfiles.length, ...nextProfiles);
    for (const profile of added) publishedProfileIds.add(profile.id);
    if (added.length > 0) collaborationDriver.addProfiles(added);
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
  async function addWorkspaceState(config: WorkbenchWorkspaceConfig): Promise<void> {
    const key = scopeKey(config.scope);
    if (byScope.has(key)) return;
    workspaces.push(config);
    byScope.set(key, config);
    workbenchTools.addWorkspace({
      scope: config.scope, root: config.root, readPrefixes: config.readPrefixes,
      ...(config.writePrefixes === undefined ? {} : { writePrefixes: config.writePrefixes }),
      ...(config.allowCommands === undefined ? {} : { allowCommands: config.allowCommands }),
    });
    await registerKernelStore(config.scope);
    // A newly opened workspace publishes NO executable profile here: until a
    // model is selected and the settings install succeeds there is no installed
    // runtime binding for this scope. The workflow binding below is role/grant
    // metadata, not a model binding, and stays.
    platform.registerWorkflowBinding({
      consumerId: workflowConsumerId,
      binding: {
        workspace: { projectId: config.scope.projectId, workspaceId: config.scope.workspaceId },
        sessionRole: structuredClone(LOCAL_WORKBENCH_ROLE),
        roleBinding: structuredClone(LOCAL_WORKBENCH_ROLE_BINDING),
        // A Work reuses the investigation/planning Session. Its cumulative
        // budget must admit that normal history before the first model call.
        budget: { tokenBudget: 1_000_000, deadline: null },
      },
    });
    workflowScopes.push({ projectId: config.scope.projectId, workspaceId: config.scope.workspaceId });
    goalWaitRegistries.push({ scope: config.scope, waits: createGoalWaitWakes() });
    if (reconcileAddedScope !== null) await reconcileAddedScope(config.scope);
    // A workspace opened later joins the request driver only after its
    // reconcile, in the same order the start takes, so the reconcile's own
    // commits wake nothing; its rounds then stand where the records leave them.
    if (wakeLoop !== undefined) {
      await wakeLoop.addWorkspace({ projectId: config.scope.projectId, workspaceId: config.scope.workspaceId });
    }
  }

  async function openWorkspaceImpl(request: OpenSettingsWorkspace & { workspaceId?: string }): Promise<SettingsResponse<HostSettingsOpenedHost>> {
    let canonical: string;
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
    const requestedProjectId = request.projectId;
    const isRestore = request.workspaceId !== undefined;
    // A PUBLIC explicit projectId must be a CURRENT Host project. The private
    // restore path (identified only by the internal `workspaceId` parameter,
    // which the HTTP route never carries) may re-attach an original ledger
    // record the Host has not rebound yet.
    if (requestedProjectId !== undefined && !isRestore
      && !workspaces.some(workspace => workspace.scope.projectId === requestedProjectId))
      return { status: 'rejected', code: 'invalid', reason: 'the target project is not a Host project' };
    // Idempotent lookup by canonical root: without an explicit project search
    // every current workspace; with one search only that project.
    for (const workspace of workspaces) {
      if (requestedProjectId !== undefined && workspace.scope.projectId !== requestedProjectId) continue;
      if (await canonicalExisting(workspace.root) === canonical)
        return { status: 'ready', value: { scope: { ...workspace.scope } } };
    }
    const projectId = requestedProjectId ?? randomBytes(16).toString('hex');
    const workspaceId = request.workspaceId ?? randomBytes(16).toString('hex');
    const scope: CoreScope = { projectId, workspaceId };
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
      await addWorkspaceState({
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
      && (check.kind === 'static' || check.kind === 'dynamic')
      && typeof check.command === 'string' && check.command.length > 0
      && typeof check.cwd === 'string'
      && typeof check.timeoutMs === 'number' && Number.isSafeInteger(check.timeoutMs) && check.timeoutMs > 0
      && (check.taskIds === 'all'
        || (Array.isArray(check.taskIds) && check.taskIds.every(id => typeof id === 'string' && id.length > 0)));
  }

  const hostAssembly: HostSettingsAssembly = {
    listWorkspaces: () => workspaces.map(workspace => ({
      scope: { projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId },
      name: workspace.name,
      root: workspace.root,
      workspaceRevision: workspace.workspaceRevision,
      modelId: null,
      writeAllowed: (workspace.writePrefixes?.length ?? 0) > 0,
      commandsAllowed: workspace.allowCommands === true,
    })),
    readCheckProposal: async (scope, answerRef) => {
      if (answerRef.projectId !== scope.projectId || answerRef.workspaceId !== scope.workspaceId) {
        return { status: 'rejected', code: 'not_found', reason: 'the saved Answer is outside this workspace scope' };
      }
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

  // The awaited startup restore of every persisted directory registration
  // happens here, before the server exists and before `listen`.
  const settingsCatalog = settingsEnabled
    ? projectSettingsCatalog(runtimeConfiguration)
    : { models: [] as HostSettingsModelDefinition[], seedSelection: {} as Record<string, string | null> };
  const hostSettings: (HostSettingsPort & ChecksAdoptionEntryPort) | undefined = settingsEnabled
    ? await createHostSettings({
      settingsDirectory: settingsDirectory as string,
      ...(promptsRoot === undefined ? {} : {
        promptsRoot,
        assertWorkspaceRoot: async (root: string) => {
          await assertRootOutsidePrompts(root, promptsRoot as string);
        },
      }),
      models: [
        ...settingsCatalog.models,
        ...((options.settings?.models ?? []).map(model => structuredClone(model))),
      ],
      seedSelection: settingsCatalog.seedSelection,
      assembly: hostAssembly,
    }, {
      onConfigurationChanged: installFromSettings,
      adoption: { buildConfiguration: buildCheckConfiguration, confirmInstalledChecks: platform.confirmInstalledChecks },
    })
    : undefined;
  // The adoption composite over J's operation owner and the settings object J publishes (its entry, saved read,
  // serial gate and the forwarded confirmation); a Host without settings publishes no adoption (`unsupported`).
  const adoptionHost = hostSettings === undefined ? undefined : createInitializationAdoptionHost({
    operations: platform.initializationAdoption,
    checks: hostSettings, savedChecks: hostSettings, settingsGate: hostSettings, confirmChecks: hostSettings,
    plans: platform.plans as InitializationAdoptionDependencies['plans'],
    architecture: platform.architecture,
    policies: platform.completionPolicies as InitializationAdoptionDependencies['policies'],
    registration: platform.projects,
    leaseOwned,
    buildConfiguration: buildCheckConfiguration,
  });

  // A.2 step 5.6 (§12.1 steps 1..7): the start-up reconcile, on the Host holding the instance lease only,
  // after the settings restore registered every workspace's Kernel Store and installed the automation
  // policy, and before any execution driver, the attention delivery or the HTTP server starts.
  // The reconcile writes as the Host's own system actor (R source, §12.1; VR-04 "Host system actor +
  // hostInstanceId"); the start-up re-drive starts the driver as `workflow/driver-start` does, as the Host actor.
  const hostScopeContext = (scope: CoreScope, as: WorkbenchActor): CoreCallContext => ({
    projectId: scope.projectId, workspaceId: scope.workspaceId,
    principal: { kind: 'host', actor: { ...as } },
    materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor: { ...as } },
    signal: new AbortController().signal,
  });
  const reconcileContext = (scope: CoreScope): CoreCallContext => hostScopeContext(scope, HOST_RECONCILE_ACTOR);
  // Slice 2B L7: with the instance lease, every served workspace records its
  // start-of-recording epoch BEFORE the start-up reconcile, so a Run that ends
  // after this instant and has no tally reads `not_recorded` (an error) rather
  // than an old `not_backfilled` one. A Host without the lease writes nothing.
  if (leaseOwned) {
    for (const workspace of workspaces) {
      const recorded = await platform.runActivity.ensureActivityRecording(hostScopeContext(workspace.scope, actor), {
        input: { workspace: { projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId } },
        meta: { requestId: `host-activity-recording:${scopeKey(workspace.scope)}`, expected: [] },
      });
      if (recorded.status !== 'committed') {
        throw new Error(`the start-of-recording write failed: ${JSON.stringify(recorded)}`);
      }
    }
  }
  const reconcileScopes = (scopes: readonly CoreScope[]) => runStartupReconcile({
    platform: { sessions: platform.sessions, executions: platform.executions, controls: platform.controls,
      plans: platform.plans, reconcile: platform.reconcile },
    hostInstanceId: instanceLease.hostInstanceId,
    resumeOnStartup: platform.automationPolicy().resumeOnStartup,
    takeover: instanceLease.takeover,
    scopes: scopes.map(scope => ({ projectId: scope.projectId, workspaceId: scope.workspaceId })),
    context: reconcileContext,
    fanOut: (ctx, goalRef, options) => goalFanOut.fanOut(ctx, goalRef, options),
    ...(lifecycleQueue === undefined ? {} : { handoffQueue: lifecycleQueue }),
  });
  const reconcileReport = leaseOwned ? await reconcileScopes(workspaces.map(workspace => workspace.scope)) : null;
  const hostReconcile: HostReconcileReportV1 = { hostInstanceId: instanceLease.hostInstanceId, lease: instanceLease.lease,
    leaseRow: instanceLease.row, leaseReason: instanceLease.reason, report: reconcileReport };
  // L8 (book ruling 5): after the workspaces are bound (settings restore included)
  // every pending bound workspace gets a `startup_retry`; detached, and a pending
  // workspace not bound in this Host is simply not passed here. Like the start-up
  // re-drive below it needs the lease and `automation.resumeOnStartup`: only `'off'`
  // stops the retry, as a start then only reconciles (§12.10 step 5) and the next trigger retries.
  if (leaseOwned && platform.automationPolicy().resumeOnStartup !== 'off') {
    autoCapture.retryPending(workspaces.map(workspace => ({
      projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId,
    })));
  }
  // The one start both the start-up re-drive and an adopted first plan use: the Goal's own profile ids, the Host
  // actor's scope context, and a `select_work` advance. A refused start leaves the Goal for the next
  // `workflow/advance` or `driver-start`.
  const startGoalDriver = async (scope: CoreScope, goalRef: GoalRef, flowId: string,
    answers?: StartupReconcileReportV1['redriveGoals'][number]['answers']): Promise<void> => {
    const profileIds = runtimeProfiles.filter(profile => profile.scope.projectId === scope.projectId
      && profile.scope.workspaceId === scope.workspaceId).map(profile => profile.id);
    try {
      await collaborationDriver.start(hostScopeContext(scope, actor), {
        advance: { schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work',
          ...(answers === undefined || answers.length === 0 ? {} : { answers }) },
        queryProfileIds: profileIds,
      });
    } catch { /* a refused start leaves the Goal for the next workflow/advance or driver-start */ }
  };
  // §12.1 step 6b (LA-6): the start-up re-drive starts the existing collaboration driver for each selected
  // Goal (a pending automation verdict or a not-entered Run), gated by `automation.resumeOnStartup` being `'auto'`; every
  // step it takes is judged by the owners, and its rework steps run as the Workflow's automation actor.
  const startRedrive = async (report: StartupReconcileReportV1): Promise<void> => {
    if (platform.automationPolicy().resumeOnStartup !== 'auto') return;
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
  if (reconcileReport !== null) await startRedrive(reconcileReport);
  // The request driver starts only now, after the start-up reconcile and its
  // re-drive: their commits must not wake a pass, and both queues rebuild
  // read-only from the records. With `resumeOnStartup` off each workspace's
  // queues stay unarmed until the first request command wakes them, so nothing
  // starts on its own after a restart.
  if (wakeLoop !== undefined) {
    await wakeLoop.start(workspaces.map(workspace => ({
      projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId,
    })), { resumeOnStartup: platform.automationPolicy().resumeOnStartup !== 'off' });
  }
  // Slice 2B L8/B2: after the start-up reconcile, the leased Host backfills the
  // last 14 days in the background, one batch at a time, until done, a
  // `retry_later` or close. The cursor is memory-only: the records are the
  // progress, so nothing is written when nothing needs doing.
  const backfillAbort = new AbortController();
  const backfillDone: Promise<void> = !leaseOwned ? Promise.resolve() : (async () => {
    for (const workspace of workspaces) {
      if (backfillAbort.signal.aborted) return;
      const scope = { projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId };
      const ctx: CoreCallContext = { ...hostScopeContext(scope, actor), signal: backfillAbort.signal };
      let cursor: string | null = null;
      try {
        for (;;) {
          if (backfillAbort.signal.aborted) return;
          const batch: ReadResult<import('../business/workflow/contracts.js').ActivityBackfillBatchV1> | undefined =
            await platform.workflow.backfillRecentActivity?.(ctx, { workspace: scope, cursor });
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
    const report = hostReconcile.report;
    if (!leaseOwned || report === null) return;
    const recorded = await platform.runActivity.ensureActivityRecording(hostScopeContext(scope, actor), {
      input: { workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId } },
      meta: { requestId: `host-activity-recording:${scopeKey(scope)}`, expected: [] },
    });
    if (recorded.status !== 'committed') return;
    const added = await reconcileScopes([scope]);
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
    await startRedrive(added);
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
   * One workspace's consume batch over C's published view: up to `CONSUME_BATCH` candidate Sessions in
   * Session-key order, each at most one turn, and the next continuation key. A Session with no matching
   * profile or no Goal is skipped with its reason and stays queued; `notify` never reaches this loop because
   * C's `nextMessage` is never a notify. A non-ready page returns the same `after` so the next heartbeat
   * retries it, never "nothing to do".
   */
  async function consumeIdle(scope: WorkspaceScope, after: string | null): Promise<string | null> {
    const ctx = hostContext(scope);
    const page = await platform.consumableSessions.readConsumableSessions(ctx,
      { workspace: scope, after, limit: CONSUME_BATCH });
    if (page.status !== 'ready') return after;
    const skips: HostConsumeSkipV1[] = [];
    for (const candidate of page.value.items) {
      // notify-only (and every other no-offer candidate): no turn, zero model calls.
      const offer = candidate.nextMessage;
      if (offer === null) continue;
      // Never guess the model: the first configured profile whose scope and sessionRole match this Session.
      const profile = runtimeProfiles.find(entry => entry.scope.projectId === scope.projectId
        && entry.scope.workspaceId === scope.workspaceId
        && canonicalJson(entry.sessionRole as never) === canonicalJson(candidate.role as never));
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
        // The one public intervention dispatch; a claimed turn ends this Session's scan, and every
        // other message of the Session stays queued for a later safe point.
        const claimed = await platform.workflow.handleIntervention?.(ctx, {
          messageRef: offer.messageRef, roleBinding: profile.roleBinding,
          runtimeBudget: profile.runtimeBudget, budget: profile.budget, consumerId: profile.consumerId,
        });
        if (claimed?.status === 'claimed') {
          const addressed = claimed.claim.task;
          await announceInterruption({ ...reconcileContext(scope), signal: ctx.signal }, hostNotices, {
            scope: { projectId: addressed.projectId, workspaceId: read.value.ref.workspaceId },
            sessionRef: candidate.session,
            personMessageRef: offer.messageRef,
          });
          await collaborationDriver.start(hostScopeContext({ projectId: addressed.projectId,
            workspaceId: read.value.ref.workspaceId }, actor), {
            advance: { schemaVersion: 1, flowId: `intervention:${claimed.claim.runRef.runId}`,
              goalRef: { aggregateType: 'Goal' as const, projectId: addressed.projectId, goalId: addressed.goalId },
              sessionHint: claimed.claim.sessionRef, kind: 'select_work', taskId: addressed.taskId },
            queryProfileIds: [profile.id],
          });
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
  // narrow seams (the platform's by default), and the send reuses the EXISTING
  // platform sender, never a second one.
  const noteScribeTodos: NoteScribeTodoPort | undefined = options.noteScribeTodos
    ?? { readScribeTodos: platform.notes.readScribeTodos, readLedgerCursor: platform.notes.readLedgerCursor };
  const resolveScribeRecipient = options.resolveScribeRecipient ?? platform.notes.resolveScribeRecipient;
  const sendScribeReminder = options.sendScribeReminder ?? platform.messages.sendMessage.bind(platform.messages);
  const scribeReminderPeriodMs = options.scribeReminderPeriodMs ?? SCRIBE_REMINDER_PERIOD_MS;
  const nowIso = options.now ?? (() => new Date().toISOString());
  const clockMs = (): number => Date.parse(nowIso());

  /**
   * §11.5/§11.7: the per-workspace reminder memory. It lasts for the life of
   * this Host only; after a restart the first check rebuilds the unhandled
   * state by paging each recipient's whole inbox once.
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
  type ScribeReminderState = {
    lastCheckAtMs: number;
    /** `undefined` = no check computed yet; otherwise the cursor of the last check. */
    computedAtCursor: string | null | undefined;
    pendingSend: SessionMessageSendInputV1 | null;
    sentRequestId: string | null;
    recipients: Map<string, ScribeRecipientMemory>;
  };
  const scribeReminderStates = new Map<string, ScribeReminderState>();
  function scribeReminderState(key: string): ScribeReminderState {
    const existing = scribeReminderStates.get(key);
    if (existing !== undefined) return existing;
    const created: ScribeReminderState = { lastCheckAtMs: Number.NEGATIVE_INFINITY,
      computedAtCursor: undefined, pendingSend: null, sentRequestId: null, recipients: new Map() };
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
  async function scribeReminderDisposition(ctx: CoreCallContext, recipient: SessionRef,
    state: ScribeReminderState): Promise<ReminderDisposition> {
    const memory = recipientMemory(state, recipient);
    if (memory.ref !== null) {
      const read = await platform.messages.readMessage(ctx, memory.ref);
      if (read.status !== 'ready') return 'unknown';
      const completion = await inputCompletion(ctx, read.value);
      if (completion === 'unknown') return 'unknown';
      if (completion === 'not_completed') return 'unhandled';
      memory.ref = null; // handled: fall through to a fresh inbox page
    }
    if (!memory.recovered) {
      let cursor: string | undefined;
      do {
        const inbox = await platform.messages.readInbox(ctx, { recipient,
          page: { limit: 100, ...(cursor === undefined ? {} : { cursor }) } });
        if (inbox.status !== 'ready') return 'unknown';
        for (const message of inbox.value.items) {
          if (message.sender.kind !== 'host' || message.intent !== 'notify') continue;
          const completion = await inputCompletion(ctx, message);
          if (completion === 'unknown') return 'unknown';
          if (completion === 'completed') continue;
          const body = await platform.messages.readMessageBody(ctx, { messageRef: message.ref, part: 'message' });
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

  /** §11.5 step 5: send the pending request; on `committed` record it so the
   * next period does not send it again. A thrown/failed send keeps `pendingSend`,
   * so the next period retries the SAME requestId. */
  async function sendPendingScribeReminder(ctx: CoreCallContext, state: ScribeReminderState): Promise<void> {
    const pending = state.pendingSend;
    if (pending === null) return;
    try {
      const sent = await sendScribeReminder(ctx, pending);
      if (sent.status === 'committed') {
        state.pendingSend = null;
        state.sentRequestId = pending.meta.requestId;
        recipientMemory(state, pending.input.recipient).ref = sent.value.ref;
      }
    } catch { /* a failed send stays pending for the next period */ }
  }

  async function runScribeReminderCheck(scope: CoreScope): Promise<void> {
    if (noteScribeTodos === undefined) return;
    const state = scribeReminderState(scopeKey(scope));
    // 1. the reminder's OWN period, on the INJECTED clock.
    const atMs = clockMs();
    if (atMs - state.lastCheckAtMs < scribeReminderPeriodMs) return;
    state.lastCheckAtMs = atMs;
    const ctx = hostContext(scope);

    // 2. the ledger cursor. A failed read does nothing this pass and leaves
    // `computedAtCursor` unset, so the next period retries.
    const cursorRead = await noteScribeTodos.readLedgerCursor(ctx);
    if (cursorRead.status !== 'ready') return;
    const cursor = cursorRead.value;

    // Rework 2 item 3: retry ONLY when the cursor did not move. A pending send
    // belongs to a specific computed cursor; once the cursor moves it is stale.
    if (state.computedAtCursor !== undefined && cursor === state.computedAtCursor) {
      if (state.pendingSend !== null) await sendPendingScribeReminder(ctx, state);
      return;
    }
    // The cursor moved (or this is the first check): drop any stale pending
    // request so it can never be resent to a recipient the ledger has left.
    state.pendingSend = null;

    const recipient = await resolveScribeRecipient(ctx);
    if (recipient.status !== 'ready' || recipient.value === null) return;
    // The resolver may hand back the Session AGGREGATE ref; the mailbox address
    // is the plain `{ projectId, sessionId }` (a bare SessionRef).
    const recipientRef: SessionRef = { projectId: recipient.value.projectId, sessionId: recipient.value.sessionId };

    // 4. the unhandled check. `unknown` sends nothing and leaves the cursor
    // unset; an unhandled reminder sends nothing but records the cursor.
    const disposition = await scribeReminderDisposition(ctx, recipientRef, state);
    if (disposition === 'unknown') return;
    if (disposition === 'unhandled') { state.computedAtCursor = cursor; return; }

    const goalIds = await platform.notes.goalIdsForWorkspace(ctx);
    if (goalIds.status !== 'ready') return;
    const todos = await noteScribeTodos.readScribeTodos(ctx, { goalIds: goalIds.value });
    if (todos.status !== 'ready') return;
    let pendingCount = 0;
    let updateDueCount = 0;
    let immediate = false;
    const identities = new Set<string>();
    const anchorNames = new Set<string>();
    for (const goal of todos.value) {
      pendingCount += goal.pending.length;
      updateDueCount += goal.updateDueTodos.length;
      if (goal.immediate) immediate = true;
      for (const todo of [...goal.pending, ...goal.updateDueTodos]) {
        identities.add(todo.identity);
        anchorNames.add(todo.anchorKey);
      }
    }
    state.computedAtCursor = cursor;
    if (!immediate && pendingCount < SCRIBE_PENDING_THRESHOLD && updateDueCount < SCRIBE_UPDATE_DUE_THRESHOLD) return;
    const requestId = 'scribe-reminder:' + scope.workspaceId + ':' + recipientRef.sessionId + ':'
      + sha256Hex(canonicalJson([...identities].sort() as never));
    if (state.sentRequestId === requestId) return;
    const text = renderTemplate(PLATFORM_PROMPT_PACK_V1, 'scribe-reminder', {
      marker: SCRIBE_REMINDER_MARKER,
      pendingCount: String(pendingCount),
      updateDueCount: String(updateDueCount),
      anchors: [...anchorNames].slice(0, 20).join('、'),
    }, []).text;
    state.pendingSend = systemNotifyRequest({ recipient: recipientRef, text, requestId });
    await sendPendingScribeReminder(ctx, state);
  }

  // L-10: without the instance lease this Host delivers no attention and wakes no consumer (no execution driver).
  const attentionDone: Promise<void> = !leaseOwned ? Promise.resolve() : (async () => {
    const scanner = createAttentionScanner({ workspace: platform.workspace, messages: platform.messages,
      readAttentionGraph: platform.runtime.readAttentionGraph.bind(platform.runtime) });
    const entries = attentionScopes.map(scope => ({
      scope, observer: createAttentionObserver(scope.config),
      confirmedSequences: new Map<string, number>(), nextSequence: 0,
      pending: [] as { signals: readonly import('./attention-observer.js').AttentionSignal[]; sequence: number; messageRef: import('../contracts/core/session-message.js').SessionMessageRef; snapshot: Awaited<ReturnType<typeof scanner.scan>> }[],
    }));
    const period = Math.max(1, Math.min(...attentionScopes.map(scope => scope.config.heartbeatMs),
      ...inputConsumers.map(entry => entry.heartbeatMs), scribeReminderPeriodMs));
    const lastInputScan = new Map<string, number>();
    const expiryCursors = new Map<string, DueWaitPageInputV1['after']>();
    const expireDueWaits = async (): Promise<void> => {
      for (const workspace of workspaces) {
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
        const key = scopeKey(workspace.scope);
        if (inputJobs.has(key) || Date.now() - (lastInputScan.get(key) ?? 0) < period) continue;
        lastInputScan.set(key, Date.now());
        const after = consumeCursors.get(key) ?? null;
        const job = consumeIdle(workspace.scope, after)
          .then(next => { consumeCursors.set(key, next); })
          .catch(() => { /* original facts remain retryable */ })
          .finally(() => inputJobs.delete(key))
          .finally(() => { for (const resolve of consumeBarrierWaiters.splice(0)) resolve(); });
        inputJobs.set(key, job);
      }
      for (const entry of entries) {
        if (attentionAbort.signal.aborted) break;
        const scope = entry.scope.scope;
        const hostCtx: CoreCallContext = {
          projectId: scope.projectId, workspaceId: scope.workspaceId,
          principal: { kind: 'host', actor: { ...actor } },
          materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor: { ...actor } },
          signal: attentionAbort.signal,
        };
        if (entry.pending.length > 0) {
          const remaining: typeof entry.pending = [];
          for (const item of entry.pending) {
            try {
              const read = await platform.messages.readMessage(hostCtx, item.messageRef);
              if (read.status === 'ready' && await inputCompleted(hostCtx, read.value)) {
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
        try { snapshot = await scanner.scan(hostCtx, entry.scope); }
        catch { continue; }
        if (attentionAbort.signal.aborted) break;
        if (entry.observer.processed === null) entry.observer.prime(snapshot);
        const delivery = entry.observer.observe(snapshot, clockMs());
        if (delivery === null || entry.scope.targetSession === null) continue;
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
          targetSession: entry.scope.targetSession, paths: entry.scope.paths,
          files: snapshot.files.map(file => ({ path: file.path, version: file.version })),
          graph: snapshot.graph,
          signals: delivery.signals.map(attentionSignalToJson),
        } as never));
        try {
          const sent = await platform.messages.sendMessage(hostCtx,
            systemNotifyRequest({ recipient: entry.scope.targetSession, text, requestId }));
          if (sent.status === 'committed') {
            entry.observer.markDelivered(snapshot, delivery.signals);
            entry.pending.push({ signals: delivery.signals, sequence: ++entry.nextSequence, messageRef: sent.value.ref, snapshot });
          }
        } catch { /* a failed delivery leaves the input unprocessed and is retried */ }
      }
      // Slice 4C-2 §11.5: every configured workspace, whether or not attention
      // or input consumers are configured. A failed check records nothing and
      // is retried on the next heartbeat.
      for (const workspace of workspaces) {
        if (attentionAbort.signal.aborted) break;
        try { await runScribeReminderCheck(workspace.scope); } catch { /* retried next heartbeat */ }
      }
      await sleepUntilAbort(period, attentionAbort.signal);
    }
  })();

  /**
   * HL-07 (L-1, L-10): a Host without the instance lease keeps every read and
   * owner write, but each entry that would enter the Kernel or start an
   * execution driver, and the attestations, answer `busy`: only the Host that
   * holds the lease enters the Kernel, so its reconcile proofs stay sound.
   */
  function leaseGated(bindings: CoreRouteBindings): CoreRouteBindings {
    if (leaseOwned) return bindings;
    const busy = (what: string) => async () => ({ status: 'rejected' as const, code: 'busy' as const,
      reason: `another Host holds the instance lease of this store; ${what} runs only there (${instanceLease.reason})` });
    const gated: CoreRouteBindings = { ...bindings,
      startRun: busy('executions/start') as unknown as CoreRouteBindings['startRun'],
      startQuery: busy('queries/start') as unknown as CoreRouteBindings['startQuery'],
      advanceWork: busy('workflow/advance') as unknown as CoreRouteBindings['advanceWork'],
      consumeConsultation: busy('workflow/consultation') as unknown as CoreRouteBindings['consumeConsultation'],
      driverStart: busy('workflow/driver-start') as unknown as CoreRouteBindings['driverStart'],
      resolveUnknownRun: busy('the unknown-outcome attestation') as unknown as CoreRouteBindings['resolveUnknownRun'],
      resolveUnknownQueryRun: busy('the unknown-outcome attestation') as unknown as CoreRouteBindings['resolveUnknownQueryRun'] };
    // Slice 2B L8/L15: the human backfill reads the Kernel, so only the leased
    // Host runs it. The route binding may not exist yet in an older route table;
    // installing it by name keeps the gate exact either way.
    (gated as unknown as Record<string, unknown>)['backfillActivityRange'] = busy('activity/backfill');
    return gated;
  }

  // The real route bindings share the ONE platform instance assembled above.
  const routeBindings = createPlatformCoreRouteBindings(platform, collaborationDriver, workbenchTools.tools, goalFanOut,
    { readReconcileReport: async () => ({ status: 'ready', value: structuredClone(hostReconcile) }) }, adoptionHost,
    scope => { armMessageRelease?.(scope); });
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
  // An adopted first plan starts its Goal's collaboration driver, replayed commits included (the driver's seed
  // dedupes them); only a context with a workspace starts. The adoption answer is unchanged.
  const adoptInitialization: CoreRouteBindings['adoptInitialization'] = async (ctx, input) => {
    const result = await routeBindings.adoptInitialization(ctx, input);
    if (result.status === 'committed' && ctx.workspaceId !== undefined) {
      await startGoalDriver({ projectId: ctx.projectId, workspaceId: ctx.workspaceId },
        input.expectedGoal.ref, `plan-adopted:${input.expectedGoal.ref.goalId}:${result.receipt.plan.planId}`);
    }
    return result;
  };
  const server: WorkbenchServer = createWorkbenchServer({
    token,
    bindings: leaseGated({ ...routeBindings, registerWorkspace, adoptInitialization }),
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
    get reconcile(): HostReconcileReportV1 { return structuredClone(hostReconcile); },
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
        const autoCaptureClosed = autoCapture.close();
        // the closing signal goes before the HTTP drain (an in-flight `executions/start`
        // must see it), and the driver's `stopRequested` before its loop reads the unavailable result.
        hostClosing.abort('host_closing');
        const collaborationClosed = collaborationDriver.close();
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
        if (wakeLoop !== undefined) await wakeLoop.close();
        if (lifecycleQueue !== undefined) await lifecycleQueue.close();
        if (requestQueues !== undefined) await requestQueues.settle();
        await collaborationClosed;
        await goalFanOut.close();
        await workbenchToolsClosed;
        await autoCaptureClosed;
        await platform.close();
        // HL-06: the lock file goes only while it still names this instance; a Host that never held it never touches it.
        await instanceLease.release().catch(() => undefined);
      })();
      return closePromise;
    },
  };
}
