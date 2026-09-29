import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { createInMemoryRecordBackend } from '../core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../core/record-store/sqlite-record-store.js';
import { RawArtifactBodyStore } from '../core/record-store/body-store.js';
import { createSqliteRawArtifactStore } from '../core/record-store/sqlite-body-store.js';
import { createGoalService } from '../core/work-graph/tasks/task-service.js';
import type { GoalTaskPort } from '../core/work-graph/tasks/contracts.js';
import { COMPLETION_RECORD_SCHEMAS } from '../core/work-graph/tasks/completion-record-codecs.js';
import { createMaterialRecordReaders, materialRecordSchemas } from '../core/work-graph/materials/record-readers.js';
import { createMaterialAccessResolver } from '../core/work-graph/materials/applicability.js';
import { createMaterialService } from '../core/work-graph/materials/material-service.js';
import { createMaterialGrantService } from '../core/work-graph/materials/grant-service.js';
import { createMaterialReadFactsService } from '../core/work-graph/materials/material-facts-service.js';
import type { MaterialGrantPort } from '../core/work-graph/materials/grant-contracts.js';
import type { MaterialPort } from '../core/work-graph/materials/contracts.js';
import { MATERIAL_GRANT_EVENT_SCHEMAS } from '../core/work-graph/materials/grant-record-codecs.js';
import { createWorkspaceAccessFactory, type WorkspaceHostBindings } from '../core/workspace/access.js';
import { createMaterialSourceProvider } from '../core/workspace/material-source-provider.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../core/workspace/workspace-tools.js';
import { createAgentRuntime } from '../core/agent-runtime/runtime.js';
import { createExecutionEntryService } from '../core/work-graph/tasks/execution-entry-service.js';
import { createModelCallService } from '../core/work-graph/tasks/model-call-service.js';
import { createSessionMailbox } from '../core/work-graph/communication/mailbox-service.js';
import type { SessionMailboxPort } from '../core/work-graph/communication/contracts.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../core/work-graph/communication/message-record-codecs.js';
import { createSourceAuthorityReader } from '../core/work-graph/source-authority-reader.js';
import { createWorkflow } from '../business/workflow/workflow.js';
import type { WorkflowDependencies, WorkflowHostConfiguration, WorkflowPort } from '../business/workflow/ports.js';

import { createEvidenceService } from '../core/work-graph/evidence/evidence-service.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../core/work-graph/evidence/evidence-record-codecs.js';
import type { EvidencePort } from '../core/work-graph/evidence/contracts.js';
import { VerificationWorkspaceReader } from '../core/workspace/verification-workspace-reader.js';
import { createRegisteredCheckRunner, type RegisteredCheckRunner } from '../core/agent-runtime/check-execution.js';
import type { TrustedCheckConfiguration } from '../contracts/verification.js';

import { createExecutionHistoryService } from '../core/work-graph/tasks/execution-history-service.js';
import { EXECUTION_HISTORY_RECORD_SCHEMAS } from '../core/work-graph/persistence/execution-history-codecs.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS } from '../core/work-graph/persistence/execution-entry-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../core/work-graph/persistence/model-request-codecs.js';
import { createRunControlService } from '../core/work-graph/tasks/control-service.js';
import type { RunControlPort } from '../core/work-graph/tasks/control-contracts.js';
import { CONTROL_RECORD_SCHEMAS } from '../core/work-graph/persistence/control-record-codecs.js';
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
import { createSessionHistoryCursorOwner, createSessionOperations } from '../core/agent-runtime/session-operations.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { SessionRef } from '../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../contracts/core/results.js';
import { canonicalJson, type JsonValue } from '../contracts/fingerprint.js';
import type { MaterialSourceScope } from '../contracts/material-access.js';
import type { RuntimeCapabilities } from '../core/agent-runtime/contracts.js';
import type { RuntimeExecutionDependencies, RuntimeHostBindings } from '../core/agent-runtime/execution-contracts.js';
import type { AuthorizeConfiguration, ExecutionEntryDependencies } from '../core/work-graph/tasks/execution-entry-contracts.js';
import { createRoleConfigurationService } from '../core/work-graph/configuration/role-memory-service.js';
import { ROLE_RECORD_SCHEMAS } from '../core/work-graph/configuration/role-record-codecs.js';
import { createProjectBootstrapServices } from '../core/work-graph/configuration/project-bootstrap-service.js';
import { createQueryExecution } from '../core/work-graph/queries/query-execution.js';
import { projectQueryConfiguration } from '../core/agent-runtime/query-preparation.js';
import { createQueryJobService } from '../core/work-graph/queries/query-job-service.js';
import type {
  CompletionPolicyConfigurationPort, ProjectRegistrationPort,
} from '../core/work-graph/configuration/project-bootstrap-contracts.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../core/work-graph/configuration/project-bootstrap-record-codecs.js';
import type { AuthorizeQueryConfiguration, QueryJobPort } from '../core/work-graph/queries/contracts.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../core/work-graph/queries/query-record-codecs.js';
import { createObservedArchitecture } from '../core/work-graph/architecture/architecture-service.js';
import { OBSERVED_ARCHITECTURE_RECORD_SCHEMAS } from '../core/work-graph/architecture/architecture-record-codecs.js';
import { createArchitectureCatalogService } from '../core/work-graph/architecture/catalog-service.js';
import type { ArchitectureCatalogPort } from '../core/work-graph/architecture/catalog-contracts.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../core/work-graph/architecture/catalog-record-codecs.js';

