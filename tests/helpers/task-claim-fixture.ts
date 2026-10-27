/**
 * R4c.1 behavior-test fixture.
 *
 * It builds a REAL target graph (Project/Workspace/governance + a Goal and an
 * accepted immutable Plan + mapped Sessions) over the real Memory/SQLite
 * backends and the real WorkGraph services. It never fabricates a claim
 * result: the claim itself is always produced by the formal `TaskClaimPort`.
 *
 * The `roles` dependency uses the real RoleConfigurationService, including its
 * internal facts entry. Missing production behavior stays RED; the fixture
 * does not invent role results or replace their guards.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, VersionPin, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { RoleBindingRefV1, RunRef, RunSnapshot, TaskBudgetV1, TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef, ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type {
  EncodedRecord, GoalRecordTransactionPort, RecordBackendSchemas, RecordGuard, StoreCommitReceipt,
} from '../../src/core/record-store/ports.js';
import type { LookupValue, RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import { PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS, PLAN_STATE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { SESSION_RECORD_SCHEMAS, encodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { ROLE_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/role-record-codecs.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createContextAssembler, type ContextAssemblerDependencies } from '../../src/core/agent-runtime/context-assembler.js';
import { createExecutionPreparation, loadPreparedManifest } from '../../src/core/agent-runtime/execution-preparation.js';
import { createQueryPreparation } from '../../src/core/agent-runtime/query-preparation.js';
import type { RuntimeHostBindings, ResolvedRuntimeConfiguration } from '../../src/core/agent-runtime/execution-contracts.js';
import type { QueryExecutionPort } from '../../src/core/work-graph/queries/contracts.js';
import type { QueryRunRef } from '../../src/contracts/query-job.js';
import type {
  PreparedQueryExecution, PreparedQueryManifestV1, PreparedTaskExecution, PreparedTaskManifestV1,
} from '../../src/contracts/core/prepared-execution.js';
import type { ContextAssemblyBindingV1 } from '../../src/contracts/graph-context.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import type { ModelClientPort } from '../../vendor/coding-agent/dist/public-api.js';
import { TASK_CLAIM_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import { UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import { EXECUTION_HISTORY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-history-codecs.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createInitializationBindingReader } from '../../src/core/work-graph/tasks/goal-confirm-service.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import type { RoleConfigurationPort } from '../../src/core/work-graph/model/configuration-contracts.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import type { ClaimTaskInput, TaskClaimPort } from '../../src/core/work-graph/model/claim-contracts.js';
import type { GoalTaskPort, GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type { PlanTaskPort } from '../../src/core/work-graph/model/plan-contracts.js';
import type { SessionDirectoryPort } from '../../src/core/work-graph/model/session-contracts.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';

const AT = '2026-09-24T00:00:00.000Z';
export const CLAIM_FIXTURE_AT = AT;
export const CLAIM_FIXTURE_EXPIRED_DEADLINE = '2000-01-01T00:00:00.000Z';

export type ClaimFixtureKind = 'memory' | 'sqlite';

/** Counts the physical calls the claim service makes through its injected
 * records port. Fixture setup does not touch this wrapper, so a spy read after
 * a claim reflects that claim alone. */
export type RecordSpy = {
  lookups: { index: string; values: LookupValue[] }[];
  readMany: string[][];
  commits: number;
  lookupCommits: number;
  eventAt: number;
};

export type MaterialSpy = { openArtifactCalls: number };

export type Records = GoalRecordTransactionPort & RecordLookupPort;

export type ClaimConnection = {
  records: Records;
  spy: RecordSpy;
  service: TaskClaimPort;
  close(): Promise<void>;
};

export type ClaimRequestOverrides = {
  input?: Partial<ClaimTaskInput>;
  requestId?: string;
  expected?: readonly VersionPin[];
};

export type ClaimFixtureOptions<A = unknown> = {
  /** The clock the fixture's owners (and its public bootstrap) use; default `CLAIM_FIXTURE_AT`. */
  clock?: () => string;
  /** Opt-in store observer installed before every bootstrap write; its result is exposed as `audit`. */
  audit?: (records: Records) => A;
  /** The trusted initial architecture module the public bootstrap adopts. */
  bootstrapModule?: { moduleId?: string; name?: string; responsibility?: string; description?: string;
    paths?: readonly string[] };
};

