/**
 * Slice 5 §5.4 WF01/WF02 (SPEC lines 1128–1133; F90, F48): the Workflow's
 * per-step confirmation gate and the read-only ordering safe point.
 *
 * Assembly follows `tests/business/R5c-workflow.test.ts`: the real seeded
 * WorkGraph/Session fixture (§5.1 P/W, Goals A/B/C@7, Workspace@3, T, operator
 * `human:operator`) with the real WorkGraph/Plan/Session owners and the real
 * Goal-settings owner; only the execution/verification owners are controlled
 * doubles. No model is called.
 *
 * Part 1 publishes `createGoalSettingsService` and the two Workflow seam
 * methods as stubs, so each case stops at the first `not implemented:` throw
 * (WF01 `setGoalSettings`, WF02 `reorderGoals`); the pins and assertions are
 * the frozen §5.4/§3.3 line 625 expectations for part 2.
 */
import { afterEach, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RuntimeEventV1 } from '../../src/contracts/dispatch.js';
import type { GoalSettingsPort, GoalSettingsServiceDependencies } from '../../src/core/work-graph/model/decision-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type { TaskResultObservation } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { EvidencePort } from '../../src/core/work-graph/model/evidence-contracts.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import type { RegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createInitializationBindingReader } from '../../src/core/work-graph/tasks/goal-confirm-service.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { WorkflowDependencies, WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import {
  GOAL_A, GOAL_B, GOAL_C, GOAL_REVISION, T, WORKSPACE_SCOPE,
  openS5DecisionFixture, type S5DecisionFixture,
} from '../helpers/S5-decision-fixture.js';
import { committed, ready } from '../helpers/S5-user-message-support.js';

const fixtures: S5DecisionFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

type Claims = WorkflowDependencies['claims'];

function unsupported(reason: string) {
  return { status: 'rejected' as const, code: 'unsupported' as const, reason };
}

/** The real claim owner plus a requeue counter whose double must never be reached when gated. */
function countingClaims(service: Claims): { claims: Claims; requeueCalls: () => number } {
  let calls = 0;
  const claims: Claims = {
    ...service,
    requeueTask: async () => {
      calls += 1;
      throw new Error('WF: the requeue owner must not be called while the decision is gated');
    },
  };
  return { claims, requeueCalls: () => calls };
}

function makeGoalSettings(fixture: S5DecisionFixture): GoalSettingsPort {
  const dependencies: GoalSettingsServiceDependencies = {
    records: fixture.records, now: fixture.now, newId: fixture.newId, operatorActor: fixture.operatorActor,
  };
  return createGoalSettingsService(dependencies);
}

function makeClaims(fixture: S5DecisionFixture): Claims {
  return createTaskClaimService({ records: fixture.records, now: fixture.now, newId: fixture.newId,
    roles: createRoleConfigurationService({ records: fixture.records, now: fixture.now, eventId: fixture.newId }) });
}

/** Real WorkGraph/Plan/Session owners + real settings owner; execution/checks are doubles. */
function assemble(fixture: S5DecisionFixture, goalSettings: GoalSettingsPort, claims: Claims) {
  const { authority } = createMaterialRecordReaders(fixture.records);
  const runtime: RuntimeExecutionPort = {
    capabilities: async () => unsupported('S5 workflow test never reads capabilities'),
    createSession: async () => unsupported('S5 workflow test never creates a Session'),
    readSessionHistory: async () => unsupported('S5 workflow test never reads Session history'),
    readExecutionHistory: async () => unsupported('S5 workflow test never reads execution history'),
    readTaskExecutionHistory: async () => unsupported('S5 workflow test never reads task history'),
    prepareExecution: async () => unsupported('S5 workflow test stops before prepare'),
    startRun: async () => unsupported('S5 workflow test stops before start'),
    observeRun: async () => unsupported('S5 workflow test never observes'),
  };
  const evidence: EvidencePort = {
    openVerification: async () => unsupported('S5 workflow test does not open checks'),
    readVerification: async () => unsupported('S5 workflow test does not read checks'),
    beginCheck: async () => unsupported('S5 workflow test does not begin checks'),
    recordCheckResult: async () => unsupported('S5 workflow test does not record checks'),
    finalizeChecks: async () => unsupported('S5 workflow test does not finalize checks'),
  };
  const checks: RegisteredCheckRunner = {
    runRegisteredCheck: async () => unsupported('S5 workflow test does not run checks'),
  };
  const configuration: WorkflowHostConfiguration = {
    consumerId: 's5-wf-consumer',
    bindings: [{
      workspace: WORKSPACE_SCOPE,
      sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: fixture.runRA.roleBinding,
      budget: fixture.runRA.budget,
    }],
  };
  const dependencies: WorkflowDependencies = {
    tasks: createGoalService({ records: fixture.records, now: fixture.now, eventId: fixture.newId }).tasks,
    plans: createPlanService({ records: fixture.records, bindings: createInitializationBindingReader({ records: fixture.records }),
      now: fixture.now, eventId: fixture.newId }),
    sessions: createSessionDirectory({ records: fixture.records, lookups: fixture.records }),
    claims,
    executions: createRunStateReader({ records: fixture.records }),
    runtime, evidence, checks,
    sourceAuthority: createSourceAuthorityReader({ authority }),
    configuration,
    goalSettings,
  };
  return createWorkflow(dependencies);
}

