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
 * Nothing in this file is reachable from an HTTP request body: the root, the
 * authorization predicate, the database path, the Kernel stores and the actor
 * come only from `options`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createTargetPlatform, type TargetPlatformOptions } from '../composition/create-platform.js';
import type { WorkspaceHostBindings } from '../core/workspace/access.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { WorkspaceRef } from '../contracts/ledger.js';
import type { WorkspaceResult } from '../core/workspace/ports.js';
import { createPlatformCoreRouteBindings } from './core-routes.js';
import type { BootstrapExecution, BootstrapResponse, BootstrapReviewMaterial, CoreScope, WorkbenchActor } from './core-http-types.js';
import {
  createWorkbenchRuntimeHostBindings,
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
  }));
}

function validateWorkspaces(workspaces: WorkbenchWorkspaceConfig[]): void {
  if (workspaces.length === 0) throw new Error('the Host requires at least one trusted workspace scope');
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
  validateWorkspaces(workspaces);
  const review: BootstrapReviewMaterial | null = options.review === undefined ? null : structuredClone(options.review);
  const storage: TargetPlatformOptions['storage'] = options.storage.kind === 'sqlite'
    ? { kind: 'sqlite', directory: options.storage.directory }
    : { kind: 'memory' };
  const architectureSource = options.architectureSource === undefined
    ? undefined
    : { provider: options.architectureSource.provider, configPath: options.architectureSource.configPath };
  if (options.runtime !== undefined && options.runtimeConfiguration !== undefined)
    throw new Error('provide either a programmatic runtime or a runtimeConfiguration, not both');
  const runtimeConfiguration: WorkbenchRuntimeConfiguration | undefined = options.runtimeConfiguration === undefined
    ? undefined : structuredClone(options.runtimeConfiguration);
  const checks: TargetPlatformOptions['checks'] = options.checks === undefined ? undefined : structuredClone(options.checks);
  const workflow: TargetPlatformOptions['workflow'] = options.workflow === undefined ? undefined : structuredClone(options.workflow);
  const token = randomBytes(32).toString('hex');
  const byScope = new Map(workspaces.map(workspace => [scopeKey(workspace.scope), workspace] as const));
  // R6 execution entry: the ONE trusted runtime binding is the programmatic one
  // or the trusted factory over the serializable configuration. Without either
  // the Host keeps its accepted Session/mailbox/read behavior and only the model
  // entry stays explicitly unconfigured.
  const runtime: TargetPlatformOptions['runtime'] = options.runtime
    ?? (runtimeConfiguration === undefined
      ? undefined
      : createWorkbenchRuntimeHostBindings(runtimeConfiguration, options.runtimeProvider ?? {}));
  // The trusted source scope reuses the exact workspace root/read prefixes and
  // the Host permission generation. It is only a source range: the real Run/Query
  // identity and eligibility stay with the source authority and the owners.
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

  // The safe display projection is computed from the frozen startup material
  // only. It carries no binding, grant, model, baseUrl, option, environment name,
  // secret, root or client, and an unconfigured Host publishes empty arrays.
  const execution: BootstrapExecution = {
    queryProfiles: (runtimeConfiguration?.queryProfiles ?? []).map(profile => ({
      id: profile.id,
      label: profile.label,
      scope: { projectId: profile.scope.projectId, workspaceId: profile.scope.workspaceId },
      sessionRole: structuredClone(profile.sessionRole),
      roleBinding: structuredClone(profile.roleBinding),
      runtimeBudget: structuredClone(profile.runtimeBudget),
      budget: structuredClone(profile.budget),
      consumerId: profile.consumerId,
    })),
    workflowScopes: workflow === undefined ? [] : [...new Map(workflow.bindings.map(binding => [
      scopeKey(binding.workspace),
      { projectId: binding.workspace.projectId, workspaceId: binding.workspace.workspaceId },
    ])).values()],
  };
  const bootstrap: BootstrapResponse = {
    workspaces: workspaces.map(workspace => ({
      scope: { projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId },
      name: workspace.name,
      workspaceRevision: workspace.workspaceRevision,
    })),
    review,
    execution,
  };

  // The real route bindings share the ONE platform instance assembled above.
  const server: WorkbenchServer = createWorkbenchServer({
    token,
    bindings: createPlatformCoreRouteBindings(platform),
    actor,
    bootstrap,
    allowedScopes: workspaces.map(workspace => workspace.scope),
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
        await platform.close();
      })();
      return closePromise;
    },
  };
}