export type TaskClaimFixture = {
  kind: ClaimFixtureKind;
  directory: string;
  ledgerPath: string;
  records: Records;
  spy: RecordSpy;
  materialsSpy: MaterialSpy;
  service: TaskClaimPort;
  ctx: CoreCallContext;
  scope: WorkspaceScope;
  projectRef: ProjectSnapshot['ref'];
  workspaceRef: WorkspaceSnapshot['ref'];
  goalRef: GoalRef;
  planRef: PlanRevisionRef;
  plan: PlanRevisionSnapshot;
  tasks: { first: TaskTriple; second: TaskTriple; gate: TaskTriple };
  sessions: { first: SessionRef; second: SessionRef };
  roleBinding: RoleBindingRefV1;
  budget: TaskBudgetV1;
  goals: GoalTaskPort;
  plans: PlanTaskPort;
  sessionsPort: SessionDirectoryPort;
  roleService: RoleConfigurationPort;
  /** Reuse real roles and ids while a test controls the record boundary/clock. */
  makeService(records?: Records, now?: () => string): TaskClaimPort;
  buildRequest(overrides?: ClaimRequestOverrides): Promise<GraphWrite<ClaimTaskInput>>;
  sessionPin(ref: SessionRef): Promise<VersionPin>;
  goalPin(): Promise<VersionPin>;
  createSession(requestId: string, role?: RoleConfigurationRef): Promise<SessionRef>;
  seedRun(taskId: string, status: RunSnapshot['status']): Promise<RunRef>;
  overwriteSession(ref: SessionRef, mutate: (record: SessionRecord) => SessionRecord): Promise<void>;
  commitRaw(records: readonly EncodedRecord[], guards?: readonly RecordGuard[]): Promise<StoreCommitReceipt>;
  openConnection(): Promise<ClaimConnection>;
  /** Only meaningful for SQLite: open a brand-new connection on the same ledger. */
  reopenService(): Promise<ClaimConnection>;
  /** Close the primary backend WITHOUT deleting the ledger directory. */
  closeBackend(): Promise<void>;
  close(): Promise<void>;
};

function emptySpy(): RecordSpy {
  return { lookups: [], readMany: [], commits: 0, lookupCommits: 0, eventAt: 0 };
}

/**
 * K3 L7 fixtures: register each record/event/lookup schema once. Callers that
 * already pass `UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS` through `additionalSchemas`
 * must not make the backend reject the whole list as a duplicate aggregateType.
 */