export type TargetPlatformOptions = {
  storage: { kind: 'memory' } | { kind: 'sqlite'; directory: string };
  workspace: WorkspaceHostBindings;
  now?: () => string;
  /** Trusted source route; defaults to TypeScript at tsconfig.json. No language inference. */
  architectureSource?: { provider: 'typescript'; configPath: string };
  /** Trusted startup configuration; never taken from a model tool request. */
  kernelStores?: Parameters<typeof createKernelStoreRegistry>[0];
  /** Trusted Host execution binding. Its model/tool/template grant is the only
   * production execution route; a caller cannot supply a client, root, hook,
   * permission or database here. When absent, execution stays explicitly
   * unsupported while Session creation/history keep their accepted behavior. */
  runtime?: RuntimeHostBindings;
  /** Trusted per-workspace source policy, consumed by the existing source factories. */
  sourcePolicyFor?: RuntimeExecutionDependencies['sourcePolicyFor'];
  /** Optional frozen trusted checks configuration. Without it the platform has
   * no registered check and the fresh evidence/check entry stays unsupported;
   * existing history reads keep working. Never defaulted to full access. */
  checks?: TrustedCheckConfiguration;
  /** Optional trusted Workflow advancement policy (R5c.1). It selects the exact
   * Session role/RoleBinding/TaskBudget per workspace; it grants no model, tool
   * or file capability and is snapshotted as pure data. Without it only the
   * Workflow's fresh selection is unsupported; every other port is unchanged. */
  workflow?: WorkflowHostConfiguration;
};

/** The composition-owned service identity. It is used only to execute trusted
 * platform material reads and mailbox body storage; it never replaces the real
 * command actor/sender. */
const SYSTEM_ACTOR = Object.freeze({ kind: 'system' as const, id: 'platform-composition-host' });

function contextForScope(scope: MaterialSourceScope, signal: AbortSignal): CoreCallContext {
  return {
    projectId: scope.projectId,
    workspaceId: scope.workspaceId,
    principal: { kind: 'host', actor: { ...SYSTEM_ACTOR } },
    materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor: { ...SYSTEM_ACTOR } },
    signal,
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue); } catch { return false; }
}

/**
 * The trusted Host projection consumed by the WorkGraph entry/model-call lanes.
 *
 * It consumes the exact Role resolution the WorkGraph admission recheck already
 * made, then calls the SAME `options.runtime.resolveConfiguration` binding the Runtime
 * driver uses. The prepared manifest permissions are only accepted after the
 * current Host tools/writeScope/shell grant and the Role ceiling allow them; the
 * whole Host template is taken from the current configuration (never rebuilt
 * from fixture constants). The returned value must still satisfy WorkGraph's
 * exact configuration/permissions/template agreement check.
 */
function createAuthorizeConfiguration(host: RuntimeHostBindings): AuthorizeConfiguration {
  return async (ctx, input) => {
    const resolution = input.roleResolution;
    if (resolution.status === 'inadmissible') {
      return { status: 'rejected', code: 'forbidden', reason: 'the current Role binding is inadmissible' };
    }
    const configured = await host.resolveConfiguration(ctx, {
      runRef: input.run.ref,
      role: input.sessionRole,
      // Isolate the reused entry resolution so handing it to the Host cannot
      // couple the admission's already-checked facts to a Host mutation.
      roleResolution: structuredClone(resolution),
    });
    if (configured.status !== 'ready') return configured;
    const current = configured.value;
    if (current.configurationRevision !== input.configurationRevision) {
      return { status: 'rejected', code: 'forbidden', reason: 'the current Host configuration revision disagrees with the prepared revision' };
    }
    // The accepted Run envelope, when present, is the formal permission source;
    // the caller-supplied manifest permissions must still match it exactly.
    const permissions = input.run.envelope?.permissions ?? input.permissions;
    if (!sameJson(permissions, input.permissions)) {
      return { status: 'rejected', code: 'forbidden', reason: 'the accepted Run permissions disagree with the prepared manifest permissions' };
    }
    const ceiling = resolution.status === 'resolved' ? resolution.spec.permissions : null;
    if (permissions.policyRevision !== input.run.roleBinding.policyRevision
      || !permissions.tools.every(tool => current.tools.includes(tool) && (ceiling === null || ceiling.tools.includes(tool)))
      || !permissions.writeScope.every(path => current.writeScope.includes(path))
      || (ceiling?.writeScope === 'none' && permissions.writeScope.length !== 0)
      || (permissions.tools.includes('shell') && (current.shellWorkspaceAccess !== 'all_except_denied'
        || permissions.writeScope.length !== 1 || permissions.writeScope[0] !== '.'))) {
      return { status: 'rejected', code: 'forbidden', reason: 'the prepared permissions are not allowed by the current Host and Role ceilings' };
    }
    let hostTemplate: typeof input.hostTemplate;
    if (resolution.status === 'resolved') {
      if (input.sessionRole.kind !== 'role_spec') {
        return { status: 'rejected', code: 'forbidden', reason: 'a resolved Role requires a role_spec Session role' };
      }
      hostTemplate = null;
    } else {
      if (input.sessionRole.kind !== 'legacy_template' || current.hostTemplate === null) {
        return { status: 'rejected', code: 'unsupported', reason: 'an absent Role requires an explicit versioned Host legacy template' };
      }
      if (input.sessionRole.templateId !== current.hostTemplate.templateId
        || input.sessionRole.templateRevision !== current.hostTemplate.revision) {
        return { status: 'rejected', code: 'forbidden', reason: 'the Session legacy template disagrees with the current Host template' };
      }
      hostTemplate = current.hostTemplate;
    }
    if (!sameJson(hostTemplate, input.hostTemplate)) {
      return { status: 'rejected', code: 'forbidden', reason: 'the current Host template disagrees with the prepared manifest template' };
    }
    return { status: 'ready', value: {
      configurationRevision: current.configurationRevision,
      permissions: structuredClone(permissions),
      hostTemplate: hostTemplate === null ? null : structuredClone(hostTemplate),
    } };
  };
}

