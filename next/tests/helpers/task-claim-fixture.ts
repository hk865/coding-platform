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
  EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas, RecordGuard, StoreCommitReceipt,
} from '../../src/core/record-store/ports.js';
import type { LookupValue, RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { canonicalRefKey, encodeProjectSnapshot, encodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS, PLAN_STATE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { SESSION_RECORD_SCHEMAS, encodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { ROLE_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/role-record-codecs.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';
import { TASK_CLAIM_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import { EXECUTION_HISTORY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-history-codecs.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import type { RoleConfigurationPort } from '../../src/core/work-graph/configuration/contracts.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import type { ClaimTaskInput, TaskClaimPort } from '../../src/core/work-graph/tasks/claim-contracts.js';
import type { GoalTaskPort, GraphWrite } from '../../src/core/work-graph/tasks/contracts.js';
import type { PlanTaskPort } from '../../src/core/work-graph/tasks/plan-contracts.js';
import type { SessionDirectoryPort } from '../../src/core/work-graph/sessions/contracts.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';

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
 * and one goal gate. Governance is a trusted fixture seed. */
export async function createTaskClaimFixture(kind: ClaimFixtureKind): Promise<TaskClaimFixture> {
  const directory = await mkdtemp(join(tmpdir(), `next-r4c-claim-${kind}-`));
  const ledgerPath = join(directory, 'ledger.sqlite');
  const materials = materialRecordSchemas();
  const schemas: RecordBackendSchemas = {
    records: [...materials.records, ...PLAN_RECORD_SCHEMAS.records, ...PLAN_STATE_RECORD_SCHEMAS.records,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records,
      ...ROLE_RECORD_SCHEMAS.records, ...TASK_CLAIM_RECORD_SCHEMAS.records],
    events: [...materials.events, ...PLAN_RECORD_SCHEMAS.events, ...PLAN_STATE_RECORD_SCHEMAS.events,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events,
      ...ROLE_RECORD_SCHEMAS.events, ...TASK_CLAIM_RECORD_SCHEMAS.events, ...EXECUTION_HISTORY_RECORD_SCHEMAS.events,
      { eventType: 'TrustedScopeSeeded', schemaVersion: 1,
        validate: event => ({ status: 'decoded', value: event }) }],
    lookups: [...(materials.lookups ?? []), ...(PLAN_RECORD_SCHEMAS.lookups ?? []),
      ...(PLAN_STATE_RECORD_SCHEMAS.lookups ?? []), ...(PLAN_GOVERNANCE_RECORD_SCHEMAS.lookups ?? []),
      ...(SESSION_RECORD_SCHEMAS.lookups ?? []), ...(ROLE_RECORD_SCHEMAS.lookups ?? []),
      ...(TASK_CLAIM_RECORD_SCHEMAS.lookups ?? [])],
  };
  const backend = kind === 'memory'
    ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path: ledgerPath, schemas });

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

  // ---- trusted scope + governance seed (Project/Workspace/policy/baseline) --
  const policyFixture = { schemaVersion: 1, identity: { policyId: 'r4c-claim-policy' }, revision: 1,
    content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } };
  const architectureFixture = { schemaVersion: 1, identity: { baselineId: 'r4c-claim-baseline' }, revision: 1,
    content: { schemaVersion: 1, description: 'R4c claim fixture baseline', constraints: [] } };
  const digest = (value: JsonValue) => sha256Hex(canonicalJson(value));
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId,
    policyId: 'r4c-claim-policy', revision: 1 };
  const architectureRef = { aggregateType: 'ArchitectureBaselineRevision' as const, projectId,
    baselineId: 'r4c-claim-baseline', revision: 1 };
  const governance = [
    { ref: policyRef, revision: 1, schemaVersion: 1, policyId: policyRef.policyId, contentRevision: 1,
      contentDigest: digest(policyFixture), content: policyFixture.content },
    { ref: architectureRef, revision: 1, schemaVersion: 1, baselineId: architectureRef.baselineId,
      contentRevision: 1, contentDigest: digest(architectureFixture), content: architectureFixture.content },
    { ref: { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId }, projectId,
      revision: 1, activeRevision: policyRef },
    { ref: { aggregateType: 'ProjectArchitectureBaselineActive' as const, projectId }, projectId,
      revision: 1, activeRevision: architectureRef },
  ];
  const encodeGovernance = (snapshot: (typeof governance)[number]): EncodedRecord => ({
    refKey: canonicalJson(snapshot.ref as unknown as JsonValue),
    schemaId: `${snapshot.ref.aggregateType}Snapshot@1`, revision: snapshot.revision, json: JSON.stringify(snapshot),
  });
  const project: ProjectSnapshot = { ref: projectRef, revision: 1 };
  const workspace: WorkspaceSnapshot = { ref: workspaceRef, revision: 1 };
  const scopeEvent = { eventId: 'r4c-claim-scope-event', eventType: 'TrustedScopeSeeded', schemaVersion: 1,
    occurredAt: AT, json: JSON.stringify({ eventId: 'r4c-claim-scope-event', eventType: 'TrustedScopeSeeded',
      schemaVersion: 1, occurredAt: AT }) };
  const scopeSeed: PreparedCommit = { identityKey: 'r4c-claim-scope-seed', fingerprint: 'r4c-claim-scope-seed-v1',
    guards: [{ refKey: canonicalRefKey(projectRef), expectedRevision: null },
      { refKey: canonicalRefKey(workspaceRef), expectedRevision: null },
      ...governance.map(snapshot => ({ refKey: canonicalJson(snapshot.ref as unknown as JsonValue), expectedRevision: null }))],
    records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace), ...governance.map(encodeGovernance)],
    events: [scopeEvent], claims: [], indexGuards: [], indexChanges: [] };
  const seededScope = await backend.records.commit(scopeSeed);
  if (seededScope.status !== 'committed') throw new Error(`fixture scope seed failed: ${seededScope.reason}`);

  // ---- real services over the real backends ---------------------------------
  let eventSeq = 0;
  const eventId = () => `r4c-claim-event-${++eventSeq}`;
  let seedSeq = 0;
  let requestSeq = 0;
  let idSeq = 0;
  const now = () => AT;
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

  async function commitRaw(recordsToWrite: readonly EncodedRecord[],
    guards: readonly RecordGuard[] = []): Promise<StoreCommitReceipt> {
    const sequence = ++seedSeq;
    const event = { eventId: `r4c-claim-seed-event-${sequence}`, eventType: 'TrustedScopeSeeded', schemaVersion: 1,
      occurredAt: AT, json: JSON.stringify({ eventId: `r4c-claim-seed-event-${sequence}`,
        eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: AT }) };
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
  return fixture;
}
