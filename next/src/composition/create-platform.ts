import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInMemoryRecordBackend } from '../core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../core/record-store/sqlite-record-store.js';
import { RawArtifactBodyStore } from '../core/record-store/body-store.js';
import { createSqliteRawArtifactStore } from '../core/record-store/sqlite-body-store.js';
import { createGoalService } from '../core/work-graph/tasks/task-service.js';
import { createMaterialRecordReaders, materialRecordSchemas } from '../core/work-graph/materials/record-readers.js';
import { createMaterialAccessResolver } from '../core/work-graph/materials/applicability.js';
import { createMaterialService } from '../core/work-graph/materials/material-service.js';
import { createWorkspaceAccessFactory, type WorkspaceHostBindings } from '../core/workspace/access.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../core/workspace/workspace-tools.js';
import { createAgentRuntime } from '../core/agent-runtime/runtime.js';
import { createWorkflow } from '../business/workflow/workflow.js';

import { createExecutionHistoryService } from '../core/work-graph/tasks/execution-history-service.js';
import { EXECUTION_HISTORY_RECORD_SCHEMAS } from '../core/work-graph/persistence/execution-history-codecs.js';
import type { ExecutionHistoryWritePort } from '../core/work-graph/tasks/execution-history-contracts.js';
import { createGraphExecutionHistoryReader } from '../core/agent-runtime/graph-execution-history.js';
import { createRunStateReader } from '../core/work-graph/tasks/run-state-service.js';
import type { ExecutionReadPort } from '../core/work-graph/tasks/execution-read-contracts.js';
import { createExecutionHistoryReader } from '../core/agent-runtime/observation-recovery.js';
import { createTaskClaimService } from '../core/work-graph/tasks/claim-service.js';
import { TASK_CLAIM_RECORD_SCHEMAS } from '../core/work-graph/tasks/claim-record-codecs.js';
import type { TaskClaimPort } from '../core/work-graph/tasks/claim-contracts.js';
import type { RoleConfigurationPort } from '../core/work-graph/configuration/contracts.js';
import { createPlanService } from '../core/work-graph/tasks/plan-service.js';
import { PLAN_RECORD_SCHEMAS } from '../core/work-graph/tasks/plan-record-codecs.js';
import { PLAN_STATE_RECORD_SCHEMAS, PLAN_GOVERNANCE_RECORD_SCHEMAS } from '../core/work-graph/tasks/plan-readers.js';
import { createSessionDirectory } from '../core/work-graph/sessions/session-directory.js';
import type { SessionDirectoryPort } from '../core/work-graph/sessions/contracts.js';
import { SESSION_RECORD_SCHEMAS } from '../core/work-graph/sessions/session-record-codecs.js';
import { createSessionLifecycleService } from '../core/work-graph/sessions/session-lifecycle.js';
import type { SessionLifecyclePort } from '../core/work-graph/sessions/lifecycle-contracts.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../core/work-graph/sessions/lifecycle-record-codecs.js';
import { createKernelStoreRegistry } from '../core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations } from '../core/agent-runtime/session-operations.js';
import type { CoreRejection, ReadResult } from '../contracts/core/results.js';
import type { RuntimeCapabilities } from '../core/agent-runtime/contracts.js';
import { createRoleConfigurationService } from '../core/work-graph/configuration/role-memory-service.js';
import { ROLE_RECORD_SCHEMAS } from '../core/work-graph/configuration/role-record-codecs.js';
import { createObservedArchitecture } from '../core/work-graph/architecture/architecture-service.js';
import { OBSERVED_ARCHITECTURE_RECORD_SCHEMAS } from '../core/work-graph/architecture/architecture-record-codecs.js';
import { createArchitectureCatalogService } from '../core/work-graph/architecture/catalog-service.js';
import type { ArchitectureCatalogPort } from '../core/work-graph/architecture/catalog-contracts.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../core/work-graph/architecture/catalog-record-codecs.js';
import { kernelSessionApiVersion } from '../../vendor/coding-agent/dist/public-api.js';

