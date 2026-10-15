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
import { realpath, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { canonicalJson, sha256Hex, type JsonValue } from '../contracts/fingerprint.js';
import { createTargetPlatform, type TargetPlatformOptions } from '../composition/create-platform.js';
import type { RecordCommitNotice, RecordCommitObserver } from '../composition/commit-observer.js';
import type { WorkspaceHostBindings } from '../core/workspace/access.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { WorkspaceRef } from '../contracts/ledger.js';
import type { WorkspaceResult } from '../core/workspace/ports.js';
import { createPlatformCoreRouteBindings, type CoreRouteBindings, type HostReconcileReportV1 } from './core-routes.js';
import { acquireHostInstanceLease } from './host-instance-lease.js';
import { HOST_RECONCILE_ACTOR, runStartupReconcile, type StartupReconcileReportV1 } from './startup-reconcile.js';
import { parseInitialPlanningResponseV2 } from '../core/work-graph/tasks/initial-plan.js';
import type { TrustedCheckConfiguration } from '../contracts/verification.js';
import { DEFAULT_TASK_AUTOMATION_POLICY } from '../contracts/task-requeue.js';
import { createChangeFeed } from './change-feed.js';
import { createCollaborationDriver } from './collaboration-driver.js';
import { createGoalFanOutDriver } from './goal-fan-out-driver.js';
import { createWorkbenchTools } from './workbench-tools.js';
import {
  attentionSignalToJson, createAttentionObserver, createAttentionScanner, type AttentionScopeV1, type AttentionSignal,
} from './attention-observer.js';
import { renderAttentionChanges } from '../core/agent-runtime/context-assembler.js';
import { READONLY_COMMAND_TOOL_NAME } from '../core/agent-runtime/readonly-command-tool.js';
import type { RuntimeHostBindings, ResolvedRuntimeConfiguration } from '../core/agent-runtime/execution-contracts.js';
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
} from './host-settings.js';
import type {
  HostSettingsPort, OpenSettingsWorkspace, SettingsResponse,
} from './host-settings-types.js';
import {
  createWorkbenchRuntimeHostBindings,
  LOCAL_WORKBENCH_BUDGET,
  LOCAL_WORKBENCH_HOST_TEMPLATE,
  LOCAL_WORKBENCH_ROLE,
  LOCAL_WORKBENCH_ROLE_BINDING,
  narrowResolvedReadonlyCommands,
  PLATFORM_SKILL_RESOURCE_ROOT,
  settingsModelSecretVariable,
  type WorkbenchModelConfiguration,
  type WorkbenchQueryProfile,
  type WorkbenchRuntimeBinding,
  type WorkbenchRuntimeConfiguration,
  type WorkbenchRuntimeNarrowing,
  type WorkbenchRuntimeProviderDependencies,
} from './runtime-configuration.js';
import { createWorkbenchServer, type WorkbenchAddress, type WorkbenchServer } from './server.js';

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

export type LocalWorkbenchHostOptions = {
  storage: TargetPlatformOptions['storage'];
  actor: WorkbenchActor;
  workspaces: WorkbenchWorkspaceConfig[];
  port?: number;
  review?: BootstrapReviewMaterial;
  architectureSource?: TargetPlatformOptions['architectureSource'];
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
  publicDir?: string;
  maxBodyBytes?: number;
};

export type LocalWorkbenchHost = {
  /** Returns the real loopback address. Repeated calls keep the same token. */
  listen(port?: number): Promise<WorkbenchAddress>;
  /** Idempotent: reject new requests, drain accepted ones, then close the platform. */
  close(): Promise<void>;
  readonly address: WorkbenchAddress | null;
  /** A.2 step 5.6 (§12.8, §12.1 step 7): the instance lease and the start-up reconcile report (null without the lease). */
  readonly reconcile: HostReconcileReportV1;
};

