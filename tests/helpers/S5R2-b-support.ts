/** Round-2 group B: real S5 owners; no Runtime/model or check process runs. */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from 'vitest';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { WorkflowDependencies } from '../../src/business/workflow/ports.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import type { DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { RoundSnapshot } from '../../src/contracts/verification.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import type { RegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createDecisionMessageService } from '../../src/core/work-graph/communication/decision-service.js';
import { createDecisionSourceFacts } from '../../src/core/work-graph/communication/decision-source-facts.js';
import { createMessageWriteOwner, createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import type { MessageDutiesFactsPort } from '../../src/core/work-graph/model/decision-contracts.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { SessionMailboxDependencies } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createExecutedFilesStub } from '../../src/core/work-graph/tasks/executed-files-stub.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createGoalDecisionCauseReader } from '../../src/core/work-graph/tasks/goal-decision-reader.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createPlanningQuestionReader } from '../../src/core/work-graph/tasks/planning-question-reader.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createAutomaticReworkNoticeSource } from '../../src/core/work-graph/views/automatic-rework-notices.js';
import { createDecisionReadModel, createGoalCauseCardSource, createPlanningQuestionCardSource } from '../../src/core/work-graph/views/decision-read-model.js';
import { createGoalConflictAssembler } from '../../src/core/work-graph/views/goal-conflicts.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';
import { createNoticePositionComparator } from '../../src/core/work-graph/views/notice-position.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import { committed, goalAt, keyOf, ready } from './S5-application-support.js';
import {
  GOAL_B, PLAN_B1, T, WORKSPACE, WORKSPACE_REVISION, WORKSPACE_SCOPE,
  type S5DecisionFixture, type S5StoreSnapshot,
} from './S5-decision-fixture.js';

