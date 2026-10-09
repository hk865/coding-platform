/**
 * Slice 5 SPEC sections 0, 2.2/2.8, 3.3 and 5.3: SS01..SS16 on both stores.
 * Production owners construct every answer, settings change, control and claim.
 * The local bootstrap adds a real catalog and can pause B at exactly revision 7.
 * Part 1 stops at the first named slice-5 stub; no Node/tests run during repair.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { SessionRef, VersionPin } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { PreparedTaskExecution, PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import type {
  DecisionSelectionV1, DecisionSourceV1, GoalAutonomyV1, GoalDecisionBasisV1, GoalParallelRiskV1,
} from '../../src/contracts/goal-decisions.js';
import type { GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, RuntimeTask } from '../../src/contracts/plan.js';
import type { RoleSpecResolutionV1 } from '../../src/contracts/role-spec-materials.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createDecisionMessageService } from '../../src/core/work-graph/communication/decision-service.js';
import { createDecisionSourceFacts } from '../../src/core/work-graph/communication/decision-source-facts.js';
import { createMessageWriteOwner, createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { SessionMailboxDependencies, SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { GoalConflictReadV1, GoalSettingsPort } from '../../src/core/work-graph/model/decision-contracts.js';
import type { AuthorizeConfiguration } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { decodeGoalSettingsChangedEvent } from '../../src/core/work-graph/persistence/decision-record-codecs.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { decodeSessionMessageRecord } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createExecutedFilesStub } from '../../src/core/work-graph/tasks/executed-files-stub.js';
import { createExecutionEntryService, MANIFEST_CONTENT_TYPE } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { setGoalControlFromHost } from '../../src/core/work-graph/tasks/goal-control.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createDecisionReadModel } from '../../src/core/work-graph/views/decision-read-model.js';
import { createGoalConflictAssembler } from '../../src/core/work-graph/views/goal-conflicts.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';
import { createNoticePositionComparator } from '../../src/core/work-graph/views/notice-position.js';
import {
  GOAL_A, GOAL_B, GOAL_C, GOAL_ORDER, GOAL_REVISION, MODULE_M, PLAN_A1, PLAN_A2, PLAN_B1, PLAN_B2,
  T, WORKSPACE, WORKSPACE_REVISION, WORKSPACE_SCOPE, conflictSourceOf, goalBasisOf,
  type S5DecisionFixture, type S5Records, type S5StoreSnapshot,
} from '../helpers/S5-decision-fixture.js';
import { openS5GoalSettingsFixture } from '../helpers/S5-goal-settings-support.js';

type Kind = 'memory' | 'sqlite';
type Ctx = { kind: Kind; f: S5DecisionFixture; service: GoalSettingsPort };
type SetReq = Parameters<GoalSettingsPort['setGoalSettings']>[1];
type ReorderReq = Parameters<GoalSettingsPort['reorderGoals']>[1];
type ResolveReq = Parameters<GoalSettingsPort['resolveGoalConflict']>[1];
type ConflictSelection = Extract<DecisionSelectionV1, { kind: 'conflict_wait' | 'conflict_order' | 'conflict_parallel' }>;
type AnsweredConflict = { source: DecisionSourceV1; message: SessionMessage; selection: ConflictSelection };
const PARALLEL: ConflictSelection = { kind: 'conflict_parallel', earlier: GOAL_A, later: GOAL_B };
const RISK: GoalParallelRiskV1 = { otherGoalRef: GOAL_A, selfPlanRef: PLAN_B1, otherPlanRef: PLAN_A1 };
const fixtures: S5DecisionFixture[] = [];
beforeEach(() => {
  // SessionDirectory/catalog have no injected clock. Freeze Date only; leave
  // real timers and the claim's explicit commit barrier alone.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T);
});
afterEach(async () => {
  try { for (const f of fixtures.splice(0)) await f.close(); }
  finally { vi.useRealTimers(); }
});

const pin = (ref: VersionPin['ref'], revision: number): VersionPin => ({ ref, revision });
const GB = (revision = GOAL_REVISION): VersionPin => pin(GOAL_B, revision);
const GA = (revision = GOAL_REVISION): VersionPin => pin(GOAL_A, revision);
const GC = (revision = GOAL_REVISION): VersionPin => pin(GOAL_C, revision);
const W = pin(WORKSPACE, WORKSPACE_REVISION);
const phase = (goalId: string): VersionPin => pin({ aggregateType: 'GoalPhase', projectId: 'P', goalId }, 0);
const modelPermits = (snapshot: S5StoreSnapshot) => snapshot.records.filter(record =>
  JSON.parse(record.refKey).aggregateType === 'ModelRequestPermit');

function settings(f: S5DecisionFixture, records: S5Records = f.records): GoalSettingsPort {
  return createGoalSettingsService({ records, now: f.now, newId: f.newId, operatorActor: f.operatorActor });
}
async function open(kind: Kind, pausedB: boolean): Promise<Ctx> {
  const f = await openS5GoalSettingsFixture(kind, pausedB);
  fixtures.push(f);
  return { kind, f, service: settings(f) };
}
function plans(x: Ctx) {
  return createPlanService({ records: x.f.records, now: x.f.now, eventId: x.f.newId });
}
async function goal(x: Ctx, ref: GoalRef): Promise<GoalSnapshot> {
  const read = await plans(x).queryGoal(x.f.ctx, ref);
  if (read.status !== 'ready') throw new Error(`S5 goal read: ${JSON.stringify(read)}`);
  return read.value.goal;
}
async function execution(x: Ctx, claim: TaskClaim) {
  const read = await createRunStateReader({ records: x.f.records }).readExecution(x.f.ctx, claim.runRef);
  if (read.status !== 'ready') throw new Error(`S5 execution read: ${JSON.stringify(read)}`);
  return read.value;
}
async function run(x: Ctx, claim: TaskClaim): Promise<RunSnapshot> { return (await execution(x, claim)).run; }
async function executionOf(x: Ctx, taskId: string) {
  const graph = await plans(x).queryTaskGraph(x.f.ctx, { goalRef: GOAL_B });
  if (graph.status !== 'ready') throw new Error(`S5 task graph: ${JSON.stringify(graph)}`);
  const task = graph.value.tasks.find(row => row.ref.taskId === taskId);
  if (task === undefined) throw new Error(`S5 missing task ${taskId}`);
  return task.execution;
}
async function messageRecord(x: Ctx, ref: SessionMessageRef): Promise<SessionMessage> {
  const read = await x.f.records.readMany([canonicalJson(ref)]);
  if (read.status !== 'ready') throw new Error(`S5 message read: ${JSON.stringify(read)}`);
  const record = read.value.records.find(candidate => candidate.refKey === canonicalJson(ref));
  if (record === undefined) throw new Error('S5 message record is absent');
  const decoded = decodeSessionMessageRecord(record);
  if (decoded.status !== 'decoded') throw new Error(`S5 message decode: ${decoded.reason}`);
  return decoded.value;
}
async function settingsEvent(x: Ctx, cursor: CommitCursor) {
  const at = await x.f.records.eventAt(cursor);
  if (at.status !== 'ready') throw new Error(`S5 eventAt: ${JSON.stringify(at)}`);
  expect(at.value.event.eventType).toBe('GoalSettingsChanged');
  const decoded = decodeGoalSettingsChangedEvent(at.value.event);
  if (decoded.status !== 'decoded') throw new Error(`S5 settings event decode: ${decoded.reason}`);
  const receipt = await x.f.records.lookupCommit({ identityKey: decoded.value.identityKey, fingerprint: decoded.value.fingerprint });
  expect(receipt).toMatchObject({ status: 'ready', value: { cursor, eventIds: [at.value.event.eventId] } });
  return decoded.value;
}
async function singleSettingsCommit(x: Ctx, before: S5StoreSnapshot, cursor: CommitCursor, value: GoalSnapshot | { goals: GoalSnapshot[] }) {
  const after = await x.f.storeSnapshot();
  expect(after.eventCount - before.eventCount).toBe(1);
  expect(after.lastCursor).toBe(cursor);
  expect(after.claims).toEqual(before.claims);
  const event = await settingsEvent(x, cursor);
  expect(event.payload.value).toEqual(value);
  return event;
}
async function control(x: Ctx, ref: GoalRef, revision: number, action: 'pause' | 'resume' | 'cancel', requestId: string) {
  const result = await setGoalControlFromHost({ records: x.f.records, now: x.f.now, eventId: x.f.newId }, x.f.ctx, {
    input: { goalRef: ref, control: action, reason: null }, meta: { requestId, expected: [pin(ref, revision), phase(ref.goalId)] },
  });
  expect(result).toMatchObject({ status: 'committed', replayed: false, value: {
    ref, revision: revision + 1, desiredState: action === 'resume' ? 'active' : action === 'pause' ? 'paused' : 'cancelled',
    desiredStateRevision: revision + 1,
  } });
  if (result.status !== 'committed') throw new Error(`S5 control: ${JSON.stringify(result)}`);
  return result;
}
function claimService(x: Ctx, records: S5Records = x.f.records) {
  return createTaskClaimService({ records, now: x.f.now, newId: x.f.newId,
    roles: createRoleConfigurationService({ records, now: x.f.now, eventId: x.f.newId }) });
}
const FREE_TASK = 'b-free-work';
const NEXT_FREE_TASK = 'b-next-free-work';

/**
 * PB1's two work Tasks belong to RA/RB. A real operator adoption adds only
 * pending work to PB2, retaining every source Task/gate/assignment/obligation.
 * PLAN-05 sees no changed or disposition-only Task and no new obligation;
 * the human adopter may add carriers while RA/RB retain their PB1 basis.
 */
