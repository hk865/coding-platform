/**
 * Group D (slice 2C) node-detail/hover support.
 *
 * What it builds and through which public calls:
 *  - A real Memory/SQLite backend with the full schema set (Goal, Plan,
 *    governance, Session, lifecycle, claims, architecture catalog, anomalies,
 *    Run and its task indexes).
 *  - The trusted scope (Project/Workspace/CompletionPolicy), the goal through
 *    `createGoalService`, the plan through `createPlanService.proposePlan` +
 *    `applyPlanChange`, the architecture catalog through
 *    `createArchitectureCatalogService.adoptInitialArchitecture`, Sessions
 *    through `SessionDirectoryPort`, responsibility links through
 *    `SessionLifecyclePort.linkSessionWork`, and Runs through the real
 *    `TaskClaimPort`.
 *  - The executed-files port is the only injected dependency (L15).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ModuleRef, SessionRef, WorkLinkRelation, WorkLinkTarget, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { RoleBindingRefV1, RunRef, RuntimeEventV1, TaskBudgetV1, TaskTriple } from '../../src/contracts/dispatch.js';
import type { ArchiveStepRefV1 } from '../../src/contracts/core/session-archive.js';
import type { GoalRef, ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { EncodedRecord, GoalRecordTransactionPort, RecordBackendSchemas, RecordGuard, StoreCommitReceipt } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS, PLAN_STATE_RECORD_SCHEMAS, readGoal } from '../../src/core/work-graph/tasks/plan-readers.js';
import { SESSION_RECORD_SCHEMAS, encodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { SESSION_ANOMALY_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import { TASK_CLAIM_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import { UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import { ROLE_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/role-record-codecs.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { materialRecordSchemas, createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { WORKFLOW_AUTOMATION_ACTOR, type TaskRequeueOutcomeV1, type TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createSessionAnomalyService, type SessionAnomalyPort } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import { createQueryExecution } from '../../src/core/work-graph/queries/query-execution.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { TaskClaimPort } from '../../src/core/work-graph/model/claim-contracts.js';
import type { GraphWrite as SessionGraphWrite } from '../../src/core/work-graph/model/session-contracts.js';
import type { LinkSessionWorkInput } from '../../src/core/work-graph/sessions/lifecycle-contracts.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import type { GoalExecutedFilesPort } from '../../src/core/work-graph/model/decision-contracts.js';
import type { ExecutedFileV1 } from '../../src/contracts/work-line.js';
import { createNodeDetailReader, type NodeDetailReaderDeps } from '../../src/core/work-graph/views/node-detail-reader.js';
import { createWorkLineReader, type WorkLineStore } from '../../src/core/work-graph/views/work-line-reader.js';
import type { SessionDutyReadPort, WorkLineReadPort } from '../../src/core/work-graph/model/work-line-contracts.js';
import type { ClaimFixtureKind } from './task-claim-fixture.js';
import type { TaskClaimFixture } from './task-claim-fixture.js';
import { createRunSupport, type RunSupport } from './S2C-L-runs-support.js';

export const D_AT = '2026-10-01T00:00:00.000Z';

export type ExecutedFilesFacts = {
  availability: 'available' | 'not_available';
  files: ExecutedFileV1[];
  possiblyIncomplete: boolean;
  sourceCursor: CommitCursor | null;
};

export type NodeFixture = {
  kind: ClaimFixtureKind;
  directory: string;
  records: WorkLineStore;
  ctx: CoreCallContext;
  scope: WorkspaceScope;
  projectRef: ProjectSnapshot['ref'];
  workspaceRef: WorkspaceSnapshot['ref'];
  goalRef: GoalRef;
  planRef: PlanRevisionRef;
  tasks: Record<string, TaskTriple>;
  moduleRef(moduleId: string): ModuleRef;
  goals: ReturnType<typeof createGoalService>['tasks'];
  plans: ReturnType<typeof createPlanService>;
  catalog: ReturnType<typeof createArchitectureCatalogService>;
  anomalies: SessionAnomalyPort;
  claims: TaskClaimPort;
  /** The real `ExecutionEntryPort` (2C-28): claims are driven to `ended` in-process. */
  runs: RunSupport;
  /** The real `SessionLifecyclePort.requestSessionArchive` + `SessionAnomalyPort.recordSessionAnomaly`. */
  writeAnchor(session: SessionRef, runRef: RunRef, requestId: string): Promise<void>;
  /** The real `GoalTaskPort.setGoalControl` (pause/cancel/resume). */
  setGoalDesired(desiredState: 'active' | 'paused' | 'cancelled'): Promise<void>;
  /** The real `run_completed` terminal event for a claimed Run. */
  completedRunEvent(claim: TaskClaim): RuntimeEventV1;
  /** The real `TaskRequeuePort.requeueTask` (2C-28 dispatch / rework_blocked). */
  requeue(taskId: string, afterRunRef: RunRef, options?: {
    actor?: 'human' | 'system'; autoReworkLimit?: number; requestId?: string;
  }): Promise<WriteResult<TaskRequeueOutcomeV1>>;
  sessions: ReturnType<typeof createSessionDirectory>;
  lifecycle: ReturnType<typeof createSessionLifecycleService>;
  createSession(requestId: string, role?: { kind: 'legacy_template'; templateId: string; templateRevision: string }): Promise<SessionRef>;
  link(session: SessionRef, task: TaskTriple, relation: WorkLinkRelation, active: boolean): Promise<void>;
  claim(taskId: string, session: SessionRef): Promise<TaskClaim>;
  claimQuery(session: SessionRef, goalRef: GoalRef, suffix: string): Promise<QueryRunRef>;
  /**
   * 2C-30 (review item 7a): one real, ended Run of one Task through public
   * services (`TaskClaimPort.claimTask` + the real cancel control + the real
   * `TaskRequeuePort`), so a test pages the Run-by-task index without a
   * hand-written `RunSnapshot`. `requeueRef` covers a reused Task.
   */
  endRun(taskId: string, session: SessionRef, requeueRef?: TaskRequeueRef): Promise<RunRef>;
  close(): Promise<void>;
};