export async function assembleB(f: S5DecisionFixture) {
  const records = f.records;
  const roles = createRoleConfigurationService({ records, now: f.now, eventId: f.newId });
  const { authority } = createMaterialRecordReaders(records);
  const materials = createMaterialService({ bodies: f.bodies, authority, now: f.now });
  const executions = createRunStateReader({ records });
  const sessions = createSessionDirectory({ records, lookups: records });
  const settings = createGoalSettingsService({ records, now: f.now, newId: f.newId, operatorActor: f.operatorActor });
  const plans = createPlanService({ records, materials, initialPlanning: { bodies: f.bodies }, now: f.now, eventId: f.newId });
  const sources = createDecisionSourceFacts({ records, plans });
  const mailboxDeps: SessionMailboxDependencies = {
    records, sessions, executions, roles, materials, systemActor: f.operatorActor,
    now: f.now, newId: f.newId,
    duties: ({
      async readMessageDutiesFacts(_ctx, input) {
        if (input.roleBinding.templateId !== f.runRA.roleBinding.templateId
          || input.roleBinding.templateRevision !== f.runRA.roleBinding.templateRevision) {
          return { status: 'rejected', code: 'unsupported', reason: 'no exact duties mapping exists for this Role binding' };
        }
        return { status: 'ready', value: { duties: [...f.duties], readOnlyCopy: false, independentReview: false, guards: [] } };
      },
    } satisfies MessageDutiesFactsPort),
  };
  const mailbox = createSessionMailbox(mailboxDeps);
  const decisions = createDecisionMessageService({ records, now: f.now, newId: f.newId,
    operatorActor: f.operatorActor, messages: mailbox, materials,
    messageWrites: createMessageWriteOwner(mailboxDeps), sources });
  const causes = createGoalDecisionCauseReader({ records, plans });
  const reads = createDecisionReadModel({ records,
    cardSources: [createGoalCauseCardSource(causes),
      createPlanningQuestionCardSource(createPlanningQuestionReader({ records, plans }))],
    noticeSources: [createAutomaticReworkNoticeSource({ records })],
    conflicts: createGoalConflictAssembler({ records, catalog: createArchitectureCatalogService({ records }),
      executedFiles: createExecutedFilesStub() }),
    positions: createNoticePositionComparator(), displayTokens: createNoticeDisplayToken(new Uint8Array(32)),
  });

  // A real, isolated source root, separate from the fixture's changing ledger/body
  // files. The enclosing fixture owns cleanup. No check command is launched.
  const root = join(f.base.directory, 's5r2-b-source');
  await mkdir(root);
  const workspaceHost: WorkspaceHostBindings = {
    async resolveRoot(scope) {
      if (scope.projectId !== WORKSPACE_SCOPE.projectId || scope.workspaceId !== WORKSPACE_SCOPE.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'outside S5 P/W' };
      }
      return { status: 'ready', value: { root, workspaceRevision: WORKSPACE_REVISION } };
    },
    async authorize(ctx, scope) {
      if (ctx.principal.kind !== 'host' || ctx.projectId !== WORKSPACE_SCOPE.projectId
        || ctx.workspaceId !== WORKSPACE_SCOPE.workspaceId || scope.projectId !== WORKSPACE_SCOPE.projectId
        || scope.workspaceId !== WORKSPACE_SCOPE.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'outside S5 Host source grant' };
      }
      return { status: 'ready', value: { subjectKey: 'human:operator', permissionRevision: 's5r2-b-source@1',
        allowsRead: () => true } };
    },
  };
  const source = new VerificationWorkspaceReader();
  const requeue = createTaskRequeueService({ records, reads: executions, workspaceHost, source,
    materials, messages: mailbox, goalSettings: settings, now: f.now, eventId: f.newId });
  const claims = { ...createTaskClaimService({ records, roles, bodies: f.bodies, now: f.now, newId: f.newId }),
    ...requeue };
  const evidence = createEvidenceService({ records, materials, executions, workspaceHost, source,
    configuration: { configurationRevision: 's5r2-b-checks@1', workspace: WORKSPACE,
      executor: f.operatorActor, permissionRevision: 's5r2-b-source@1', sourceAccess: 'verification_workspace',
      processAccess: 'all_except_denied', deniedPrefixes: ['.git'], checks: [] },
    now: f.now, newId: f.newId });

  let runtimeCalls = 0;
  const unusedRuntime = async (): Promise<never> => {
    runtimeCalls += 1;
    throw new Error('R2B: no Runtime/model call is allowed');
  };
  const runtime: RuntimeExecutionPort = {
    capabilities: unusedRuntime, createSession: unusedRuntime,
    readSessionHistory: unusedRuntime, readExecutionHistory: unusedRuntime, readTaskExecutionHistory: unusedRuntime,
    prepareExecution: unusedRuntime, startRun: unusedRuntime, observeRun: unusedRuntime,
  };
  const checks: RegisteredCheckRunner = {
    async runRegisteredCheck() { throw new Error('R2B: no check process is allowed'); },
  };
  const dependencies: WorkflowDependencies = {
    tasks: createGoalService({ records, now: f.now, eventId: f.newId }).tasks,
    plans, sessions, claims, executions, runtime, evidence, checks,
    sourceAuthority: createSourceAuthorityReader({ authority }),
    configuration: { consumerId: 's5r2-b-workflow', bindings: [{ workspace: WORKSPACE_SCOPE,
      sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: f.runRA.roleBinding, budget: f.runRA.budget }] },
    goalSettings: settings, decisionMessages: { ...decisions, sendUserMessage: mailbox.sendUserMessage.bind(mailbox) },
    decisionSources: sources,
  };
  return { workflow: createWorkflow(dependencies), settings, plans, reads, sources, evidence,
    runtimeCalls: () => runtimeCalls };
}

export type BOwners = Awaited<ReturnType<typeof assembleB>>;

export function selectB(flowId: string, taskId?: string): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: GOAL_B, flowId, sessionHint: null, kind: 'select_work',
    ...(taskId === undefined ? {} : { taskId }) };
}

export async function everyStep(f: S5DecisionFixture, owners: BOwners, requestId: string) {
  const before = await goalAt(f.records);
  return committed(await owners.settings.setGoalSettings(f.ctx, {
    input: { goalRef: GOAL_B, autonomy: 'every_step', waitForGoalRef: null },
    meta: { requestId, expected: [{ ref: GOAL_B, revision: before.revision }] },
  }));
}