async function adoptFreeTasks(x: Ctx, taskIds: readonly string[]): Promise<void> {
  const beforeGoal = await goal(x, GOAL_B);
  expect(beforeGoal).toMatchObject({ revision: 7, desiredState: 'active', activePlanRevision: PLAN_B1 });
  const ra = await execution(x, x.f.claimRA);
  const rb = await execution(x, x.f.claimRB);
  const source = x.f.plans.B1;
  const added = taskIds.map((taskId): RuntimeTask => ({ taskId, title: `Claimable work ${taskId}`,
    requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'module', stageId: 'stage-b', moduleRef: MODULE_M.moduleId } }));
  const draft: PlanRevisionDraft = { schemaVersion: 2, planId: PLAN_B2.planId, planRevision: 2, goalId: GOAL_B.goalId,
    stages: structuredClone(source.stages), tasks: [...structuredClone(source.tasks), ...added],
    assignments: [...structuredClone(source.assignments ?? []), ...taskIds.map(taskId => (
      { taskId, role: 'builder', instruction: `Execute ${taskId}` }))],
    obligations: source.obligations.map(obligation => ({ ...structuredClone(obligation), taskIds: [...obligation.taskIds, ...taskIds] })),
    taskHierarchy: structuredClone(source.taskHierarchy), executionDag: structuredClone(source.executionDag) };
  const owner = plans(x);
  const proposed = await owner.proposePlan(x.f.ctx, { input: { goalRef: GOAL_B, basedOn: PLAN_B1, draft,
    reason: { text: 'Add unclaimed work while retaining RA and RB', sources: [] } },
    meta: { requestId: 'ss-propose-free-tasks', expected: [GB(7)] } });
  expect(proposed).toMatchObject({ status: 'committed', replayed: false, value: { revision: 1, issues: [] } });
  if (proposed.status !== 'committed') throw new Error(`S5 free-task proposal: ${JSON.stringify(proposed)}`);
  const adopted = await owner.applyPlanChange(x.f.ctx, { input: { proposalRef: proposed.value.ref,
    expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
    meta: { requestId: 'ss-adopt-free-tasks', expected: [GB(7)] } });
  expect(adopted).toMatchObject({ status: 'committed', replayed: false,
    value: { ref: PLAN_B2, revision: 1, planRevision: 2 } });
  if (adopted.status !== 'committed') throw new Error(`S5 free-task adoption: ${JSON.stringify(adopted)}`);
  expect(adopted.value.tasks.filter(task => !taskIds.includes(task.taskId))).toEqual(source.tasks);
  expect(adopted.value.tasks.filter(task => taskIds.includes(task.taskId))).toEqual(added);
  expect(await goal(x, GOAL_B)).toEqual({ ...beforeGoal, revision: 8, activePlanRevision: PLAN_B2 });
  for (const [claim, before] of [[x.f.claimRA, ra], [x.f.claimRB, rb]] as const) {
    const after = await execution(x, claim);
    expect(after.run).toEqual(before.run);
    expect(after.lease).toEqual(before.lease);
    expect(after.attempt).toEqual(before.attempt);
    expect(after.session).toEqual(before.session);
    expect(after.outbox).toEqual(before.outbox);
    expect(await executionOf(x, claim.task.taskId)).toEqual(claim.runRef);
  }
  for (const taskId of taskIds) expect(await executionOf(x, taskId)).toBeNull();
}