const scopeKey = (scope: CoreScope): string => `${scope.projectId}\u0000${scope.workspaceId}`;

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
    tools: ['read', 'look_graph', 'find_graph',
      ...(readonlyCommandsAllowed ? [READONLY_COMMAND_TOOL_NAME] : []),
      ...(writeAllowed ? ['write', 'send_session_message',
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
  validateWorkspaces(workspaces, settingsEnabled);
  const architectureSource = options.architectureSource === undefined
    ? undefined
    : { provider: options.architectureSource.provider, configPath: options.architectureSource.configPath };
  if (options.runtime !== undefined && options.runtimeConfiguration !== undefined)
    throw new Error('provide either a programmatic runtime or a runtimeConfiguration, not both');
  const runtimeConfiguration: WorkbenchRuntimeConfiguration | undefined = options.runtimeConfiguration === undefined
    ? undefined : structuredClone(options.runtimeConfiguration);
  const checks: TargetPlatformOptions['checks'] = options.checks === undefined ? undefined : structuredClone(options.checks);
  const workflow: TargetPlatformOptions['workflow'] = options.workflow === undefined ? undefined : structuredClone(options.workflow);
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
  const startupCatalogOptions = new Map<string, { provider: string; options: Record<string, JsonValue> }>();
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
  const commitObserver: RecordCommitObserver = {
    started(head) { changes.started(head); },
    committed(notice) {
      try { changes.committed(notice); } catch { /* the change feed keeps its own state */ }
      try { goalFanOutCommitted?.(notice); } catch { /* the driver never affects a commit */ }
    },
  };
  // A.2 step 5.6 (§12.1 step 0, §12.8): the Host instance lease is taken BEFORE the platform. Without it
  // this Host serves reads and owner writes only: no reconcile, no execution driver, no Kernel entry (L-10).
  if (storage.kind === 'sqlite') mkdirSync(storage.directory, { recursive: true });
  const instanceLease = await acquireHostInstanceLease({ directory: storage.kind === 'sqlite' ? storage.directory : null,
    now: options.now ?? (() => new Date().toISOString()) });
  const leaseOwned = instanceLease.lease === 'owned';
  let platform: Awaited<ReturnType<typeof createTargetPlatform>>;
  try {
    platform = await createTargetPlatform({
      storage,
      workspace: bindings,
      commitObserver,
      hostInstance: { hostInstanceId: instanceLease.hostInstanceId, lease: instanceLease.lease },
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(architectureSource === undefined ? {} : { architectureSource }),
      ...(options.kernelStores === undefined ? {} : { kernelStores: options.kernelStores }),
      ...(runtime === undefined ? {} : { runtime }),
      ...(checks === undefined ? {} : { checks }),
      ...(workflow === undefined ? {} : { workflow }),
      sourcePolicyFor,
      resourceCaps,
      operatorActor: actor,
    });
  } catch (error) {
    await instanceLease.release().catch(() => undefined);
    throw error;
  }

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
    onChange: changes.driverChanged,
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

  // Live projections the Host rebuilds for every bootstrap read / settings open.
  const runtimeProfiles: WorkbenchQueryProfile[] = (runtimeConfiguration?.queryProfiles ?? []).map(profile => structuredClone(profile));
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

  function localWorkbenchProfile(scope: CoreScope, bindingId: string, model: HostSettingsStoredModel): WorkbenchQueryProfile {
    const suffix = sha256Hex(scopeKey(scope)).slice(0, 16);
    return {
      id: `local-workbench-query-${suffix}`,
      label: 'Local workbench',
      scope: { projectId: scope.projectId, workspaceId: scope.workspaceId },
      runtimeBindingId: bindingId,
      sessionRole: structuredClone(LOCAL_WORKBENCH_ROLE),
      roleBinding: structuredClone(LOCAL_WORKBENCH_ROLE_BINDING),
      runtimeBudget: localWorkbenchBudget(model),
      budget: { maxTokens: null, deadline: null },
      consumerId: workflowConsumerId,
    };
  }

  function settingsModelBinding(model: HostSettingsStoredModel): WorkbenchModelConfiguration {
    const variable = typeof model.apiKey === 'string' && model.apiKey.length > 0
      ? settingsModelSecretVariable(model.id)
      : (model.secretEnvironmentVariable ?? settingsModelSecretVariable(model.id));
    const original = startupCatalogOptions.get(model.id);
    const options: Record<string, JsonValue> = original?.provider === model.provider
      ? structuredClone(original.options) : {};
    if (model.thinking !== undefined) options['thinking'] = model.thinking;
    if (model.reasoningEffort !== undefined) options['reasoningEffort'] = model.reasoningEffort;
    return {
      revision: `host-settings:${model.id}`,
      provider: model.provider,
      model: model.model,
      ...(model.baseUrl === undefined || model.baseUrl.length === 0 ? {} : { baseUrl: model.baseUrl }),
      ...(Object.keys(options).length === 0 ? {} : { options }),
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
      // Slice 3 (§4.6): the revision is a function of the explicit resolved
      // fields, so a change to the duty, budget, tools, write scope or model is
      // a new Host configuration version instead of the same scope-only digest.
      const configurationRevision = `local-workbench:s3@${sha256Hex(canonicalJson({
        scope: { projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId },
        duty: grant.platformDuty ?? 'executor',
        residentBytes: grant.contextResidentBytes ?? 4096,
        tools: grant.tools,
        writeScope: grant.writeScope,
        modelRevision: boundModel.revision,
      } as unknown as JsonValue)).slice(0, 16)}`;
      nextBindings.push({
        id: bindingId,
        label: 'Local workbench',
        scope: { projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId },
        role: structuredClone(LOCAL_WORKBENCH_ROLE),
        configurationRevision,
        model: boundModel,
        grant,
      });
      nextProfiles.push(localWorkbenchProfile(workspace.scope, bindingId, selected));
    }
    return { schemaVersion: 1, bindings: nextBindings, queryProfiles: nextProfiles };
  }

  const installFromSettings = (snapshot: HostSettingsPrivateSnapshot): void => {
    // C8 (A.2 step 5.6): the Host setting `automation` (defaults 3 / true) governs the
    // requeue owner, the read model and the start-up re-drive (`resumeOnStartup`).
    platform.registerAutomationPolicy(snapshot.automation);
    // L13: install the effective resource-cap values into the ONE holder. The
    // already-built platform, Runtime and workbench page read `current()` live,
    // so the next command of an already-running execution uses the new values.
    resourceCapsRequest = { memoryMaxBytes: snapshot.resourceCaps.memoryMaxBytes, tasksMax: snapshot.resourceCaps.tasksMax };
    // R6 cold-start: restore/refresh the trusted check configuration for every
    // scope whose saved checks were explicitly approved. It replaces only the
    // per-scope registration; an already-open round keeps its frozen config.
    for (const entry of snapshot.checks) {
      const workspace = workspaces.find(candidate => scopeKey(candidate.scope) === scopeKey(entry.scope));
      if (workspace === undefined || entry.checks.length === 0) continue;
      // R6 cold-start: the configuration revision is a function of the exact
      // approved checks AND their saved-Answer source digest, not the scope
      // alone, so a re-approval of different content/source is a new version.
      const configurationRevision = `host-settings-checks:${sha256Hex(canonicalJson({
        answerDigest: entry.answerDigest, checks: entry.checks,
      } as unknown as JsonValue)).slice(0, 16)}`;
      const configuration: TrustedCheckConfiguration = {
        configurationRevision,
        workspace: { aggregateType: 'Workspace', projectId: entry.scope.projectId, workspaceId: entry.scope.workspaceId },
        executor: { ...actor },
        permissionRevision: permissionRevision(actor, workspace),
        sourceAccess: 'verification_workspace',
        processAccess: 'all_except_denied',
        deniedPrefixes: ['.git'],
        checks: structuredClone(entry.checks),
      };
      platform.registerCheckConfiguration({ configuration });
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
      const identity = canonicalJson({
        provider, model: binding.model.model, baseUrl: baseUrl ?? null,
        secretEnvironmentVariable, options: binding.model.options ?? null,
      } as never);
      const id = `runtime-${sha256Hex(identity).slice(0, 16)}`;
      startupCatalogOptions.set(id, { provider, options: structuredClone(binding.model.options ?? {}) });
      if (!modelsById.has(id)) {
        modelsById.set(id, {
          id, label: `${provider} ${binding.model.model}`, provider, model: binding.model.model,
          ...(baseUrl === undefined ? {} : { baseUrl }),
          secretEnvironmentVariable,
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
    if (reconcileAddedScope !== null) await reconcileAddedScope(config.scope);
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
      if (existingRegistration.status !== 'ready') {
        const registered = await platform.projects.registerWorkspace(ctx, {
          input: { workspace: scope },
          meta: { requestId: `host-settings-workspace:${workspaceId}`, expected: [
            { ref: { aggregateType: 'Project', projectId }, revision: projectRevision },
            { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 0 },
          ] },
        });
        if (registered.status !== 'committed') return { status: 'rejected', code: 'unavailable', reason: 'the workspace could not be registered' };
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
    listProjectIds: () => [...new Set(workspaces.map(workspace => workspace.scope.projectId))],
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
  const hostSettings: HostSettingsPort | undefined = settingsEnabled
    ? await createHostSettings({
      settingsDirectory: settingsDirectory as string,
      models: [
        ...settingsCatalog.models,
        ...((options.settings?.models ?? []).map(model => structuredClone(model))),
      ],
      seedSelection: settingsCatalog.seedSelection,
      assembly: hostAssembly,
    }, { onConfigurationChanged: installFromSettings })
    : undefined;

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
    scopes: scopes.map(scope => ({ projectId: scope.projectId, workspaceId: scope.workspaceId })),
    context: reconcileContext,
    fanOut: (ctx, goalRef, options) => goalFanOut.fanOut(ctx, goalRef, options),
  });
  const reconcileReport = leaseOwned ? await reconcileScopes(workspaces.map(workspace => workspace.scope)) : null;
  const hostReconcile: HostReconcileReportV1 = { hostInstanceId: instanceLease.hostInstanceId, lease: instanceLease.lease,
    leaseRow: instanceLease.row, leaseReason: instanceLease.reason, report: reconcileReport };
  // §12.1 step 6b (LA-6): the start-up re-drive starts the existing collaboration driver for each selected
  // Goal (a pending automation verdict or a not-entered Run), gated by `automation.resumeOnStartup`; every
  // step it takes is judged by the owners, and its rework steps run as the Workflow's automation actor.
  const startRedrive = async (goals: StartupReconcileReportV1['redriveGoals']): Promise<void> => {
    if (!platform.automationPolicy().resumeOnStartup) return;
    for (const goal of goals) {
      const scope = goal.scope;
      const profileIds = runtimeProfiles.filter(profile => profile.scope.projectId === scope.projectId
        && profile.scope.workspaceId === scope.workspaceId).map(profile => profile.id);
      try {
        await collaborationDriver.start(hostScopeContext(scope, actor), {
          advance: { schemaVersion: 1, goalRef: goal.goalRef, flowId: `startup-redrive:${goal.goalRef.goalId}`,
            sessionHint: null, kind: 'select_work' },
          queryProfileIds: profileIds,
        });
      } catch { /* a refused start leaves the Goal for the next workflow/advance or driver-start */ }
    }
  };
  if (reconcileReport !== null) await startRedrive(reconcileReport.redriveGoals);
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
    report.fanOut.push(...added.fanOut);
    report.redriveGoals.push(...added.redriveGoals);
    report.problems.push(...added.problems);
    await startRedrive(added.redriveGoals);
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
  const hostContext = (scope: CoreScope): CoreCallContext => ({
    ...scope, principal: { kind: 'host', actor: { ...actor } },
    materialReader: { kind: 'host', ...scope, actor: { ...actor } }, signal: attentionAbort.signal,
  });
  async function inputCompleted(ctx: CoreCallContext, message: import('../core/work-graph/model/communication-contracts.js').SessionMessage): Promise<boolean> {
    for (const accepted of message.acceptedInputs ?? []) {
      if (accepted.part !== 'message') continue;
      const ref = accepted.executionRef;
      if (ref.aggregateType === 'Run') {
        const read = await platform.executions.readExecution(ctx, ref);
        if (read.status === 'ready' && read.value.run.status === 'ended' && read.value.run.outcome === 'completed') return true;
      } else {
        const read = await platform.queries.readQueryJob(ctx, { aggregateType: 'QueryJob', projectId: ref.projectId, workspaceId: ref.workspaceId, queryJobId: ref.queryJobId });
        if (read.status === 'ready' && read.value.run.ref.runId === ref.runId && read.value.job.job.answerRefs.length > 0) {
          const answer = await platform.queries.readQueryAnswer(ctx, read.value.job.job.answerRefs.at(-1)!);
          if (answer.status === 'ready') return true;
        }
      }
    }
    return false;
  }
  async function consumeIdle(entry: WorkbenchInputConsumer): Promise<void> {
    const ctx = hostContext(entry.scope);
    const profile = runtimeConfiguration?.queryProfiles.find(p => p.id === entry.queryProfileId
      && p.scope.projectId === entry.scope.projectId && p.scope.workspaceId === entry.scope.workspaceId);
    if (profile === undefined) return;
    const card = await platform.sessions.readSession(ctx, entry.sessionRef);
    if (card.status !== 'ready' || card.value.record.lifecycle !== 'active' || canonicalJson(card.value.record.role as never) !== canonicalJson(profile.sessionRole as never)) return;
    const prior = card.value.record.lastExecutionRef;
    if (prior?.aggregateType === 'Run') {
      const read = await platform.executions.readExecution(ctx, prior);
      if (read.status !== 'ready') return;
      const desired = read.value.run.controlState?.desiredState;
      if (desired === 'paused' || desired === 'cancelled' || read.value.run.outcome === 'cancelled') return;
    }
    if (prior?.aggregateType === 'QueryRun') {
      const read = await platform.queries.readQueryJob(ctx, { aggregateType: 'QueryJob', projectId: prior.projectId, workspaceId: prior.workspaceId, queryJobId: prior.queryJobId });
      if (read.status !== 'ready' || read.value.run.run.outcome === 'cancelled') return;
    }
    let cursor: string | undefined;
    do {
      const inbox = await platform.messages.readInbox(ctx, { recipient: entry.sessionRef, page: { limit: 100, ...(cursor === undefined ? {} : { cursor }) } });
      if (inbox.status !== 'ready') return;
      for (const message of inbox.value.items) {
        const inquiry = message.intent === 'inquiry' || (message.intent === undefined && message.replyMode === 'wait');
        if (message.status === 'responded' || (!inquiry && await inputCompleted(ctx, message))) continue;
        if (!inquiry && (card.value.availability !== 'idle' || card.value.record.occupancy !== null)) continue;
        await platform.workflow.consumeConsultation?.(ctx, {
          schemaVersion: 1, messageRef: message.ref, goalRef: entry.goalRef,
          roleBinding: profile.roleBinding, runtimeBudget: profile.runtimeBudget, budget: profile.budget, consumerId: profile.consumerId,
        });
        return;
      }
      cursor = inbox.value.nextCursor ?? undefined;
    } while (cursor !== undefined && !attentionAbort.signal.aborted);
    if (card.value.availability !== 'idle' || card.value.record.occupancy !== null) return;
    cursor = undefined;
    do {
      const outbox = await platform.messages.readOutbox(ctx, { senderSession: entry.sessionRef, page: { limit: 100, ...(cursor === undefined ? {} : { cursor }) } });
      if (outbox.status !== 'ready') return;
      for (const message of outbox.value.items) {
        if (message.response === null || (message.acceptedInputs ?? []).some(input => input.part === 'response')) continue;
        if (message.sender.kind !== 'work_run') continue;
        const source = await platform.executions.readExecution(ctx, message.sender.runRef);
        if (source.status !== 'ready' || source.value.run.controlState?.desiredState === 'paused'
          || source.value.run.controlState?.desiredState === 'cancelled' || source.value.run.outcome === 'cancelled') continue;
        await platform.workflow.consumeConsultation?.(ctx, {
          schemaVersion: 1, part: 'response', messageRef: message.ref, goalRef: entry.goalRef,
          roleBinding: profile.roleBinding, runtimeBudget: profile.runtimeBudget, budget: profile.budget, consumerId: profile.consumerId,
        });
        return;
      }
      cursor = outbox.value.nextCursor ?? undefined;
    } while (cursor !== undefined && !attentionAbort.signal.aborted);
  }
  // L-10: without the instance lease this Host delivers no attention and wakes no consumer (no execution driver).
  const attentionDone: Promise<void> = (attentionScopes.length === 0 && inputConsumers.length === 0) || !leaseOwned ? Promise.resolve() : (async () => {
    const scanner = createAttentionScanner({ workspace: platform.workspace, plans: platform.plans, messages: platform.messages, architecture: platform.architecture,
      ...(platform.runtime.readAttentionGraph === undefined ? {} : {
        readAttentionGraph: platform.runtime.readAttentionGraph.bind(platform.runtime),
      }) });
    const entries = attentionScopes.map(scope => ({
      scope, observer: createAttentionObserver(scope.config),
      confirmedSequences: new Map<string, number>(), nextSequence: 0,
      pending: [] as { signals: readonly import('./attention-observer.js').AttentionSignal[]; sequence: number; messageRef: import('../contracts/core/session-message.js').SessionMessageRef; snapshot: Awaited<ReturnType<typeof scanner.scan>> }[],
    }));
    const period = Math.max(1, Math.min(...attentionScopes.map(scope => scope.config.heartbeatMs), ...inputConsumers.map(entry => entry.heartbeatMs)));
    const lastInputScan = new Map<string, number>();
    while (!attentionAbort.signal.aborted) {
      for (const entry of inputConsumers) {
        const key = canonicalJson({ scope: entry.scope, sessionRef: entry.sessionRef } as never);
        if (!inputJobs.has(key) && Date.now() - (lastInputScan.get(key) ?? 0) >= entry.heartbeatMs) {
          lastInputScan.set(key, Date.now());
          const job = consumeIdle(entry).catch(() => { /* original facts remain retryable */ }).finally(() => inputJobs.delete(key));
          inputJobs.set(key, job);
        }
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
        const delivery = entry.observer.observe(snapshot, Date.now());
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
          const sent = await platform.messages.sendMessage(hostCtx, {
            input: { recipient: entry.scope.targetSession, text, intent: 'notify' },
            meta: { requestId, expected: [] },
          });
          if (sent.status === 'committed') {
            entry.observer.markDelivered(snapshot, delivery.signals);
            entry.pending.push({ signals: delivery.signals, sequence: ++entry.nextSequence, messageRef: sent.value.ref, snapshot });
          }
        } catch { /* a failed delivery leaves the input unprocessed and is retried */ }
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
  const server: WorkbenchServer = createWorkbenchServer({
    token,
    bindings: leaseGated(createPlatformCoreRouteBindings(platform, collaborationDriver, workbenchTools.tools, goalFanOut,
      { readReconcileReport: async () => ({ status: 'ready', value: structuredClone(hostReconcile) }) })),
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
    get address(): WorkbenchAddress | null { return server.address; },
    get reconcile(): HostReconcileReportV1 { return structuredClone(hostReconcile); },
    listen(port?: number): Promise<WorkbenchAddress> {
      if (closePromise !== undefined) return Promise.reject(new Error('the workbench Host is closed'));
      listenPromise ??= server.listen(port ?? options.port ?? 0);
      return listenPromise;
    },
    close(): Promise<void> {
      closePromise ??= (async () => {
        await server.close();
        const workbenchToolsClosed = workbenchTools.close();
        attentionAbort.abort('host_closing');
        backfillAbort.abort('host_closing');
        await backfillDone.catch(() => { /* the loop records its own state */ });
        await attentionDone.catch(() => { /* the loop records its own state */ });
        await Promise.all([...inputJobs.values()]);
        await collaborationDriver.close();
        await goalFanOut.close();
        await workbenchToolsClosed;
        await platform.close();
        // HL-06: the lock file goes only while it still names this instance; a Host that never held it never touches it.
        await instanceLease.release().catch(() => undefined);
      })();
      return closePromise;
    },
  };
}