/** WF01's real terminal observation, after the fixture's claim/authorize/enter. */
export async function crashWork(f: S5DecisionFixture, owners: BOwners) {
  const executions = createRunStateReader({ records: f.records });
  const run = ready(await executions.readExecution(f.ctx, f.claimRA.runRef)).run;
  const history = run.executionHistory;
  const authorization = run.executionAuthorization;
  if (history === undefined || authorization === undefined || !('schemaVersion' in authorization)
    || authorization.schemaVersion !== 2 || authorization.phase !== 'entered') {
    throw new Error('R2B setup requires the real entered Run RA');
  }
  const entry = createExecutionEntryService({ records: f.records, reads: executions, bodies: f.bodies,
    roles: createRoleConfigurationService({ records: f.records, now: f.now, eventId: f.newId }),
    now: f.now, eventId: f.newId, newId: f.newId,
    authorizeConfiguration: async () => { throw new Error('an entered Run must not be reauthorized'); },
  });
  const position = history.observedThroughPosition + 1;
  const kernelSource = { ...history.kernel, position };
  const crashed = committed(await entry.recordRunResult(f.ctx, {
    input: { claim: f.claimRA,
      entry: { consumerId: authorization.consumerId, entryGeneration: authorization.generation },
      event: { schemaVersion: 1, eventType: 'run_crashed', eventId: 's5r2-b-crash', runRef: run.ref,
        sequence: run.lastEventSeq + 1, occurredAt: T,
        payload: { kind: 'crashed', error: 'R2B previous work Run crashed' } },
      kernelSource, completedHistoryBoundary: { source: kernelSource, cursor: `s5r2-b-ended-${position}` },
      history: { kernel: history.kernel, startPosition: history.startPosition,
        observedThroughPosition: position, endPosition: position } },
    meta: { requestId: 's5r2-b-crash-result', expected: [{ ref: run.ref, revision: run.revision }] },
  }));
  expect(crashed.value).toMatchObject({ ref: f.claimRA.runRef, status: 'ended', outcome: 'crashed', endedAt: T });
  expect(crashed.value.revision).toBe(run.revision + 1);
  const graph = ready(await owners.plans.queryTaskGraph(f.ctx, { goalRef: GOAL_B }));
  expect(graph.tasks.find(task => task.ref.taskId === 'b-work')).toMatchObject({
    ref: f.claimRA.task, effectivePhase: 'failed', execution: f.claimRA.runRef,
    failure: { runRevision: crashed.value.revision, failureClass: 'run_failed',
      automation: { requeueAutoCount: 0, cap: 3, coveringRequeue: null,
        verdict: { kind: 'requeue', failureClass: 'run_failed', retryAfterRefusal: false } } },
  });
  return crashed.value;
}

export async function queueB(f: S5DecisionFixture, owners: BOwners): Promise<DecisionQueueReadV1> {
  return ready(await owners.reads.queryDecisionQueue(f.ctx, { workspace: WORKSPACE_SCOPE, goalRef: GOAL_B,
    sections: ['waiting_answer', 'answered_pending_application'], page: { limit: 100 } }));
}

/** Exactly one card for this emitted cause; the fixture also has other decision sources. */
export function waitingCard(queue: DecisionQueueReadV1, source: DecisionSourceV1): DecisionCardV1 {
  const matches = queue.waitingAnswer.filter(card => card.cardKey === source.key);
  expect(matches).toHaveLength(1);
  const card = matches[0];
  if (card === undefined) throw new Error('R2B: the emitted cause must be in the queue');
  expect(card).toMatchObject({ cardKey: source.key, source: { kind: 'goal_cause', key: source.key, goalRef: GOAL_B },
    state: 'waiting_answer', readOnly: false, options: [], answerMessageRef: null });
  return card;
}

export function requeueRecords(snapshot: S5StoreSnapshot) {
  return snapshot.records.filter(record => record.refKey.includes('"aggregateType":"TaskRequeue"'));
}

/**
 * A real GV-10 head on an adopted stage gate. PB1's frozen requirement is `test`,
 * while registered command checks only cover `static`/`dynamic`; rewriting it
 * or asserting a fake PASS would invalidate the fixture. The evidence owner
 * therefore opens with an explicit uncovered requirement and finalizes it as
 * INCONCLUSIVE. Its first automatic reverify is eligible at GV-10 (no refusal).
 * Both existing work Runs really enter/end. An operator cancels b-work in
 * stage-b (TASK-19), retains required/active b-work-2 outside that stage, and
 * adds a stage gate carrying a new required obligation. This preserves the
 * frozen goal gate and satisfies plan admission without a GV-5 fix in scope.
 */
