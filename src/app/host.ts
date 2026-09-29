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
import { createBuiltinProviderRegistry } from '../../vendor/coding-agent/dist/public-api.js';
import { mkdirSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { canonicalJson, sha256Hex, type JsonValue } from '../contracts/fingerprint.js';
import { createTargetPlatform, type TargetPlatformOptions } from '../composition/create-platform.js';
import type { WorkspaceHostBindings } from '../core/workspace/access.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { WorkspaceRef } from '../contracts/ledger.js';
import type { WorkspaceResult } from '../core/workspace/ports.js';
import { createPlatformCoreRouteBindings } from './core-routes.js';
import { parseInitialPlanningResponseV2 } from '../core/work-graph/tasks/initial-plan.js';
import type { TrustedCheckConfiguration } from '../contracts/verification.js';
import { createCollaborationDriver } from './collaboration-driver.js';
import { createWorkbenchTools } from './workbench-tools.js';
import {
  attentionSignalToJson, createAttentionObserver, createAttentionScanner, type AttentionScopeV1,
} from './attention-observer.js';
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
  PLATFORM_SKILL_RESOURCE_ROOT,
  settingsModelSecretVariable,
  type WorkbenchModelConfiguration,
  type WorkbenchQueryProfile,
  type WorkbenchRuntimeBinding,
  type WorkbenchRuntimeConfiguration,
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
  const initialBindings = options.runtime
    ?? (seedConfiguration === undefined
      ? undefined : createWorkbenchRuntimeHostBindings(seedConfiguration,
        versionProvider(versionSecretSource(seedConfiguration, { models: [], selection: {}, checks: [] }))));
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

  const platform = await createTargetPlatform({
    storage,
    workspace: bindings,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(architectureSource === undefined ? {} : { architectureSource }),
    ...(options.kernelStores === undefined ? {} : { kernelStores: options.kernelStores }),
    ...(runtime === undefined ? {} : { runtime }),
    ...(checks === undefined ? {} : { checks }),
    ...(workflow === undefined ? {} : { workflow }),
    sourcePolicyFor,
  });

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
  });
  const collaborationDriver = createCollaborationDriver({
    workflow: platform.workflow,
    runtime: platform.runtime,
    sessions: platform.sessions,
    executions: platform.executions,
    mailbox: platform.messages,
    controls: platform.controls,
    profiles: runtimeConfiguration?.queryProfiles ?? [],
  });

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

  function localWorkbenchBudget(model: HostSettingsStoredModel): typeof LOCAL_WORKBENCH_BUDGET {
    // Published DeepSeek model limits, checked 2026-09-29:
    // https://api-docs.deepseek.com/quick_start/pricing/
    const contextWindowTokens = model.provider === 'deepseek'
      && ['deepseek-flash', 'deepseek-v4-pro'].includes(model.model)
      ? 1_000_000 : LOCAL_WORKBENCH_BUDGET.contextWindowTokens;
    return { ...LOCAL_WORKBENCH_BUDGET, contextWindowTokens };
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

  function localWorkbenchGrant(workspace: WorkbenchWorkspaceConfig, model: HostSettingsStoredModel): WorkbenchRuntimeBinding['grant'] {
    const writeAllowed = (workspace.writePrefixes?.length ?? 0) > 0;
    const commandsAllowed = workspace.allowCommands === true && writeAllowed;
    return {
      budget: localWorkbenchBudget(model),
      hostTemplate: { ...LOCAL_WORKBENCH_HOST_TEMPLATE },
      // R6 cold-start: an explicitly write-enabled Work may reuse the EXISTING
      // validated collaboration read/notify tools so it can find related
      // Sessions, read their cards, read its mailbox and read the task graph.
      // The read-only Query ceiling still strips every mailbox/whiteboard name,
      // and no governance writer (`apply_future_plan` or similar) is granted.
      // Query expands the read capability into its source tools. project_source
      // is not a Work Kernel grant name; passing it here prevents Work startup.
      tools: ['read',
        ...(writeAllowed ? ['write', 'find_related_sessions', 'read_session_card', 'send_session_message',
          'read_session_inbox', 'read_session_message', 'read_session_message_body', 'query_task_graph'] : []),
        ...(commandsAllowed ? ['shell'] : [])],
      writeScope: writeAllowed ? ['.'] : [],
      skills: { resourceRoot: PLATFORM_SKILL_RESOURCE_ROOT, enabledIds: ['platform-work'] },
      systemInstruction: null,
      deniedPrefixes: [],
      processSandboxOptions: {},
      materialBasis: null,
      ...(commandsAllowed ? { shellWorkspaceAccess: 'all_except_denied' as const } : {}),
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
      nextBindings.push({
        id: bindingId,
        label: 'Local workbench',
        scope: { projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId },
        role: structuredClone(LOCAL_WORKBENCH_ROLE),
        configurationRevision: `local-workbench@${sha256Hex(key).slice(0, 16)}`,
        model: settingsModelBinding(selected),
        grant: localWorkbenchGrant(workspace, selected),
      });
      nextProfiles.push(localWorkbenchProfile(workspace.scope, bindingId, selected));
    }
    return { schemaVersion: 1, bindings: nextBindings, queryProfiles: nextProfiles };
  }

  const installFromSettings = (snapshot: HostSettingsPrivateSnapshot): void => {
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
      versionProvider(versionSecretSource(configuration, snapshot))));
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
  async function inputCompleted(ctx: CoreCallContext, message: import('../core/work-graph/communication/contracts.js').SessionMessage): Promise<boolean> {
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
  const attentionDone: Promise<void> = attentionScopes.length === 0 && inputConsumers.length === 0 ? Promise.resolve() : (async () => {
    const scanner = createAttentionScanner({ workspace: platform.workspace, plans: platform.plans, messages: platform.messages, architecture: platform.architecture });
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
        const text = JSON.stringify({ signals: delivery.signals.map(attentionSignalToJson),
          sources: { scope, goalRef: entry.scope.goalRef, files: snapshot.files.map(file => ({ path: file.path, version: file.version })), graph: snapshot.graph },
        });
        const requestId = 'attention:' + scope.workspaceId + ':' + sha256Hex(canonicalJson({
          targetSession: entry.scope.targetSession, paths: entry.scope.paths,
          files: snapshot.files.map(file => ({ path: file.path, version: file.version })),
          graph: snapshot.graph,
          signals: delivery.signals,
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

  // The real route bindings share the ONE platform instance assembled above.
  const server: WorkbenchServer = createWorkbenchServer({
    token,
    bindings: createPlatformCoreRouteBindings(platform, collaborationDriver, workbenchTools.tools),
    actor,
    bootstrap: buildBootstrap,
    allowsScope: scope => byScope.has(scopeKey(scope)),
    ...(hostSettings === undefined ? {} : { settings: hostSettings }),
    ...(options.publicDir === undefined ? {} : { publicDir: options.publicDir }),
    ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
  });

  let listenPromise: Promise<WorkbenchAddress> | undefined;
  let closePromise: Promise<void> | undefined;

  return {
    get address(): WorkbenchAddress | null { return server.address; },
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
        await attentionDone.catch(() => { /* the loop records its own state */ });
        await Promise.all([...inputJobs.values()]);
        await collaborationDriver.close();
        await workbenchToolsClosed;
        await platform.close();
      })();
      return closePromise;
    },
  };
}