function schemas(): RecordBackendSchemas {
  return {
    records: [...materialRecordSchemas().records, ...PLAN_RECORD_SCHEMAS.records, ...PLAN_STATE_RECORD_SCHEMAS.records,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records,
      ...SESSION_LIFECYCLE_RECORD_SCHEMAS.records, ...SESSION_ANOMALY_RECORD_SCHEMAS.records,
      ...ARCHITECTURE_CATALOG_SCHEMAS.records, ...TASK_CLAIM_RECORD_SCHEMAS.records, ...ROLE_RECORD_SCHEMAS.records,
      ...QUERY_JOB_RECORD_SCHEMAS.records, ...CONTROL_RECORD_SCHEMAS.records, ...COMPLETION_RECORD_SCHEMAS.records,
      ...MODEL_REQUEST_RECORD_SCHEMAS.records, ...SESSION_MESSAGE_RECORD_SCHEMAS.records,
      ...EVIDENCE_RECORD_SCHEMAS.records, ...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.records],
    events: [...materialRecordSchemas().events, ...PLAN_RECORD_SCHEMAS.events, ...PLAN_STATE_RECORD_SCHEMAS.events,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events,
      ...SESSION_LIFECYCLE_RECORD_SCHEMAS.events, ...SESSION_ANOMALY_RECORD_SCHEMAS.events,
      ...ARCHITECTURE_CATALOG_SCHEMAS.events, ...TASK_CLAIM_RECORD_SCHEMAS.events, ...ROLE_RECORD_SCHEMAS.events,
      ...QUERY_JOB_RECORD_SCHEMAS.events, ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events,
      ...CONTROL_RECORD_SCHEMAS.events, ...COMPLETION_RECORD_SCHEMAS.events,
      ...MODEL_REQUEST_RECORD_SCHEMAS.events, ...SESSION_MESSAGE_RECORD_SCHEMAS.events,
      ...EVIDENCE_RECORD_SCHEMAS.events,
      // The real execution-entry/result replay events (records empty: Run/Attempt/
      // Outbox/Session are registered by their owning modules), so the fixture can
      // drive a claimed Run to `ended` through the real `ExecutionEntryPort`.
      ...EXECUTION_ENTRY_RECORD_SCHEMAS.events, ...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.events],
    lookups: [...SESSION_RECORD_SCHEMAS.lookups ?? [], ...PLAN_RECORD_SCHEMAS.lookups ?? [],
      ...PLAN_STATE_RECORD_SCHEMAS.lookups ?? [], ...PLAN_GOVERNANCE_RECORD_SCHEMAS.lookups ?? [],
      ...SESSION_LIFECYCLE_RECORD_SCHEMAS.lookups ?? [], ...SESSION_ANOMALY_RECORD_SCHEMAS.lookups ?? [],
      ...ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? [], ...TASK_CLAIM_RECORD_SCHEMAS.lookups ?? [],
      ...ROLE_RECORD_SCHEMAS.lookups ?? [], ...QUERY_JOB_RECORD_SCHEMAS.lookups ?? [],
      ...CONTROL_RECORD_SCHEMAS.lookups ?? [], ...COMPLETION_RECORD_SCHEMAS.lookups ?? [],
      ...MODEL_REQUEST_RECORD_SCHEMAS.lookups ?? [], ...SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? [],
      ...EVIDENCE_RECORD_SCHEMAS.lookups ?? [], ...(UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.lookups ?? []),
      ...(materialRecordSchemas().lookups ?? [])],
  };
}