export async function gateHead(f: S5DecisionFixture, owners: BOwners) {
  expect(await f.settleRunRA()).toMatchObject({ status: 'ended', outcome: 'completed' });
  expect(await f.enterClaim(f.claimRB)).toMatchObject({ status: 'running' });
  expect(await f.settleRun(f.claimRB)).toMatchObject({ status: 'ended', outcome: 'completed' });
  const goal = await goalAt(f.records);
  const plan = ready(await owners.plans.queryTaskGraph(f.ctx, { goalRef: GOAL_B })).plan;
  expect(plan.ref).toEqual(PLAN_B1);
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: 's5r2-b-gate-plan', planRevision: 2, goalId: GOAL_B.goalId,
    stages: structuredClone(plan.stages),
    tasks: [...plan.tasks.map(task => task.taskId === 'b-work'
      ? { ...task, disposition: 'cancelled' as const } : structuredClone(task)),
    { taskId: 'b-stage-gate', title: 'Stage B verification', requirementLevel: 'required', taskKind: 'gate',
      disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'stage-b' } }],
    assignments: structuredClone(plan.assignments ?? []),
    obligations: [...structuredClone(plan.obligations), {
      obligationId: 's5r2-b-stage-obligation', title: 'Verify stage B', requirementLevel: 'required',
      taskIds: ['b-stage-gate'], verificationRequirements: [{ requirementId: 's5r2-b-stage-check',
        requirementLevel: 'required', kind: 'test', description: 'Stage B tests pass' }],
    }],
    taskHierarchy: structuredClone(plan.taskHierarchy), executionDag: structuredClone(plan.executionDag),
    taskRelations: [], inputRequirements: [],
  };
  const proposed = committed(await owners.plans.proposePlan(f.ctx, {
    input: { goalRef: GOAL_B, basedOn: plan.ref, draft,
      reason: { text: 'Retire ended stage work and add its verification gate; retain work outside the stage', sources: [],
        affectedTaskIds: ['b-work', 'b-stage-gate'] } },
    meta: { requestId: 's5r2-b-gate-propose', expected: [{ ref: GOAL_B, revision: goal.revision }] },
  }));
  expect(proposed.value.issues).toEqual([]);
  const adopted = committed(await owners.plans.applyPlanChange(f.ctx, {
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
    meta: { requestId: 's5r2-b-gate-adopt', expected: [{ ref: GOAL_B, revision: goal.revision }] },
  }));
  const graph = ready(await owners.plans.queryTaskGraph(f.ctx, { goalRef: GOAL_B }));
  expect(graph.tasks.map(task => ({ taskId: task.ref.taskId, disposition: task.disposition }))).toEqual([
    { taskId: 'b-work', disposition: 'cancelled' }, { taskId: 'b-work-2', disposition: 'active' },
    { taskId: 'b-gate', disposition: 'active' }, { taskId: 'b-stage-gate', disposition: 'active' },
  ]);
  expect(graph.plan.tasks.find(task => task.taskId === 'b-work-2')).toMatchObject({
    requirementLevel: 'required', taskKind: 'work', disposition: 'active', scope: { kind: 'goal' },
  });
  expect(graph.plan.tasks.find(task => task.taskId === 'b-stage-gate')).toMatchObject({
    requirementLevel: 'required', taskKind: 'gate', disposition: 'active',
    scope: { kind: 'stage', stageId: 'stage-b' },
  });
  // plan-service.ts gateCoverage: a stage gate covers only non-goal work in
  // its own stage. The sole covered work is cancelled, so GV-5 is false.
  expect(graph.plan.tasks.filter(task => task.taskKind === 'work' && task.scope.kind !== 'goal'
    && task.scope.stageId === 'stage-b').map(task => ({ taskId: task.taskId, disposition: task.disposition })))
    .toEqual([{ taskId: 'b-work', disposition: 'cancelled' }]);
  expect(graph.plan.obligations.find(obligation => obligation.obligationId === 's5r2-b-stage-obligation'))
    .toEqual({ obligationId: 's5r2-b-stage-obligation', title: 'Verify stage B', requirementLevel: 'required',
      taskIds: ['b-stage-gate'], verificationRequirements: [{ requirementId: 's5r2-b-stage-check',
        requirementLevel: 'required', kind: 'test', description: 'Stage B tests pass' }] });
  const opened = committed(await owners.evidence.openVerification(f.ctx, {
    input: { subject: { projectId: 'P', goalId: 'B', taskId: 'b-stage-gate' },
      subjectRunRef: f.claimRA.runRef, planRef: adopted.value.ref, gateSubject: 'stage' },
    meta: { requestId: 's5r2-b-gate-open', expected: [] },
  }));
  expect(opened.value).toMatchObject({ status: 'open', revision: 1, checks: [],
    chain: { ordinal: 1, autoCount: 0, predecessorRoundRef: null } });
  expect(opened.value.gaps).toEqual([
    { code: 'uncovered_requirement', message: 'no registered check covers required requirement PB1-check',
      coverage: { obligationId: 'PB1-obligation', requirementId: 'PB1-check' } },
    { code: 'uncovered_requirement', message: 'no registered check covers required requirement s5r2-b-stage-check',
      coverage: { obligationId: 's5r2-b-stage-obligation', requirementId: 's5r2-b-stage-check' } },
  ]);
  const finalized = committed(await owners.evidence.finalizeChecks(f.ctx, {
    input: { roundRef: opened.value.ref },
    meta: { requestId: 's5r2-b-gate-finalize', expected: [{ ref: opened.value.ref, revision: 1 }] },
  }));
  expect(finalized.value).toMatchObject({ outcome: 'INCONCLUSIVE', evidence: [],
    snapshot: { ref: opened.value.ref, revision: 2, status: 'finalized', outcome: 'INCONCLUSIVE',
      chain: { ordinal: 1, autoCount: 0 } } });
  const after = ready(await owners.plans.queryTaskGraph(f.ctx, { goalRef: GOAL_B }));
  expect(after.tasks.find(task => task.ref.taskId === 'b-stage-gate')).toMatchObject({
    effectivePhase: 'blocked', disposition: 'active', failure: { subjectKind: 'gate',
      runRef: f.claimRA.runRef, round: { roundRef: opened.value.ref, revision: 2, status: 'finalized', outcome: 'INCONCLUSIVE' },
      automation: { cap: 3, lastReverifyRefusal: null, verdict: { kind: 'reverify',
        roundRef: opened.value.ref, needsFinalize: false, onlyIfSourceChanged: false,
        failureClass: 'check_incomplete', retryAfterRefusal: false } } },
  });
  return finalized.value.snapshot;
}