/** The selected PB2 Task is unclaimed; each real Session belongs to P/W. */
async function freeClaim(x: Ctx, requestId: string, taskId = FREE_TASK) {
  const session: SessionRef = await x.f.createS5Session(`${requestId}-session`);
  const sessionRead = await createSessionDirectory({ records: x.f.records, lookups: x.f.records }).readSession(x.f.ctx, session);
  if (sessionRead.status !== 'ready') throw new Error(`S5 free Session: ${JSON.stringify(sessionRead)}`);
  expect(sessionRead.value.record.workspaceId).toBe('W');
  expect(sessionRead.value.record.occupancy).toBeNull();
  const b = await goal(x, GOAL_B);
  expect(b.activePlanRevision).toEqual(PLAN_B2);
  expect(await executionOf(x, taskId)).toBeNull();
  return { input: { goalRef: GOAL_B, planRef: PLAN_B2, taskId, sessionRef: session,
    roleBinding: x.f.runRB.roleBinding, budget: x.f.runRB.budget },
  meta: { requestId, expected: [GB(b.revision), W, pin(plainSessionRefToAggregate(session), sessionRead.value.record.revision)] } };
}
/** A legal future-only adoption keeps a-work/its gate intact while adding work. */
async function adoptPA2(x: Ctx): Promise<void> {
  const source = x.f.plans.A1;
  const extra: RuntimeTask = { taskId: 'a-future', title: 'Future module M work', requirementLevel: 'required',
    taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'module', stageId: 'stage-a', moduleRef: MODULE_M.moduleId } };
  const draft: PlanRevisionDraft = { schemaVersion: 2, planId: PLAN_A2.planId, planRevision: 2, goalId: GOAL_A.goalId,
    stages: structuredClone(source.stages), tasks: [...structuredClone(source.tasks), extra],
    assignments: [...structuredClone(source.assignments ?? []), { taskId: extra.taskId, role: 'builder', instruction: 'Execute future work' }],
    obligations: source.obligations.map(obligation => ({ ...structuredClone(obligation), taskIds: [...obligation.taskIds, extra.taskId] })),
    taskHierarchy: structuredClone(source.taskHierarchy), executionDag: structuredClone(source.executionDag) };
  const owner = plans(x);
  const proposed = await owner.proposePlan(x.f.ctx, { input: { goalRef: GOAL_A, basedOn: PLAN_A1, draft,
    reason: { text: 'Add future module M work', sources: [] } }, meta: { requestId: 'ss07-propose-pa2', expected: [GA()] } });
  expect(proposed).toMatchObject({ status: 'committed', value: { issues: [] } });
  if (proposed.status !== 'committed') throw new Error(`S5 PA2 proposal: ${JSON.stringify(proposed)}`);
  const adopted = await owner.applyPlanChange(x.f.ctx, { input: { proposalRef: proposed.value.ref,
    expectedProposalRevision: proposed.value.revision, decisionRefs: [] }, meta: { requestId: 'ss07-adopt-pa2', expected: [GA()] } });
  expect(adopted).toMatchObject({ status: 'committed', value: { ref: PLAN_A2, revision: 1, planRevision: 2 } });
  expect(await goal(x, GOAL_A)).toMatchObject({ revision: 8, activePlanRevision: PLAN_A2 });
}

const S5_HOST = {
  configurationRevision: 's5-host-config-1',
  permissions: { policyRevision: 'legacy-template', tools: ['read'], writeScope: [] as string[] },
  hostTemplate: { templateId: 'builder', revision: '1', digest: artifactBodyDigest('s5 trusted builder template') },
};
const S5_SESSION_ROLE = { kind: 'legacy_template' as const, templateId: 'builder', templateRevision: '1' };

function s5Entry(x: Ctx) {
  let seq = 0;
  const roles = createRoleConfigurationService({ records: x.f.records, now: () => T, eventId: () => `s5-ss16-event-${++seq}` });
  const authorizeConfiguration: AuthorizeConfiguration = async (ctx, input) => {
    if (ctx.projectId !== 'P' || ctx.workspaceId !== 'W'
      || input.configurationRevision !== S5_HOST.configurationRevision
      || canonicalJson(input.sessionRole) !== canonicalJson(S5_SESSION_ROLE)) {
      return { status: 'rejected', code: 'forbidden', reason: 'the S5 test Host binding does not authorize this configuration' };
    }
    return { status: 'ready', value: { configurationRevision: S5_HOST.configurationRevision,
      permissions: structuredClone(input.permissions), hostTemplate: structuredClone(input.hostTemplate) } };
  };
  const reads = createRunStateReader({ records: x.f.records });
  return { reads, roles, entry: createExecutionEntryService({ records: x.f.records, reads, roles,
    bodies: { read: ref => x.f.bodies.read(ref) }, authorizeConfiguration, now: () => T,
    eventId: () => `s5-ss16-event-${++seq}`, newId: () => `s5-ss16-id-${++seq}` }) };
}

/** The fixture's own `buildPrepared` for one claim, in the P/W scope. */
async function s5Prepared(x: Ctx, claim: TaskClaim): Promise<PreparedTaskExecution> {
  const { reads, roles } = s5Entry(x);
  const target = await reads.readExecution(x.f.ctx, claim.runRef);
  if (target.status !== 'ready') throw new Error(`S5 prepared run read: ${JSON.stringify(target)}`);
  const input = 'S5 decision fixture prepared manifest input';
  const inputDigest = artifactBodyDigest(input);
  const permissions = structuredClone(S5_HOST.permissions);
  const roleFacts = await roles.resolveRoleBindingFacts(x.f.ctx, { roleBinding: target.value.run.roleBinding, declaredPermissions: permissions });
  if (roleFacts.result.status !== 'ready') throw new Error(`S5 prepared role facts: ${JSON.stringify(roleFacts)}`);
  const role: RoleSpecResolutionV1 = roleFacts.result.value;
  const workspaceSnapshot = { workspaceId: claim.workspaceId, revision: WORKSPACE_REVISION };
  const manifest: PreparedTaskManifestV1 = {
    schemaVersion: 1, kind: 'task_execution', claim, role, hostTemplate: structuredClone(S5_HOST.hostTemplate),
    roleBinding: target.value.run.roleBinding, hostConfigurationRevision: S5_HOST.configurationRevision,
    sessionRole: target.value.session.role, workspaceSnapshot, permissions, budget: target.value.run.budget,
    selectedTaskInputs: [], materialBasis: null, materialAccessRefs: [], additionalMaterialRefs: [], deliveryRefs: [],
    sourceRefs: [], input, inputDigest,
  };
  const manifestJson = JSON.stringify(manifest);
  const stored = await x.f.bodies.put({ body: manifestJson, contentType: MANIFEST_CONTENT_TYPE,
    sourceRefs: [{ kind: 'workspace', refId: claim.workspaceId, revision: String(workspaceSnapshot.revision) }],
    origin: { kind: 'run', owner: claim.runRef }, requestedAt: T });
  if (stored.status !== 'ready') throw new Error(`S5 manifest store: ${JSON.stringify(stored)}`);
  const envelope: TaskEnvelopeV1 = {
    schemaVersion: 1, envelopeId: 's5-ss16-envelope', projectId: claim.task.projectId, workspaceId: claim.workspaceId,
    goalId: claim.task.goalId, taskId: claim.task.taskId, runRef: claim.runRef, attemptRef: claim.attemptRef,
    planRef: claim.planRef, roleBinding: target.value.run.roleBinding, workspaceSnapshot, permissions, budget: target.value.run.budget,
    sourceRefs: [], bundleRef: stored.value.ref,
  };
  const inputBinding: PreparedTaskExecution['inputBinding'] = { schemaVersion: 1, inputDigest,
    manifestDigest: artifactBodyDigest(manifestJson), materialAccessRefs: [], additionalMaterialRefs: [], deliveryRefs: [] };
  return { kind: 'task', claim, envelope, inputBinding };
}


