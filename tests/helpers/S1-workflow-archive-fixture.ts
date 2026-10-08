/** FX3-only owners, injected clocks and commit-by-commit invariant observations.
 * The claim/entry builders follow the existing task-claim and B2 fixtures;
 * domain setup is performed through the production writers on both backends.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CoreCallContext } from '../../src/contracts/core/call-context.js';
import { type RoleConfigurationRef, type SessionRef, type VersionPin, type WorkspaceScope } from '../../src/contracts/core/identity.js';
import { type RoleBindingRefV1, type RunRef, type RunSnapshot, type TaskBudgetV1, type TaskTriple, type RuntimeEventV1, type TaskLeaseSnapshot } from '../../src/contracts/dispatch.js';
import { type GoalRef, type ProjectSnapshot, type WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import { type PlanRevisionDraft, type PlanRevisionRef, type PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import { type EncodedRecord, type GoalRecordTransactionPort, type RecordBackendSchemas, type EncodedDomainEvent } from '../../src/core/record-store/ports.js';
import { type LookupValue, type RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { canonicalRefKey, decodeGoalCreatedEvent, decodeGoalDesiredStateChangedEvent, decodeGoalSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_RECORD_SCHEMAS, decodePlanRevisionSnapshot } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS, PLAN_STATE_RECORD_SCHEMAS, readCanonicalTaskFacts } from '../../src/core/work-graph/tasks/plan-readers.js';
import { SESSION_RECORD_SCHEMAS, plainSessionRefToAggregate, decodeSessionRecord } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { ROLE_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/role-record-codecs.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';
import { TASK_CLAIM_RECORD_SCHEMAS, decodeDispatchOutboxEntry, decodeTaskAttemptSnapshot, decodeTaskRequeueSnapshot, decodeTaskReworkRefusalSnapshot, taskClaimedEventFromEvent, taskRequeuedEventFromEvent, taskReworkRefusedEventFromEvent } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import { EXECUTION_HISTORY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-history-codecs.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { type RoleConfigurationPort } from '../../src/core/work-graph/model/configuration-contracts.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { type ClaimTaskInput, type TaskClaimPort } from '../../src/core/work-graph/model/claim-contracts.js';
import { type GoalTaskPort, type GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import { type PlanTaskPort } from '../../src/core/work-graph/model/plan-contracts.js';
import { type SessionDirectoryPort } from '../../src/core/work-graph/model/session-contracts.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import { expect } from 'vitest';
import { type PreparedTaskExecution, type PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import { type TaskClaim } from '../../src/contracts/core/task-claim.js';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import { type RoleSpecResolutionV1 } from '../../src/contracts/role-spec-materials.js';
import { type TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import { type RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { type AuthorizeConfiguration, type CompletedHistoryBoundary, type ExecutionEntryDependencies, type ExecutionEntryPort, type KernelExecutionBinding, type ObservedExecutionHistory, type TaskEntryPermit, type TaskResultObservation } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS, executionEntryAuthorizedEventFromEvent } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import { type TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { type ModelRequestPort, type ActualModelRequest } from '../../src/core/work-graph/tasks/model-call-contracts.js';
import { createModelCallService } from '../../src/core/work-graph/tasks/model-call-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { type TaskReductionSnapshot } from '../../src/contracts/reduction.js';
import { type SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { decodeSessionMessageRecord } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { decodeEvidenceSnapshot, decodeTaskEvidenceIndexSnapshot, decodeVerificationRoundSnapshot, verificationRoundEventFromEvent } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { controlIntentSubmittedEventFromEvent, decodeControlIntentSnapshot } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { decodeQueryRunSnapshotRecord } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { decodeSessionAnomalyAnchor } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { decodeGoalPhaseSnapshot } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { decodeRun } from '../../src/core/work-graph/materials/run-snapshot-decoder.js';
import { checkAllInvariants, emptyInvariantWorld, refKey, type InvariantWorld, type InvariantTaskState, type InvariantEvent } from '../state/invariants.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../src/contracts/ledger.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createSessionHealthService } from '../../src/core/work-graph/sessions/session-health.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import { createQueryExecution, QUERY_MANIFEST_CONTENT_TYPE } from '../../src/core/work-graph/queries/query-execution.js';
import { consultationQueryRefs, type QueryJobAnswerRef, type QueryJobAnswerV1, type QueryJobIntentV1 } from '../../src/contracts/query-job.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { QueryEntryIdentity } from '../../src/core/work-graph/queries/contracts.js';
import type { RunExecutionHistoryV1 } from '../../src/contracts/core/execution-history.js';
import * as kernelApi from '../../vendor/coding-agent/dist/public-api.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import { createExecutionHistoryReader } from '../../src/core/agent-runtime/observation-recovery.js';
import { createGraphExecutionHistoryReader } from '../../src/core/agent-runtime/graph-execution-history.js';
import { createExecutionHistoryService } from '../../src/core/work-graph/tasks/execution-history-service.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createRuntimeHostDouble, createScriptedModel } from './B2-runtime-fixture.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import { createSessionResponsibilityBasisReader } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createSessionResponsibilityService } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createSessionAnomalyService } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import { DEFAULT_SESSION_ARCHIVE_POLICY, type WorkflowDependencies, type WorkflowPort } from '../../src/business/workflow/ports.js';
const AT = '2026-10-08T00:00:00.000Z';
/** Observe the real backend, including bootstrap and writes made by all owners. */
export type FixtureAudit = {
  check(label: string): Promise<void>;
  world(): Promise<InvariantWorld>;
  totals(): { records: number; events: number; receipts: number };
  events(): readonly { cursor: import('../../src/contracts/command-event.js').CommitCursor; event: EncodedDomainEvent }[];
};

function sameRef(left: object | null | undefined, right: object | null | undefined): boolean {
  return left == null || right == null ? left === right : refKey(left) === refKey(right);
}

function observeFixtureStore(records: Records, projectId: string): FixtureAudit {
  const keys = new Set<string>();
  const identities = new Set<string>();
  const events: Array<{ cursor: import('../../src/contracts/command-event.js').CommitCursor; event: EncodedDomainEvent }> = [];
  let previous: InvariantWorld | undefined;
  const worldTypes = new Set(['Run', 'TaskAttempt', 'DispatchOutboxEntry', 'TaskLease', 'Session', 'QueryRun',
    'ControlIntent', 'VerificationRound', 'Evidence', 'TaskEvidenceIndex', 'SessionMessage', 'Goal', 'GoalPhase',
    'TaskReduction', 'TaskRequeue', 'TaskReworkRefusal', 'PlanRevision', 'SessionAnomalyAnchor']);
  async function world(): Promise<InvariantWorld> {
    const read = await records.readMany([...keys].filter(key => {
      const ref = JSON.parse(key) as { aggregateType: string; projectId: string };
      return ref.projectId === projectId && worldTypes.has(ref.aggregateType);
    }));
    if (read.status !== 'ready') throw new Error(`FX3 invariant read: ${JSON.stringify(read)}`);
    expect(read.value.missing).toEqual([]);
    const result = decodeWorldRecords(projectId, read.value.records);
    result.events = events.flatMap(({ cursor, event }) => {
      const decodedEvent = worldEvent(seqOfCommitCursor(cursor), event, projectId);
      return decodedEvent === null ? [] : [decodedEvent];
    });
    result.taskStates = await readTaskStates(records, result);
    return result;
  }
  async function check(label: string): Promise<void> {
    const current = await world();
    expect(checkAllInvariants(current, previous), label).toEqual([]);
    previous = structuredClone(current);
  }
  const commit = records.commit.bind(records);
  records.commit = async batch => {
    const receipt = await commit(batch);
    if (receipt.status === 'committed' && !receipt.replayed) {
      for (const record of batch.records) keys.add(record.refKey);
      identities.add(receipt.identityKey);
      const end = seqOfCommitCursor(receipt.cursor);
      for (let seq = end - receipt.eventIds.length + 1; seq <= end; seq++) {
        const read = await records.eventAt(makeCommitCursor(seq));
        if (read.status !== 'ready') throw new Error(`FX3 event read: ${JSON.stringify(read)}`);
        events.push(read.value);
      }
      await check(batch.events.map(event => event.eventType).join(', '));
    }
    return receipt;
  };
  return { check, world, totals: () => ({ records: keys.size, events: events.length, receipts: identities.size }),
    events: () => structuredClone(events) };
}
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

export type TaskClaimFixture = {
  audit: FixtureAudit;
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
  /** Close the primary backend WITHOUT deleting the ledger directory. */
  closeBackend(): Promise<void>;
  close(): Promise<void>;
};