/**
 * R2B03/R2B04 setup limitation (UNDETERMINED): select_work waits for every
 * required work Task in the Goal and refuses explicit gate selection
 * (workflow.ts:1398-1421), even when GV-10 permits this stage gate. The frozen
 * fixture's `test` requirement cannot be covered by registered static/dynamic
 * checks, so its remaining work cannot honestly be marked satisfied either.
 * Enter the real shared confirmation policy through perform/reverify_round
 * with the committed head and refusal-absence pins (workflow.ts:257-274).
 * This tests the emitted card's pause/answer behavior, not gate selection.
 */
export function gateReverify(flowId: string, head: RoundSnapshot): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: GOAL_B, flowId, sessionHint: null, kind: 'perform',
    operation: { kind: 'reverify_round', request: {
      input: { predecessorRoundRef: head.ref, reason: 'auto-reverify:check_incomplete#1' },
      meta: { requestId: `${flowId}:reverify`, expected: [
        { ref: head.ref, revision: 2 },
        { ref: { aggregateType: 'TaskReworkRefusal', projectId: 'P', goalId: 'B', taskId: 'b-stage-gate',
          operation: 'reverify', subjectId: head.ref.roundId }, revision: 0 },
      ] },
    } } };
}

/** Refresh only the Goal CAS pin from a real pause receipt, keeping the emitted identity. */
export function pausedSource(source: DecisionSourceV1, goalRevision: number): DecisionSourceV1 {
  expect(source.pins.filter(pin => keyOf(pin.ref) === keyOf(GOAL_B))).toHaveLength(1);
  return { ...structuredClone(source), pins: source.pins.map(pin => keyOf(pin.ref) === keyOf(GOAL_B)
    ? { ref: GOAL_B, revision: goalRevision } : structuredClone(pin)) };
}