function setReq(requestId: string, autonomy: GoalAutonomyV1, revision: number, waitForGoalRef: GoalRef | null = null): SetReq {
  return { input: { goalRef: GOAL_B, autonomy, waitForGoalRef }, meta: { requestId,
    expected: waitForGoalRef === null ? [GB(revision)] : [GB(revision), GA(), phase('A')] } };
}
function reorderReq(requestId: string, goalOrder: GoalRef[], expected: VersionPin[]): ReorderReq {
  return { input: { workspace: WORKSPACE_SCOPE, goalOrder }, meta: { requestId, expected } };
}
function resolveReq(requestId: string, answer: AnsweredConflict, bRevision: number): ResolveReq {
  return { input: { source: answer.source, selection: answer.selection, decisionMessageRef: answer.message.ref },
    meta: { requestId, expected: [GA(), GB(bRevision)] } };
}
function decisions(x: Ctx) {
  const { f } = x;
  const readers = createMaterialRecordReaders(f.records);
  const materials = createMaterialService({ bodies: f.bodies, authority: readers.authority, now: f.now });
  const deps: SessionMailboxDependencies = { records: f.records,
    sessions: createSessionDirectory({ records: f.records, lookups: f.records }),
    executions: createRunStateReader({ records: f.records }),
    roles: createRoleConfigurationService({ records: f.records, now: f.now, eventId: f.newId }),
    materials, systemActor: f.operatorActor, now: f.now, newId: f.newId };
  return createDecisionMessageService({ records: f.records, now: f.now, newId: f.newId, operatorActor: f.operatorActor,
    messages: createSessionMailbox(deps), materials, messageWrites: createMessageWriteOwner(deps),
    sources: createDecisionSourceFacts({ records: f.records }) });
}
async function conflicts(x: Ctx): Promise<GoalConflictReadV1> {
  const reads = createDecisionReadModel({ records: x.f.records, cardSources: [], noticeSources: [],
    conflicts: createGoalConflictAssembler({ records: x.f.records,
      catalog: createArchitectureCatalogService({ records: x.f.records }), executedFiles: createExecutedFilesStub() }),
    positions: createNoticePositionComparator(), displayTokens: createNoticeDisplayToken(new Uint8Array(32)) });
  const before = await x.f.storeSnapshot();
  const read = await reads.queryGoalConflicts(x.f.ctx, { workspace: WORKSPACE_SCOPE });
  expect(read.status).toBe('ready');
  if (read.status !== 'ready') throw new Error(`S5 conflicts: ${JSON.stringify(read)}`);
  expect(await x.f.storeSnapshot()).toEqual(before);
  return read.value;
}
/** Read the actual A/B card, answer that source, and keep ITS returned message. */
async function answerConflict(x: Ctx, requestId: string): Promise<AnsweredConflict> {
  const a = await goal(x, GOAL_A);
  const b = await goal(x, GOAL_B);
  const expectedBases = [goalBasisOf(a), goalBasisOf(b)];
  const expectedSource = conflictSourceOf([{ goalRef: GOAL_A, activePlanRef: PLAN_A1 }, { goalRef: GOAL_B, activePlanRef: PLAN_B1 }],
    [GA(a.revision), GB(b.revision), pin(PLAN_A1, 1), pin(PLAN_B1, 1)], expectedBases);
  const before = await conflicts(x);
  expect(a).toMatchObject({ revision: 7, activePlanRevision: PLAN_A1, settings: { order: 0 } });
  expect(b).toMatchObject({ revision: 7, activePlanRevision: PLAN_B1, settings: {
    schemaVersion: 1, autonomy: 'after_plan_confirmation', order: 1, waitForGoalRef: null, parallelRisks: [] } });
  expect(before.labels).toEqual([]);
  expect(before.cards).toHaveLength(1);
  const card = before.cards[0];
  if (card === undefined) throw new Error('S5 A/B conflict card missing');
  expect(card).toMatchObject({ state: 'waiting_answer', source: { kind: 'goal_conflict', key: expectedSource.key },
    options: [ { id: 'wait', label: '等前一个目标', effect: 'apply' },
      { id: 'order', label: '调整顺序', effect: 'apply' }, { id: 'parallel', label: '接受风险并行', effect: 'apply' } ] });
  expect(card.source.pins).toEqual(expect.arrayContaining(expectedSource.pins));
  expect(card.source.goalBases?.slice().sort((left, right) => left.goalRef.goalId.localeCompare(right.goalRef.goalId))).toEqual(expectedBases);
  expect(await x.f.decisionAnswersBySource(card.source.kind, card.source.key)).toEqual([]);
  const responded = await x.f.messagesByWorkspaceStatus('responded');
  const answered = await decisions(x).answerDecision(x.f.ctx, {
    input: { source: card.source, selection: PARALLEL, text: 'Accept the module M overlap for these two plans.', annotations: [] },
    meta: { requestId, expected: [...card.source.pins] },
  });
  expect(answered).toMatchObject({ status: 'committed', replayed: false, value: { revision: 1, status: 'responded',
    decision: { syntheticAnswer: true }, response: { decision: { selection: PARALLEL, requiresApplication: true, source: card.source } } } });
  if (answered.status !== 'committed') throw new Error(`S5 conflict answer: ${JSON.stringify(answered)}`);
  const message = await messageRecord(x, answered.value.ref);
  // Rebase onto slice 1 (lead): a decoded Message carries the slice-1 §2.9 read defaults.
  expect(message).toEqual({ ...answered.value, replyHandler: null, archiveWaitDisposition: null });
  const response = message.response;
  if (response === null || !('decision' in response)) throw new Error('S5 conflict answer has no decision response');
  expect(await x.f.messagesByWorkspaceStatus('responded')).toHaveLength(responded.length + 1);
  expect(await x.f.decisionAnswersBySource(card.source.kind, card.source.key)).toEqual([canonicalJson(message.ref)]);
  expect(await goal(x, GOAL_A)).toEqual(a);
  expect(await goal(x, GOAL_B)).toEqual(b);
  return { source: structuredClone(response.decision.source), message, selection: PARALLEL };
}
async function acceptRisk(x: Ctx, requestId: string) {
  const answer = await answerConflict(x, `${requestId}-answer`);
  const before = await x.f.storeSnapshot();
  const accepted = await x.service.resolveGoalConflict(x.f.ctx, resolveReq(requestId, answer, 7));
  expect(accepted).toMatchObject({ status: 'committed', replayed: false });
  if (accepted.status !== 'committed') throw new Error(`S5 risk acceptance: ${JSON.stringify(accepted)}`);
  expect(accepted.value.goals.find(g => g.ref.goalId === 'B')).toMatchObject({ revision: 8, settings: { parallelRisks: [RISK] } });
  expect(await goal(x, GOAL_B)).toMatchObject({ revision: 8, settings: { parallelRisks: [RISK] } });
  expect(await goal(x, GOAL_A)).toMatchObject({ revision: 7, settings: { parallelRisks: [] } });
  const event = await singleSettingsCommit(x, before, accepted.cursor, accepted.value);
  expect(event.payload.proof).toMatchObject({ acknowledgementRef: answer.message.ref, capturedPins: answer.source.pins,
    changes: [{ before: GB(7), after: GB(8) }], basisRebases: [] });
  return { answer, accepted };
}
async function assertOriginalAnswer(x: Ctx, answer: AnsweredConflict) {
  expect(await x.f.decisionAnswersBySource('goal_conflict', answer.source.key)).toEqual([canonicalJson(answer.message.ref)]);
  const current = await messageRecord(x, answer.message.ref);
  expect(current).toEqual(answer.message);
  expect(current.application ?? null).toBeNull();
  expect(current.response).toMatchObject({ decision: { requiresApplication: true } });
}
async function assertRebase(x: Ctx, answer: AnsweredConflict, cursor: CommitCursor,
  actualBefore: number, basis: GoalDecisionBasisV1) {
  const event = await settingsEvent(x, cursor);
  expect(event.payload.proof).toEqual({ acknowledgementRef: answer.message.ref, capturedPins: answer.source.pins,
    changes: [{ before: GB(actualBefore), after: GB(actualBefore + 1) }],
    basisRebases: [{ captured: GB(7), actualBefore: GB(actualBefore), basis }] });
  await assertOriginalAnswer(x, answer);
}
function assertLabels(read: GoalConflictReadV1) {
  expect(read.cards).toEqual([]);
  expect(read.labels.map(({ goalRef, otherGoalRef, selfPlanRef, otherPlanRef }) => ({ goalRef, otherGoalRef, selfPlanRef, otherPlanRef }))
    .sort((left, right) => left.goalRef.goalId.localeCompare(right.goalRef.goalId))).toEqual([
      { goalRef: GOAL_A, otherGoalRef: GOAL_B, selfPlanRef: PLAN_A1, otherPlanRef: PLAN_B1 },
      { goalRef: GOAL_B, otherGoalRef: GOAL_A, selfPlanRef: PLAN_B1, otherPlanRef: PLAN_A1 },
    ]);
}