function emptySpy(): RecordSpy {
  return { lookups: [], readMany: [], commits: 0, lookupCommits: 0, eventAt: 0 };
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

/** Register the project, governance, Goal, Plan and Sessions through their owners. */
export async function createTaskClaimFixture(kind: ClaimFixtureKind, additionalSchemas: RecordBackendSchemas = { records: [], events: [] }, clock: () => string = () => AT): Promise<TaskClaimFixture> {
  const directory = await mkdtemp(join(tmpdir(), `next-r4c-claim-${kind}-`));
  const ledgerPath = join(directory, 'ledger.sqlite');
  const materials = materialRecordSchemas();
  const schemas: RecordBackendSchemas = {
    records: [...materials.records, ...PLAN_RECORD_SCHEMAS.records, ...PLAN_STATE_RECORD_SCHEMAS.records,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records,
      ...ROLE_RECORD_SCHEMAS.records, ...TASK_CLAIM_RECORD_SCHEMAS.records,
      ...ARCHITECTURE_CATALOG_SCHEMAS.records, ...additionalSchemas.records],
    events: [...materials.events, ...PLAN_RECORD_SCHEMAS.events, ...PLAN_STATE_RECORD_SCHEMAS.events,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events,
      ...ROLE_RECORD_SCHEMAS.events, ...TASK_CLAIM_RECORD_SCHEMAS.events, ...EXECUTION_HISTORY_RECORD_SCHEMAS.events,
      ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events, ...ARCHITECTURE_CATALOG_SCHEMAS.events, ...additionalSchemas.events],
    lookups: [...(materials.lookups ?? []), ...(PLAN_RECORD_SCHEMAS.lookups ?? []),
      ...(PLAN_STATE_RECORD_SCHEMAS.lookups ?? []), ...(PLAN_GOVERNANCE_RECORD_SCHEMAS.lookups ?? []),
      ...(SESSION_RECORD_SCHEMAS.lookups ?? []), ...(ROLE_RECORD_SCHEMAS.lookups ?? []),
      ...(TASK_CLAIM_RECORD_SCHEMAS.lookups ?? []), ...(additionalSchemas.lookups ?? [])],
  };
  const backend = kind === 'memory'
    ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path: ledgerPath, schemas });

  const audit = observeFixtureStore(backend.records, 'r4c-claim-project');
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

  // Every bootstrap write uses the same audited backend as the scenario owners.
  let bootstrapSeq = 0;
  const bootstrap = createProjectBootstrapServices({ records: backend.records, now: clock,
    eventId: () => `fx3-bootstrap-${++bootstrapSeq}` });
  const project = await bootstrap.projects.createProject(ctx, {
    input: { projectId }, meta: { requestId: 'fx3-project', expected: [{ ref: projectRef, revision: 0 }] },
  });
  if (project.status !== 'committed') throw new Error(`project setup: ${JSON.stringify(project)}`);
  const workspace = await bootstrap.projects.registerWorkspace(ctx, {
    input: { workspace: scope }, meta: { requestId: 'fx3-workspace', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] },
  });
  if (workspace.status !== 'committed') throw new Error(`workspace setup: ${JSON.stringify(workspace)}`);
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId,
    policyId: 'r4c-claim-policy', revision: 1 };
  const installed = await bootstrap.completionPolicies.installCompletionPolicy(ctx, {
    input: { policyId: policyRef.policyId, contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } },
    meta: { requestId: 'fx3-policy', expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
  });
  if (installed.status !== 'committed') throw new Error(`policy setup: ${JSON.stringify(installed)}`);
  const activated = await bootstrap.completionPolicies.activateCompletionPolicy(ctx, {
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } },
    meta: { requestId: 'fx3-active-policy', expected: [{ ref: projectRef, revision: 1 },
      { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId }, revision: 0 }] },
  });
  if (activated.status !== 'committed') throw new Error(`policy activation: ${JSON.stringify(activated)}`);
  const architecture = await createArchitectureCatalogService({ records: backend.records }).adoptInitialArchitecture(ctx, {
    input: { baselineId: 'r4c-claim-baseline', description: 'FX3 fixture', constraints: [],
      catalog: { requireDag: true, dependencies: [], modules: [{ ref: { projectId, moduleId: 'fx3-work' },
        name: 'FX3 work', responsibility: 'Fixture workspace', paths: ['src'], interfaces: [] }] } },
    meta: { requestId: 'fx3-architecture', expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
  });
  if (architecture.status !== 'committed') throw new Error(`architecture setup: ${JSON.stringify(architecture)}`);

  // ---- real services over the real backends ---------------------------------
  let eventSeq = 0;
  const eventId = () => `r4c-claim-event-${++eventSeq}`;
  let requestSeq = 0;
  let idSeq = 0;
  const now = clock;
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
  const plans = createPlanService({ records: backend.records, materials: materialsPort, now, eventId });
  const sessionsPort = createSessionDirectory({ records: backend.records, lookups: backend.records });

  const roleService = createRoleConfigurationService({ records: backend.records, now, eventId });

  // ---- Goal + accepted Plan through the real services ------------------------
  const createdGoal = await goalsService.tasks.createGoal(ctx, { meta: {
    requestId: 'r4c-claim-create-goal',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'Exercise the atomic claim skeleton' } });
  if (createdGoal.status !== 'committed') throw new Error(`fixture Goal creation failed: ${JSON.stringify(createdGoal)}`);

  const draft: PlanRevisionDraft = { schemaVersion: 1, planId: planRef.planId, planRevision: 1,
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

  async function createSession(requestId: string, role: RoleConfigurationRef = defaultRole): Promise<SessionRef> {
    const admitted = await sessionsPort.admitSessionCreation(ctx, { meta: { requestId: `admit-${requestId}`, expected: [] },
      input: { workspace: scope, kernelStore: { adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store' },
        role, recommendedRefs: [], initialLinks: [] } });
    if (admitted.status !== 'committed') throw new Error(`fixture session admission failed: ${JSON.stringify(admitted)}`);
    const kernelSessionId = `r4c-claim-kernel-session-${requestId}`;
    await kernelStores.withStore('r4c-claim-kernel', store => store.create({
      sessionId: kernelSessionId, recordId: `r4c-claim-kernel-record-${requestId}`, createdAt: AT,
    }, { signal: ctx.signal }));
    const registered = await sessionsPort.recordSessionCreated(ctx, { meta: { requestId: `register-${requestId}`, expected: [] },
      input: { operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
        adapterId: 'r4c-claim-kernel', kernelSessionId, historyCursor: null, observedAt: AT } });
    if (registered.status !== 'committed') throw new Error(`fixture session registration failed: ${JSON.stringify(registered)}`);
    return { projectId: registered.value.ref.projectId, sessionId: registered.value.ref.sessionId };
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

  async function decodedRevision(refKey: string): Promise<number> {
    const read = await backend.records.readMany([refKey]);
    if (read.status !== 'ready') throw new Error(`fixture revision read failed: ${JSON.stringify(read)}`);
    const record = read.value.records.find(candidate => candidate.refKey === refKey);
    if (record === undefined) throw new Error(`fixture record is absent: ${refKey}`);
    const parsed = JSON.parse(record.json) as { revision?: unknown };
    if (typeof parsed.revision !== 'number') throw new Error(`fixture record has no revision: ${refKey}`);
    return parsed.revision;
  }

  const fixture: TaskClaimFixture = {
    audit, kind, directory, ledgerPath, records: backend.records, spy, materialsSpy, service, ctx, scope,
    projectRef, workspaceRef, goalRef, planRef, plan, tasks,
    sessions: { first: firstSession, second: secondSession }, roleBinding, budget,
    goals: goalsService.tasks, plans, sessionsPort, roleService, makeService,
    async buildRequest(overrides = {}) {
      const sessionRef = overrides.input?.sessionRef ?? firstSession;
      const goalRead = await plans.queryGoal(ctx, goalRef);
      if (goalRead.status !== 'ready') throw new Error(`fixture goal read failed: ${JSON.stringify(goalRead)}`);
      const card = await sessionsPort.readSession(ctx, sessionRef);
      if (card.status !== 'ready') throw new Error(`fixture session read failed: ${JSON.stringify(card)}`);
      const expected = overrides.expected ?? [
        { ref: goalRef, revision: goalRead.value.goal.revision },
        { ref: workspaceRef, revision: await decodedRevision(canonicalRefKey(workspaceRef)) },
        { ref: plainSessionRefToAggregate(sessionRef), revision: card.value.record.revision },
      ];
      return { input: {
        goalRef: overrides.input?.goalRef ?? goalRef,
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
  return fixture;
}

export const B2_AT = CLAIM_FIXTURE_AT;
export const B2_INPUT = 'Implement A using the accepted task and plan contract.';
export const B2_HOST = {
  configurationRevision: 'b2-host-config-1',
  permissions: { policyRevision: 'legacy-template', tools: ['read'], writeScope: [] as string[] },
  hostTemplate: { templateId: 'builder', revision: '1', digest: artifactBodyDigest('trusted builder template revision 1') },
};
export type B2Records = TaskClaimFixture['records'];
export type B2Ports = { entry: ExecutionEntryPort; model: ModelRequestPort };
export type B2Admitted = { prepared: PreparedTaskExecution; permit: TaskEntryPermit };
export type B2TerminalObservation = TaskResultObservation & {
  kernelSource: NonNullable<TaskResultObservation['kernelSource']>;
  completedHistoryBoundary: CompletedHistoryBoundary;
  history: ObservedExecutionHistory;
};


export type B2PreparedOptions = {
  claim?: TaskClaim;
  input?: string;
  role?: RoleSpecResolutionV1;
  hostTemplate?: PreparedTaskManifestV1['hostTemplate'];
  permissions?: TaskEnvelopeV1['permissions'];
};

export type B2ExecutionFixture = {
  base: TaskClaimFixture;
  ctx: CoreCallContext;
  claim: TaskClaim;
  secondClaim: TaskClaim;
  run: RunSnapshot;
  kernel: KernelExecutionBinding;
  kernelFor(claim: TaskClaim): Promise<KernelExecutionBinding>;
  entry: ExecutionEntryPort;
  model: ModelRequestPort;
  bodies: RawArtifactStorePort;
  buildPrepared(options?: B2PreparedOptions): Promise<PreparedTaskExecution>;
  permit(overrides?: Partial<TaskEntryPermit>): TaskEntryPermit;
  secondPermit(overrides?: Partial<TaskEntryPermit>): TaskEntryPermit;
  runPin(): Promise<VersionPin>;
  secondRunPin(): Promise<VersionPin>;
  terminalEvent(overrides?: Partial<RuntimeEventV1>): RuntimeEventV1;
  completedBoundary(position?: number): CompletedHistoryBoundary;
  observedHistory(position?: number): ObservedExecutionHistory;
  sessionAvailability(): Promise<string | null>;
  ports(records?: B2Records): B2Ports;
  host: { enabled: boolean; calls: number };
  read(claim?: TaskClaim, records?: B2Records): Promise<TaskExecutionRecord>;
  authorize(options?: { prepared?: PreparedTaskExecution; ports?: B2Ports; consumerId?: string }): Promise<B2Admitted>;
  start(options?: { prepared?: PreparedTaskExecution; ports?: B2Ports }): Promise<B2Admitted>;
  enter(options?: { prepared?: PreparedTaskExecution; ports?: B2Ports }): Promise<B2Admitted>;
  pin(claim?: TaskClaim, records?: B2Records): Promise<VersionPin>;
  currentPermit(claim?: TaskClaim, records?: B2Records): Promise<TaskEntryPermit>;
  actualRequest(admitted: B2Admitted, requestId?: string): ActualModelRequest;
  terminalObservation(admitted: B2Admitted): B2TerminalObservation;

  close(): Promise<void>;
};

export async function createB2ExecutionFixture(
  kind: ClaimFixtureKind = 'memory',
  additionalSchemas: RecordBackendSchemas = { records: [], events: [] },
  clock: () => string = () => AT,
): Promise<B2ExecutionFixture> {
  const base = await createTaskClaimFixture(kind, {
    records: [...EXECUTION_ENTRY_RECORD_SCHEMAS.records, ...MODEL_REQUEST_RECORD_SCHEMAS.records,
      ...additionalSchemas.records],
    events: [...EXECUTION_ENTRY_RECORD_SCHEMAS.events, ...MODEL_REQUEST_RECORD_SCHEMAS.events,
      ...additionalSchemas.events],
    lookups: [...EXECUTION_ENTRY_RECORD_SCHEMAS.lookups ?? [], ...MODEL_REQUEST_RECORD_SCHEMAS.lookups ?? [],
      ...(additionalSchemas.lookups ?? [])],
  }, clock);
  const claimed = await base.service.claimTask(base.ctx, await base.buildRequest());
  if (claimed.status !== 'committed') throw new Error(`B2 fixture claim failed: ${JSON.stringify(claimed)}`);
  const claim = claimed.value;
  const reads = createRunStateReader({ records: base.records });
  const runRead = await reads.readExecution(base.ctx, claim.runRef);
  if (runRead.status !== 'ready') throw new Error(`B2 fixture run read failed: ${JSON.stringify(runRead)}`);
  const run = runRead.value.run;
  const kernel: KernelExecutionBinding = {
    adapterId: runRead.value.session.kernel.adapterId,
    kernelSessionId: runRead.value.session.kernel.kernelSessionId,
    runId: 'b2-kernel-run',
    turnId: 'b2-kernel-turn',
  };

  // A second real, independent claim: new Goal + accepted Plan + mapped Session.
  const goal2Ref: GoalRef = { aggregateType: 'Goal', projectId: base.scope.projectId, goalId: 'b2-second-goal' };
  const createdGoal2 = await base.goals.createGoal(base.ctx, { meta: {
    requestId: 'b2-create-goal-2',
    expected: [{ ref: base.projectRef, revision: 1 }, { ref: base.workspaceRef, revision: 1 }] },
    input: { goalId: goal2Ref.goalId, workspace: base.scope, objective: 'B2 second independent run' } });
  if (createdGoal2.status !== 'committed') throw new Error(`B2 fixture goal2 failed: ${JSON.stringify(createdGoal2)}`);
  const plan2Ref: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: base.scope.projectId, planId: 'b2-second-plan' };
  const draft2: PlanRevisionDraft = { schemaVersion: 1, planId: plan2Ref.planId, planRevision: 1, goalId: goal2Ref.goalId, stages: [],
    tasks: [
      { taskId: 'b2-second-task', title: 'B2 second task', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'b2-second-gate', title: 'B2 second gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 'b2-second-task', role: 'builder', instruction: 'B2 second task' }],
    obligations: [{ obligationId: 'b2-second-obligation', title: 'B2 second delivery', requirementLevel: 'required', taskIds: ['b2-second-task', 'b2-second-gate'],
      verificationRequirements: [{ requirementId: 'b2-second-check', requirementLevel: 'required', kind: 'test', description: 'B2 second test' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
  const proposed2 = await base.plans.proposePlan(base.ctx, { meta: { requestId: 'b2-propose-plan-2', expected: [{ ref: goal2Ref, revision: 1 }] },
    input: { goalRef: goal2Ref, basedOn: null, draft: draft2, reason: { text: 'B2 second plan', sources: [] } } });
  if (proposed2.status !== 'committed' || proposed2.value.issues.length > 0) throw new Error(`B2 fixture plan2 proposal failed: ${JSON.stringify(proposed2)}`);
  const applied2 = await base.plans.applyPlanChange(base.ctx, { meta: { requestId: 'b2-apply-plan-2', expected: [{ ref: goal2Ref, revision: 1 }] },
    input: { proposalRef: proposed2.value.ref, expectedProposalRevision: proposed2.value.revision, decisionRefs: [] } });
  if (applied2.status !== 'committed') throw new Error(`B2 fixture plan2 adoption failed: ${JSON.stringify(applied2)}`);
  const session2 = await base.createSession('b2-session-second');
  const goal2Read = await base.plans.queryGoal(base.ctx, goal2Ref);
  if (goal2Read.status !== 'ready') throw new Error(`B2 fixture goal2 read failed: ${JSON.stringify(goal2Read)}`);
  const session2Card = await base.sessionsPort.readSession(base.ctx, session2);
  if (session2Card.status !== 'ready') throw new Error(`B2 fixture session2 read failed: ${JSON.stringify(session2Card)}`);
  const request2: GraphWrite<ClaimTaskInput> = {
    input: { goalRef: goal2Ref, planRef: plan2Ref, taskId: 'b2-second-task', sessionRef: session2, roleBinding: base.roleBinding, budget: base.budget },
    meta: { requestId: 'b2-claim-second', expected: [
      { ref: goal2Ref, revision: goal2Read.value.goal.revision },
      { ref: base.workspaceRef, revision: 1 },
      { ref: plainSessionRefToAggregate(session2), revision: session2Card.value.record.revision },
    ] },
  };
  const claimed2 = await base.service.claimTask(base.ctx, request2);
  if (claimed2.status !== 'committed') throw new Error(`B2 fixture second claim failed: ${JSON.stringify(claimed2)}`);
  const secondClaim = claimed2.value;

  let seq = 0;
  const now = clock;
  const eventId = () => `b2-event-${++seq}`;
  const roles = createRoleConfigurationService({ records: base.records, now, eventId });
  const bodies = new RawArtifactBodyStore();
  const host = { enabled: true, calls: 0 };
  const authorizeConfiguration: AuthorizeConfiguration = async (ctx, input) => {
    host.calls++;
    const expectedRole = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
    if (!host.enabled || ctx.projectId !== base.scope.projectId || ctx.workspaceId !== base.scope.workspaceId
      || input.run.ref.projectId !== base.scope.projectId
      || canonicalJson(input.sessionRole) !== canonicalJson(expectedRole)
      || input.configurationRevision !== B2_HOST.configurationRevision
      || canonicalJson(input.permissions) !== canonicalJson(B2_HOST.permissions)
      || canonicalJson(input.hostTemplate) !== canonicalJson(B2_HOST.hostTemplate)) {
      return { status: 'rejected', code: 'forbidden', reason: 'fixed test Host configuration does not authorize this request' };
    }
    return { status: 'ready', value: structuredClone(B2_HOST) };
  };
  function ports(records: B2Records = base.records): B2Ports {
    const deps: ExecutionEntryDependencies = {
      records, reads: createRunStateReader({ records }),
      roles: createRoleConfigurationService({ records, now, eventId }),
      bodies, authorizeConfiguration,
      now, eventId, newId: () => `b2-id-${++seq}`,
    };
    return { entry: createExecutionEntryService(deps), model: createModelCallService(deps) };
  }
  const { entry, model } = ports();

  async function buildPrepared(options: B2PreparedOptions = {}): Promise<PreparedTaskExecution> {
    const targetClaim = options.claim ?? claim;
    const target = await read(targetClaim);
    const input = options.input ?? B2_INPUT;
    const inputDigest = artifactBodyDigest(input);
    const permissions = options.permissions ?? structuredClone(B2_HOST.permissions);
    const roleFacts = await roles.resolveRoleBindingFacts(base.ctx, { roleBinding: target.run.roleBinding, declaredPermissions: permissions });
    if (roleFacts.result.status !== 'ready') throw Error('real role fixture could not resolve');
    const role = options.role ?? roleFacts.result.value;
    const hostTemplate = options.hostTemplate === undefined ? structuredClone(B2_HOST.hostTemplate) : options.hostTemplate;
    const workspaceSnapshot = { workspaceId: targetClaim.workspaceId, revision: 1 };
    const manifest: PreparedTaskManifestV1 = {
      schemaVersion: 1, kind: 'task_execution', claim: targetClaim, role, hostTemplate,
      roleBinding: base.roleBinding, hostConfigurationRevision: 'b2-host-config-1',
      sessionRole: target.session.role,
      workspaceSnapshot, permissions, budget: base.budget, selectedTaskInputs: [],
      materialBasis: null, materialAccessRefs: [], additionalMaterialRefs: [], deliveryRefs: [],
      sourceRefs: [], input, inputDigest,
    };
    const manifestJson = JSON.stringify(manifest);
    const stored = await bodies.put({ body: manifestJson,
      contentType: 'application/vnd.coding-platform.task-execution-manifest+json;version=1',
      sourceRefs: [{ kind: 'workspace', refId: targetClaim.workspaceId, revision: String(workspaceSnapshot.revision) }],
      origin: { kind: 'run', owner: targetClaim.runRef }, requestedAt: now() });
    if (stored.status !== 'ready') throw new Error(`B2 fixture manifest store failed: ${JSON.stringify(stored)}`);
    const envelope: TaskEnvelopeV1 = {
      schemaVersion: 1, envelopeId: 'b2-envelope-1', projectId: targetClaim.task.projectId,
      workspaceId: targetClaim.workspaceId, goalId: targetClaim.task.goalId, taskId: targetClaim.task.taskId,
      runRef: targetClaim.runRef, attemptRef: targetClaim.attemptRef, planRef: targetClaim.planRef,
      roleBinding: base.roleBinding, workspaceSnapshot, permissions, budget: base.budget,
      sourceRefs: [], bundleRef: stored.value.ref,
    };
    const inputBinding: PreparedTaskExecution['inputBinding'] = {
      schemaVersion: 1, inputDigest, manifestDigest: artifactBodyDigest(manifestJson), materialAccessRefs: [],
      deliveryRefs: [] };
    return { kind: 'task', claim: targetClaim, envelope, inputBinding };
  }
  function permit(overrides: Partial<TaskEntryPermit> = {}): TaskEntryPermit {
    return { claim, consumerId: 'runtime-a', entryGeneration: 1, authorizationRevision: 1, inputDigest: artifactBodyDigest(B2_INPUT), ...overrides };
  }
  function secondPermit(overrides: Partial<TaskEntryPermit> = {}): TaskEntryPermit {
    return { claim: secondClaim, consumerId: 'runtime-b', entryGeneration: 1, authorizationRevision: 1, inputDigest: artifactBodyDigest(B2_INPUT), ...overrides };
  }
  async function pinFor(target: RunRef): Promise<VersionPin> {
    const read = await reads.readExecution(base.ctx, target);
    if (read.status !== 'ready') throw new Error(`B2 fixture pin read failed: ${JSON.stringify(read)}`);
    return { ref: target, revision: read.value.run.revision };
  }
  function terminalEvent(overrides: Partial<RuntimeEventV1> = {}): RuntimeEventV1 {
    return { eventType: 'run_completed', schemaVersion: 1, eventId: 'b2-runtime-complete',
      runRef: claim.runRef, sequence: 2, occurredAt: now(), payload: { kind: 'completed', exitCode: 0 }, ...overrides };
  }
  function completedBoundary(position = 4): CompletedHistoryBoundary {
    return { source: { ...kernel, position }, cursor: 'b2-trusted-runtime-completed-boundary-4' };
  }
  function observedHistory(position = 3): ObservedExecutionHistory {
    return { kernel, startPosition: 2, observedThroughPosition: position, endPosition: null };
  }
  async function read(target: TaskClaim = claim, records: B2Records = base.records): Promise<TaskExecutionRecord> {
    const result = await createRunStateReader({ records }).readExecution(base.ctx, target.runRef);
    if (result.status !== 'ready') throw Error(`real execution fixture read: ${JSON.stringify(result)}`);
    return result.value;
  }
  async function pin(target: TaskClaim = claim, records: B2Records = base.records): Promise<VersionPin> {
    const current = await read(target, records);
    return { ref: target.runRef, revision: current.run.revision };
  }
  async function currentPermit(target: TaskClaim = claim, records: B2Records = base.records): Promise<TaskEntryPermit> {
    const current = await read(target, records);
    const auth = current.run.executionAuthorization;
    if (!auth || !('schemaVersion' in auth) || auth.schemaVersion !== 2) throw Error('no formal V2 entry binding');
    return { claim: target, consumerId: auth.consumerId, entryGeneration: auth.generation,
      authorizationRevision: auth.revision, inputDigest: auth.inputDigest };
  }
  async function authorize(options: { prepared?: PreparedTaskExecution; ports?: B2Ports; consumerId?: string } = {}): Promise<B2Admitted> {
    const prepared = options.prepared ?? await buildPrepared();
    const p = options.ports ?? { entry, model };
    const result = await p.entry.authorizeRuntimeEntry(base.ctx, { input: { prepared, consumerId: options.consumerId ?? 'runtime-a' },
      meta: { requestId: `b2-formal-authorize-${++seq}`, expected: [await pin(prepared.claim)] } });
    expect(result, 'formal authorize prerequisite').toMatchObject({ status: 'committed', replayed: false });
    if (result.status !== 'committed') throw Error('authorize prerequisite not implemented');
    return { prepared, permit: result.value };
  }
  async function kernelFor(target: TaskClaim): Promise<KernelExecutionBinding> {
    const current = await read(target);
    return { ...kernel, adapterId: current.session.kernel.adapterId,
      kernelSessionId: current.session.kernel.kernelSessionId,
      ...(target.runRef.runId === claim.runRef.runId ? {} : {
        runId: `fx3-kernel-${target.runRef.runId}`, turnId: `fx3-turn-${target.runRef.runId}`,
      }) };
  }
  async function start(options: { prepared?: PreparedTaskExecution; ports?: B2Ports } = {}): Promise<B2Admitted> {
    const admitted = await authorize(options);
    const p = options.ports ?? { entry, model };
    const result = await p.entry.beginRuntimeEntry(base.ctx, { input: { permit: admitted.permit, kernel: await kernelFor(admitted.prepared.claim) },
      meta: { requestId: `b2-formal-begin-${++seq}`, expected: [await pin(admitted.prepared.claim)] } });
    expect(result, 'formal fresh begin prerequisite').toMatchObject({ status: 'committed', replayed: false });
    if (result.status !== 'committed') throw Error('begin prerequisite not implemented');
    return { ...admitted, permit: { ...admitted.permit, authorizationRevision: result.value.authorization.revision } };
  }
  async function enter(options: { prepared?: PreparedTaskExecution; ports?: B2Ports } = {}): Promise<B2Admitted> {
    const started = await start(options);
    const boundKernel = await kernelFor(started.prepared.claim);
    const p = options.ports ?? { entry, model };
    const result = await p.entry.recordExecutionEntered(base.ctx, { input: { permit: started.permit, enteredAt: now(),
      kernelSource: { ...boundKernel, position: 3 }, history: { ...observedHistory(3), kernel: boundKernel } },
      meta: { requestId: `b2-formal-entered-${++seq}`, expected: [await pin(started.prepared.claim)] } });
    expect(result, 'formal entered prerequisite').toMatchObject({ status: 'committed', value: { status: 'running' } });
    return { ...started, permit: await currentPermit(started.prepared.claim) };
  }
  function actualRequest(admitted: B2Admitted, requestId = 'b2-actual-request'): ActualModelRequest {
    return { permit: admitted.permit, requestId, requestDigest: artifactBodyDigest(JSON.stringify({ requestId, input: B2_INPUT })),
      contextInputDigest: admitted.prepared.inputBinding.inputDigest,
      manifestDigest: admitted.prepared.inputBinding.manifestDigest };
  }
  function terminalObservation(admitted: B2Admitted) {
    return { claim: admitted.prepared.claim,
      entry: { consumerId: admitted.permit.consumerId, entryGeneration: admitted.permit.entryGeneration },
      event: terminalEvent(), kernelSource: { ...kernel, position: 4 }, completedHistoryBoundary: completedBoundary(4),
      history: { ...observedHistory(4), endPosition: 4 } };
  }

  return {
    base, ctx: base.ctx, claim, secondClaim, run, kernel, kernelFor, entry, model, bodies,
    buildPrepared, permit, secondPermit, ports, host, read, pin, currentPermit, authorize, start, enter, actualRequest, terminalObservation,
    runPin: () => pinFor(claim.runRef),
    secondRunPin: () => pinFor(secondClaim.runRef),
    terminalEvent, completedBoundary, observedHistory,
    async sessionAvailability() {
      const card = await base.sessionsPort.readSession(base.ctx, claim.sessionRef);
      return card.status === 'ready' ? card.value.availability : null;
    },
    close: () => base.close(),
  };
}


function decoded<T>(result: { status: 'decoded'; value: T } | { status: 'invalid'; reason: string }, refKey: string): T {
  if (result.status !== 'decoded') throw new Error(`readInvariantWorld: ${refKey} does not decode: ${result.reason}`);
  return result.value;
}

function decodeWorldRecords(projectId: string, records: readonly EncodedRecord[]): InvariantWorld {
  const world = emptyInvariantWorld(projectId);
  for (const record of records) {
    const aggregateType = (JSON.parse(record.refKey) as { aggregateType: string }).aggregateType;
    switch (aggregateType) {
      case 'Run': {
        const run = decodeRun(record);
        if (!run.ok) throw new Error(`readInvariantWorld: ${record.refKey} does not decode: ${run.reason}`);
        world.runs.push(run.value);
        break;
      }
      case 'TaskAttempt': world.attempts.push(decoded(decodeTaskAttemptSnapshot(record), record.refKey)); break;
      case 'DispatchOutboxEntry': world.outboxes.push(decoded(decodeDispatchOutboxEntry(record), record.refKey)); break;
      // TaskLease and TaskReduction have no decoder of their own: `readMany` already ran the registered
      // `PLAN_STATE_RECORD_SCHEMAS` validators, as every production reader of these records relies on.
      case 'TaskLease': world.leases.push(JSON.parse(record.json) as TaskLeaseSnapshot); break;
      case 'TaskReduction': world.reductions.push(JSON.parse(record.json) as TaskReductionSnapshot); break;
      case 'Session': world.sessions.push(decoded(decodeSessionRecord(record), record.refKey)); break;
      case 'QueryRun': world.queryRuns.push(decoded(decodeQueryRunSnapshotRecord(record), record.refKey)); break;
      case 'ControlIntent': world.intents.push(decoded(decodeControlIntentSnapshot(record), record.refKey)); break;
      case 'VerificationRound': world.rounds.push(decoded(decodeVerificationRoundSnapshot(record), record.refKey)); break;
      case 'Evidence': world.evidence.push(decoded(decodeEvidenceSnapshot(record), record.refKey)); break;
      case 'TaskEvidenceIndex': world.evidenceIndexes.push(decoded(decodeTaskEvidenceIndexSnapshot(record), record.refKey)); break;
      case 'SessionMessage': world.messages.push(decoded(decodeSessionMessageRecord(record), record.refKey)); break;
      case 'Goal': world.goals.push(decoded(decodeGoalSnapshot(record), record.refKey)); break;
      case 'GoalPhase': world.goalPhases.push(decoded(decodeGoalPhaseSnapshot(record), record.refKey)); break;
      case 'TaskRequeue': world.requeues.push(decoded(decodeTaskRequeueSnapshot(record), record.refKey)); break;
      case 'TaskReworkRefusal': world.refusals.push(decoded(decodeTaskReworkRefusalSnapshot(record), record.refKey)); break;
      case 'PlanRevision': world.plans.push(decoded(decodePlanRevisionSnapshot(record), record.refKey)); break;
      case 'SessionAnomalyAnchor': {
        const anchors = world.anchors ?? (world.anchors = []);
        anchors.push(decoded(decodeSessionAnomalyAnchor(record), record.refKey));
        break;
      }
      default: throw new Error(`readInvariantWorld: unexpected aggregate type ${aggregateType}`);
    }
  }
  return world;
}

/** One §11.11 event in its world form, or null when it belongs to another project. */
function worldEvent(seq: number, event: EncodedDomainEvent, projectId: string): InvariantEvent | null {
  const base = { seq, goalStateTo: null, revision: null, controlKind: null, taskId: null };
  const where = `event ${event.eventId} (${event.eventType})`;
  switch (event.eventType) {
    case 'GoalCreated': {
      const value = decoded(decodeGoalCreatedEvent(event), where);
      return value.projectId !== projectId ? null : { ...base, eventType: 'GoalCreated', goalId: value.aggregateId,
        goalStateTo: 'active', subject: refKey({ aggregateType: 'Goal', projectId, goalId: value.aggregateId }) };
    }
    case 'GoalDesiredStateChanged': {
      const value = decoded(decodeGoalDesiredStateChangedEvent(event), where);
      return value.goal.ref.projectId !== projectId ? null : { ...base, eventType: 'GoalDesiredStateChanged',
        goalId: value.goal.ref.goalId, goalStateTo: value.to, subject: refKey(value.goal.ref) };
    }
    case 'TaskClaimed': {
      const claim = decoded(taskClaimedEventFromEvent(event), where).claim;
      return claim.task.projectId !== projectId ? null
        : { ...base, eventType: 'TaskClaimed', goalId: claim.task.goalId, subject: refKey(claim.runRef), taskId: claim.task.taskId };
    }
    case 'ExecutionEntryAuthorized': {
      const claim = decoded(executionEntryAuthorizedEventFromEvent(event), where).permit.claim;
      return claim.task.projectId !== projectId ? null : { ...base, eventType: 'ExecutionEntryAuthorized',
        goalId: claim.task.goalId, subject: refKey(claim.runRef), taskId: claim.task.taskId };
    }
    case 'VerificationRoundOpened':
    case 'VerificationCheckBegun':
    case 'VerificationRoundReverified': {
      const value = decoded(verificationRoundEventFromEvent(event), where);
      return value.roundRef.projectId !== projectId ? null
        : { ...base, eventType: event.eventType, goalId: value.roundRef.goalId, subject: refKey(value.roundRef),
          taskId: value.roundRef.taskId };
    }
    case 'TaskRequeued': {
      const requeue = decoded(taskRequeuedEventFromEvent(event), where).requeue;
      return requeue.ref.projectId !== projectId ? null : { ...base, eventType: 'TaskRequeued', goalId: requeue.ref.goalId,
        subject: refKey(requeue.ref), taskId: requeue.ref.taskId };
    }
    case 'TaskReworkRefused': {
      const refusal = decoded(taskReworkRefusedEventFromEvent(event), where).refusal;
      return refusal.ref.projectId !== projectId ? null : { ...base, eventType: 'TaskReworkRefused', goalId: refusal.ref.goalId,
        subject: refKey(refusal.ref), revision: refusal.revision, taskId: refusal.ref.taskId };
    }
    case 'ControlIntentSubmitted': {
      const intent = decoded(controlIntentSubmittedEventFromEvent(event), where).submitted.intent;
      return intent.ref.projectId !== projectId ? null : { ...base, eventType: 'ControlIntentSubmitted',
        goalId: intent.runRef.goalId, subject: refKey(intent.ref), controlKind: intent.kind };
    }
    default: return null;
  }
}

/** `phase(t)`, `cause(t)`, `selected(t)` of every Task of each Goal's active Plan, from the canonical reader. */
async function readTaskStates(
  records: Parameters<typeof readCanonicalTaskFacts>[0], world: InvariantWorld,
): Promise<InvariantTaskState[]> {
  const states: InvariantTaskState[] = [];
  for (const goal of world.goals) {
    const active = goal.activePlanRevision;
    if (active === null) continue;
    const plan = world.plans.find((candidate) => sameRef(candidate.ref, active));
    if (plan === undefined) throw new Error(`readInvariantWorld: the active Plan of Goal ${goal.ref.goalId} is not in the window`);
    const read = await readCanonicalTaskFacts(records, goal.ref, plan);
    for (const task of plan.tasks) {
      const base = { goalId: goal.ref.goalId, taskId: task.taskId, taskKind: task.taskKind };
      const state = read.status === 'ready' ? read.value.byTaskId.get(task.taskId) : undefined;
      if (state === undefined) {
        states.push({ ...base, phase: null, cause: null, selectedRunRef: null, coveringRequeueRef: null,
          problem: read.status === 'ready' ? `task ${task.taskId} has no canonical state` : `${read.code}: ${read.reason}` });
        continue;
      }
      states.push({ ...base, phase: state.effectivePhase, cause: state.phaseCause, selectedRunRef: state.execution,
        coveringRequeueRef: state.requeueRef, problem: null });
    }
  }
  return states;
}




/** No terminal was recovered from the old Host: RUN-20 also ends Attempt/Outbox. */
export async function unknownWork(f: B2ExecutionFixture, now: () => string): Promise<void> {
  let eventSeq = 0;
  const reconcile = createRunReconcileService({ records: f.base.records,
    reads: createRunStateReader({ records: f.base.records }),
    hostInstance: { hostInstanceId: 'fx3-host', lease: 'owned' }, now, eventId: () => `fx3-unknown-${++eventSeq}` });
  const result = await reconcile.reconcileRun(f.ctx, {
    input: { runRef: f.claim.runRef, basis: { kind: 'host_instance_takeover', hostInstanceId: 'fx3-host' },
      probe: 'missing', result: { kind: 'unknown', cause: 'kernel_unreadable',
        unresolvedToolCallIds: [], observedThroughPosition: null, turn: null } },
    meta: { requestId: 'fx3-unknown', expected: [await f.pin()] },
  });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed', value: { status: 'ended', outcome: 'outcome_unknown' } });
  const read = await f.read();
  expect(read.attempt.endOutcome).toBe('outcome_unknown');
  expect(read.session.occupancy).toEqual({ kind: 'execution', executionRef: f.claim.runRef,
    generation: f.claim.generation });
}

/** The existing clean-crash path stops the writer and retires its open Kernel Turn. */
export async function interruptWork(f: B2ExecutionFixture, now: () => string): Promise<void> {
  let eventSeq = 0;
  const reconcile = createRunReconcileService({ records: f.base.records,
    reads: createRunStateReader({ records: f.base.records }),
    hostInstance: { hostInstanceId: 'fx3-host', lease: 'owned' }, now, eventId: () => `fx3-interrupted-${++eventSeq}` });
  const result = await reconcile.reconcileRun(f.ctx, {
    input: { runRef: f.claim.runRef, basis: { kind: 'host_instance_takeover', hostInstanceId: 'fx3-host' },
      probe: 'ready', result: { kind: 'interrupted_clean', turn: { terminal: false, inFlightToolCallIds: [],
        lastPosition: 3, kernelPaused: false, entered: null, acceptedSteers: [], inputsConfirmed: true } } },
    meta: { requestId: 'fx3-interrupted', expected: [await f.pin()] },
  });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed', value: { status: 'ended' } });
  const read = await f.read();
  expect(read.session.occupancy).toBeNull();
  expect(read.session.health).toBe('unavailable');
  expect(read.session.healthConclusion).toBe('kernel_turn_open');
}

export async function retireSession(base: TaskClaimFixture, sessionRef: SessionRef, now: () => string): Promise<void> {
  const health = createSessionHealthService({ records: base.records,
    hostInstance: { hostInstanceId: 'fx3-host', lease: 'owned' }, now,
    eventId: () => `fx3-missing-${sessionRef.sessionId}` });
  const result = await health.recordSessionHealth(base.ctx, { sessionRef, probe: { verdict: 'missing', activeRunId: null } });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'observed', session: { health: 'unavailable' } });
}

/** Complete the actual entered claim through WG's result owner (not a phase patch). */
export async function completeWork(f: B2ExecutionFixture, claim: TaskClaim = f.claim): Promise<void> {
  const admitted = await f.enter({ prepared: await f.buildPrepared({ claim }) });
  const observation = f.terminalObservation(admitted);
  const kernel = await f.kernelFor(claim);
  observation.event = { ...observation.event, eventId: `fx3-completed-${claim.runRef.runId}`, runRef: claim.runRef };
  observation.kernelSource = { ...kernel, position: 4 };
  observation.completedHistoryBoundary = { source: observation.kernelSource, cursor: `fx3-completed-${claim.runRef.runId}` };
  observation.history = { ...observation.history, kernel };
  const result = await f.entry.recordRunResult(f.ctx, { input: observation,
    meta: { requestId: `fx3-completed-${claim.runRef.runId}`, expected: [await f.pin(claim)] } });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed', value: { status: 'ended', outcome: 'completed' } });
  expect((await f.read(claim)).session.occupancy).toBeNull();
}
export async function beginConsultation(b2: B2ExecutionFixture, requestId: string, from: SessionRef,
  now: () => string, isolatedCopy = true) {
    const base = b2.base;
    const records = base.records;
    const goalRef = base.goalRef;
    let seq = 0;
    const eventId = () => `fx3-query-${requestId}-${++seq}`;
    const materialReads = createMaterialRecordReaders(records);
    const mailbox = createSessionMailbox({ records, sessions: base.sessionsPort,
      executions: createRunStateReader({ records }), roles: createRoleConfigurationService({ records, now, eventId }),
      materials: createMaterialService({ bodies: b2.bodies, authority: materialReads.authority, now }),
      systemActor: { kind: 'system', id: 'fx3-query' }, now, newId: eventId });
    const pinOf = async (ref: VersionPin['ref']): Promise<VersionPin> => {
      const read = await records.readMany([refKey(ref)]);
      if (read.status !== 'ready') throw new Error(JSON.stringify(read));
      return { ref, revision: read.value.records[0]?.revision ?? 0 };
    };
    const sessionPin = (ref: SessionRef) => base.sessionPin(ref);
    const KERNEL_ADAPTER = 'r4c-claim-kernel';
    const KERNEL_STORE = 'r4c-claim-kernel-store';
    const DEFAULT_ROLE: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
    const question = `consultation ${requestId}`;
    const sent = await mailbox.sendMessage(base.ctx, {
      meta: { requestId: `s1-maintenance-send-${requestId}`, expected: [] },
      input: { recipient: from, text: question, intent: 'inquiry', needsReply: true },
    });
    if (sent.status !== 'committed') throw new Error(`maintenance inquiry send failed: ${JSON.stringify(sent)}`);
    const messageRef = sent.value.ref;

    let copy = from;
    let derivation: NonNullable<SessionMessage['consultationDerivation']> | undefined;
    if (isolatedCopy) {
    const admitted = await base.sessionsPort.admitSessionCreation(base.ctx, {
      meta: { requestId: `s1-maintenance-copy-admit-${requestId}`, expected: [] },
      input: { workspace: base.scope, kernelStore: { adapterId: KERNEL_ADAPTER, storeKey: KERNEL_STORE },
        role: DEFAULT_ROLE, recommendedRefs: [], initialLinks: [],
        provenance: { schemaVersion: 1, kind: 'readonly_copy', from, messageRef } },
    });
    if (admitted.status !== 'committed') throw new Error(`maintenance copy admission failed: ${JSON.stringify(admitted)}`);
    const registered = await base.sessionsPort.recordSessionCreated(base.ctx, {
      meta: { requestId: `s1-maintenance-copy-register-${requestId}`, expected: [] },
      input: { operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
        adapterId: KERNEL_ADAPTER, kernelSessionId: `s1-maintenance-copy-kernel-${requestId}`,
        historyCursor: null, observedAt: now() },
    });
    if (registered.status !== 'committed') throw new Error(`maintenance copy registration failed: ${JSON.stringify(registered)}`);
    copy = { projectId: registered.value.ref.projectId, sessionId: registered.value.ref.sessionId };

    const sourceCard = await base.sessionsPort.readSession(base.ctx, from);
    if (sourceCard.status !== 'ready') throw new Error(`maintenance copy source read failed: ${JSON.stringify(sourceCard)}`);
    const foundMessage = await mailbox.readMessage(base.ctx, messageRef);
    if (foundMessage.status !== 'ready') throw new Error(`maintenance copy message read failed: ${JSON.stringify(foundMessage)}`);
    derivation = {
      childSessionRef: copy, sourceSessionRef: from,
      sourceKernel: { adapterId: sourceCard.value.record.kernel.adapterId,
        kernelSessionId: sourceCard.value.record.kernel.kernelSessionId },
      throughPosition: 1,
    };
    const derived = await mailbox.recordConsultationDerivation!(base.ctx, {
      meta: { requestId: `s1-maintenance-derivation-${requestId}`,
        expected: [{ ref: messageRef, revision: foundMessage.value.revision }] },
      input: { messageRef, derivation },
    });
    if (derived.status !== 'committed') throw new Error(`maintenance copy derivation failed: ${JSON.stringify(derived)}`);

    }
    const { queryJobRef, queryRunRef } = consultationQueryRefs(messageRef);
    const queryBudget = { maxTokens: null, deadline: null };
    const queryRuntimeBudget = structuredClone(DEFAULT_RUNTIME_BUDGET);
    const queryHostRevision = 's1-maintenance-query-host@1';
    const queryPermissions: { tools: string[]; writeScope: [] } = { tools: ['read'], writeScope: [] };
    const queryExecution = createQueryExecution({
      records, roles: createRoleConfigurationService({ records, now, eventId }), bodies: b2.bodies, now, eventId,
      sessionFacts: createSessionFactsService({ records }),
      authorizeConfiguration: async () => ({ status: 'ready', value: {
        configurationRevision: queryHostRevision, permissions: queryPermissions,
        hostTemplate: null, budget: queryRuntimeBudget } }),
    });
    const queryJobs = createQueryJobService({ records, now, eventId,
      execution: { claimQuery: queryExecution.claimQuery, readQueryAnswer: queryExecution.readQueryAnswer },
      consultations: { readMessage: mailbox.readMessage, readMessageBody: mailbox.readMessageBody } });

    const goalRead = await base.plans.queryGoal(base.ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error(`maintenance copy goal read failed: ${JSON.stringify(goalRead)}`);
    const goal = goalRead.value.goal;
    const intent: QueryJobIntentV1 = {
      schemaVersion: 1, intentId: queryJobRef.queryJobId, projectId: base.scope.projectId,
      workspaceId: base.scope.workspaceId, goalId: goalRef.goalId, question, focusTaskRefs: [],
      budget: queryBudget, multiTurn: { maxRounds: 1 }, correlationId: queryJobRef.queryJobId,
      execution: { kind: 'semantic_query', roleBinding: base.roleBinding, runtimeBudget: queryRuntimeBudget,
        consultation: { messageRef, recipient: from, ...(derivation === undefined ? {} : { derivation }) } },
    };
    const submitted = await queryJobs.submitQueryJob(base.ctx, {
      meta: { requestId: `s1-maintenance-query-submit-${requestId}`, expected: [
        await pinOf(base.projectRef), await pinOf(base.workspaceRef), { ref: goalRef, revision: goal.revision },
        { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }] },
      input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent },
    });
    if (submitted.status !== 'committed') throw new Error(`maintenance copy query submit failed: ${JSON.stringify(submitted)}`);

    const claimed = await queryExecution.claimQuery(base.ctx, {
      input: { queryRunRef, sessionRef: copy },
      meta: { requestId: `s1-maintenance-query-claim-${requestId}`, expected: [
        await pinOf(queryJobRef), await pinOf(queryRunRef), await sessionPin(copy)] },
    });
    if (claimed.status !== 'committed') throw new Error(`maintenance copy query claim failed: ${JSON.stringify(claimed)}`);

    const claimRead = await queryExecution.readQueryExecution(base.ctx, queryRunRef);
    if (claimRead.status !== 'ready') throw new Error(`maintenance copy query read failed: ${JSON.stringify(claimRead)}`);
    const state = claimRead.value.run.run.executionState;
    if (state === undefined) throw new Error('maintenance copy QueryRun has no execution state');
    const workspaceKey = canonicalJson(goal.workspaceRef as unknown as JsonValue);
    const workspaceRead = await records.readMany([workspaceKey]);
    if (workspaceRead.status !== 'ready') throw new Error(`maintenance copy workspace read failed: ${JSON.stringify(workspaceRead)}`);
    const workspaceRevision = workspaceRead.value.records.find((record) => record.refKey === workspaceKey)?.revision;
    if (workspaceRevision === undefined) throw new Error('maintenance copy workspace record is absent');
    const manifestInput = `question: ${question}`;
    const manifest: PreparedQueryManifestV1 = {
      schemaVersion: 1, kind: 'query_execution', queryRunRef, sessionRef: copy,
      sessionGeneration: state.sessionGeneration, roleBinding: state.roleBinding, sessionRole: state.role,
      role: state.roleResolution, hostTemplate: null,
      hostConfigurationRevision: queryHostRevision,
      goal: { ref: goal.ref, revision: goal.revision },
      workspace: { ref: goal.workspaceRef, revision: workspaceRevision }, focusPlan: null,
      permissions: queryPermissions, runtimeBudget: queryRuntimeBudget,
      budget: { tokenBudget: queryBudget.maxTokens, deadline: queryBudget.deadline },
      sourceRefs: [{ kind: 'workspace', refId: base.scope.workspaceId, revision: String(workspaceRevision) }],
      input: manifestInput, inputDigest: sha256Hex(manifestInput),
      ...(derivation === undefined ? {} : { sessionBasis: {
        sourceKernelSessionId: derivation.sourceKernel.kernelSessionId, throughPosition: derivation.throughPosition } }),
    };
    const storedManifest = await b2.bodies.put({ body: JSON.stringify(manifest), contentType: QUERY_MANIFEST_CONTENT_TYPE,
      sourceRefs: manifest.sourceRefs, origin: { kind: 'run', owner: queryRunRef }, requestedAt: now() });
    if (storedManifest.status !== 'ready') throw new Error(`maintenance copy manifest store failed: ${JSON.stringify(storedManifest)}`);
    const prepared: PreparedQueryExecution = { queryRunRef, bundleRef: storedManifest.value.ref, inputDigest: manifest.inputDigest };
    const bound = await queryExecution.bindPreparedQuery(base.ctx, {
      input: { prepared },
      meta: { requestId: `s1-maintenance-query-bind-${requestId}`, expected: [
        await pinOf(queryRunRef), await sessionPin(copy)] },
    });
    if (bound.status !== 'committed') throw new Error(`maintenance copy query bind failed: ${JSON.stringify(bound)}`);

    const copyCard = await base.sessionsPort.readSession(base.ctx, copy);
    if (copyCard.status !== 'ready') throw new Error(`maintenance copy Session read failed: ${JSON.stringify(copyCard)}`);
    const kernel = { adapterId: copyCard.value.record.kernel.adapterId,
      kernelSessionId: copyCard.value.record.kernel.kernelSessionId,
      runId: `s1-maintenance-copy-run-${requestId}`, turnId: `s1-maintenance-copy-turn-${requestId}` };
    const begun = await queryExecution.beginQueryEntry(base.ctx, {
      input: { prepared, consumerId: `s1-maintenance-copy-consumer-${requestId}`, kernel },
      meta: { requestId: `s1-maintenance-query-begin-${requestId}`, expected: [
        await pinOf(queryJobRef), await pinOf(queryRunRef), await sessionPin(copy)] },
    });
    if (begun.status !== 'committed') throw new Error(`maintenance copy query begin failed: ${JSON.stringify(begun)}`);
    const entry: QueryEntryIdentity = {
      queryRunRef: begun.value.queryRunRef, sessionRef: begun.value.sessionRef,
      sessionGeneration: begun.value.sessionGeneration, entryGeneration: begun.value.entryGeneration,
      consumerId: begun.value.consumerId, kernel: begun.value.kernel,
    };
    const source = { position: 1, cursor: `s1-maintenance-copy-cursor-${requestId}` };
    const baseHistory: RunExecutionHistoryV1 = { schemaVersion: 1, sessionRef: copy, kernel: entry.kernel,
      startPosition: 1, observedThroughPosition: 1, endPosition: null };
    const entered = await queryExecution.recordQueryObservation(base.ctx, {
      input: { entry, source, history: baseHistory,
        observation: { kind: 'entered', occurredAt: now() } },
      meta: { requestId: `s1-maintenance-query-entered-${requestId}`, expected: [await pinOf(queryRunRef)] },
    });
    if (entered.status !== 'committed') throw new Error(`maintenance copy query entered failed: ${JSON.stringify(entered)}`);

    // query-execution.ts excludes derived copies from mailbox input supply:
    // their question is in the manifest, so they never accept the source's inputId.
    if (!isolatedCopy) {
      const accepted = await mailbox.recordInputAccepted!(base.ctx, {
        input: { messageRef, part: 'message', executionRef: queryRunRef, executionSessionRef: copy,
          kernel: { ...kernel, position: 2 } },
        meta: { requestId: `fx3-query-accepted-${requestId}`, expected: [await pinOf(messageRef)] },
      });
      if (accepted.status !== 'committed') throw new Error(`Query input acceptance failed: ${JSON.stringify(accepted)}`);
    }
    return { sessionRef: copy, queryRunRef, messageRef, mailbox, queryExecution, async answer() {
    const answerText = `answer ${requestId}`;
    const answerBody = await b2.bodies.put({ body: answerText, contentType: 'text/plain; charset=utf-8',
      sourceRefs: manifest.sourceRefs, origin: { kind: 'run', owner: queryRunRef }, requestedAt: now() });
    if (answerBody.status !== 'ready') throw new Error(`maintenance copy answer body store failed: ${JSON.stringify(answerBody)}`);
    const answer: QueryJobAnswerV1 = {
      schemaVersion: 1, answerId: `s1-maintenance-answer-${requestId}`, queryJobRef, runRef: queryRunRef, roundIndex: 0,
      answer: answerText, sources: [], followsAnswerRef: null, stale: false, staleReason: null, answeredAt: now(),
      bodyRef: answerBody.value.ref,
    };
    const settled = await queryExecution.recordQueryObservation(base.ctx, {
      input: { entry, source: { position: 3, cursor: `fx3-query-terminal-${requestId}` }, history: { ...baseHistory, observedThroughPosition: 3, endPosition: 3 },
        observation: { kind: 'terminal', occurredAt: now(), outcome: 'answered', answer, reason: null } },
      meta: { requestId: `s1-maintenance-query-answered-${requestId}`, expected: [await pinOf(queryRunRef)] },
    });
    if (settled.status !== 'committed') throw new Error(`maintenance copy query answer failed: ${JSON.stringify(settled)}`);

    const answerRef: QueryJobAnswerRef = { aggregateType: 'QueryJobAnswer', projectId: base.scope.projectId,
      workspaceId: base.scope.workspaceId, queryJobId: queryJobRef.queryJobId, answerId: answer.answerId };
    const currentMessage = await mailbox.readMessage(base.ctx, messageRef);
    if (currentMessage.status !== 'ready') throw new Error(`maintenance copy message re-read failed: ${JSON.stringify(currentMessage)}`);
    const respond = mailbox.respondFromQueryAnswer;
    if (respond === undefined) throw new Error('the mailbox does not expose respondFromQueryAnswer');
    const answered = await respond.call(mailbox, base.ctx, {
      input: { messageRef, answerRef },
      meta: { requestId: `s1-maintenance-answer-${requestId}`, expected: [{ ref: messageRef, revision: currentMessage.value.revision }] },
    });
    if (answered.status !== 'committed') throw new Error(`maintenance copy answer failed: ${JSON.stringify(answered)}`);
    return { answer, answerRef, message: answered.value };
    } };
  }



let workflowFixtureId = 0;
/** Full production wiring: archive/maintenance need Runtime, requeue, directory and Plan ports too. */
export async function workflowForFixture(b2: B2ExecutionFixture, options: {
  now: () => string; records?: B2Records; allowedRuns?: Set<string>;
} & Pick<WorkflowDependencies, 'sessionDuty' | 'archivePolicy' | 'attestUnknownRun' | 'attestUnknownQueryRun'>): Promise<WorkflowPort> {
  const base = b2.base;
  const records = options.records ?? base.records;
  const now = options.now;
  const prefix = `fx3-workflow-${++workflowFixtureId}`;
  let seq = 0;
  const eventId = () => `${prefix}-${++seq}`;
  const reads = createRunStateReader({ records, bodies: b2.bodies });
  const roles = createRoleConfigurationService({ records, now, eventId });
  const authority = createMaterialRecordReaders(records).authority;
  const materials = createMaterialService({ bodies: b2.bodies, authority, now });
  const messages = createSessionMailbox({ records, sessions: base.sessionsPort, executions: reads, roles, materials,
    systemActor: { kind: 'system', id: prefix }, now, newId: eventId });
  const controls = createRunControlService({ records, authority, reads, now, eventId });
  const workspaceHost = {
    async resolveRoot(scope: WorkspaceScope) {
      if (scope.projectId !== base.scope.projectId || scope.workspaceId !== base.scope.workspaceId) {
        return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'unknown fixture workspace' };
      }
      return { status: 'ready' as const, value: { root: base.directory, workspaceRevision: 1 } };
    },
    async authorize(ctx: CoreCallContext, scope: WorkspaceScope) {
      if (scope.projectId !== ctx.projectId || scope.workspaceId !== ctx.workspaceId) {
        return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'unknown fixture scope' };
      }
      return { status: 'ready' as const, value: { subjectKey: refKey(ctx.principal), permissionRevision: prefix,
        allowsRead: () => true } };
    },
  };
  const requeue = createTaskRequeueService({ records, reads, workspaceHost,
    source: { captureDigest: async () => ({ status: 'ready', sourceDigest: sha256Hex('unchanged FX3 workspace') }) },
    materials, messages, now, eventId });
  const claims = { ...base.service, ...requeue };
  const kernelStores = await createKernelStoreRegistry({ entries: [{ adapterId: 'r4c-claim-kernel',
    storeKey: 'r4c-claim-kernel-store', workspace: base.scope, databasePath: join(base.directory, 'kernel.sqlite') }] });
  const sessionOperations = createSessionOperations({ sessions: base.sessionsPort, kernelStores });
  const activity = createExecutionHistoryReader({ history: sessionOperations });
  const scripted = createScriptedModel([{ kind: 'text', text: 'FX3 must stop before start' }]);
  const runtime = createAgentRuntime({ claims, executions: reads, entry: b2.entry, modelRequests: b2.model,
    roles, plans: base.plans, messages, sessions: base.sessionsPort, materials, bodies: b2.bodies,
    historyWriter: createExecutionHistoryService({ records, now, eventId }), activity,
    graphHistory: createGraphExecutionHistoryReader({ executions: reads, history: activity }),
    sessionOperations, kernelStores, workspaceHost,
    sourceAuthority: () => createSourceAuthorityReader({ authority }),
    host: createRuntimeHostDouble({ runRefs: options.allowedRuns ?? new Set<string>(), scripted,
      root: base.directory, skillRoot: join(base.directory, 'skills'), scope: base.scope,
      role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' } }),
    kernel: kernelApi, controls, now, newId: eventId,
  });
  const sessionFacts = createSessionFactsService({ records });
  const forbiddenCheck = async () => { throw new Error('archive/maintenance must not start a check'); };
  const deps: WorkflowDependencies = {
    tasks: base.goals, plans: base.plans, sessions: base.sessionsPort, claims, executions: reads,
    runtime: { ...runtime.port, createSession: sessionOperations.createSession,
      readSessionHistory: sessionOperations.readSessionHistory },
    evidence: { openVerification: forbiddenCheck, readVerification: forbiddenCheck, beginCheck: forbiddenCheck,
      recordCheckResult: forbiddenCheck, finalizeChecks: forbiddenCheck },
    checks: { runRegisteredCheck: forbiddenCheck }, sourceAuthority: createSourceAuthorityReader({ authority }),
    configuration: { consumerId: prefix, bindings: [{ workspace: base.scope,
      sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: base.roleBinding, budget: base.budget }] },
    sessionLifecycle: createSessionLifecycleService({ records, lookups: records, sessionFacts }), sessionFacts,
    responsibilities: createSessionResponsibilityService({ records, lookups: records,
      basis: createSessionResponsibilityBasisReader(records), now }),
    sessionAnomalies: createSessionAnomalyService({ records, lookups: records, sessionFacts, now }), controls,
    archivePolicy: options.archivePolicy ?? DEFAULT_SESSION_ARCHIVE_POLICY,
    // S1-AUTO-03 / §4.1 step 7 (lead fix 2026-10-09): the SAME mailbox instance the Runtime uses, as the real
    // composition wires it (create-platform `messages: mailbox`); it reads the copy's answer facts.
    messages,
    // §4.2 (lead fix 2026-10-09): the executor due clock is read from the terminal close event through
    // link.until -> eventAt, as the real composition wires it; never from the last Run.endedAt.
    records: {
      async eventAt(cursor) {
        const at = await records.eventAt(cursor);
        return at.status === 'ready'
          ? { status: 'ready' as const, value: { cursor: at.value.cursor, event: at.value.event } }
          : { status: 'rejected' as const, code: 'unavailable' as const, reason: at.reason };
      },
    },
    sessionDuty: options.sessionDuty ?? (async role => ({ status: 'ready', value:
      role.kind === 'legacy_template' && role.templateId === 'builder' ? 'executor' : 'unknown' })),
    ...(options.attestUnknownRun === undefined ? {} : { attestUnknownRun: options.attestUnknownRun }),
    ...(options.attestUnknownQueryRun === undefined ? {} : { attestUnknownQueryRun: options.attestUnknownQueryRun }),
  };
  return createWorkflow(deps);
}