function selectWork(
  goalRef: WorkflowAdvanceInput['goalRef'], flowId: string,
  sessionHint: WorkflowAdvanceInput['sessionHint'] = null, taskId?: string,
): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef, flowId, sessionHint, kind: 'select_work',
    ...(taskId === undefined ? {} : { taskId }) };
}

/** A real P/W Session nobody claims; §5.4 WF02: the same idle Session can take both pending advances. */
async function createIdleSession(fixture: S5DecisionFixture): Promise<SessionRef> {
  const ref = await fixture.createS5Session('s5-wf02-idle');
  const sessions = createSessionDirectory({ records: fixture.records, lookups: fixture.records });
  expect(ready(await sessions.readSession(fixture.ctx, ref)).record).toMatchObject({ lifecycle: 'active', occupancy: null });
  return ref;
}

/** WF01 §5.1 precondition: end the Task's selected Run as a real failure (crash), never faking PASS. */
async function endRunCrashed(fixture: S5DecisionFixture, claim: TaskClaim): Promise<void> {
  const reads = createRunStateReader({ records: fixture.records });
  const read = await reads.readExecution(fixture.ctx, claim.runRef);
  if (read.status !== 'ready') throw new Error(`WF01 setup: the Run is not readable: ${JSON.stringify(read)}`);
  const run = read.value.run;
  const history = run.executionHistory;
  if (history === undefined) throw new Error('WF01 setup: the Run has no entered Kernel history');
  const authorization = run.executionAuthorization;
  if (authorization === undefined || !('schemaVersion' in authorization) || authorization.schemaVersion !== 2
    || authorization.phase !== 'entered') throw new Error('WF01 setup: the Run has no entered authorization');
  const kernel = history.kernel;
  const position = history.observedThroughPosition + 1;
  const entry = createExecutionEntryService({ records: fixture.records, reads, bodies: fixture.bodies,
    roles: createRoleConfigurationService({ records: fixture.records, now: fixture.now, eventId: fixture.newId }),
    now: fixture.now, eventId: fixture.newId, newId: fixture.newId,
    authorizeConfiguration: async () => { throw new Error('recordRunResult must not reauthorize an already-entered Run'); },
  });
  const event: RuntimeEventV1 = {
    eventType: 'run_crashed', schemaVersion: 1, eventId: 's5-wf01-crash',
    runRef: { ...run.ref }, sequence: run.lastEventSeq + 1, occurredAt: T,
    payload: { kind: 'crashed', error: 'WF01: the previous Run failed' },
  };
  const request: GraphWrite<TaskResultObservation> = {
    input: {
      claim,
      entry: { consumerId: authorization.consumerId, entryGeneration: authorization.generation },
      event,
      kernelSource: { ...kernel, position },
      completedHistoryBoundary: { source: { ...kernel, position }, cursor: `s5-wf01-boundary-${position}` },
      history: { kernel: { ...kernel }, startPosition: history.startPosition, observedThroughPosition: position, endPosition: position },
    },
    meta: { requestId: 's5-wf01-crash-result', expected: [{ ref: run.ref, revision: run.revision }] },
  };
  const result = committed(await entry.recordRunResult(fixture.ctx, request));
  expect(result.value).toMatchObject({ status: 'ended', outcome: 'crashed', endedAt: T });
  const plans = createPlanService({ records: fixture.records, bindings: createInitializationBindingReader({ records: fixture.records }),
    now: fixture.now, eventId: fixture.newId });
  const graph = ready(await plans.queryTaskGraph(fixture.ctx, { goalRef: GOAL_B }));
  expect(graph.tasks.find(task => task.ref.taskId === claim.task.taskId)).toMatchObject({
    ref: claim.task, effectivePhase: 'failed', execution: claim.runRef,
    failure: { automation: { requeueAutoCount: 0, cap: 3, verdict: { kind: 'requeue' } } },
  });
}