/**
 * R5b.2 trusted Query Host projection. It reuses the SAME
 * `resolveQueryConfiguration` binding the Runtime Query branch uses, returns the
 * exact trusted configuration revision/tools/budget/template, and applies the
 * Query read-only ceiling (zero write scope). It never echoes a manifest
 * declaration and is never a constant `true`.
 */
function createAuthorizeQueryConfiguration(host: RuntimeHostBindings): AuthorizeQueryConfiguration {
  return async (ctx, input) => {
    if (host.resolveQueryConfiguration === undefined) {
      return { status: 'rejected', code: 'unsupported', reason: 'the trusted Query Host configuration binding is not configured' };
    }
    const executionState = input.run.run.executionState;
    if (executionState === undefined) {
      return { status: 'rejected', code: 'incomplete', reason: 'the QueryRun has no persisted execution state to authorize' };
    }
    const execution = input.job.job.intent.execution;
    if (execution === undefined) {
      return { status: 'rejected', code: 'unsupported', reason: 'the QueryJob has no explicit read-only execution binding' };
    }
    const configured = await host.resolveQueryConfiguration(ctx, {
      queryRunRef: input.run.ref,
      sessionRef: executionState.sessionRef,
      role: input.sessionRole,
      roleResolution: input.roleResolution,
    });
    if (configured.status !== 'ready') return configured;
    // The Query ceiling is the intersection of the real Host grant, the stable
    // Role ceiling and the read-only Query ceiling. It never echoes a manifest
    // declaration and never widens the Host grant.
    return { status: 'ready', value: projectQueryConfiguration({
      host: configured.value, requested: execution.runtimeBudget, roleResolution: input.roleResolution,
    }) };
  };
}

/** Trusted local composition root. Old Ledger/Index/Vault instances cannot be
 * supplied. No business bootstrap/claim API is invented by the storage factory. */