export type TargetPlatformOptions = {
  storage: { kind: 'memory' } | { kind: 'sqlite'; directory: string };
  workspace: WorkspaceHostBindings;
  now?: () => string;
  /** Trusted source route; defaults to TypeScript at tsconfig.json. No language inference. */
  architectureSource?: { provider: 'typescript'; configPath: string };
  /** Trusted startup configuration; never taken from a model tool request. */
  kernelStores?: Parameters<typeof createKernelStoreRegistry>[0];
};

/** Trusted local composition root. Old Ledger/Index/Vault instances cannot be
 * supplied. No business bootstrap/claim API is invented by the storage factory. */
export async function createTargetPlatform(options: TargetPlatformOptions) {
  const now = options.now ?? (() => new Date().toISOString());
  const materialsSchema = materialRecordSchemas();
  const schemas = {
    records: [...materialsSchema.records, ...PLAN_RECORD_SCHEMAS.records, ...PLAN_STATE_RECORD_SCHEMAS.records,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records, ...SESSION_LIFECYCLE_RECORD_SCHEMAS.records,
      ...ROLE_RECORD_SCHEMAS.records, ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.records,
      ...ARCHITECTURE_CATALOG_SCHEMAS.records, ...TASK_CLAIM_RECORD_SCHEMAS.records],
    events: [...materialsSchema.events, ...PLAN_RECORD_SCHEMAS.events, ...PLAN_STATE_RECORD_SCHEMAS.events,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events, ...SESSION_LIFECYCLE_RECORD_SCHEMAS.events,
      ...ROLE_RECORD_SCHEMAS.events, ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.events, ...ARCHITECTURE_CATALOG_SCHEMAS.events,
      ...TASK_CLAIM_RECORD_SCHEMAS.events, ...EXECUTION_HISTORY_RECORD_SCHEMAS.events],
    lookups: [...materialsSchema.lookups ?? [], ...PLAN_RECORD_SCHEMAS.lookups ?? [], ...PLAN_STATE_RECORD_SCHEMAS.lookups ?? [],
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.lookups ?? [], ...SESSION_RECORD_SCHEMAS.lookups ?? [],
      ...SESSION_LIFECYCLE_RECORD_SCHEMAS.lookups ?? [], ...ROLE_RECORD_SCHEMAS.lookups ?? [],
      ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.lookups ?? [], ...ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? [],
      ...TASK_CLAIM_RECORD_SCHEMAS.lookups ?? []],
  };
  if (options.storage.kind === 'sqlite') mkdirSync(options.storage.directory, { recursive: true });
  const backend = options.storage.kind === 'memory'
    ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ schemas, path: join(options.storage.directory, 'ledger.sqlite') });
  let closeBodies: (() => Promise<void>) | undefined;
  try {
    const bodies = options.storage.kind === 'memory' ? new RawArtifactBodyStore()
      : createSqliteRawArtifactStore(join(options.storage.directory, 'artifacts.sqlite'));
    if ('close' in bodies) closeBodies = () => bodies.close();
    const reads = createMaterialRecordReaders(backend.records);
    const grants = createMaterialAccessResolver(reads.authority, reads.index);
    const materials = createMaterialService({ bodies, authority: reads.authority, grants, now });
    const goals = createGoalService({ records: backend.records, now, eventId: randomUUID }).tasks;
    const access = createWorkspaceAccessFactory(options.workspace);
    const workspace = createWorkspaceTools({ access,
      now, limits: DEFAULT_WORKSPACE_LIMITS });
    const roleService = createRoleConfigurationService({ records: backend.records, now, eventId: randomUUID });
    const observed = createObservedArchitecture({ records: backend.records, bodies, access, workspace: workspace.tools,
      source: options.architectureSource ?? { provider: 'typescript', configPath: 'tsconfig.json' } });
    const catalog = createArchitectureCatalogService({ records: backend.records });
    const planService = createPlanService({ records: backend.records, materials, now, eventId: randomUUID });
    const claimService = createTaskClaimService({ records: backend.records, roles: roleService,
      now, newId: randomUUID });
    const sessionDirectory = createSessionDirectory({ records: backend.records, lookups: backend.records });
    const sessionLifecycle = createSessionLifecycleService({ records: backend.records, lookups: backend.records });
    const kernelStores = await createKernelStoreRegistry(options.kernelStores ?? { entries: [] });
    // Internal calls retain the raw directory. The outer Runtime operation is
    // drained once as a whole, so close cannot reject its later registration.
    const sessionOperations = createSessionOperations({ sessions: sessionDirectory, kernelStores });
    const executionReader = createRunStateReader({ records: backend.records });
    const executionHistory = createExecutionHistoryReader({ history: sessionOperations });
    const historyWriter = createExecutionHistoryService({ records: backend.records, now, eventId: randomUUID });
    const graphHistory = createGraphExecutionHistoryReader({ executions: executionReader, history: executionHistory });
    const runtime = createAgentRuntime();
    // A Session operation spans both stores. Drain the complete operation before
    // closing the platform Store, not merely its short Kernel callback.
    let isClosing = false;
    const pending = new Set<Promise<unknown>>();
    function trackedCall<T>(call: () => Promise<T>, whenClosed: () => T): Promise<T> {
      if (isClosing) return Promise.resolve(whenClosed());
      // Start synchronously so each port snapshots inputs before its first await.
      const result = call();
      pending.add(result);
      void result.then(() => pending.delete(result), () => pending.delete(result));
      return result;
    }
    const unavailable = (): CoreRejection => ({ status: 'rejected', code: 'unavailable', reason: 'platform is closing' });
    function sessionCall<T>(call: () => Promise<T>): Promise<T | CoreRejection> {
      return trackedCall<T | CoreRejection>(call, unavailable);
    }
    const sessions: SessionDirectoryPort & SessionLifecyclePort = {
      admitSessionCreation: (...args) => trackedCall(() => sessionDirectory.admitSessionCreation(...args), unavailable),
      recordSessionCreated: (...args) => trackedCall(() => sessionDirectory.recordSessionCreated(...args), unavailable),
      getSessionOperation: (...args) => trackedCall(() => sessionDirectory.getSessionOperation(...args), unavailable),
      readSession: (...args) => trackedCall(() => sessionDirectory.readSession(...args), unavailable),
      findSessions: (...args) => trackedCall(() => sessionDirectory.findSessions(...args), unavailable),
      linkSessionWork: (...args) => trackedCall(() => sessionLifecycle.linkSessionWork(...args), unavailable),
      archiveSession: (...args) => trackedCall(() => sessionLifecycle.archiveSession(...args), unavailable),
      reactivateSession: (...args) => trackedCall(() => sessionLifecycle.reactivateSession(...args), unavailable),
    };
    const executions: ExecutionReadPort & ExecutionHistoryWritePort = {
      recordExecutionHistory: (...args) => trackedCall(() => historyWriter.recordExecutionHistory(...args), unavailable),
      readExecution: (...args) => trackedCall(() => executionReader.readExecution(...args), unavailable),
    };
    const claims: TaskClaimPort = {
      claimTask: (...args) => trackedCall(() => claimService.claimTask(...args), unavailable),
      readTaskClaim: (...args) => trackedCall(() => claimService.readTaskClaim(...args), unavailable),
    };
    const roles: RoleConfigurationPort = {
      installRoleSpec: (ctx, command) => trackedCall(() => roleService.installRoleSpec(ctx, command),
        () => ({ status: 'rejected', code: 'unavailable', commandId: command.commandId })),
      activateRoleSpec: (ctx, command) => trackedCall(() => roleService.activateRoleSpec(ctx, command),
        () => ({ status: 'rejected', code: 'unavailable', commandId: command.commandId })),
      readRoleSpec: (...args) => trackedCall(() => roleService.readRoleSpec(...args), unavailable),
      resolveRoleBinding: (...args) => trackedCall(() => roleService.resolveRoleBinding(...args), unavailable),
    };
    const architecture: typeof observed & ArchitectureCatalogPort = {
      captureSourceChanges: (...args) => trackedCall(() => observed.captureSourceChanges(...args), unavailable),
      queryArchitecture: (...args) => trackedCall(() => observed.queryArchitecture(...args), unavailable),
      compareArchitecture: (...args) => trackedCall(() => observed.compareArchitecture(...args), unavailable),
      queryImpact: (...args) => trackedCall(() => observed.queryImpact(...args), unavailable),
      adoptInitialArchitecture: (...args) => trackedCall(() => catalog.adoptInitialArchitecture(...args), unavailable),
      readArchitectureRevision: (...args) => trackedCall(() => catalog.readArchitectureRevision(...args), unavailable),
    };
    // Explicit task-input reads span the ledger and material store. Drain them
    // before closing either store, preserving the service's synchronous input snapshot.
    const plans: typeof planService = {
      ...planService,
      readTaskInput: (...args) => trackedCall(() => planService.readTaskInput(...args), unavailable),
    };
    const runtimePort = {
      ...runtime.port,
      async capabilities(...args: Parameters<typeof runtime.port.capabilities>): Promise<ReadResult<RuntimeCapabilities>> {
        const [ctx, scope] = args;
        if (isClosing) return { status: 'rejected', code: 'unavailable', reason: 'platform is closing' };
        if (ctx.signal.aborted) return { status: 'rejected', code: 'cancelled', reason: 'capability read cancelled' };
        if (ctx.principal.kind !== 'host' || ctx.projectId !== scope.projectId || ctx.workspaceId !== scope.workspaceId)
          return { status: 'rejected', code: 'forbidden', reason: 'capability scope is not bound by the Host' };
        const registered = kernelStores.forWorkspace(scope);
        if (!registered) return { status: 'rejected', code: 'unsupported', reason: 'workspace has no configured Kernel Store' };
        const pending = { supported: false, reason: 'platform execution or maintenance wiring is not implemented' };
        return { status: 'ready', value: {
          adapterId: registered.adapterId, kernelSessionApiVersion,
          createSession: { supported: true, reason: 'durable creation and Kernel mapping are configured' },
          readHistory: { supported: true, reason: 'original Kernel history reader is configured' },
          continueHistory: pending, recoverRun: pending, safePointPause: pending,
          cancel: pending, nativeCompact: pending, scopedWorkspaceWrites: pending,
        } };
      },
      createSession(...args: Parameters<typeof sessionOperations.createSession>) {
        return sessionCall(() => sessionOperations.createSession(...args));
      },
      readTaskExecutionHistory(...args: Parameters<typeof graphHistory.readTaskExecutionHistory>) {
        return sessionCall(() => graphHistory.readTaskExecutionHistory(...args));
      },
      readExecutionHistory(...args: Parameters<typeof executionHistory.readExecutionHistory>) {
        return sessionCall(() => executionHistory.readExecutionHistory(...args));
      },
      readSessionHistory(...args: Parameters<typeof sessionOperations.readSessionHistory>) {
        return sessionCall(() => sessionOperations.readSessionHistory(...args));
      },
    };
    const workflow = createWorkflow({ tasks: goals });
    let closing: Promise<void> | undefined;
    return {
      goals, plans, claims, executions, sessions, materials, roles, architecture, workspace: workspace.tools, runtime: runtimePort, workflow,
      close(): Promise<void> {
        isClosing = true;
        closing ??= (async () => {
          await Promise.allSettled([...pending]);
          try { await workspace.close(); }
          finally {
            try { await closeBodies?.(); }
            finally { await backend.close(); }
          }
        })();
        return closing;
      },
    };
  } catch (error) {
    // Close every owned resource while preserving the initialization error.
    try { await closeBodies?.(); } catch { /* keep original error */ }
    try { await backend.close(); } catch { /* keep original error */ }
    throw error;
  }
}