export async function openNodeFixture(kind: ClaimFixtureKind): Promise<NodeFixture> {
  const directory = await mkdtemp(join(tmpdir(), `s2c-d-node-${kind}-`));
  const ledgerPath = join(directory, 'ledger.sqlite');
  const backend = kind === 'memory'
    ? createInMemoryRecordBackend({ schemas: schemas() })
    : createSqliteRecordBackend({ path: ledgerPath, schemas: schemas() });

  const projectId = 's2c-d-project';
  const workspaceId = 's2c-d-workspace';
  const scope: WorkspaceScope = { projectId, workspaceId };
  const projectRef: ProjectSnapshot['ref'] = { aggregateType: 'Project', projectId };
  const workspaceRef: WorkspaceSnapshot['ref'] = { aggregateType: 'Workspace', projectId, workspaceId };
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId, goalId: 's2c-d-goal' };
  const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId, planId: 's2c-d-plan' };
  const actor = { kind: 'human' as const, id: 's2c-d-operator' };
  const ctx: CoreCallContext = {
    projectId, workspaceId, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal,
  };

  // Trusted scope through the REAL public bootstrap writer (Project/Workspace +
  // CompletionPolicy). This file never hand-builds a raw PreparedCommit; the
  // catalog adoption and Goal creation below run unchanged on top of it. No
  // architecture baseline is seeded so the real catalog adoption can run.
  const records = backend.records as unknown as WorkLineStore;
  let seq = 0;
  const now = () => D_AT;
  const eventId = () => `s2c-d-event-${++seq}`;
  const newId = () => `s2c-d-id-${++seq}`;
  const bootstrap = createProjectBootstrapServices({ records: backend.records, now, eventId });
  const created = await bootstrap.projects.createProject(ctx, {
    input: { projectId }, meta: { requestId: 's2c-d-create-project',
      expected: [{ ref: projectRef, revision: 0 }] } });
  if (created.status !== 'committed') throw new Error(`S2C-D Project creation failed: ${JSON.stringify(created)}`);
  const registered = await bootstrap.projects.registerWorkspace(ctx, {
    input: { workspace: scope }, meta: { requestId: 's2c-d-register-workspace',
      expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] } });
  if (registered.status !== 'committed') throw new Error(`S2C-D Workspace registration failed: ${JSON.stringify(registered)}`);
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId,
    policyId: 's2c-d-policy', revision: 1 };
  const installed = await bootstrap.completionPolicies.installCompletionPolicy(ctx, {
    input: { policyId: policyRef.policyId, contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } },
    meta: { requestId: 's2c-d-install-policy',
      expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] } });
  if (installed.status !== 'committed') throw new Error(`S2C-D policy install failed: ${JSON.stringify(installed)}`);
  const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
  const activated = await bootstrap.completionPolicies.activateCompletionPolicy(ctx, {
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } },
    meta: { requestId: 's2c-d-activate-policy',
      expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] } });
  if (activated.status !== 'committed') throw new Error(`S2C-D policy activation failed: ${JSON.stringify(activated)}`);
  const bodies = new RawArtifactBodyStore();
  const materialsPort = { async openArtifact() { return { status: 'rejected' as const, code: 'unsupported' as const, reason: 'S2C-D does not read material' }; } };
  const goals = createGoalService({ records: backend.records, now, eventId }).tasks;
  const plans = createPlanService({ records: backend.records, materials: materialsPort, now, eventId });
  const catalog = createArchitectureCatalogService({ records: backend.records });
  const sessions = createSessionDirectory({ records: backend.records, lookups: backend.records });
  const lifecycle = createSessionLifecycleService({ records: backend.records, lookups: backend.records,
    sessionFacts: createSessionFactsService({ records: backend.records }) });
  const anomalies = createSessionAnomalyService({ records: backend.records, lookups: backend.records,
    sessionFacts: createSessionFactsService({ records: backend.records }), now });
  const roles = createRoleConfigurationService({ records: backend.records, now, eventId });
  const claims = createTaskClaimService({ records: backend.records, roles, now, newId });

  const modules: { ref: ModuleRef; name: string; responsibility: string; paths: string[]; interfaces: [] }[] = [
    { ref: { projectId, moduleId: 'M' }, name: 'Module M', responsibility: 'Own M', paths: ['m'], interfaces: [] },
    { ref: { projectId, moduleId: 'M-sub' }, name: 'Module M sub', responsibility: 'Own M sub', paths: ['m/sub'], interfaces: [] },
    { ref: { projectId, moduleId: 'N' }, name: 'Module N', responsibility: 'Own N', paths: ['n'], interfaces: [] },
  ];
  const adopted = await catalog.adoptInitialArchitecture(ctx, {
    input: { baselineId: 's2c-d-baseline', catalog: { modules, dependencies: [], requireDag: true,
      containment: { parentOf: [{ parent: modules[0]!.ref, child: modules[1]!.ref }] } },
      description: 'S2C-D catalog', constraints: [{ name: 'dag', scope: 'project' }] },
    meta: { requestId: 's2c-d-adopt', expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
  });
  if (adopted.status !== 'committed') throw new Error(`S2C-D catalog adoption failed: ${JSON.stringify(adopted)}`);

  const createdGoal = await goals.createGoal(ctx, { meta: {
    requestId: 's2c-d-create-goal', expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'S2C-D node detail' } });
  if (createdGoal.status !== 'committed') throw new Error(`S2C-D Goal creation failed: ${JSON.stringify(createdGoal)}`);

  const task = (taskId: string, title: string, moduleId: string, stageId: string,
    overrides: Partial<PlanRevisionDraft['tasks'][number]> = {}): PlanRevisionDraft['tasks'][number] => ({
    taskId, title, requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'module', stageId, moduleRef: moduleId }, ...overrides });
  const tasksList: PlanRevisionDraft['tasks'][number][] = [
    task('task-a', 'Task A', 'M', 'stage-1'),
    task('task-b', 'Task B', 'M', 'stage-1'),
    task('task-c', 'Task C', 'M', 'stage-1'),
    task('task-d', 'Task D', 'N', 'stage-2'),
    task('task-sub', 'Task sub', 'M-sub', 'stage-1'),
    task('task-cancel', 'Task cancelled', 'M', 'stage-1', { disposition: 'cancelled' }),
    task('task-super', 'Task superseded', 'M', 'stage-1', { disposition: 'superseded' }),
    { taskId: 'gate-goal', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
  ];
  const draft: PlanRevisionDraft = { schemaVersion: 1, planId: planRef.planId, planRevision: 1, goalId: goalRef.goalId,
    stages: [{ stageId: 'stage-1', title: 'Stage 1' }, { stageId: 'stage-2', title: 'Stage 2' }],
    tasks: tasksList,
    assignments: tasksList.filter((entry) => entry.taskKind === 'work').map((entry) => ({ taskId: entry.taskId, role: 'builder', instruction: entry.title })),
    obligations: [{ obligationId: 's2c-d-obligation', title: 'Deliver', requirementLevel: 'required',
      taskIds: tasksList.map((entry) => entry.taskId),
      verificationRequirements: [{ requirementId: 's2c-d-check', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [
      { taskId: 'task-b', dependsOnId: 'task-a', requires: { kind: 'output-contract', label: 'A output' } },
      { taskId: 'task-c', dependsOnId: 'task-b', requires: { kind: 'output-contract', label: 'B output' } },
    ] } };
  const proposed = await plans.proposePlan(ctx, { meta: { requestId: 's2c-d-propose-plan', expected: [{ ref: goalRef, revision: 1 }] },
    input: { goalRef, basedOn: null, draft, reason: { text: 'S2C-D plan', sources: [] } } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) throw new Error(`S2C-D plan proposal failed: ${JSON.stringify(proposed)}`);
  const applied = await plans.applyPlanChange(ctx, { meta: { requestId: 's2c-d-apply-plan', expected: [{ ref: goalRef, revision: 1 }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`S2C-D plan adoption failed: ${JSON.stringify(applied)}`);

  const kernelStores = await createKernelStoreRegistry({ entries: [{ adapterId: 's2c-d-kernel',
    storeKey: 's2c-d-kernel-store', workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] });
  const defaultRole = { kind: 'legacy_template' as const, templateId: 'builder', templateRevision: '1' };
  async function createSession(requestId: string,
    role: { kind: 'legacy_template'; templateId: string; templateRevision: string } = defaultRole): Promise<SessionRef> {
    const admitted = await sessions.admitSessionCreation(ctx, { meta: { requestId: `admit-${requestId}`, expected: [] },
      input: { workspace: scope, kernelStore: { adapterId: 's2c-d-kernel', storeKey: 's2c-d-kernel-store' },
        role, recommendedRefs: [], initialLinks: [] } });
    if (admitted.status !== 'committed') throw new Error(`S2C-D session admission failed: ${JSON.stringify(admitted)}`);
    await kernelStores.withStore('s2c-d-kernel', (store) => store.create({
      sessionId: `s2c-d-kernel-session-${requestId}`, recordId: `s2c-d-kernel-record-${requestId}`, createdAt: D_AT,
    }, { signal: ctx.signal }));
    const registered = await sessions.recordSessionCreated(ctx, { meta: { requestId: `register-${requestId}`, expected: [] },
      input: { operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
        adapterId: 's2c-d-kernel', kernelSessionId: `s2c-d-kernel-session-${requestId}`, historyCursor: null, observedAt: D_AT } });
    if (registered.status !== 'committed') throw new Error(`S2C-D session registration failed: ${JSON.stringify(registered)}`);
    return { projectId: registered.value.ref.projectId, sessionId: registered.value.ref.sessionId };
  }

  async function link(session: SessionRef, task: TaskTriple, relation: WorkLinkRelation, active: boolean): Promise<void> {
    const target: WorkLinkTarget = { kind: 'task', ref: task };
    const linkRef = { ...session, aggregateType: 'SessionWorkLink' as const, target, relation };
    const refs = [plainSessionRefToAggregate(session), linkRef];
    const read = await backend.records.readMany(refs.map((ref) => canonicalJson(ref as unknown as JsonValue)));
    if (read.status !== 'ready') throw new Error('S2C-D cannot build link pins');
    const expected = refs.map((ref) => ({ ref, revision: read.value.records.find((record) =>
      record.refKey === canonicalJson(ref as unknown as JsonValue))?.revision ?? 0 }));
    const request: SessionGraphWrite<LinkSessionWorkInput> = { input: { sessionRef: session, target, relation, active },
      meta: { requestId: `s2c-d-link-${++seq}`, expected } };
    const result = await lifecycle.linkSessionWork(ctx, request);
    if (result.status !== 'committed') throw new Error(`S2C-D link failed: ${JSON.stringify(result)}`);
  }

  const roleBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 's2c-d-binding', templateId: 'builder',
    templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
  const budget: TaskBudgetV1 = { tokenBudget: 100000, deadline: null };
  async function claim(taskId: string, session: SessionRef, requeueRef?: TaskRequeueRef): Promise<TaskClaim> {
    const goalRead = await plans.queryGoal(ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error('S2C-D goal read failed');
    const workspaceRead = await backend.records.readMany([canonicalRefKey(workspaceRef)]);
    const workspaceRevision = workspaceRead.status === 'ready' && workspaceRead.value.records[0] !== undefined
      ? JSON.parse(workspaceRead.value.records[0].json).revision as number : 1;
    const sessionCard = await sessions.readSession(ctx, session);
    if (sessionCard.status !== 'ready') throw new Error('S2C-D session read failed');
    const result = await claims.claimTask(ctx, { input: { goalRef, planRef, taskId, sessionRef: session, roleBinding, budget,
      ...(requeueRef === undefined ? {} : { requeueRef }) },
      meta: { requestId: `s2c-d-claim-${++seq}`, expected: [
        { ref: goalRef, revision: goalRead.value.goal.revision },
        { ref: workspaceRef, revision: workspaceRevision },
        { ref: plainSessionRefToAggregate(session), revision: sessionCard.value.record.revision },
      ] } });
    if (result.status !== 'committed') throw new Error(`S2C-D claim failed: ${JSON.stringify(result)}`);
    return result.value;
  }

  /**
   * The real `ExecutionEntryPort` over the fixture records, so a claimed Run is
   * entered and ended through public services (2C-28; never a hand-written
   * RunSnapshot). Only the fields `enter`/`recordResult` read are populated.
   */
  const runBase = { ctx, records: backend.records, budget, roleBinding, sessionsPort: sessions,
    plans, scope, goalRef, projectRef, workspaceRef, goals } as unknown as TaskClaimFixture;
  const runs = createRunSupport(runBase);

  async function sessionPin(session: SessionRef) {
    const key = sessionAggregateRefKey(plainSessionRefToAggregate(session));
    const read = await backend.records.readMany([key]);
    if (read.status !== 'ready') throw new Error(`S2C-D Session pin read failed: ${JSON.stringify(read)}`);
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    return { ref: plainSessionRefToAggregate(session), revision: record?.revision ?? 0 };
  }

  /** The real `setGoalControl` for the fixture Goal (2C-28 goal_stopped states). */
  async function setGoalDesired(desiredState: 'active' | 'paused' | 'cancelled'): Promise<void> {
    const goalRead = await plans.queryGoal(ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error('S2C-D goal read failed');
    const control = desiredState === 'paused' ? 'pause' : desiredState === 'cancelled' ? 'cancel' : 'resume';
    const goalPhaseRef = { aggregateType: 'GoalPhase' as const, projectId, goalId: goalRef.goalId };
    const phaseKey = canonicalJson(goalPhaseRef as unknown as JsonValue);
    const phaseRead = await backend.records.readMany([phaseKey]);
    const phaseRevision = phaseRead.status === 'ready'
      ? phaseRead.value.records.find((entry) => entry.refKey === phaseKey)?.revision ?? 0 : 0;
    const result = await goals.setGoalControl(ctx, { input: { goalRef, control, reason: null },
      meta: { requestId: `s2c-d-goal-control-${++seq}`,
        expected: [{ ref: goalRef, revision: goalRead.value.goal.revision }, { ref: goalPhaseRef, revision: phaseRevision }] } });
    if (result.status !== 'committed') throw new Error(`S2C-D goal control failed: ${JSON.stringify(result)}`);
  }

  /**
   * The real archive step (2C-28): `requestSessionArchive` registers the durable
   * request, then `recordSessionAnomaly` writes the anchor for `runRef` through
   * the same `fixture.anomalies` owner the `tasks/archive-state` route binds.
   */
  async function writeAnchor(session: SessionRef, runRef: RunRef, requestId: string): Promise<void> {
    const requested = await lifecycle.requestSessionArchive(ctx, {
      input: { sessionRef: session, reason: 'S2C-D archive-step fixture', tasks: [], wait: null,
        confirmUnknownStopped: false },
      meta: { requestId: `${requestId}-request`, expected: [await sessionPin(session)] } });
    if (requested.status !== 'committed') throw new Error(`S2C-D archive request failed: ${JSON.stringify(requested)}`);
    const request = requested.value.archiveRequest;
    if (request === null || request === undefined) throw new Error('S2C-D archive request is missing');
    const step: ArchiveStepRefV1 = { sessionRef: session, archiveRequestId: request.requestId,
      requestReceipt: request.receipt, step: 'anchor', subjectKey: canonicalJson(runRef as unknown as JsonValue) };
    const result = await anomalies.recordSessionAnomaly(ctx, { step, files: { source: 'kernel', status: 'known',
      confirmed: [], possible: [], omitted: 0, baseCommit: null, runBaselineKnown: false, reason: null } });
    if (result.status !== 'committed') throw new Error(`S2C-D anchor write failed: ${JSON.stringify(result)}`);
  }

  /** The real `run_completed` terminal event for a claimed Run (2C-28 dispatch/human_continue). */
  function completedRunEvent(claim: TaskClaim): RuntimeEventV1 {
    return { eventType: 'run_completed', schemaVersion: 1, eventId: `s2c-d-completed-${claim.runRef.runId}`,
      runRef: claim.runRef, sequence: 0, occurredAt: D_AT, payload: { kind: 'completed', exitCode: 0 } };
  }

  async function runPinOf(runRef: RunRef) {
    const key = canonicalJson(runRef as unknown as JsonValue);
    const read = await backend.records.readMany([key]);
    if (read.status !== 'ready') throw new Error(`S2C-D Run pin read failed: ${JSON.stringify(read)}`);
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined) throw new Error('S2C-D Run pin is absent');
    return { ref: runRef, revision: JSON.parse(record.json).revision as number };
  }

  /**
   * 2C-28: the real `TaskRequeuePort` over the fixture records. `actor:'system'`
   * is the platform automation actor (a cap refusal becomes observable); the
   * optional policy lowers the cap so one real refusal is enough.
   */
  async function requeue(taskId: string, afterRunRef: RunRef, options: {
    actor?: 'human' | 'system'; autoReworkLimit?: number; requestId?: string;
  } = {}): Promise<WriteResult<TaskRequeueOutcomeV1>> {
    const task = tasks[taskId];
    if (task === undefined) throw new Error(`S2C-D requeue: unknown task ${taskId}`);
    const goalRead = await plans.queryGoal(ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error('S2C-D requeue goal read failed');
    const bodies = new RawArtifactBodyStore();
    const authority = createMaterialRecordReaders(backend.records).authority;
    const materials = createMaterialService({ bodies, authority, now });
    const service = createTaskRequeueService({
      records: backend.records, reads: createRunStateReader({ records: backend.records }),
      workspaceHost: { async resolveRoot() { return { status: 'ready' as const,
        value: { root: directory, workspaceRevision: 1 } }; } },
      source: { async captureDigest() { return { status: 'ready' as const, sourceDigest: 'a'.repeat(64) }; } },
      materials, messages: { async readMessage() { return { status: 'not_found' as const }; } },
      ...(options.autoReworkLimit === undefined ? {}
        : { automationPolicy: () => ({ schemaVersion: 1 as const,
          autoReworkLimit: options.autoReworkLimit as number, resumeOnStartup: true }) }),
      now, eventId: () => `s2c-d-requeue-event-${++seq}`,
    });
    const reqActor = options.actor === 'system' ? WORKFLOW_AUTOMATION_ACTOR : actor;
    const callCtx: CoreCallContext = reqActor.kind === 'system'
      ? { ...ctx, principal: { kind: 'host', actor: reqActor },
        materialReader: { kind: 'host', projectId, workspaceId, actor: reqActor } }
      : ctx;
    return service.requeueTask(callCtx, { input: { taskRef: task, afterRunRef,
      reason: `S2C-D requeue ${taskId}` },
      meta: { requestId: options.requestId ?? `s2c-d-requeue-${++seq}`,
        expected: [{ ref: goalRef, revision: goalRead.value.goal.revision }, await runPinOf(afterRunRef)] } });
  }

  /**
   * L20: a real claimed QueryRun whose QueryJob targets `goalRef`, so the
   * secretary line's latest-Query Goal becomes observable through the hover.
   */
  async function claimQuery(session: SessionRef, queryGoalRef: GoalRef, suffix: string): Promise<QueryRunRef> {
    const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId, workspaceId,
      queryJobId: `s2c-d-query-${suffix}` };
    const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId, workspaceId,
      queryJobId: queryJobRef.queryJobId, runId: `s2c-d-query-run-${suffix}` };
    const goalRead = await plans.queryGoal(ctx, queryGoalRef);
    if (goalRead.status !== 'ready') throw new Error('S2C-D query goal read failed');
    const sessionCard = await sessions.readSession(ctx, session);
    if (sessionCard.status !== 'ready') throw new Error('S2C-D query session read failed');
    const sessionRole = sessionCard.value.record.role;
    const binding: RoleBindingRefV1 = sessionRole.kind === 'legacy_template'
      ? { schemaVersion: 1, bindingId: `s2c-d-query-binding-${suffix}`, templateId: sessionRole.templateId,
        templateRevision: sessionRole.templateRevision, bindingVersion: 1, policyRevision: 'legacy-template' }
      : roleBinding;
    const execution = createQueryExecution({ records: backend.records, roles, bodies, now, eventId,
      sessionFacts: createSessionFactsService({ records: backend.records }),
      authorizeConfiguration: async () => ({ status: 'rejected', code: 'forbidden', reason: 'S2C-D does not prepare a Query' }) });
    const jobs = createQueryJobService({ records: backend.records, execution, now, eventId });
    const runtimeBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
      maxRequests: 1, maxToolCalls: null, timeoutMs: null, perResponseTokens: 4096 };
    const intent: QueryJobIntentV1 = { schemaVersion: 1, intentId: queryJobRef.queryJobId,
      projectId, workspaceId, goalId: queryGoalRef.goalId, question: `S2C-D query ${suffix}`, focusTaskRefs: [],
      budget: { maxTokens: null, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: queryJobRef.queryJobId,
      execution: { kind: 'semantic_query', roleBinding: binding, runtimeBudget } };
    const submitted = await jobs.submitQueryJob(ctx, { input: { queryJobId: queryJobRef.queryJobId,
      runId: queryRunRef.runId, intent }, meta: { requestId: `s2c-d-query-submit-${suffix}`, expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 },
      { ref: queryGoalRef, revision: goalRead.value.goal.revision },
      { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }] } });
    if (submitted.status !== 'committed') throw new Error(`S2C-D query submit failed: ${JSON.stringify(submitted)}`);
    const claimed = await jobs.claimQuery(ctx, { input: { queryRunRef, sessionRef: session },
      meta: { requestId: `s2c-d-query-claim-${suffix}`, expected: [
        { ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
        { ref: plainSessionRefToAggregate(session), revision: sessionCard.value.record.revision }] } });
    if (claimed.status !== 'committed') throw new Error(`S2C-D query claim failed: ${JSON.stringify(claimed)}`);
    return queryRunRef;
  }

  const tasks: Record<string, TaskTriple> = {};
  for (const entry of tasksList) tasks[entry.taskId] = { projectId, goalId: goalRef.goalId, taskId: entry.taskId };

  /**
   * 2C-30 (review item 7a): one real, ended Run of one Task through public
   * services only. The Run comes from the real `TaskClaimPort` (the covering
   * `TaskRequeueRef` is passed on a reused Task), and it is ended by the real
   * `RunControlPort` cancel, which applies immediately to a Run that has not
   * entered the Kernel. No hand-written `RunSnapshot` is committed.
   */
  async function endRun(taskId: string, session: SessionRef, requeueRef?: TaskRequeueRef): Promise<RunRef> {
    const claimed = await claim(taskId, session, requeueRef);
    const cancelled = await runs.submitResult(claimed, 'cancel');
    if (cancelled.status !== 'committed' || cancelled.value.intent.status !== 'applied') {
      throw new Error(`S2C-D Run cancel did not apply: ${JSON.stringify(cancelled)}`);
    }
    return claimed.runRef;
  }

  return {
    kind, directory, records, ctx, scope, projectRef, workspaceRef, goalRef, planRef, tasks,
    moduleRef: (moduleId) => ({ projectId, moduleId }),
    goals, plans, catalog, anomalies, claims, runs, sessions, lifecycle, createSession, link, claim, endRun, claimQuery,
    writeAnchor, setGoalDesired, completedRunEvent, requeue,
    close: async () => { await backend.close(); await rm(directory, { recursive: true, force: true }); },
  };
}

/** The real WorkLine reader over a fixture, with a scripted duty port. */
export function lineReaderOf(fixture: NodeFixture, duty: 'executor' | 'secretary' = 'executor'): WorkLineReadPort {
  const dutyFor: SessionDutyReadPort = async () => ({ status: 'ready', value: duty });
  return createWorkLineReader({ records: fixture.records, dutyFor,
    undeliveredRepliesFor: () => undefined, sessionAnomaliesFor: () => fixture.anomalies });
}

/** The executed-files port double (L15): "有" with a hand-written list, or the stub answer. */
export function scriptedExecutedFiles(facts: ExecutedFilesFacts): GoalExecutedFilesPort {
  return { async readGoalExecutedFiles() {
    if (facts.availability === 'not_available') {
      return { status: 'ready', value: { availability: 'not_available', files: [], possiblyIncomplete: true, guards: [], sourceCursor: null } };
    }
    return { status: 'ready', value: { availability: 'available', files: facts.files,
      possiblyIncomplete: facts.possiblyIncomplete, guards: [], sourceCursor: facts.sourceCursor } };
  } };
}

export function rejectingExecutedFiles(code: 'unavailable' | 'invalid' | 'incomplete' = 'unavailable'): GoalExecutedFilesPort {
  return { async readGoalExecutedFiles() { return { status: 'rejected', code, reason: 'executed-files read failed' }; } };
}

export function nodeReaderOf(fixture: NodeFixture, options: {
  executedFiles?: GoalExecutedFilesPort; duty?: 'executor' | 'secretary';
  dutyByRole?: Record<string, 'executor' | 'secretary'>; anomalies?: SessionAnomalyPort;
  dutyFor?: SessionDutyReadPort; records?: WorkLineStore;
} = {}) {
  const records = options.records ?? fixture.records;
  const lineDeps = { records,
    dutyFor: options.dutyFor ?? ((async (role: { templateId?: string; roleId?: string }) => ({ status: 'ready' as const,
      value: (role.templateId !== undefined ? options.dutyByRole?.[role.templateId] : undefined)
        ?? options.duty ?? 'executor' })) as SessionDutyReadPort),
    undeliveredRepliesFor: () => undefined, sessionAnomaliesFor: () => fixture.anomalies };
  const deps: NodeDetailReaderDeps = {
    records, plans: fixture.plans, catalog: fixture.catalog, anomalies: options.anomalies ?? fixture.anomalies,
    executedFiles: options.executedFiles ?? scriptedExecutedFiles({ availability: 'not_available', files: [], possiblyIncomplete: true, sourceCursor: null }),
    line: lineDeps,
  };
  return { reader: createNodeDetailReader(deps), line: createWorkLineReader(lineDeps) };
}

/** One observed store call, with the number of records a `lookup` returned and
 * the ledger watermark the call itself reported (the expected source cursor). */
export type NodeStoreCall =
  | { kind: 'lookup'; index: string; records: number; readThrough: CommitCursor | null }
  | { kind: 'lookupOrdered'; index: string; records: number; readThrough: CommitCursor | null }
  | { kind: 'countLookup'; index: string }
  | { kind: 'readMany'; records: number; readThrough: CommitCursor | null }
  | { kind: 'eventAt' };

/** Wrap a store and log every read call, including the records a lookup returned. */
export function countingNodeStore(store: WorkLineStore): { records: WorkLineStore; calls: NodeStoreCall[] } {
  const calls: NodeStoreCall[] = [];
  const records = { ...store,
    async lookup(request: Parameters<WorkLineStore['lookup']>[0]) {
      const page = await store.lookup(request);
      calls.push({ kind: 'lookup', index: request.index,
        records: page.status === 'ready' ? page.value.records.length : 0,
        readThrough: page.status === 'ready' ? page.value.readThrough : null });
      return page;
    },
    async lookupOrdered(request: Parameters<WorkLineStore['lookupOrdered']>[0]) {
      const page = await store.lookupOrdered(request);
      calls.push({ kind: 'lookupOrdered', index: request.index,
        records: page.status === 'ready' ? page.value.records.length : 0,
        readThrough: page.status === 'ready' ? page.value.readThrough : null });
      return page;
    },
    async countLookup(request: Parameters<WorkLineStore['countLookup']>[0]) {
      calls.push({ kind: 'countLookup', index: request.index });
      return store.countLookup(request);
    },
    async readMany(refKeys: readonly string[]) {
      const read = await store.readMany(refKeys);
      calls.push({ kind: 'readMany', records: refKeys.length,
        readThrough: read.status === 'ready' ? read.value.readThrough : null });
      return read;
    },
    async eventAt(cursor: Parameters<WorkLineStore['eventAt']>[0]) {
      calls.push({ kind: 'eventAt' });
      return store.eventAt(cursor);
    },
  } as unknown as WorkLineStore;
  return { records, calls };
}

/** Fail every `lookup`/`lookupOrdered` against one index, leaving other reads alone. */
export function failingIndexRead(records: WorkLineStore, index: string, reason: string): WorkLineStore {
  const failure = { status: 'rejected' as const, code: 'unavailable' as const, reason };
  return { ...records,
    async lookup(request) {
      if (request.index === index) return failure;
      return records.lookup(request);
    },
    async lookupOrdered(request) {
      if (request.index === index) return failure;
      return records.lookupOrdered(request);
    } };
}

/** 2C-29: fail one `readMany` for the named Run refKey, leaving others alone. */
export function failingRunRead(records: WorkLineStore, runKey: string): WorkLineStore {
  return { ...records,
    async readMany(refKeys) {
      if (refKeys.some((key) => key === runKey)) {
        return { status: 'rejected', code: 'unavailable', reason: 'injected Run read failure' };
      }
      return records.readMany(refKeys);
    } };
}

/** A stub anomaly port that reports `incomplete` (2C-28's partial count). */
export function incompleteAnomalies(): SessionAnomalyPort {
  return {
    async recordSessionAnomaly() { return { status: 'rejected', code: 'unsupported', reason: 'stub' }; },
    async listSessionAnomalies() { return { status: 'rejected', code: 'incomplete', reason: 'anomaly read capped' }; },
    async readTaskArchiveState() { return { status: 'rejected', code: 'incomplete', reason: 'anomaly read capped' }; },
  };
}

export type { TaskClaim, EncodedRecord, StoreCommitReceipt };