export async function createTargetPlatform(options: TargetPlatformOptions) {
  const now = options.now ?? (() => new Date().toISOString());
  const materialsSchema = materialRecordSchemas();
  const schemas = {
    records: [...materialsSchema.records, ...PLAN_RECORD_SCHEMAS.records, ...PLAN_STATE_RECORD_SCHEMAS.records,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records, ...SESSION_LIFECYCLE_RECORD_SCHEMAS.records,
      ...ROLE_RECORD_SCHEMAS.records, ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.records,
      ...ARCHITECTURE_CATALOG_SCHEMAS.records, ...TASK_CLAIM_RECORD_SCHEMAS.records,
      ...EXECUTION_ENTRY_RECORD_SCHEMAS.records, ...MODEL_REQUEST_RECORD_SCHEMAS.records,
      ...SESSION_MESSAGE_RECORD_SCHEMAS.records, ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.records,
      ...CONTROL_RECORD_SCHEMAS.records, ...EVIDENCE_RECORD_SCHEMAS.records, ...QUERY_JOB_RECORD_SCHEMAS.records,
      ...COMPLETION_RECORD_SCHEMAS.records],
    events: [...materialsSchema.events, ...PLAN_RECORD_SCHEMAS.events, ...PLAN_STATE_RECORD_SCHEMAS.events,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events, ...SESSION_LIFECYCLE_RECORD_SCHEMAS.events,
      ...ROLE_RECORD_SCHEMAS.events, ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.events, ...ARCHITECTURE_CATALOG_SCHEMAS.events,
      ...TASK_CLAIM_RECORD_SCHEMAS.events, ...EXECUTION_HISTORY_RECORD_SCHEMAS.events,
      ...EXECUTION_ENTRY_RECORD_SCHEMAS.events, ...MODEL_REQUEST_RECORD_SCHEMAS.events,
      ...SESSION_MESSAGE_RECORD_SCHEMAS.events, ...MATERIAL_GRANT_EVENT_SCHEMAS,
      ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events, ...CONTROL_RECORD_SCHEMAS.events, ...EVIDENCE_RECORD_SCHEMAS.events, ...QUERY_JOB_RECORD_SCHEMAS.events,
      ...COMPLETION_RECORD_SCHEMAS.events],
    lookups: [...materialsSchema.lookups ?? [], ...PLAN_RECORD_SCHEMAS.lookups ?? [], ...PLAN_STATE_RECORD_SCHEMAS.lookups ?? [],
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.lookups ?? [], ...SESSION_RECORD_SCHEMAS.lookups ?? [],
      ...SESSION_LIFECYCLE_RECORD_SCHEMAS.lookups ?? [], ...ROLE_RECORD_SCHEMAS.lookups ?? [],
      ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.lookups ?? [], ...ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? [],
      ...TASK_CLAIM_RECORD_SCHEMAS.lookups ?? [], ...EXECUTION_ENTRY_RECORD_SCHEMAS.lookups ?? [],
      ...MODEL_REQUEST_RECORD_SCHEMAS.lookups ?? [], ...SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? [],
      ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.lookups ?? [], ...CONTROL_RECORD_SCHEMAS.lookups ?? [], ...EVIDENCE_RECORD_SCHEMAS.lookups ?? [], ...QUERY_JOB_RECORD_SCHEMAS.lookups ?? [],
      ...COMPLETION_RECORD_SCHEMAS.lookups ?? []],
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
    // The one Workspace source capability is constructed early so the material
    // reader/writer and the grant writer share the exact same trusted provider.
    const access = createWorkspaceAccessFactory(options.workspace);
    const source = createMaterialSourceProvider({ access, contextForScope });
    const reads = createMaterialRecordReaders(backend.records);
    // R4.1: the raw control service shares the ONE records/authority pair; the
    // public port is wrapped below so close drains an in-flight control call.
    const rawControls = createRunControlService({ records: backend.records, authority: reads.authority,
      now, eventId: randomUUID });
    const grants = createMaterialAccessResolver(reads.authority, reads.index, source);
    const rawMaterials = createMaterialService({ bodies, authority: reads.authority, grants, now });
    const grantService = createMaterialGrantService({ records: backend.records, authority: reads.authority,
      materials: rawMaterials, source, now, eventId: randomUUID });
    const rawGoals = createGoalService({ records: backend.records, now, eventId: randomUUID }).tasks;
    const workspace = createWorkspaceTools({ access,
      now, limits: DEFAULT_WORKSPACE_LIMITS });
    const roleService = createRoleConfigurationService({ records: backend.records, now, eventId: randomUUID });
    const bootstrap = createProjectBootstrapServices({ records: backend.records, now, eventId: randomUUID });
    // C2 §3.1: build the unique execution reader and the optional trusted Host
    // authorization BEFORE the single Plan service, so the W2 delegated writes
    // and the C1 mailbox admission share exactly this instance and this callback.
    const executionReader = createRunStateReader({ records: backend.records });
    const authorizeConfiguration = options.runtime === undefined
      ? undefined : createAuthorizeConfiguration(options.runtime);
    const sessionDirectory = createSessionDirectory({ records: backend.records, lookups: backend.records });
    // The public mailbox is real even without a model Host binding; internal
    // calls use the raw service so an in-flight operation is never rejected by
    // the public tracked wrapper after close has already begun. It is built
    // BEFORE the Query jobs so a consultation submit can use its read-only
    // message seam; no second mailbox/service instance exists.
    const mailbox = createSessionMailbox({ records: backend.records, sessions: sessionDirectory,
      executions: executionReader, roles: roleService, materials: rawMaterials,
      systemActor: SYSTEM_ACTOR, now, newId: randomUUID,
      ...(authorizeConfiguration === undefined ? {} : { runtimeAdmission: { bodies, authorizeConfiguration } }) });
    // R5b.2: the ONE internal Query writer shares this records/roles/bodies
    // instance. It is injected into the QueryJob claim/read adapter and the
    // Runtime thin path, never published as a public terminal port. Without a
    // trusted Runtime Host binding there is no Query Host projection, so the new
    // Query methods stay unsupported while pending submit/read is unchanged.
    const queryExecution = options.runtime === undefined ? undefined : createQueryExecution({
      records: backend.records, roles: roleService, bodies,
      authorizeConfiguration: createAuthorizeQueryConfiguration(options.runtime),
      now, eventId: randomUUID,
    });
    const queryJobs = createQueryJobService({
      records: backend.records, now, eventId: randomUUID,
      ...(queryExecution === undefined ? {} : { execution: queryExecution }),
      consultations: { readMessage: mailbox.readMessage.bind(mailbox), readMessageBody: mailbox.readMessageBody.bind(mailbox) },
    });
    const observed = createObservedArchitecture({ records: backend.records, bodies, access, workspace: workspace.tools,
      source: options.architectureSource ?? { provider: 'typescript', configPath: 'tsconfig.json' } });
    const catalog = createArchitectureCatalogService({ records: backend.records });
    const planService = createPlanService({ records: backend.records, materials: rawMaterials, now, eventId: randomUUID,
      // R5b.4: the SAME raw body store already owned by the composition root.
      initialPlanning: { bodies },
      ...(authorizeConfiguration === undefined ? {} : {
        delegatedWrites: { reads: executionReader, roles: roleService, bodies, authorizeConfiguration },
      }) });
    const claimService = createTaskClaimService({ records: backend.records, roles: roleService,
      now, newId: randomUUID });
    const sessionLifecycle = createSessionLifecycleService({ records: backend.records, lookups: backend.records });
    const kernelStores = await createKernelStoreRegistry(options.kernelStores ?? { entries: [] });
    // Internal calls retain the raw directory. The outer Runtime operation is
    // drained once as a whole, so close cannot reject its later registration.
    const sessionOperations = createSessionOperations({ sessions: sessionDirectory, kernelStores });
    const executionHistory = createExecutionHistoryReader({ history: sessionOperations });
    const historyWriter = createExecutionHistoryService({ records: backend.records, now, eventId: randomUUID });
    const graphHistory = createGraphExecutionHistoryReader({ executions: executionReader, history: executionHistory });
    const sourceAuthority = createSourceAuthorityReader({ authority: reads.authority, records: backend.records });
    // C2 §3.1: the SAME reads/source/bodies feed the M2 material read-facts seam
    // consumed by the B2 entry and model barriers. It is a fresh per-call
    // observer, not a second persistent material service.
    const materialFacts = createMaterialReadFactsService({ authority: reads.authority, index: reads.index,
      bodies, sourceApplicability: source, now });
    // R3e.1: the ONE trusted verification/evidence service and its thin Host
    // check runner share the existing records/material/execution instances. The
    // frozen checks configuration is optional; without it fresh open/begin stay
    // unsupported while existing history reads/receipts keep their behavior.
    // R6 cold-start: the live per-workspace trusted checks configuration the
    // Host registers after an explicit user approval. It is read by a FRESH
    // round only; an already-open round keeps the configuration it froze. The
    // legacy static `options.checks` remains a compatible same-scope fallback.
    const registeredCheckConfigurations = new Map<string, TrustedCheckConfiguration>();
    const checkScopeKey = (scope: { projectId: string; workspaceId: string }): string =>
      `${scope.projectId}\u0000${scope.workspaceId}`;
    const rawEvidence = createEvidenceService({
      records: backend.records, materials: rawMaterials, materialFacts, executions: executionReader,
      workspaceHost: options.workspace, source: new VerificationWorkspaceReader(),
      ...(options.checks === undefined ? {} : { configuration: options.checks }),
      configurationFor: (scope) => registeredCheckConfigurations.get(checkScopeKey(scope))
        ?? (options.checks !== undefined
          && options.checks.workspace.projectId === scope.projectId
          && options.checks.workspace.workspaceId === scope.workspaceId
          ? options.checks : undefined),
      now, newId: randomUUID,
    });
    const rawCheckRunner = createRegisteredCheckRunner({ evidence: rawEvidence,
      workspaceHost: options.workspace, kernel, now });
    let runtime = createAgentRuntime();
    if (options.runtime !== undefined) {
      const host = options.runtime;
      // The hoisted optional instance is guaranteed present by `options.runtime`.
      const entryAuthorizeConfiguration = authorizeConfiguration as AuthorizeConfiguration;
      const entryDependencies: ExecutionEntryDependencies = {
        records: backend.records, reads: executionReader, roles: roleService, plans: planService,
        materials: rawMaterials, materialFacts, bodies, authorizeConfiguration: entryAuthorizeConfiguration,
        now, eventId: randomUUID, newId: randomUUID,
      };
      const entry = createExecutionEntryService(entryDependencies);
      const modelRequests = createModelCallService(entryDependencies);
      const dependencies: RuntimeExecutionDependencies = {
        claims: claimService, executions: executionReader, entry, historyWriter, modelRequests,
        roles: roleService, plans: planService, messages: mailbox, sessions: sessionDirectory,
        materials: rawMaterials, bodies, activity: executionHistory, graphHistory, sessionOperations,
        // R4.3a: the SAME raw control service `platform.controls` wraps. The
        // Runtime gets the internal observation writer intersection while the
        // public surface still publishes only submit/read.
        controls: rawControls,
        kernelStores, workspaceHost: options.workspace, sourceAuthority: () => sourceAuthority,
        ...(options.sourcePolicyFor === undefined ? {} : { sourcePolicyFor: options.sourcePolicyFor }),
        ...(queryExecution === undefined ? {} : { queryExecution }),
        host, kernel, now, newId: randomUUID,
      };
      runtime = createAgentRuntime(dependencies);
    }
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
    // The completion methods are published on the SAME Goal service and drained
    // through the one trackedCall/close path; no second service or store exists.
    const goals: GoalTaskPort = {
      createGoal: (...args) => trackedCall(() => rawGoals.createGoal(...args), unavailable),
      completeTask: (...args) => trackedCall(() => rawGoals.completeTask(...args), unavailable),
      completeGoal: (...args) => trackedCall(() => rawGoals.completeGoal(...args), unavailable),
    };
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
    const executions: ExecutionReadPort & ExecutionHistoryWritePort
      & Required<Pick<ExecutionReadPort, 'listExecutions'>> = {
      recordExecutionHistory: (...args) => trackedCall(() => historyWriter.recordExecutionHistory(...args), unavailable),
      readExecution: (...args) => trackedCall(() => executionReader.readExecution(...args), unavailable),
      // MVP UI connection: the bounded execution list is assembled here so the
      // route table never sees a missing method. The reader implementation is
      // still an explicit stage-one gap.
      listExecutions: (...args) => trackedCall(() => executionReader.listExecutions!(...args), unavailable),
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
    // The initialization writers share the same physical backend as Goal/Plan
    // and are drained before close like every other WorkGraph port.
    const projects: ProjectRegistrationPort = {
      createProject: (...args) => trackedCall(() => bootstrap.projects.createProject(...args), unavailable),
      registerWorkspace: (...args) => trackedCall(() => bootstrap.projects.registerWorkspace(...args), unavailable),
      readWorkspaceRegistration: (...args) => trackedCall(() => bootstrap.projects.readWorkspaceRegistration(...args), unavailable),
      // MVP UI connection: the narrow Project-only read is assembled here so a
      // real composition never leaves it absent. The reader implementation is
      // still an explicit stage-one gap.
      readProject: (...args) => trackedCall(() => bootstrap.projects.readProject!(...args), unavailable),
    };
    const completionPolicies: CompletionPolicyConfigurationPort = {
      installCompletionPolicy: (...args) => trackedCall(() => bootstrap.completionPolicies.installCompletionPolicy(...args), unavailable),
      activateCompletionPolicy: (...args) => trackedCall(() => bootstrap.completionPolicies.activateCompletionPolicy(...args), unavailable),
      // R6 cold-start: the independent current-policy read published as the
      // original `completion-policies/read` core route. The real owner always
      // publishes it; the optional cast keeps a narrow double compiling.
      readCurrentCompletionPolicy: (...args) =>
        trackedCall(() => bootstrap.completionPolicies.readCurrentCompletionPolicy!(...args), unavailable),
    };
    // R5b.1: the public pending QueryJob port depends only on the shared store;
    // it is real even without a Runtime Host binding and both operations are
    // drained before the ledger closes and reject once close has begun.
    const queries: QueryJobPort = {
      submitQueryJob: (...args) => trackedCall(() => queryJobs.submitQueryJob(...args), unavailable),
      readQueryJob: (...args) => trackedCall(() => queryJobs.readQueryJob(...args), unavailable),
      claimQuery: (...args) => trackedCall(() => queryJobs.claimQuery(...args), unavailable),
      readQueryAnswer: (...args) => trackedCall(() => queryJobs.readQueryAnswer(...args), unavailable),
    };
    const architecture: typeof observed & ArchitectureCatalogPort = {
      captureSourceChanges: (...args) => trackedCall(() => observed.captureSourceChanges(...args), unavailable),
      queryArchitecture: (...args) => trackedCall(() => observed.queryArchitecture(...args), unavailable),
      compareArchitecture: (...args) => trackedCall(() => observed.compareArchitecture(...args), unavailable),
      queryImpact: (...args) => trackedCall(() => observed.queryImpact(...args), unavailable),
      adoptInitialArchitecture: (...args) => trackedCall(() => catalog.adoptInitialArchitecture(...args), unavailable),
      reviseArchitectureCatalog: (...args) => trackedCall(() => catalog.reviseArchitectureCatalog(...args), unavailable),
      readArchitectureRevision: (...args) => trackedCall(() => catalog.readArchitectureRevision(...args), unavailable),
    };
    // Explicit task-input reads span the ledger and material store. Drain them
    // before closing either store, preserving the service's synchronous input snapshot.
    const plans: typeof planService = {
      ...planService,
      readTaskInput: (...args) => trackedCall(() => planService.readTaskInput(...args), unavailable),
      proposeInitialPlanFromAnswer: (...args) =>
        trackedCall(() => planService.proposeInitialPlanFromAnswer(...args), unavailable),
    };
    // The public material chain spans the ledger, bodies and source I/O, so the
    // whole outer call is drained before any owned store closes. The in-flight
    // service keeps the raw materials/grant instances, never these wrappers.
    const materials: MaterialPort & MaterialGrantPort = {
      storeArtifact: (...args) => trackedCall(() => rawMaterials.storeArtifact(...args), unavailable),
      openArtifact: (...args) => trackedCall(() => rawMaterials.openArtifact(...args), unavailable),
      grantMaterialAccess: (...args) => trackedCall(() => grantService.grantMaterialAccess(...args), unavailable),
      revokeMaterialAccess: (...args) => trackedCall(() => grantService.revokeMaterialAccess(...args), unavailable),
    };
    const messages: SessionMailboxPort & Required<Pick<SessionMailboxPort, 'readOutbox'>> = {
      sendMessage: (...args) => trackedCall(() => mailbox.sendMessage(...args), unavailable),
      readMessage: (...args) => trackedCall(() => mailbox.readMessage(...args), unavailable),
      readMessageBody: (...args) => trackedCall(() => mailbox.readMessageBody(...args), unavailable),
      readInbox: (...args) => trackedCall(() => mailbox.readInbox(...args), unavailable),
      readOutbox: (...args) => trackedCall(() => mailbox.readOutbox(...args), unavailable),
      ackMessage: (...args) => trackedCall(() => mailbox.ackMessage(...args), unavailable),
      respondMessage: (...args) => trackedCall(() => mailbox.respondMessage(...args), unavailable),
    };
    // The public control port is real even without a Runtime Host binding: the
    // raw service depends only on the store and exact Run reads. Both operations
    // are drained before the ledger closes and reject once close has begun.
    const controls: RunControlPort = {
      submitControl: (...args) => trackedCall(() => rawControls.submitControl(...args), unavailable),
      readControl: (...args) => trackedCall(() => rawControls.readControl(...args), unavailable),
    };
    // The public evidence/check ports drain the whole outer call before any
    // owned store closes; the raw services keep their original instances.
    const evidence: EvidencePort = {
      openVerification: (...args) => trackedCall(() => rawEvidence.openVerification(...args), unavailable),
      readVerification: (...args) => trackedCall(() => rawEvidence.readVerification(...args), unavailable),
      // The narrow original-round read delegates to the raw Evidence owner's
      // formal RecordStore candidate lookup; no second store, table or manager.
      queryOriginalVerification: (...args) => trackedCall(() => rawEvidence.queryOriginalVerification!(...args), unavailable),
      beginCheck: (...args) => trackedCall(() => rawEvidence.beginCheck(...args), unavailable),
      recordCheckResult: (...args) => trackedCall(() => rawEvidence.recordCheckResult(...args), unavailable),
      submitEvidence: (...args) => trackedCall(() => rawEvidence.submitEvidence(...args), unavailable),
      finalizeChecks: (...args) => trackedCall(() => rawEvidence.finalizeChecks(...args), unavailable),
    };
    const checks: RegisteredCheckRunner = {
      runRegisteredCheck: (...args) => trackedCall(() => rawCheckRunner.runRegisteredCheck(...args), unavailable),
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
        const pending = { supported: false, reason: 'continuation, recovery, cancellation, pause, compaction and scoped writes are not implemented' };
        return { status: 'ready', value: {
          adapterId: registered.adapterId, kernelSessionApiVersion: kernel.kernelSessionApiVersion,
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
      async readCompletedBoundary(ctx: CoreCallContext, request: { sessionRef: SessionRef }): Promise<ReadResult<{ cursor: string | null; position: number }>> {
        if (isClosing) return { status: 'rejected', code: 'unavailable', reason: 'platform is closing' };
        if (ctx.principal.kind !== 'host') return { status: 'rejected', code: 'forbidden', reason: 'the completed boundary read requires the Host principal' };
        if (request.sessionRef.projectId !== ctx.projectId) return { status: 'rejected', code: 'forbidden', reason: 'the Session belongs to another project' };
        const read = await sessionDirectory.readSession(ctx, request.sessionRef);
        if (read.status !== 'ready') return read;
        const owner = createSessionHistoryCursorOwner({ kernelStores });
        const boundary = await owner.completedBoundary({ session: read.value.record, signal: ctx.signal });
        if (boundary.status !== 'resolved') {
          return { status: 'rejected', code: boundary.code, reason: boundary.reason };
        }
        return { status: 'ready', value: { cursor: boundary.cursor, position: boundary.position } };
      },
      prepareExecution(...args: Parameters<typeof runtime.port.prepareExecution>) {
        return sessionCall(() => runtime.port.prepareExecution(...args));
      },
      startRun(...args: Parameters<typeof runtime.port.startRun>) {
        return sessionCall(() => runtime.port.startRun(...args));
      },
      observeRun(...args: Parameters<typeof runtime.port.observeRun>) {
        return sessionCall(() => runtime.port.observeRun(...args));
      },
      // R4.3a: local control delivery runs on the SAME trackedCall/close path as
      // execution; no public close API or background recovery is added.
      deliverControl(...args: Parameters<NonNullable<typeof runtime.port.deliverControl>>) {
        return sessionCall(() => runtime.port.deliverControl!(...args));
      },
      prepareQuery(...args: Parameters<NonNullable<typeof runtime.port.prepareQuery>>) {
        return sessionCall(() => runtime.port.prepareQuery!(...args));
      },
      startQuery(...args: Parameters<NonNullable<typeof runtime.port.startQuery>>) {
        return sessionCall(() => runtime.port.startQuery!(...args));
      },
      observeQuery(...args: Parameters<NonNullable<typeof runtime.port.observeQuery>>) {
        return sessionCall(() => runtime.port.observeQuery!(...args));
      },
    };
    // R5c.1: the raw Runtime surface is the SAME `runtime.port` plus the
    // existing Session operations; no second Runtime/Store/Kernel is created.
    // The Workflow gets raw owners (never the public tracked wrappers) because
    // the whole public advanceWork call is drained as one tracked unit below.
    const rawRuntime = {
      ...runtime.port,
      createSession: (...args: Parameters<typeof sessionOperations.createSession>) =>
        sessionOperations.createSession(...args),
      readSessionHistory: (...args: Parameters<typeof sessionOperations.readSessionHistory>) =>
        sessionOperations.readSessionHistory(...args),
      readTaskExecutionHistory: (...args: Parameters<typeof graphHistory.readTaskExecutionHistory>) =>
        graphHistory.readTaskExecutionHistory(...args),
      readExecutionHistory: (...args: Parameters<typeof executionHistory.readExecutionHistory>) =>
        executionHistory.readExecutionHistory(...args),
    };
    const workflowConfiguration = options.workflow === undefined
      ? undefined : structuredClone(options.workflow);
    const workflowDependencies: WorkflowDependencies = {
      tasks: rawGoals, plans: planService, sessions: sessionDirectory, claims: claimService,
      executions: executionReader, runtime: rawRuntime, evidence: rawEvidence, checks: rawCheckRunner,
      sourceAuthority,
      ...(workflowConfiguration === undefined ? {} : { configuration: workflowConfiguration }),
      // The explicit-consultation consumer reuses the SAME mailbox/Query/Project
      // owners. The mailbox half is read-only plus the ONE Host-only answer
      // association; it is never a second mailbox or a new service.
      consultations: {
        messages: { readMessage: mailbox.readMessage.bind(mailbox), readMessageBody: mailbox.readMessageBody.bind(mailbox),
          respondFromQueryAnswer: mailbox.respondFromQueryAnswer.bind(mailbox),
          recordConsultationDerivation: mailbox.recordConsultationDerivation!.bind(mailbox) },
        queries: queryJobs,
        projects: bootstrap.projects,
      },
    };
    const rawWorkflow = createWorkflow(workflowDependencies);
    // The public advancement port drains the complete call before any owned
    // store closes; the in-flight raw workflow keeps the raw owner instances.
    const workflow: WorkflowPort & Required<Pick<WorkflowPort, 'consumeConsultation'>> = {
      handleGoalInput: (...args) => trackedCall(() => rawWorkflow.handleGoalInput(...args), unavailable),
      advanceWork: (...args) => trackedCall(() => rawWorkflow.advanceWork(...args), unavailable),
      consumeConsultation: (...args) => trackedCall(() => rawWorkflow.consumeConsultation(...args), unavailable),
    };
    let closing: Promise<void> | undefined;
    return {
      goals, plans, claims, executions, sessions, materials, messages, controls, evidence, checks, roles, architecture, projects, completionPolicies,
      queries,
      workspace: workspace.tools, runtime: runtimePort, workflow, kernelStores,
      /**
       * Extend the trusted Workflow configuration with one newly opened
       * workspace binding. The existing Workflow reads `deps.configuration`
       * live, so the binding takes effect without a restart; a binding for the
       * exact workspace is upserted and never duplicated or widened.
       */
      /**
       * R6 cold-start narrow seam: register the CURRENT Host-approved trusted
       * checks configuration for exactly one workspace. It only replaces the
       * registration map keyed by that workspace scope; a fresh round opened
       * afterwards resolves it, while every already-open round keeps its own
       * frozen configuration. It grants no model/tool permission of its own.
       */
      registerCheckConfiguration(input: { configuration: TrustedCheckConfiguration }): void {
        registeredCheckConfigurations.set(checkScopeKey(input.configuration.workspace), structuredClone(input.configuration));
      },
      registerWorkflowBinding(input: { consumerId: string; binding: WorkflowHostConfiguration['bindings'][number] }): void {
        const current = workflowDependencies.configuration;
        if (current === undefined) {
          workflowDependencies.configuration = { consumerId: input.consumerId, bindings: [structuredClone(input.binding)] };
          return;
        }
        const bindings = current.bindings as WorkflowHostConfiguration['bindings'][number][];
        const index = bindings.findIndex(existing => existing.workspace.projectId === input.binding.workspace.projectId
          && existing.workspace.workspaceId === input.binding.workspace.workspaceId);
        if (index >= 0) bindings[index] = structuredClone(input.binding);
        else bindings.push(structuredClone(input.binding));
      },
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