it('WF01 a system requeue under every_step waits with the derived automation cause and writes nothing', async () => {
  const fixture = await openS5DecisionFixture('memory');
  fixtures.push(fixture);
  const goalSettings = makeGoalSettings(fixture);

  // §5.4 WF01 + §3.3 line 625: B sets every_step through the REAL Goal-settings
  // owner; waitForGoalRef is null, so the exact pin set is the target Goal alone.
  const configured = await goalSettings.setGoalSettings(fixture.ctx, {
    input: { goalRef: GOAL_B, autonomy: 'every_step', waitForGoalRef: null },
    meta: { requestId: 's5-wf01-set-settings', expected: [{ ref: GOAL_B, revision: GOAL_REVISION }] },
  });
  expect(configured, 'the Goal B every_step write is real').toMatchObject({
    status: 'committed', value: { ref: GOAL_B, revision: 8, settings: { autonomy: 'every_step' } },
  });

  // B's task tB has a previous failed Run that is automatically requeue-eligible (prior 0, cap 3).
  await endRunCrashed(fixture, fixture.claimRA);
  const { claims, requeueCalls } = countingClaims(makeClaims(fixture));
  const workflow = assemble(fixture, goalSettings, claims);

  const before = await fixture.storeSnapshot();
  const result = await workflow.advanceWork(fixture.ctx, selectWork(GOAL_B, 's5-wf01-flow', null, 'b-work'));
  const after = await fixture.storeSnapshot();

  expect(result).toMatchObject({
    status: 'ready',
    value: { state: 'waiting', next: null, reason: 'automation_confirmation_required:system_requeue' },
  });
  if (result.status !== 'ready') throw new Error(`WF01: the step was not a ready result: ${JSON.stringify(result)}`);
  expect(result.value.decisionCause).toMatchObject({
    code: 'automation_confirmation_required', action: 'system_requeue',
    taskRef: { projectId: 'P', goalId: 'B', taskId: 'b-work' },
  });
  // Persisted records (including TaskRequeue/Run), events, claims and versions stay identical.
  expect(after).toEqual(before);
  expect(requeueCalls()).toBe(0);
});

it('WF02 reorders B before A and returns the advances in order without touching the input or the store', async () => {
  const fixture = await openS5DecisionFixture('memory');
  fixtures.push(fixture);
  const goalSettings = makeGoalSettings(fixture);

  // §5.4 WF02 + S5-GS-02 + §3.3 line 625: the REAL reorder owner takes the FULL
  // Goal set [B, A, C] and pins every Goal in it at its current revision.
  const reordered = await goalSettings.reorderGoals(fixture.ctx, {
    input: { workspace: WORKSPACE_SCOPE, goalOrder: [GOAL_B, GOAL_A, GOAL_C] },
    meta: { requestId: 's5-wf02-reorder', expected: [
      { ref: GOAL_B, revision: GOAL_REVISION },
      { ref: GOAL_A, revision: GOAL_REVISION },
      { ref: GOAL_C, revision: GOAL_REVISION },
    ] },
  });
  expect(reordered, 'the reorder is a real Goal-set write').toMatchObject({
    status: 'committed',
    value: { goals: [
      { ref: GOAL_B, settings: { order: 0 } },
      { ref: GOAL_A, settings: { order: 1 } },
      { ref: GOAL_C, settings: { order: 2 } },
    ] },
  });

  // One idle Session can take both pending advances.
  const idle = await createIdleSession(fixture);
  const { claims } = countingClaims(makeClaims(fixture));
  const workflow = assemble(fixture, goalSettings, claims);

  const advanceA = selectWork(GOAL_A, 's5-wf02-flow-a', idle);
  const advanceB = selectWork(GOAL_B, 's5-wf02-flow-b', idle);
  const advances = [advanceA, advanceB];
  const originalAdvances = structuredClone(advances);

  const before = await fixture.storeSnapshot();
  const result = await workflow.orderGoalAdvances(fixture.ctx, { advances });
  const after = await fixture.storeSnapshot();

  expect(result).toMatchObject({ status: 'ready', value: { advances: [advanceB, advanceA] } });
  expect(advances, 'the caller input array stays in its original order').toEqual(originalAdvances);
  // The ordering read leaves persisted records/events/claims and their versions untouched.
  expect(after).toEqual(before);
});