const cases: [string, (x: Ctx) => Promise<void>][] = [
  ['SS01 B every_step commits B@8 with one GoalSettingsChanged event and keeps Run RA', async x => {
    const ra = await run(x, x.f.claimRA);
    const beforeGoal = await goal(x, GOAL_B);
    const before = await x.f.storeSnapshot();
    const result = await x.service.setGoalSettings(x.f.ctx, setReq('ss01', 'every_step', 7));
    expect(result).toMatchObject({ status: 'committed', replayed: false, value: { ref: GOAL_B, revision: 8,
      desiredState: 'active', desiredStateRevision: beforeGoal.desiredStateRevision,
      desiredStateRequestedBy: beforeGoal.desiredStateRequestedBy, activePlanRevision: PLAN_B1,
      settings: { schemaVersion: 1, autonomy: 'every_step', order: 1, waitForGoalRef: null, parallelRisks: [] } } });
    if (result.status !== 'committed') throw new Error('SS01 did not commit');
    await singleSettingsCommit(x, before, result.cursor, result.value);
    expect(await goal(x, GOAL_B)).toEqual(result.value);
    expect(await run(x, x.f.claimRA)).toEqual(ra);
  }],
  ['SS02 same set identity replays the complete B@8 and cursor after B is cancelled', async x => {
    const request = setReq('ss02', 'every_step', 7);
    const first = await x.service.setGoalSettings(x.f.ctx, request);
    expect(first).toMatchObject({ status: 'committed', replayed: false, value: { revision: 8 } });
    if (first.status !== 'committed') throw new Error('SS02 first did not commit');
    const cancelled = await control(x, GOAL_B, 8, 'cancel', 'ss02-cancel');
    const before = await x.f.storeSnapshot();
    const allocations = { ...x.f.allocationCounts };
    const replay = await x.service.setGoalSettings(x.f.ctx, request);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(x.f.allocationCounts).toEqual(allocations);
    expect(await x.f.storeSnapshot()).toEqual(before);
    expect(await goal(x, GOAL_B)).toEqual(cancelled.value);
  }],
  ['SS03 same identity with another autonomy is idempotency_conflict with zero writes', async x => {
    const first = await x.service.setGoalSettings(x.f.ctx, setReq('ss03', 'every_step', 7));
    expect(first).toMatchObject({ status: 'committed', value: { revision: 8 } });
    const before = await x.f.storeSnapshot();
    const result = await x.service.setGoalSettings(x.f.ctx, setReq('ss03', 'after_plan_confirmation', 7));
    expect(result).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(await x.f.storeSnapshot()).toEqual(before);
    expect(await goal(x, GOAL_B)).toMatchObject({ revision: 8, settings: { autonomy: 'every_step' } });
  }],
  ['SS04 order B,A,C commits B0/A1/C2 once and retains the accepted risk on B', async x => {
    await acceptRisk(x, 'ss04-risk');
    const before = await x.f.storeSnapshot();
    const result = await x.service.reorderGoals(x.f.ctx, reorderReq('ss04', [GOAL_B, GOAL_A, GOAL_C], [GA(), GB(8), GC()]));
    expect(result).toMatchObject({ status: 'committed', replayed: false });
    if (result.status !== 'committed') throw new Error('SS04 did not commit');
    await singleSettingsCommit(x, before, result.cursor, result.value);
    expect(result.value.goals.map(g => [g.ref.goalId, g.settings?.order])).toEqual([['B', 0], ['A', 1], ['C', 2]]);
    expect((await goal(x, GOAL_B)).settings).toMatchObject({ order: 0, parallelRisks: [RISK] });
    expect((await goal(x, GOAL_A)).settings).toMatchObject({ order: 1, parallelRisks: [] });
    expect((await goal(x, GOAL_C)).settings).toMatchObject({ order: 2, parallelRisks: [] });
    expect(result.value.goals.find(g => g.ref.goalId === 'B')?.settings?.parallelRisks).toEqual([RISK]);
  }],
  ['SS05 an order omitting C is invalid with zero writes', async x => {
    const before = await x.f.storeSnapshot();
    const result = await x.service.reorderGoals(x.f.ctx, reorderReq('ss05', [GOAL_B, GOAL_A], [GA(), GB()]));
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await x.f.storeSnapshot()).toEqual(before);
    expect((await goal(x, GOAL_A)).settings?.order).toBe(GOAL_ORDER.A);
    expect((await goal(x, GOAL_B)).settings?.order).toBe(GOAL_ORDER.B);
    expect((await goal(x, GOAL_C)).settings?.order).toBe(GOAL_ORDER.C);
  }],
  ['SS06 accepting the A/B risk then reordering retains both pointer labels and zero cards', async x => {
    const { answer } = await acceptRisk(x, 'ss06-risk');
    assertLabels(await conflicts(x));
    const result = await x.service.reorderGoals(x.f.ctx, reorderReq('ss06-order', [GOAL_B, GOAL_A, GOAL_C], [GA(), GB(8), GC()]));
    expect(result).toMatchObject({ status: 'committed' });
    assertLabels(await conflicts(x));
    expect((await goal(x, GOAL_B)).settings).toMatchObject({ order: 0, parallelRisks: [RISK] });
    expect((await goal(x, GOAL_A)).settings).toMatchObject({ order: 1, parallelRisks: [] });
    await assertOriginalAnswer(x, answer);
  }],
  ['SS07 real PA2 adoption removes the labels and produces one new conflict identity', async x => {
    const { answer } = await acceptRisk(x, 'ss07-risk');
    assertLabels(await conflicts(x));
    const ra = await run(x, x.f.claimRA);
    await adoptPA2(x);
    const after = await conflicts(x);
    expect(after.labels).toEqual([]);
    expect(after.cards).toHaveLength(1);
    const newSource = conflictSourceOf([{ goalRef: GOAL_A, activePlanRef: PLAN_A2 }, { goalRef: GOAL_B, activePlanRef: PLAN_B1 }], []);
    expect(after.cards[0]?.source.key).toBe(newSource.key);
    expect(after.cards[0]?.source.key).not.toBe(answer.source.key);
    expect(after.cards[0]?.state).toBe('waiting_answer');
    expect((await goal(x, GOAL_B)).settings?.parallelRisks).toEqual([RISK]);
    expect(await run(x, x.f.claimRA)).toEqual(ra);
  }],
  ['SS08 settings wins against an in-flight claim commit without a new lease or Run', async x => {
    await adoptFreeTasks(x, [FREE_TASK]);
    const request = await freeClaim(x, 'ss08-claim');
    expect(await executionOf(x, request.input.taskId)).toBeNull();
    const ra = await execution(x, x.f.claimRA);
    const rb = await execution(x, x.f.claimRB);
    let arrive!: () => void;
    let release!: () => void;
    const reachedCommit = new Promise<void>(resolve => { arrive = resolve; });
    const continueCommit = new Promise<void>(resolve => { release = resolve; });
    // All reads/guards are real. Only the first claim commit is held before
    // the actual store so settings can win its Goal CAS while claim is in flight.
    const records: S5Records = { ...x.f.records, async commit(batch) {
      arrive();
      await continueCommit;
      return x.f.records.commit(batch);
    } };
    const pendingClaim = claimService(x, records).claimTask(x.f.ctx, request);
    try {
      await Promise.race([reachedCommit, pendingClaim.then(result => {
        throw new Error(`SS08 claim finished before the commit barrier: ${JSON.stringify(result)}`);
      })]);
      const beforeWaiting = await x.f.storeSnapshot();
      const waiting = await x.service.setGoalSettings(x.f.ctx, setReq('ss08-wait', 'after_plan_confirmation', 8, GOAL_A));
      expect(waiting).toMatchObject({ status: 'committed', value: { revision: 9, settings: { waitForGoalRef: GOAL_A } } });
      if (waiting.status !== 'committed') throw new Error('SS08 wait did not commit');
      await singleSettingsCommit(x, beforeWaiting, waiting.cursor, waiting.value);
      const won = await x.f.storeSnapshot();
      release();
      const rejected = await pendingClaim;
      expect(rejected).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      expect(await x.f.storeSnapshot()).toEqual(won);
      expect(await executionOf(x, request.input.taskId)).toBeNull();
      expect((await execution(x, x.f.claimRA)).run).toEqual(ra.run);
      expect((await execution(x, x.f.claimRB)).run).toEqual(rb.run);
      expect((await execution(x, x.f.claimRA)).lease).toEqual(ra.lease);
      expect((await execution(x, x.f.claimRB)).lease).toEqual(rb.lease);
      expect(won.records.filter(record => JSON.parse(record.refKey).aggregateType === 'TaskLease'
        && JSON.parse(record.refKey).taskId === request.input.taskId)).toEqual([]);
    } finally {
      release();
      await pendingClaim;
    }
  }],
  ['SS09 a cancelled predecessor permits a new claim while B retains waitFor A', async x => {
    await adoptFreeTasks(x, [FREE_TASK]);
    const rb = await execution(x, x.f.claimRB);
    const waiting = await x.service.setGoalSettings(x.f.ctx, setReq('ss09-wait', 'after_plan_confirmation', 8, GOAL_A));
    expect(waiting).toMatchObject({ status: 'committed', value: { revision: 9, settings: { waitForGoalRef: GOAL_A } } });
    await control(x, GOAL_A, 7, 'cancel', 'ss09-cancel');
    const request = await freeClaim(x, 'ss09-claim');
    const claimed = await claimService(x).claimTask(x.f.ctx, request);
    expect(claimed).toMatchObject({ status: 'committed', replayed: false });
    if (claimed.status !== 'committed') throw new Error('SS09 did not claim');
    expect(await run(x, claimed.value)).toMatchObject({ status: 'starting' });
    expect(await executionOf(x, request.input.taskId)).toEqual(claimed.value.runRef);
    expect((await execution(x, claimed.value)).lease).toMatchObject({
      holderRunId: claimed.value.runRef.runId, attemptId: claimed.value.attemptRef.attemptId,
      revision: 1, grantedAt: T, expiresAt: null,
    });
    expect(await goal(x, GOAL_B)).toMatchObject({ revision: 9, activePlanRevision: PLAN_B2, settings: { waitForGoalRef: GOAL_A } });
    expect((await execution(x, x.f.claimRB)).run).toEqual(rb.run);
    expect((await execution(x, x.f.claimRB)).lease).toEqual(rb.lease);
  }],
  ['SS10 reopening the same backend retains autonomy/order/wait/risk exactly', async x => {
    await acceptRisk(x, 'ss10-risk');
    const saved = await x.service.setGoalSettings(x.f.ctx, setReq('ss10-set', 'every_step', 8, GOAL_A));
    expect(saved).toMatchObject({ status: 'committed', value: { revision: 9, settings: {
      schemaVersion: 1, autonomy: 'every_step', order: 1, waitForGoalRef: GOAL_A, parallelRisks: [RISK] } } });
    if (saved.status !== 'committed') throw new Error('SS10 did not commit');
    const before = await x.f.storeSnapshot();
    const allocations = { ...x.f.allocationCounts };
    const records = x.kind === 'sqlite' ? (await x.f.reopen()).records : x.f.records;
    const read = await settings(x.f, records).readGoalSettings(x.f.ctx, { goalRef: GOAL_B });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') throw new Error(`SS10 reopen: ${JSON.stringify(read)}`);
    expect(read.value.goal).toEqual(saved.value);
    expect(read.value.settings).toEqual(saved.value.settings);
    expect(await x.f.storeSnapshot()).toEqual(before);
    expect(x.f.allocationCounts).toEqual(allocations);
  }],
  ['SS11 paused B@7 conflict answer applies after resume with captured7/actual8', async x => {
    expect(await goal(x, GOAL_B)).toMatchObject({ revision: 7, desiredState: 'paused', desiredStateRevision: 7 });
    const answer = await answerConflict(x, 'ss11-answer');
    const basis = goalBasisOf(await goal(x, GOAL_B));
    await control(x, GOAL_B, 7, 'resume', 'ss11-resume');
    const before = await x.f.storeSnapshot();
    const result = await x.service.resolveGoalConflict(x.f.ctx, resolveReq('ss11-apply', answer, 8));
    expect(result).toMatchObject({ status: 'committed', replayed: false });
    if (result.status !== 'committed') throw new Error('SS11 did not apply');
    expect(result.value.goals.find(g => g.ref.goalId === 'B')).toMatchObject({ revision: 9, settings: { parallelRisks: [RISK] } });
    await singleSettingsCommit(x, before, result.cursor, result.value);
    await assertRebase(x, answer, result.cursor, 8, basis);
    expect(await goal(x, GOAL_B)).toMatchObject({ revision: 9, desiredState: 'active', desiredStateRevision: 8,
      settings: { parallelRisks: [RISK] } });
  }],
  ['SS12 changed autonomy after resume rejects the captured answer with zero writes', async x => {
    const answer = await answerConflict(x, 'ss12-answer');
    await control(x, GOAL_B, 7, 'resume', 'ss12-resume');
    const changed = await x.service.setGoalSettings(x.f.ctx, setReq('ss12-set', 'every_step', 8));
    expect(changed).toMatchObject({ status: 'committed', value: { revision: 9, settings: { autonomy: 'every_step' } } });
    const before = await x.f.storeSnapshot();
    const result = await x.service.resolveGoalConflict(x.f.ctx, resolveReq('ss12-apply', answer, 9));
    expect(result).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await x.f.storeSnapshot()).toEqual(before);
    expect(await goal(x, GOAL_B)).toMatchObject({ revision: 9, settings: { autonomy: 'every_step', parallelRisks: [] } });
    await assertOriginalAnswer(x, answer);
  }],
  ['SS13 the winning claim survives later waiting; a new free-task claim is waiting_predecessor', async x => {
    await adoptFreeTasks(x, [FREE_TASK, NEXT_FREE_TASK]);
    const rb = await execution(x, x.f.claimRB);
    const winningRequest = await freeClaim(x, 'ss13-winning-claim');
    const claimed = await claimService(x).claimTask(x.f.ctx, winningRequest);
    expect(claimed).toMatchObject({ status: 'committed', replayed: false,
      value: { task: { projectId: 'P', goalId: 'B', taskId: FREE_TASK }, planRef: PLAN_B2 } });
    if (claimed.status !== 'committed') throw new Error('SS13 first claim did not commit');
    const winner = await execution(x, claimed.value);
    expect(winner.run.status).toBe('starting');
    expect(winner.lease).toMatchObject({ holderRunId: claimed.value.runRef.runId, attemptId: claimed.value.attemptRef.attemptId,
      revision: 1, grantedAt: T, expiresAt: null });
    expect(await executionOf(x, FREE_TASK)).toEqual(claimed.value.runRef);
    const waiting = await x.service.setGoalSettings(x.f.ctx, setReq('ss13-wait', 'after_plan_confirmation', 8, GOAL_A));
    expect(waiting).toMatchObject({ status: 'committed', value: { revision: 9, settings: { waitForGoalRef: GOAL_A } } });
    const after = await execution(x, claimed.value);
    expect(after.run).toEqual(winner.run);
    expect(after.lease).toEqual(winner.lease);
    expect(after.attempt).toEqual(winner.attempt);
    expect(after.session).toEqual(winner.session);
    expect(after.outbox).toEqual(winner.outbox);
    expect((await execution(x, x.f.claimRB)).run).toEqual(rb.run);
    expect((await execution(x, x.f.claimRB)).lease).toEqual(rb.lease);
    const request = await freeClaim(x, 'ss13-next-claim', NEXT_FREE_TASK);
    const before = await x.f.storeSnapshot();
    const rejected = await claimService(x).claimTask(x.f.ctx, request);
    expect(rejected).toMatchObject({ status: 'rejected', code: 'busy', reason: expect.stringMatching(/^waiting_predecessor:/) });
    expect(await x.f.storeSnapshot()).toEqual(before);
    expect(await executionOf(x, request.input.taskId)).toBeNull();
  }],
  ['SS14 pause/resume preserves every setting, revision epoch, and complete original receipt', async x => {
    const { answer, accepted } = await acceptRisk(x, 'ss14-risk');
    const firstRequest = setReq('ss14-set', 'every_step', 8, GOAL_A);
    const first = await x.service.setGoalSettings(x.f.ctx, firstRequest);
    expect(first).toMatchObject({ status: 'committed', value: { revision: 9, desiredStateRevision: 1 } });
    if (first.status !== 'committed') throw new Error('SS14 first did not commit');
    expect(first.value.settings).toEqual({ schemaVersion: 1, autonomy: 'every_step', order: 1, waitForGoalRef: GOAL_A, parallelRisks: [RISK] });
    const secondRequest = reorderReq('ss14-order', [GOAL_A, GOAL_C, GOAL_B], [GA(), GB(9), GC()]);
    const second = await x.service.reorderGoals(x.f.ctx, secondRequest);
    expect(second).toMatchObject({ status: 'committed' });
    if (second.status !== 'committed') throw new Error('SS14 second did not commit');
    const finalSettings = { schemaVersion: 1, autonomy: 'every_step', order: 2, waitForGoalRef: GOAL_A, parallelRisks: [RISK] };
    expect(second.value.goals.find(g => g.ref.goalId === 'B')).toMatchObject({ revision: 10, desiredStateRevision: 1, settings: finalSettings });
    expect(await goal(x, GOAL_B)).toMatchObject({ revision: 10, desiredStateRevision: 1, settings: finalSettings });
    const paused = await control(x, GOAL_B, 10, 'pause', 'ss14-pause');
    expect(paused.value.settings).toEqual(finalSettings);
    const resumed = await control(x, GOAL_B, 11, 'resume', 'ss14-resume');
    expect(resumed.value.settings).toEqual(finalSettings);
    const before = await x.f.storeSnapshot();
    const allocations = { ...x.f.allocationCounts };
    const replayRisk = await x.service.resolveGoalConflict(x.f.ctx, resolveReq('ss14-risk', answer, 7));
    const replayFirst = await x.service.setGoalSettings(x.f.ctx, firstRequest);
    const replaySecond = await x.service.reorderGoals(x.f.ctx, secondRequest);
    expect(replayRisk).toEqual({ ...accepted, replayed: true });
    expect(replayFirst).toEqual({ ...first, replayed: true });
    expect(replaySecond).toEqual({ ...second, replayed: true });
    expect(x.f.allocationCounts).toEqual(allocations);
    expect(await x.f.storeSnapshot()).toEqual(before);
    expect((await settingsEvent(x, accepted.cursor)).payload.value).toEqual(accepted.value);
    expect((await settingsEvent(x, first.cursor)).payload.value).toEqual(first.value);
    expect((await settingsEvent(x, second.cursor)).payload.value).toEqual(second.value);
    expect(await goal(x, GOAL_B)).toEqual(resumed.value);
  }],
  ['SS15 paused B@7 answer survives content changed back and resume with exactly one rebase', async x => {
    const answer = await answerConflict(x, 'ss15-answer');
    const basis = goalBasisOf(await goal(x, GOAL_B));
    const changed = await x.service.setGoalSettings(x.f.ctx, setReq('ss15-every-step', 'every_step', 7));
    expect(changed).toMatchObject({ status: 'committed', value: { revision: 8, desiredState: 'paused', desiredStateRevision: 7 } });
    const restored = await x.service.setGoalSettings(x.f.ctx, setReq('ss15-restore', 'after_plan_confirmation', 8));
    expect(restored).toMatchObject({ status: 'committed', value: { revision: 9, desiredState: 'paused', desiredStateRevision: 7 } });
    expect(goalBasisOf(await goal(x, GOAL_B))).toEqual(basis);
    await control(x, GOAL_B, 9, 'resume', 'ss15-resume');
    const before = await x.f.storeSnapshot();
    const result = await x.service.resolveGoalConflict(x.f.ctx, resolveReq('ss15-apply', answer, 10));
    expect(result).toMatchObject({ status: 'committed', replayed: false });
    if (result.status !== 'committed') throw new Error('SS15 did not apply');
    expect(result.value.goals.find(g => g.ref.goalId === 'B')).toMatchObject({ revision: 11, settings: { parallelRisks: [RISK] } });
    await singleSettingsCommit(x, before, result.cursor, result.value);
    await assertRebase(x, answer, result.cursor, 10, basis);
    expect(await goal(x, GOAL_B)).toMatchObject({ revision: 11, desiredState: 'active', desiredStateRevision: 10,
      settings: { autonomy: 'after_plan_confirmation', parallelRisks: [RISK] } });
  }],
  ['SS16 waiting refuses authorization and leaves RB Starting.Unbound with zero writes', async x => {
    const waiting = await x.service.setGoalSettings(x.f.ctx, setReq('ss16-wait', 'after_plan_confirmation', 7, GOAL_A));
    expect(waiting).toMatchObject({ status: 'committed', value: { revision: 8 } });
    const rb = await run(x, x.f.claimRB);
    expect(rb.status).toBe('starting');
    expect(rb.executionAuthorization).toBeUndefined();
    expect(rb.inputBinding).toBeUndefined();
    const prepared = await s5Prepared(x, x.f.claimRB);
    const before = await x.f.storeSnapshot();
    const refused = await s5Entry(x).entry.authorizeRuntimeEntry(x.f.ctx, { input: { prepared, consumerId: 's5-ss16' },
      meta: { requestId: 'ss16-authorize', expected: [pin(x.f.claimRB.runRef, rb.revision)] } });
    expect(refused).toMatchObject({ status: 'rejected', code: 'busy', reason: expect.stringMatching(/^waiting_predecessor:/) });
    expect(await run(x, x.f.claimRB)).toEqual(rb);
    expect(await x.f.storeSnapshot()).toEqual(before);
  }],
];

describe.each(['memory', 'sqlite'] as const)('S5 goal-settings owner service (%s)', kind => {
  for (const [title, row] of cases) it(title, async () => {
    const x = await open(kind, ['SS11', 'SS12', 'SS15'].includes(title.slice(0, 4)));
    const before = await x.f.storeSnapshot();
    await row(x);
    // No model client is supplied to any owner. Also inspect the real persisted
    // model admission records, rather than asserting a disconnected mock count.
    expect(modelPermits(await x.f.storeSnapshot())).toEqual(modelPermits(before));
  });
});
