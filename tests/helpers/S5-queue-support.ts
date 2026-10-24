/** Group 6 setup only. All commands use the same observed P/W records port. */
import { expect } from 'vitest';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import { DEFAULT_GOAL_SETTINGS_V1 } from '../../src/contracts/goal-decisions.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RoleBindingRefV1, RuntimeEventV1 } from '../../src/contracts/dispatch.js';
import type { QueryEntryIdentity } from '../../src/core/work-graph/queries/contracts.js';
import type { QueryJobAnswerV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { GoalRef, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { DEFAULT_TASK_AUTOMATION_POLICY, WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { RoundSnapshot, TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { S5RecordPort } from '../../src/core/work-graph/model/decision-contracts.js';
import type { RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { SessionMailboxDependencies } from '../../src/core/work-graph/model/communication-contracts.js';
import type { AuthorizeConfiguration } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { SESSION_MAILBOX_TOOL_NAMES, USER_DECISION_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createQueryExecution } from '../../src/core/work-graph/queries/query-execution.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { parseInitialPlanningResponseV2 } from '../../src/core/work-graph/tasks/initial-plan.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { decodeModelRequestPermitSnapshot } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { decodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { QUERY_JOB_RECORD_SCHEMAS, decodeQueryRunSnapshotRecord } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { DECISION_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/decision-record-codecs.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { createB2ExecutionFixture } from './B2-execution-fixture.js';
import { OPERATOR, PROJECT, T, WORKSPACE, WORKSPACE_SCOPE,
  type S5DecisionFixture, type S5FixtureKind } from './S5-decision-fixture.js';
import { preparationHost, prepareQueryForReal, prepareTaskForReal } from './task-claim-fixture.js';

export const key = (value: object): string => canonicalJson(value as JsonValue);
export function ready<V>(result: { status: 'ready'; value: V } | { status: 'not_found' | 'not_ready' | 'rejected' }): V {
  if (result.status !== 'ready') throw new Error(`setup read: ${JSON.stringify(result)}`);
  return result.value;
}
export function committed<V>(result: WriteResult<V>): V {
  expect(result.status).toBe('committed');
  if (result.status !== 'committed') throw new Error(`setup write: ${JSON.stringify(result)}`);
  return result.value;
}
export async function storedRecord(records: S5RecordPort, ref: object) {
  const read = ready(await records.readMany([key(ref)]));
  const record = read.records.find(candidate => candidate.refKey === key(ref));
  if (record === undefined) throw new Error(`missing setup record: ${key(ref)}`);
  return record;
}
export async function pin(records: S5RecordPort, ref: VersionPin['ref']): Promise<VersionPin> {
  return { ref, revision: (await storedRecord(records, ref)).revision };
}
export async function workspaceSnapshot(f: S5DecisionFixture): Promise<WorkspaceSnapshot> {
  const decoded = decodeWorkspaceSnapshot(await storedRecord(f.records, WORKSPACE));
  if (decoded.status !== 'decoded') throw new Error(decoded.reason);
  return decoded.value;
}
/** The read API has no provider dependency. Observe the formal Work attempt and
 * Query admission counters on its actual store, rather than an unused provider.
 * Every supported model entry records these facts before it can call a model. */
export async function modelRequestCounts(f: S5DecisionFixture) {
  const snapshot = await f.storeSnapshot();
  let workAttempts = 0;
  let queryAdmissions = 0;
  for (const saved of snapshot.records) {
    const ref: { aggregateType: string } = JSON.parse(saved.refKey);
    if (ref.aggregateType !== 'ModelRequestPermit' && ref.aggregateType !== 'QueryRun') continue;
    const record = ready(await f.records.readMany([saved.refKey])).records[0];
    if (record === undefined) throw new Error('model evidence disappeared during the read');
    if (ref.aggregateType === 'ModelRequestPermit') {
      const decoded = decodeModelRequestPermitSnapshot(record);
      if (decoded.status !== 'decoded') throw new Error(decoded.reason);
      if (decoded.value.permit.consumedByAttemptId !== null) workAttempts += 1;
    } else {
      const decoded = decodeQueryRunSnapshotRecord(record);
      if (decoded.status !== 'decoded') throw new Error(decoded.reason);
      queryAdmissions += decoded.value.run.executionState?.requests.filter(request => request.admitted).length ?? 0;
    }
  }
  return { workAttempts, queryAdmissions };
}
export function materialsFor(f: S5DecisionFixture) {
  return createMaterialService({ bodies: f.bodies, authority: createMaterialRecordReaders(f.records).authority, now: f.now });
}
export function mailboxDependencies(f: S5DecisionFixture): SessionMailboxDependencies {
  const permissions = { policyRevision: 'legacy-template', tools: ['read', ...SESSION_MAILBOX_TOOL_NAMES, ...USER_DECISION_TOOL_NAMES], writeScope: [] };
  // The world has two formal Host templates: the decision sender's RA uses
  // `platform-adviser`; the older builder Sessions/Runs keep `builder`.
  const hostTemplates = [
    { templateId: 'builder', revision: '1', digest: artifactBodyDigest('s5 trusted builder template') },
    { templateId: 'platform-adviser', revision: 's3.1', digest: artifactBodyDigest('s5 trusted platform-adviser template') },
  ];
  const authorizeConfiguration: AuthorizeConfiguration = async (ctx, input) => {
    const template = hostTemplates.find(candidate => key({ value: candidate }) === key({ value: input.hostTemplate }));
    return ctx.projectId === WORKSPACE_SCOPE.projectId && ctx.workspaceId === WORKSPACE_SCOPE.workspaceId
      && input.configurationRevision === 's5-host-config-1'
      && key(input.permissions) === key(permissions) && template !== undefined
      ? { status: 'ready', value: { configurationRevision: 's5-host-config-1', permissions, hostTemplate: template } }
      : { status: 'rejected', code: 'forbidden', reason: 'not the shared S5 mailbox grant' };
  };
  return { records: f.records, sessions: createSessionDirectory({ records: f.records, lookups: f.records }),
    executions: createRunStateReader({ records: f.records }),
    roles: createRoleConfigurationService({ records: f.records, now: f.now, eventId: f.newId }),
    materials: materialsFor(f), runtimeAdmission: { bodies: f.bodies, authorizeConfiguration },
    systemActor: OPERATOR, now: f.now, newId: f.newId,
    duties: { async readMessageDutiesFacts() { return { status: 'ready', value: {
      duties: ['adviser'], readOnlyCopy: false, independentReview: false, guards: [] } }; } } };
}
const BUILDER_ROLE_BINDING: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 's5-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
/** The queue world's work principal: the decision sender's Run keeps its own formal binding. */
export function workContext(f: S5DecisionFixture, claim: TaskClaim,
  roleBinding = canonicalJson(claim.runRef) === canonicalJson(f.runRA.ref) ? f.runRA.roleBinding : BUILDER_ROLE_BINDING): CoreCallContext {
  return { ...f.ctx, principal: { kind: 'work_run', runRef: claim.runRef, roleBinding },
    materialReader: { kind: 'run', requester: claim.runRef } };
}
export function automationContext(f: S5DecisionFixture): CoreCallContext {
  return { ...f.ctx, principal: { kind: 'host', actor: WORKFLOW_AUTOMATION_ACTOR },
    materialReader: { kind: 'host', ...WORKSPACE_SCOPE, actor: WORKFLOW_AUTOMATION_ACTOR } };
}

/** The result writer needs the saved entry, not a caller-invented ended Run. */
export async function endRun(f: S5DecisionFixture, claim: TaskClaim,
  terminal: Pick<RuntimeEventV1, 'eventType' | 'payload'>) {
  const reads = createRunStateReader({ records: f.records });
  const current = ready(await reads.readExecution(f.ctx, claim.runRef));
  const authorization = current.run.executionAuthorization;
  const history = current.run.executionHistory;
  if (authorization === undefined || !('schemaVersion' in authorization) || authorization.schemaVersion !== 2
    || authorization.phase !== 'entered' || history === undefined || history === null) throw new Error('Run must be entered');
  const roles = createRoleConfigurationService({ records: f.records, now: f.now, eventId: f.newId });
  const entry = createExecutionEntryService({ records: f.records, reads, roles, bodies: f.bodies,
    // recordRunResult checks the frozen authorization; it does not authorize a new entry.
    authorizeConfiguration: async () => ({ status: 'rejected', code: 'forbidden', reason: 'result-only setup' }),
    now: f.now, eventId: f.newId, newId: f.newId });
  const position = history.observedThroughPosition + 1;
  const source = { ...history.kernel, position };
  return committed(await entry.recordRunResult(f.ctx, { input: { claim,
    entry: { consumerId: authorization.consumerId, entryGeneration: authorization.generation },
    event: { schemaVersion: 1, eventId: f.newId(), runRef: claim.runRef,
      sequence: current.run.lastEventSeq + 1, occurredAt: T, ...terminal },
    kernelSource: source, completedHistoryBoundary: { source, cursor: `s5-end-${claim.runRef.runId}` },
    history: { ...history, observedThroughPosition: position, endPosition: position } },
    meta: { requestId: f.newId(), expected: [{ ref: claim.runRef, revision: current.run.revision }] } }));
}

/** B stays RUNNING via RA; RB's exhausted budget supplies a concrete decision cause. */
export async function exhaustSecondRun(f: S5DecisionFixture) {
  await f.enterClaim(f.claimRB);
  const run = await endRun(f, f.claimRB, { eventType: 'run_budget_exhausted',
    payload: { kind: 'budget_exhausted', exhaustedAt: T } });
  expect(run).toMatchObject({ status: 'ended', outcome: 'budget_exhausted' });
  return run;
}

export const PLANNING_GOAL: GoalRef = { aggregateType: 'Goal', projectId: 'P', goalId: 'D' };

/** D has no Plan or proposal: initial_coordination is admitted only in that
 * state. Its real Query goes pending -> claimed -> prepared -> entered -> answered.
 * Do not use the shared seedQueryJob helper here: its caller pins belong to B@7. */
export async function answeredPlanningQuestion(f: S5DecisionFixture) {
  const goals = createGoalService({ records: f.records, now: f.now, eventId: f.newId }).tasks;
  const goal = committed(await goals.createGoal(f.ctx, { input: { goalId: PLANNING_GOAL.goalId, workspace: WORKSPACE_SCOPE,
    objective: 'Choose the acceptance tradeoff before planning D' }, meta: { requestId: 's5-planning-goal',
      expected: [await pin(f.records, PROJECT), await pin(f.records, WORKSPACE)] } }));
  expect(goal).toMatchObject({ ref: PLANNING_GOAL, revision: 1, desiredState: 'active', activePlanRevision: null });
  expect(goal.settings ?? DEFAULT_GOAL_SETTINGS_V1).toEqual({ schemaVersion: 1, autonomy: 'after_plan_confirmation',
    order: 0, waitForGoalRef: null, parallelRisks: [] });
  const roles = createRoleConfigurationService({ records: f.records, now: f.now, eventId: f.newId });
  const roleBinding = BUILDER_ROLE_BINDING;
  const budget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
    maxRequests: 4, maxToolCalls: 8, timeoutMs: null, perResponseTokens: 512 };
  const host = { configurationRevision: 's5-planning-host-1', permissions: { tools: ['read'], writeScope: [] as [] },
    hostTemplate: { templateId: 'builder', revision: '1', digest: sha256Hex('S5 planning instructions') }, budget };
  const execution = createQueryExecution({ records: f.records, roles, bodies: f.bodies,
    authorizeConfiguration: async () => ({ status: 'ready', value: host }), now: f.now, eventId: f.newId });
  const jobs = createQueryJobService({ records: f.records, execution, now: f.now, eventId: f.newId });
  const jobRef: QueryJobRef = { ...WORKSPACE_SCOPE, aggregateType: 'QueryJob', queryJobId: 'Q-planning' };
  const runRef: QueryRunRef = { ...WORKSPACE_SCOPE, aggregateType: 'QueryRun', queryJobId: jobRef.queryJobId, runId: 'Q-planning-run' };
  const submitted = committed(await jobs.submitQueryJob(f.ctx, { input: { queryJobId: jobRef.queryJobId, runId: runRef.runId,
    intent: { schemaVersion: 1, intentId: 'Q-planning', ...WORKSPACE_SCOPE, goalId: PLANNING_GOAL.goalId,
      question: 'Which acceptance tradeoff should this plan use?', focusTaskRefs: [],
      budget: { maxTokens: null, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: 's5-planning',
      execution: { kind: 'initial_coordination', roleBinding, runtimeBudget: budget } } },
    meta: { requestId: 's5-planning-submit', expected: [await pin(f.records, PROJECT), await pin(f.records, WORKSPACE),
      { ref: PLANNING_GOAL, revision: goal.revision }, { ref: jobRef, revision: 0 }, { ref: runRef, revision: 0 }] } }));
  const job = submitted.job;
  expect(job).toMatchObject({ ref: jobRef, revision: 1, job: { goalId: 'D', status: 'pending' } });
  expect(submitted.run).toMatchObject({ ref: runRef, revision: 1, run: { status: 'pending' } });
  const session = await f.createS5Session('s5-planning');
  let record = committed(await jobs.claimQuery(f.ctx, { input: { queryRunRef: runRef, sessionRef: session },
    meta: { requestId: 's5-planning-claim', expected: [{ ref: job.ref, revision: 1 }, { ref: runRef, revision: 1 },
      await pin(f.records, plainSessionRefToAggregate(session))] } }));
  const facts = ready(await execution.readPreparationFacts(f.ctx, runRef));
  expect(facts.goal).toMatchObject({ ref: PLANNING_GOAL, revision: 1, activePlanRevision: null });
  expect(facts.focusPlan).toBeNull();
  const prepared = (await prepareQueryForReal(f, {
    bodies: f.bodies, queryRunRef: runRef, queryExecution: execution, now: f.now,
    requestId: 's5-planning-prepare',
    host: preparationHost({ configurationRevision: host.configurationRevision, permissions: host.permissions,
      hostTemplate: host.hostTemplate, budget }),
  })).prepared;
  const preparedState = ready(await execution.readQueryExecution(f.ctx, runRef));
  const kernel = { adapterId: preparedState.session.kernel.adapterId,
    kernelSessionId: preparedState.session.kernel.kernelSessionId,
    runId: 's5-planning-kernel-run', turnId: 's5-planning-turn' };
  const ticket = committed(await execution.beginQueryEntry(f.ctx, { input: { prepared, consumerId: 's5-planning-consumer', kernel },
    meta: { requestId: 's5-planning-begin', expected: [{ ref: job.ref, revision: preparedState.job.revision },
      { ref: runRef, revision: preparedState.run.revision },
      { ref: preparedState.session.ref, revision: preparedState.session.revision }] } }));
  const entry: QueryEntryIdentity = { queryRunRef: runRef, sessionRef: ticket.sessionRef,
    sessionGeneration: ticket.sessionGeneration, entryGeneration: 1, consumerId: ticket.consumerId, kernel: ticket.kernel };
  record = committed(await execution.recordQueryObservation(f.ctx, { input: { entry,
    history: { schemaVersion: 1, sessionRef: ticket.sessionRef, kernel: ticket.kernel, startPosition: 1, observedThroughPosition: 2, endPosition: null },
    source: { position: 2, cursor: 's5-planning-entered' }, observation: { kind: 'entered', occurredAt: T } },
    meta: { requestId: 's5-planning-entered', expected: [await pin(f.records, runRef)] } }));
  const answerText = JSON.stringify({ schemaVersion: 2, kind: 'needs_decision', summary: 'An acceptance choice remains.',
    questions: ['Should acceptance prioritize latency or throughput?'] });
  const answerBody = ready(await f.bodies.put({ body: answerText, contentType: 'text/plain; charset=utf-8',
    sourceRefs: [{ kind: 'workspace', refId: 'W', revision: String(facts.workspace.revision) }],
    origin: { kind: 'run', owner: runRef }, requestedAt: T }));
  const answer: QueryJobAnswerV1 = { schemaVersion: 1, answerId: 's5-planning-answer', queryJobRef: job.ref,
    runRef, roundIndex: 0, answer: answerText, sources: [], followsAnswerRef: null, stale: false,
    staleReason: null, answeredAt: T, bodyRef: answerBody.ref, ideas: [], goalCardDrafts: [] };
  record = committed(await execution.recordQueryObservation(f.ctx, { input: { entry,
    history: { schemaVersion: 1, sessionRef: ticket.sessionRef, kernel: ticket.kernel, startPosition: 1, observedThroughPosition: 3, endPosition: 3 },
    source: { position: 3, cursor: 's5-planning-answered' },
    observation: { kind: 'terminal', occurredAt: T, outcome: 'answered', answer, reason: null } },
    meta: { requestId: 's5-planning-answered', expected: [{ ref: runRef, revision: record.run.revision }] } }));
  expect(record.job.job.status).toBe('answered');
  expect(record.session.occupancy).toBeNull();
  if (record.answer === null) throw new Error('missing formal planning answer');
  const plans = createPlanService({ records: f.records, materials: materialsFor(f), initialPlanning: { bodies: f.bodies }, now: f.now, eventId: f.newId });
  if (plans.readInitialPlanAnswerFacts === undefined) throw new Error('missing formal answer reader');
  const saved = ready(await plans.readInitialPlanAnswerFacts(f.ctx, record.answer.ref));
  expect(saved.answerText).toBe(answerText);
  expect(saved.job.job.goalId).toBe('D');
  expect(parseInitialPlanningResponseV2(saved.answerText)).toEqual({ status: 'parsed', response: {
    schemaVersion: 2, kind: 'needs_decision', summary: 'An acceptance choice remains.',
    questions: ['Should acceptance prioritize latency or throughput?'] } });
  if (plans.queryGoalDisplay === undefined) throw new Error('missing Goal display entry');
  expect(ready(await plans.queryGoalDisplay(f.ctx, { goalRef: PLANNING_GOAL })).display)
    .toMatchObject({ phase: 'PLANNING', causes: [] });
  return record.answer.ref;
}

/** DQ03 starts before adoption. The B2 world's independent scope is left alone. */
export async function openUninitializedQueue(kind: S5FixtureKind) {
  const bundles = [QUERY_JOB_RECORD_SCHEMAS, SESSION_MESSAGE_RECORD_SCHEMAS, DECISION_RECORD_SCHEMAS,
    COMPLETION_RECORD_SCHEMAS, EVIDENCE_RECORD_SCHEMAS, ARCHITECTURE_CATALOG_SCHEMAS,
    { records: [], events: PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events }];
  const b2 = await createB2ExecutionFixture(kind, { records: bundles.flatMap(b => [...b.records]),
    events: bundles.flatMap(b => [...b.events]), lookups: bundles.flatMap(b => [...(b.lookups ?? [])]) });
  // Slice 2A P8: the uninitialized queue's real records port also carries the
  // separate ordered lookup the notice sources read through.
  const records = b2.base.records as S5RecordPort & RecordOrderedLookupPort;
  const ctx: CoreCallContext = { ...b2.base.ctx, ...WORKSPACE_SCOPE, principal: { kind: 'host', actor: OPERATOR },
    materialReader: { kind: 'host', ...WORKSPACE_SCOPE, actor: OPERATOR } };
  const bootstrap = createProjectBootstrapServices({ records, now: () => T, eventId: () => 'dq03-event' });
  committed(await bootstrap.projects.createProject(ctx, { input: { projectId: PROJECT.projectId },
    meta: { requestId: 'dq03-project', expected: [{ ref: PROJECT, revision: 0 }] } }));
  committed(await bootstrap.projects.registerWorkspace(ctx, { input: { workspace: WORKSPACE_SCOPE },
    meta: { requestId: 'dq03-workspace', expected: [
      { ref: PROJECT, revision: 1 }, { ref: WORKSPACE, revision: 0 }] } }));
  const goals = createGoalService({ records, now: () => T, eventId: () => 'dq03-goal-created' }).tasks;
  committed(await goals.createGoal(ctx, { input: { goalId: 'B', workspace: WORKSPACE_SCOPE,
    objective: 'Choose the initial architecture' }, meta: { requestId: 'dq03-create', expected: [
      { ref: PROJECT, revision: 1 }, { ref: WORKSPACE, revision: 1 }] } }));
  return { records, ctx, plans: createPlanService({ records, now: () => T, eventId: () => 'dq03-event' }), close: () => b2.close() };
}

/** Build an independent static-check Plan through propose/apply, then use real
 * claim/entry/result and requeue/reverify owners. A/B/C remain their frozen plans.
 * The governance checkpoint is installed and activated by the public bootstrap
 * owners; immutable policy content is never overwritten. */
export async function noticeWork(f: S5DecisionFixture) {
  const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: 'P' };
  const previous = await storedRecord(f.records, activeRef);
  const bootstrap = createProjectBootstrapServices({ records: f.records, now: f.now, eventId: f.newId });
  const policyRef = { aggregateType: 'CompletionPolicyRevision', projectId: 'P',
    policyId: 's5-notice-static', revision: 1 } as const;
  const installed = committed(await bootstrap.completionPolicies.installCompletionPolicy(f.ctx, {
    input: { policyId: 's5-notice-static', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } },
    meta: { requestId: 'nr-install-policy', expected: [{ ref: PROJECT, revision: 1 }, { ref: policyRef, revision: 0 }] },
  }));
  const activatedPolicy = committed(await bootstrap.completionPolicies.activateCompletionPolicy(f.ctx, {
    input: { target: { ref: installed.ref, digest: installed.contentDigest } },
    meta: { requestId: 'nr-activate-policy', expected: [{ ref: PROJECT, revision: 1 },
      { ref: activeRef, revision: previous.revision }] },
  }));
  expect(activatedPolicy.activeRevision).toEqual(policyRef);
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: 'P', goalId: 'NR' };
  const goals = createGoalService({ records: f.records, now: f.now, eventId: f.newId }).tasks;
  const goal = committed(await goals.createGoal(f.ctx, { input: { goalId: 'NR', workspace: WORKSPACE_SCOPE,
    objective: 'Notice history with registered static checks' }, meta: { requestId: 'nr-goal', expected: [
      { ref: PROJECT, revision: 1 }, await pin(f.records, WORKSPACE)] } }));
  const tasks = ['system', 'agent', 'human', 'round', 'controller'];
  const draft: PlanRevisionDraft = { schemaVersion: 2, planId: 'PNR1', planRevision: 1, goalId: 'NR', stages: [],
    tasks: [...tasks.map(taskId => ({ taskId, title: `NR ${taskId}`, taskKind: 'work' as const,
      requirementLevel: 'required' as const, disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'goal' as const } })),
      { taskId: 'gate', title: 'NR gate', taskKind: 'gate', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
    assignments: tasks.map(taskId => ({ taskId, role: 'builder', instruction: `Perform ${taskId}` })),
    obligations: [{ obligationId: 'nr-obligation', title: 'Static acceptance', requirementLevel: 'required', taskIds: [...tasks, 'gate'],
      verificationRequirements: [{ requirementId: 'nr-check', kind: 'static', requirementLevel: 'required', description: 'Registered check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] };
  const plans = createPlanService({ records: f.records, now: f.now, eventId: f.newId });
  const proposal = committed(await plans.proposePlan(f.ctx, { input: { goalRef, basedOn: null, draft,
    reason: { text: 'Notice preconditions', sources: [] } }, meta: { requestId: 'nr-propose', expected: [{ ref: goalRef, revision: goal.revision }] } }));
  expect(proposal.issues).toEqual([]);
  const plan = committed(await plans.applyPlanChange(f.ctx, { input: { proposalRef: proposal.ref,
    expectedProposalRevision: proposal.revision, decisionRefs: [] }, meta: { requestId: 'nr-adopt', expected: [{ ref: goalRef, revision: goal.revision }] } }));
  const reads = createRunStateReader({ records: f.records });
  const roles = createRoleConfigurationService({ records: f.records, now: f.now, eventId: f.newId });
  const materials = materialsFor(f);
  const mailbox = createSessionMailbox(mailboxDependencies(f));
  const workspaceHost = {
    async resolveRoot() { return { status: 'ready' as const, value: { root: f.base.directory, workspaceRevision: (await workspaceSnapshot(f)).revision } }; },
    async authorize() { return { status: 'ready' as const, value: { subjectKey: 's5-notice-host', permissionRevision: 's5-notice-permission', allowsRead: () => true } }; },
  };
  const grant = { policyRevision: 'legacy-template', tools: ['read', 'requeue_task'], writeScope: [] as string[] };
  const template = { templateId: 'builder', revision: '1', digest: sha256Hex('S5 notice controller') };
  const authorizeConfiguration: AuthorizeConfiguration = async (_ctx, input) => input.configurationRevision === 's5-notice-controller'
    && key(input.permissions) === key(grant) && key({ value: input.hostTemplate }) === key({ value: template })
    ? { status: 'ready', value: { configurationRevision: 's5-notice-controller', permissions: grant, hostTemplate: template } }
    : { status: 'rejected', code: 'forbidden', reason: 'not the notice controller grant' };
  const entry = createExecutionEntryService({ records: f.records, reads, roles, bodies: f.bodies,
    authorizeConfiguration, now: f.now, eventId: f.newId, newId: f.newId });
  const start = async (taskId: string) => {
    const sessionRef = await f.createS5Session(`nr-${taskId}`);
    const claim = await f.claimRun({ requestId: `nr-claim-${taskId}`, goalRef, planRef: plan.ref, taskId, sessionRef });
    if (taskId !== 'controller') { await f.enterClaim(claim); return claim; }
    const current = ready(await reads.readExecution(f.ctx, claim.runRef));
    const prepared = (await prepareTaskForReal(f, {
      bodies: f.bodies, runRef: claim.runRef, now: f.now, requestId: f.newId(),
      host: preparationHost({ configurationRevision: 's5-notice-controller', permissions: grant, hostTemplate: template }),
    })).prepared;
    const permit = committed(await entry.authorizeRuntimeEntry(f.ctx, { input: { prepared, consumerId: 'nr-controller' },
      meta: { requestId: f.newId(), expected: [await pin(f.records, claim.runRef)] } }));
    const kernel = { adapterId: current.session.kernel.adapterId, kernelSessionId: current.session.kernel.kernelSessionId,
      runId: 'nr-controller-run', turnId: 'nr-controller-turn' };
    const begun = committed(await entry.beginRuntimeEntry(f.ctx, { input: { permit, kernel },
      meta: { requestId: f.newId(), expected: [await pin(f.records, claim.runRef)] } }));
    committed(await entry.recordExecutionEntered(f.ctx, { input: { permit: { ...permit, authorizationRevision: begun.authorization.revision },
      enteredAt: T, kernelSource: { ...kernel, position: 3 }, history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null } },
      meta: { requestId: f.newId(), expected: [await pin(f.records, claim.runRef)] } }));
    return claim;
  };
  const automationPolicy = { current: { ...DEFAULT_TASK_AUTOMATION_POLICY } };
  const source = { revision: 1 };
  const requeues = () => createTaskRequeueService({ records: f.records,
    reads, materials, messages: mailbox, workspaceHost, source: { async captureDigest() { return { status: 'ready', sourceDigest: sha256Hex(`nr-source-${source.revision}`) }; } },
    delegatedWrites: { reads, roles, bodies: f.bodies, authorizeConfiguration }, automationPolicy: () => automationPolicy.current,
    now: f.now, eventId: f.newId });
  const requeue = async (taskId: string, actor: CoreCallContext) => {
    const claim = await start(taskId);
    const ended = await endRun(f, claim, { eventType: 'run_crashed', payload: { kind: 'crashed', error: 'recorded fixture failure' } });
    const value = committed(await requeues().requeueTask(actor, { input: { taskRef: claim.task, afterRunRef: claim.runRef, reason: 'Retry failed work' },
      meta: { requestId: f.newId(), expected: [await pin(f.records, goalRef), { ref: claim.runRef, revision: ended.revision }] } }));
    if (value.kind !== 'requeued') throw new Error(`requeue refused: ${JSON.stringify(value)}`);
    return value.requeue;
  };
  const configuration: TrustedCheckConfiguration = { configurationRevision: 's5-notice-checks', workspace: WORKSPACE,
    executor: OPERATOR, permissionRevision: 's5-notice-permission', sourceAccess: 'verification_workspace', processAccess: 'all_except_denied',
    deniedPrefixes: [], checks: [{ checkId: 'static', kind: 'static', command: 'fixture-check', cwd: '.', timeoutMs: 1000, taskIds: 'all' }] };
  let roundId = 0;
  const evidence = createEvidenceService({ records: f.records, executions: reads, materials, workspaceHost, configuration,
    automationPolicy: () => automationPolicy.current,
    source: { async capture() { return { status: 'ready', sourceDigest: sha256Hex(`nr-source-${source.revision}`),
      sourceProof: { kind: 'current-workspace-only', runBaselineKnown: false },
      changeScope: { diffClass: 'code-change', changedFiles: ['src/m/a.ts'], writeSummary: `source ${source.revision}` }, gaps: [] }; } },
    now: f.now, newId: () => `nr-round-id-${++roundId}` });
  const finish = async (round: RoundSnapshot) => {
    // Finalize pending checks -> INCONCLUSIVE. This is a real, non-exempt close
    // at revision 2; the source changes before each automatic successor.
    const result = committed(await evidence.finalizeChecks(f.ctx, { input: { roundRef: round.ref },
      meta: { requestId: f.newId(), expected: [{ ref: round.ref, revision: round.revision }] } }));
    expect(result.snapshot).toMatchObject({ revision: 2, status: 'finalized', outcome: 'INCONCLUSIVE' });
    return result.snapshot;
  };
  const rounds = async (successors: number) => {
    const claim = await start('round');
    await f.settleRun(claim);
    let current = committed(await evidence.openVerification(f.ctx, { input: { subjectRunRef: claim.runRef, subject: claim.task, planRef: plan.ref },
      meta: { requestId: f.newId(), expected: [] } }));
    const history: RoundSnapshot[] = [];
    if (evidence.reverifyRound === undefined) throw new Error('missing reverify owner');
    for (let n = 1; n <= successors; n += 1) {
      current = await finish(current); history.push(current); source.revision += 1;
      const result = committed(await evidence.reverifyRound(automationContext(f), { input: { predecessorRoundRef: current.ref },
        meta: { requestId: f.newId(), expected: [{ ref: current.ref, revision: current.revision }] } }));
      if (result.kind !== 'reverified') throw new Error(`reverify refused: ${JSON.stringify(result)}`);
      current = result.round;
      expect(current.chain).toMatchObject({ ordinal: n + 1, autoCount: n, predecessorRevision: 2 });
      expect(current.chain?.basisDigests).toHaveLength(n);
    }
    history.push(current);
    return { claim, history, head: current };
  };
  return { goalRef, plan, plans, start, requeue, rounds, evidence, automationPolicy };
}