function uniqueBySchemaId<T>(items: readonly T[], id: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = id(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function wrapRecords(target: Records, spy: RecordSpy): Records {
  return {
    readMany(refKeys) { spy.readMany.push([...refKeys]); return target.readMany(refKeys); },
    lookupCommit(input) { spy.lookupCommits += 1; return target.lookupCommit(input); },
    commit(input) { spy.commits += 1; return target.commit(input); },
    eventAt(cursor) { spy.eventAt += 1; return target.eventAt(cursor); },
    lookup(request) {
      spy.lookups.push({ index: request.index, values: [...request.values] });
      return target.lookup(request);
    },
  };
}

/** The real Goal/Plan/Session records plus an accepted plan for two work tasks
 * and one goal gate. Governance is created through the public bootstrap owners
 * (Project, Workspace, completion policy and the adopted architecture). */
export async function createTaskClaimFixture<A = unknown>(kind: ClaimFixtureKind,
  additionalSchemas: RecordBackendSchemas = { records: [], events: [] },
  options: ClaimFixtureOptions<A> = {}): Promise<TaskClaimFixture & { audit?: A }> {
  const directory = await mkdtemp(join(tmpdir(), `next-r4c-claim-${kind}-`));
  const ledgerPath = join(directory, 'ledger.sqlite');
  const materials = materialRecordSchemas();
  const schemas: RecordBackendSchemas = {
    records: uniqueBySchemaId([...materials.records, ...PLAN_RECORD_SCHEMAS.records, ...PLAN_STATE_RECORD_SCHEMAS.records,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records,
      ...ROLE_RECORD_SCHEMAS.records, ...TASK_CLAIM_RECORD_SCHEMAS.records,
      ...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.records, ...ARCHITECTURE_CATALOG_SCHEMAS.records,
      ...additionalSchemas.records], (schema) => schema.schemaId),
    events: uniqueBySchemaId([...materials.events, ...PLAN_RECORD_SCHEMAS.events, ...PLAN_STATE_RECORD_SCHEMAS.events,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events,
      ...ROLE_RECORD_SCHEMAS.events, ...TASK_CLAIM_RECORD_SCHEMAS.events, ...EXECUTION_HISTORY_RECORD_SCHEMAS.events,
      { eventType: 'TrustedScopeSeeded', schemaVersion: 1,
        validate: event => ({ status: 'decoded', value: event }) }, ...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.events,
      ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events, ...ARCHITECTURE_CATALOG_SCHEMAS.events,
      ...additionalSchemas.events], (schema) => `${schema.eventType}@${String(schema.schemaVersion)}`),
    lookups: uniqueBySchemaId([...(materials.lookups ?? []), ...(PLAN_RECORD_SCHEMAS.lookups ?? []),
      ...(PLAN_STATE_RECORD_SCHEMAS.lookups ?? []), ...(PLAN_GOVERNANCE_RECORD_SCHEMAS.lookups ?? []),
      ...(SESSION_RECORD_SCHEMAS.lookups ?? []), ...(ROLE_RECORD_SCHEMAS.lookups ?? []),
      ...(TASK_CLAIM_RECORD_SCHEMAS.lookups ?? []), ...(UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.lookups ?? []),
      ...(additionalSchemas.lookups ?? [])], (index) => index.name),
  };
  const backend = kind === 'memory'
    ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path: ledgerPath, schemas });
  const audit = options.audit?.(backend.records);

  const projectId = 'r4c-claim-project';
  const workspaceId = 'r4c-claim-workspace';
  const scope: WorkspaceScope = { projectId, workspaceId };
  const projectRef: ProjectSnapshot['ref'] = { aggregateType: 'Project', projectId };
  const workspaceRef: WorkspaceSnapshot['ref'] = { aggregateType: 'Workspace', projectId, workspaceId };
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId, goalId: 'r4c-claim-goal' };
  const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId, planId: 'r4c-claim-plan' };
  const actor = { kind: 'human' as const, id: 'r4c-claim-operator' };
  const ctx: CoreCallContext = {
    projectId, workspaceId, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal,
  };

  const now = options.clock ?? (() => AT);
  // ---- real Project/Workspace/policy/baseline bootstrap through the public owners --
  let bootstrapSeq = 0;
  const bootstrap = createProjectBootstrapServices({ records: backend.records, now,
    eventId: () => `r4c-claim-bootstrap-${++bootstrapSeq}` });
  const createdProject = await bootstrap.projects.createProject(ctx, {
    input: { projectId }, meta: { requestId: 'r4c-claim-create-project', expected: [{ ref: projectRef, revision: 0 }] },
  });
  if (createdProject.status !== 'committed') throw new Error(`fixture project setup failed: ${JSON.stringify(createdProject)}`);
  const registeredWorkspace = await bootstrap.projects.registerWorkspace(ctx, {
    input: { workspace: scope }, meta: { requestId: 'r4c-claim-register-workspace', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] },
  });
  if (registeredWorkspace.status !== 'committed') throw new Error(`fixture workspace setup failed: ${JSON.stringify(registeredWorkspace)}`);
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId,
    policyId: 'r4c-claim-policy', revision: 1 };
  const installed = await bootstrap.completionPolicies.installCompletionPolicy(ctx, {
    input: { policyId: policyRef.policyId, contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } },
    meta: { requestId: 'r4c-claim-install-policy', expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
  });
  if (installed.status !== 'committed') throw new Error(`fixture policy setup failed: ${JSON.stringify(installed)}`);
  const activated = await bootstrap.completionPolicies.activateCompletionPolicy(ctx, {
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } },
    meta: { requestId: 'r4c-claim-activate-policy', expected: [{ ref: projectRef, revision: 1 },
      { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId }, revision: 0 }] },
  });
  if (activated.status !== 'committed') throw new Error(`fixture policy activation failed: ${JSON.stringify(activated)}`);
  const architectureModule = {
    moduleId: options.bootstrapModule?.moduleId ?? 'r4c-claim-work',
    name: options.bootstrapModule?.name ?? 'R4c claim work',
    responsibility: options.bootstrapModule?.responsibility ?? 'Fixture workspace',
    description: options.bootstrapModule?.description ?? 'R4c claim fixture baseline',
    paths: options.bootstrapModule?.paths ?? ['src/r4c-claim-work'],
  };
  const architecture = await createArchitectureCatalogService({ records: backend.records }).adoptInitialArchitecture(ctx, {
    input: { baselineId: 'r4c-claim-baseline', description: architectureModule.description, constraints: [],
      catalog: { requireDag: true, dependencies: [], modules: [{ ref: { projectId, moduleId: architectureModule.moduleId },
        name: architectureModule.name, responsibility: architectureModule.responsibility, paths: [...architectureModule.paths], interfaces: [] }] } },
    meta: { requestId: 'r4c-claim-adopt-architecture', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
  });
  if (architecture.status !== 'committed') throw new Error(`fixture architecture setup failed: ${JSON.stringify(architecture)}`);

  // ---- real services over the real backends ---------------------------------
  let eventSeq = 0;
  const eventId = () => `r4c-claim-event-${++eventSeq}`;
  let seedSeq = 0;
  let requestSeq = 0;
  let idSeq = 0;
  const newId = () => `r4c-claim-id-${++idSeq}`;
  const materialsSpy: MaterialSpy = { openArtifactCalls: 0 };
  const materialsPort = {
    async openArtifact() {
      materialsSpy.openArtifactCalls += 1;
      return { status: 'rejected' as const, code: 'unsupported' as const,
        reason: 'R4c.1 fixture: claim admission must not read material' };
    },
  };
  const goalsService = createGoalService({ records: backend.records, now, eventId });
  const plans = createPlanService({ records: backend.records, bindings: createInitializationBindingReader({ records: backend.records }),
    materials: materialsPort, now, eventId });
  const sessionsPort = createSessionDirectory({ records: backend.records, lookups: backend.records });

  const roleService = createRoleConfigurationService({ records: backend.records, now, eventId });

  async function commitRaw(recordsToWrite: readonly EncodedRecord[],
    guards: readonly RecordGuard[] = []): Promise<StoreCommitReceipt> {
    const sequence = ++seedSeq;
    const event = { eventId: `r4c-claim-seed-event-${sequence}`, eventType: 'TrustedScopeSeeded', schemaVersion: 1,
      occurredAt: now(), json: JSON.stringify({ eventId: `r4c-claim-seed-event-${sequence}`,
        eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: now() }) };
    const guarded = new Set(guards.map(guard => guard.refKey));
    const allGuards: RecordGuard[] = [...guards,
      ...recordsToWrite.filter(record => !guarded.has(record.refKey))
        .map(record => ({ refKey: record.refKey, expectedRevision: null }))];
    return backend.records.commit({ identityKey: `r4c-claim-seed-${sequence}`,
      fingerprint: `r4c-claim-seed-fingerprint-${sequence}`, guards: allGuards,
      records: [...recordsToWrite], events: [event], claims: [], indexGuards: [], indexChanges: [] });
  }

  // ---- Goal + accepted Plan through the real services ------------------------
  const createdGoal = await goalsService.tasks.createGoal(ctx, { meta: {
    requestId: 'r4c-claim-create-goal',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'Exercise the atomic claim skeleton' } });
  if (createdGoal.status !== 'committed') throw new Error(`fixture Goal creation failed: ${JSON.stringify(createdGoal)}`);

  const draft: PlanRevisionDraft = { schemaVersion: 2, planId: planRef.planId, planRevision: 1,
    goalId: goalRef.goalId, stages: [],
    tasks: [
      { taskId: 'implement-a', title: 'Implement A', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'implement-b', title: 'Implement B', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'gate-goal', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [
      { taskId: 'implement-a', role: 'builder', instruction: 'Implement A' },
      { taskId: 'implement-b', role: 'builder', instruction: 'Implement B' },
    ],
    obligations: [{ obligationId: 'obligation-1', title: 'Deliver implementation', requirementLevel: 'required',
      taskIds: ['implement-a', 'implement-b', 'gate-goal'],
      verificationRequirements: [{ requirementId: 'check-1', requirementLevel: 'required', kind: 'test',
        description: 'Tests pass' }] }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [{ taskId: 'implement-b', dependsOnId: 'implement-a',
      requires: { kind: 'output-contract', label: 'A output contract' } }] } };
  const proposed = await plans.proposePlan(ctx, { meta: { requestId: 'r4c-claim-propose-plan',
    expected: [{ ref: goalRef, revision: 1 }] },
    input: { goalRef, basedOn: null, draft, reason: { text: 'Initial R4c claim plan', sources: [] } } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
    throw new Error(`fixture Plan proposal failed: ${JSON.stringify(proposed)}`);
  }
  const applied = await plans.applyPlanChange(ctx, { meta: { requestId: 'r4c-claim-apply-plan',
    expected: [{ ref: goalRef, revision: 1 }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`fixture Plan adoption failed: ${JSON.stringify(applied)}`);
  const plan = applied.value;

  // ---- mapped Sessions through the real directory + Kernel store -------------
  const kernelStores = await createKernelStoreRegistry({ entries: [{ adapterId: 'r4c-claim-kernel',
    storeKey: 'r4c-claim-kernel-store', workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] });
  const defaultRole: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };

  const sessionOperations = createSessionOperations({ sessions: sessionsPort, kernelStores });

  async function createSession(requestId: string, role: RoleConfigurationRef = defaultRole): Promise<SessionRef> {
    // The real Session operations owner admits, creates the pinned Kernel Session
    // and registers the mapping; the fixture never calls `recordSessionCreated`.
    const created = await sessionOperations.createSession(ctx, {
      workspace: scope, role, recommendedRefs: [], initialLinks: [],
      meta: { requestId: `admit-${requestId}`, expected: [] },
    });
    if (created.status !== 'completed') throw new Error(`fixture session creation failed: ${JSON.stringify(created)}`);
    return { projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId };
  }
  const firstSession = await createSession('session-first');
  const secondSession = await createSession('session-second');

  // ---- records port/claim service (spy only observes the claim service) ------
  const spy = emptySpy();
  let backendClosed = false;
  const wrapped = wrapRecords(backend.records, spy);
  function makeService(target: Records = wrapped, clock: () => string = now): TaskClaimPort {
    const roles = createRoleConfigurationService({ records: target, now: clock, eventId });
    return createTaskClaimService({ records: target, roles, now: clock, newId });
  }
  const service = makeService();

  const tasks = {
    first: { projectId, goalId: goalRef.goalId, taskId: 'implement-a' },
    second: { projectId, goalId: goalRef.goalId, taskId: 'implement-b' },
    gate: { projectId, goalId: goalRef.goalId, taskId: 'gate-goal' },
  };
  const roleBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 'r4c-claim-binding',
    templateId: 'builder', templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
  const budget: TaskBudgetV1 = { tokenBudget: 100000, deadline: null };

  /** The Workspace pin from the bootstrap owner's public registration read. */
  async function registeredWorkspacePin(): Promise<VersionPin> {
    const registration = await bootstrap.projects.readWorkspaceRegistration(ctx, scope);
    if (registration.status !== 'ready') throw new Error(`fixture registration read failed: ${JSON.stringify(registration)}`);
    return { ref: registration.value.workspace.ref, revision: registration.value.workspace.revision };
  }

  function openSecondary(path: string): ClaimConnection {
    const secondary = createSqliteRecordBackend({ path, schemas });
    const secondarySpy = emptySpy();
    const secondaryService = makeService(wrapRecords(secondary.records, secondarySpy));
    return { records: secondary.records, spy: secondarySpy, service: secondaryService, close: () => secondary.close() };
  }

  const fixture: TaskClaimFixture = {
    kind, directory, ledgerPath, records: backend.records, spy, materialsSpy, service, ctx, scope,
    projectRef, workspaceRef, goalRef, planRef, plan, tasks,
    sessions: { first: firstSession, second: secondSession }, roleBinding, budget,
    goals: goalsService.tasks, plans, sessionsPort, roleService, makeService,
    async buildRequest(overrides = {}) {
      const sessionRef = overrides.input?.sessionRef ?? firstSession;
      const requestedGoalRef = overrides.input?.goalRef ?? goalRef;
      const goalRead = await plans.queryGoal(ctx, requestedGoalRef);
      if (goalRead.status !== 'ready') throw new Error(`fixture goal read failed: ${JSON.stringify(goalRead)}`);
      const card = await sessionsPort.readSession(ctx, sessionRef);
      if (card.status !== 'ready') throw new Error(`fixture session read failed: ${JSON.stringify(card)}`);
      const expected = overrides.expected ?? [
        { ref: requestedGoalRef, revision: goalRead.value.goal.revision },
        await registeredWorkspacePin(),
        { ref: plainSessionRefToAggregate(sessionRef), revision: card.value.record.revision },
      ];
      return { input: {
        goalRef: requestedGoalRef,
        planRef: overrides.input?.planRef ?? planRef,
        taskId: overrides.input?.taskId ?? tasks.first.taskId,
        sessionRef,
        roleBinding: overrides.input?.roleBinding ?? roleBinding,
        budget: overrides.input?.budget ?? budget,
      }, meta: { requestId: overrides.requestId ?? `r4c-claim-request-${++requestSeq}`, expected: [...expected] } };
    },
    async sessionPin(ref) {
      const card = await sessionsPort.readSession(ctx, ref);
      if (card.status !== 'ready') throw new Error(`fixture session read failed: ${JSON.stringify(card)}`);
      return { ref: plainSessionRefToAggregate(ref), revision: card.value.record.revision };
    },
    async goalPin() {
      const read = await plans.queryGoal(ctx, goalRef);
      if (read.status !== 'ready') throw new Error(`fixture goal read failed: ${JSON.stringify(read)}`);
      return { ref: goalRef, revision: read.value.goal.revision };
    },
    createSession,
    async seedRun(taskId, status) {
      const runId = `r4c-seeded-run-${++seedSeq}`;
      const ref: RunRef = { aggregateType: 'Run', projectId, goalId: goalRef.goalId, runId };
      const snapshot: RunSnapshot = { ref, revision: 1, schemaVersion: 1,
        task: { projectId, goalId: goalRef.goalId, taskId }, attemptId: `r4c-seeded-attempt-${taskId}`,
        planRef, roleBinding, budget, workspaceSnapshot: { workspaceId, revision: 1 },
        status, outcome: status === 'ended' ? 'failed' : null, exitCode: null,
        lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '', envelope: null,
        startedAt: null, endedAt: null };
      const result = await commitRaw([{ refKey: canonicalJson(ref as unknown as JsonValue),
        schemaId: 'RunSnapshot@1', revision: 1, json: JSON.stringify(snapshot) }]);
      if (result.status !== 'committed') throw new Error(`fixture Run seed failed: ${JSON.stringify(result)}`);
      return ref;
    },
    async overwriteSession(ref, mutate) {
      const card = await sessionsPort.readSession(ctx, ref);
      if (card.status !== 'ready') throw new Error(`fixture session read failed: ${JSON.stringify(card)}`);
      const current = card.value.record;
      const next: SessionRecord = { ...mutate(current), revision: current.revision + 1 };
      const result = await commitRaw([encodeSessionRecord(next)],
        [{ refKey: sessionAggregateRefKey(current.ref), expectedRevision: current.revision }]);
      if (result.status !== 'committed') throw new Error(`fixture Session rewrite failed: ${JSON.stringify(result)}`);
    },
    commitRaw,
    async openConnection() {
      if (kind === 'memory') {
        return { records: backend.records, spy, service, close: async () => undefined };
      }
      return openSecondary(ledgerPath);
    },
    async reopenService() {
      if (kind !== 'sqlite') throw new Error('reopenService is only meaningful for the SQLite fixture');
      return openSecondary(ledgerPath);
    },
    async closeBackend() {
      if (backendClosed) return;
      backendClosed = true;
      await backend.close();
    },
    async close() {
      await fixture.closeBackend();
      await rm(directory, { recursive: true, force: true });
    },
  };
  return audit === undefined ? fixture : { ...fixture, audit };
}

/**
 * The model handle a preparation-only Host carries: preparation never streams, so
 * a call here is a fixture defect and fails loudly instead of inventing a reply.
 */
const preparationOnlyModel: ModelClientPort = {
  async *stream() { throw new Error('the preparation-only Host model must not be called'); },
};

export type PreparationHostConfiguration = {
  configurationRevision: string;
  /** Optional: preparation takes the policy revision from the Run's Role binding. */
  permissions: { policyRevision?: string; tools: string[]; writeScope?: string[] };
  hostTemplate: { templateId: string; revision: string; digest: string } | null;
  budget?: RuntimeBudget;
  client?: ModelClientPort;
  /** Optional preparation model binding; default is the fixture's test/test one. */
  model?: { configuration: { revision: string; provider: string; model: string; baseUrl: string }; client?: ModelClientPort };
};

/** A trusted Host binding for the REAL preparation path, over public configuration only. */
export function preparationHost(config: PreparationHostConfiguration): RuntimeHostBindings {
  const resolved = (): ResolvedRuntimeConfiguration => ({
    configurationRevision: config.configurationRevision,
    model: {
      configuration: config.model === undefined
        ? { revision: config.configurationRevision, provider: 'test', model: 'test', baseUrl: 'http://127.0.0.1' }
        : { ...config.model.configuration },
      client: config.client ?? config.model?.client ?? preparationOnlyModel,
    },
    budget: config.budget ?? { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
      maxRequests: 4, maxToolCalls: 8, timeoutMs: null, perResponseTokens: 512 },
    hostTemplate: config.hostTemplate === null ? null : { ...config.hostTemplate },
    tools: [...config.permissions.tools],
    writeScope: [...(config.permissions.writeScope ?? [])],
    skills: { resourceRoot: '/tmp', enabledIds: [] },
    systemInstruction: 'preparation-only trusted Host configuration',
    deniedPrefixes: [],
    processSandboxOptions: {},
    materialBasis: null,
  });
  return {
    async resolveConfiguration() { return { status: 'ready', value: resolved() }; },
    async resolveQueryConfiguration() { return { status: 'ready', value: resolved() }; },
  };
}

export type RealPreparationWorld = { records: Records; ctx: CoreCallContext };

export type RealPreparedTask = {
  prepared: PreparedTaskExecution;
  manifest: PreparedTaskManifestV1;
  binding: ContextAssemblyBindingV1;
};

export type RealTaskPreparationOptions = {
  bodies: RawArtifactStorePort;
  runRef: RunRef;
  host: RuntimeHostBindings;
  records?: Records;
  /** The trusted call context of the world; defaults to the fixture's own. */
  ctx?: CoreCallContext;
  now?: () => string;
  requestId?: string;
  graphContext?: ContextAssemblerDependencies['graphContext'];
  taskInputs?: ContextAssemblerDependencies['taskInputs'];
  /** The ledger directory; needed only to map the Session's Kernel store for a requeue Run. */
  directory?: string;
  /** The Workspace scope of that Kernel mapping. */
  scope?: { projectId: string; workspaceId: string };
};

/**
 * Prepare ONE claimed Run through the production `createExecutionPreparation`
 * over the fixture's own real owners. The returned manifest body is the saved
 * one, so a caller never builds a manifest or context binding by hand.
 */
export async function prepareTaskForReal(
  fixture: RealPreparationWorld, options: RealTaskPreparationOptions,
): Promise<RealPreparedTask> {
  const records = options.records ?? fixture.records;
  const now = options.now ?? ((): string => CLAIM_FIXTURE_AT);
  let sequence = 0;
  const eventId = (): string => `real-prepare-event-${++sequence}`;
  const newId = (): string => `real-prepare-id-${++sequence}`;
  const executions = createRunStateReader({ records, bodies: options.bodies });
  const roles = createRoleConfigurationService({ records, now, eventId });
  const materials = createMaterialService({
    bodies: options.bodies, authority: createMaterialRecordReaders(records).authority, now });
  const unknownCallReviews = createUnknownCallReviewService({ records, reads: executions, now, eventId });
  const kernelStores = options.directory === undefined || options.scope === undefined ? undefined
    : await createKernelStoreRegistry({ entries: [{
      adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store',
      workspace: options.scope, databasePath: join(options.directory, 'kernel.sqlite'),
    }] });
  const assemblerDeps = { executions, roles, materials, bodies: options.bodies, unknownCallReviews, now,
    ...(kernelStores === undefined ? {} : { kernelStores }),
    ...(options.graphContext === undefined ? {} : { graphContext: options.graphContext }),
    ...(options.taskInputs === undefined ? {} : { taskInputs: options.taskInputs }) } as ContextAssemblerDependencies;
  const assembler = createContextAssembler(assemblerDeps);
  const preparation = createExecutionPreparation({
    executions, roles, bodies: options.bodies, host: options.host, now, newId,
    materials, unknownCallReviews,
    ...(kernelStores === undefined ? {} : { kernelStores }),
    readTaskClosure: async (_ctx, task) => readTaskClosure(records,
      { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId }, task.taskId),
  }, assembler);
  const result = await preparation.prepare(options.ctx ?? fixture.ctx, {
    runRef: options.runRef, requestId: options.requestId ?? 'real-task-prepare' });
  if (result.status !== 'ready') throw new Error(`real Task preparation failed: ${JSON.stringify(result)}`);
  const loaded = await loadPreparedManifest(options.bodies, result.value);
  if (loaded.status !== 'ready') throw new Error(`real prepared manifest is not readable: ${JSON.stringify(loaded)}`);
  return { prepared: result.value, manifest: loaded.value.manifest, binding: loaded.value.manifest.contextAssembly };
}

export type RealPreparedQuery = {
  prepared: PreparedQueryExecution;
  manifest: PreparedQueryManifestV1;
  binding: ContextAssemblyBindingV1;
};

export type RealQueryPreparationOptions = {
  bodies: RawArtifactStorePort;
  queryRunRef: QueryRunRef;
  host: RuntimeHostBindings;
  queryExecution: QueryExecutionPort;
  records?: Records;
  ctx?: CoreCallContext;
  now?: () => string;
  requestId?: string;
};

/**
 * Prepare ONE claimed Query through the production `createQueryPreparation`
 * (which also binds the saved manifest) over the fixture's own real owners.
 */
export async function prepareQueryForReal(
  fixture: RealPreparationWorld, options: RealQueryPreparationOptions,
): Promise<RealPreparedQuery> {
  const records = options.records ?? fixture.records;
  const now = options.now ?? ((): string => CLAIM_FIXTURE_AT);
  let sequence = 0;
  const eventId = (): string => `real-query-prepare-event-${++sequence}`;
  const newId = (): string => `real-query-prepare-id-${++sequence}`;
  const executions = createRunStateReader({ records, bodies: options.bodies });
  const roles = createRoleConfigurationService({ records, now, eventId });
  const materials = createMaterialService({
    bodies: options.bodies, authority: createMaterialRecordReaders(records).authority, now });
  const assemblerDeps = { executions, roles, materials, bodies: options.bodies, now } as ContextAssemblerDependencies;
  const assembler = createContextAssembler(assemblerDeps);
  // The preparation owner reads exactly these ports; the rest of the Runtime
  // dependency bundle belongs to start, which this helper never invokes.
  const preparation = createQueryPreparation({
    executions, roles, bodies: options.bodies, host: options.host, now, newId,
    queryExecution: options.queryExecution,
  } as unknown as Parameters<typeof createQueryPreparation>[0], assembler);
  const result = await preparation.prepare(options.ctx ?? fixture.ctx, {
    queryRunRef: options.queryRunRef, requestId: options.requestId ?? 'real-query-prepare' });
  if (result.status !== 'ready') throw new Error(`real Query preparation failed: ${JSON.stringify(result)}`);
  // Read the saved manifest through the fixture's real materials owner, never
  // by opening the body store directly (rule sheet F7).
  const stored = await materials.openArtifact(options.ctx ?? fixture.ctx, {
    ref: result.value.bundleRef, usage: 'historical_explanation' });
  if (stored.status !== 'ready') throw new Error(`real prepared Query manifest is not readable: ${JSON.stringify(stored)}`);
  const manifest = JSON.parse(stored.value.body) as PreparedQueryManifestV1;
  return { prepared: result.value, manifest, binding: manifest.contextAssembly };
}
