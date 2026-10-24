/**
 * A.2 step 5.8, part 2: the Workflow acts on the automation verdict
 * (docs/refactor/STATE-MACHINES-SPEC.md §4.3 "Workflow", §15.2 5.8; C8, TD-6,
 * AV-3, AV-11, AV-12, ND-7, ND-8, §13.4 #19, #21) over controlled owner doubles.
 *
 * - `select_work` reads each work Task's `TaskRow.failure.automation.verdict`
 *   first: `requeue` returns the automatic `requeue_task` (reason
 *   `auto-rework:<class>#<autoCount>`, `expected` pinning the Goal, the afterRun
 *   and `TaskReworkRefusal@k`, k = 0 without a refusal) whose requestId is
 *   derived from the request alone, so another flow or operator sends the same
 *   identity (W-23); a stale refusal's retry pins @k and so is a new request;
 *   `stopped/budget_exhausted` requeues only with the binding's larger budget;
 *   `stopped` skips this Task's rework while the other Tasks continue, and a
 *   fenced Task's completed Run still has its round opened and its PASS head
 *   completed (AV-4, STEP5-FLIPS §14); a Task on an invalid round chain
 *   (`round_ambiguous`) is skipped without reading the chain; a requeued Task
 *   (P4) is claimed only while its verdict is `claim_requeued`.
 * - `perform requeue_task` calls the owner once as `WORKFLOW_AUTOMATION_ACTOR`
 *   (`automationContext`) and maps the answer: a commit (`requeued` or
 *   `refused`) and `revision_conflict` → `select_work`; any other refusal →
 *   `waiting('<code>: …')`.
 * - (A.2 step 6, OWED §1) W-21's Session choice for a `claim_requeued` Task whose afterRun claim
 *   Session is `recoverable` (wait) or `not_found` (`chooseSession(null)`): branches no Host scenario
 *   reaches on clean data.
 *
 * Only the owners a step reads answer; every other port throws if touched. The
 * real platform path is `tests/scenarios/A1-rework-same-session.test.ts`.
 */
import { expect, it } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowOperation } from '../../src/business/workflow/contracts.js';
import type { WorkflowDependencies } from '../../src/business/workflow/ports.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { CoreRejection, WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef, RunSnapshot, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { RuntimeTask } from '../../src/contracts/plan.js';
import type { TaskAutomationVerdictV1, TaskFailureFactsV1 } from '../../src/contracts/task-failure.js';
import { WORKFLOW_AUTOMATION_ACTOR, type TaskRequeueOutcomeV1, type TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type { RequeueTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import type { TaskRow } from '../../src/core/work-graph/model/plan-contracts.js';

const P = 'a2-rework-project', W = 'a2-rework-workspace', G = 'a2-rework-goal';
const actor = { kind: 'human' as const, id: 'a2-rework-operator' };
const signal = new AbortController().signal;
const ctx: CoreCallContext = { projectId: P, workspaceId: W, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId: P, workspaceId: W, actor }, signal };
const goalRef = { aggregateType: 'Goal' as const, projectId: P, goalId: G };
const planRef = { aggregateType: 'PlanRevision' as const, projectId: P, planId: 'a2-rework-plan', revision: 1 };
const BINDING_BUDGET: TaskBudgetV1 = { tokenBudget: 1000, deadline: null };
const goal: GoalSnapshot = { ref: goalRef, workspaceRef: { aggregateType: 'Workspace', projectId: P, workspaceId: W },
  objective: 'A2 rework', desiredState: 'active', desiredStateRevision: 1, desiredStateRequestedBy: null,
  activePlanRevision: planRef as never, revision: 3, since: 'c0000000001' as GoalSnapshot['since'] };

const runRefOf = (taskId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId: `run-${taskId}` });
const refusalRefOf = (taskId: string) => ({ aggregateType: 'TaskReworkRefusal' as const, projectId: P, goalId: G, taskId,
  operation: 'requeue' as const, subjectId: `run-${taskId}` });

function failureOf(taskId: string, verdict: TaskAutomationVerdictV1,
  over: { failureClass?: TaskFailureFactsV1['failureClass']; count?: number; refusalRevision?: number } = {}): TaskFailureFactsV1 {
  return {
    subjectKind: 'work', runRef: runRefOf(taskId), runRevision: 5, attemptRef: null, sessionRef: null,
    failureClass: over.failureClass ?? 'check_failed', notReworkableCause: null, run: null, interruption: null, stop: null,
    round: null, source: { atFailure: null, lastChecked: null, sinceFailure: 'unknown' }, requeueActors: ['human', 'system'],
    reverifyActors: [],
    automation: { cap: 3, requeueAutoCount: over.count ?? 0, coveringRequeue: null, verdict, lastReverifyRefusal: null,
      lastRefusal: over.refusalRevision === undefined ? null : { ref: refusalRefOf(taskId), revision: over.refusalRevision,
        code: 'no_new_basis', reason: 'no new basis', requestedBy: { ...WORKFLOW_AUTOMATION_ACTOR }, refusedAt: 't', stale: true } },
  };
}
function definitionOf(taskId: string): RuntimeTask {
  return { taskId, title: taskId, requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'goal' }, executionIntent: 'request_execution' };
}
function rowOf(taskId: string, failure: TaskFailureFactsV1 | undefined, over: Partial<TaskRow> = {}): TaskRow {
  return { ref: { projectId: P, goalId: G, taskId }, definition: definitionOf(taskId), effectivePhase: 'failed',
    disposition: 'active', currentAttempt: null, execution: runRefOf(taskId), eligibilityScope: 'task_state',
    eligibility: { eligible: false, reasons: [] } as never, relations: [], inputRequirements: [], legacyDependencies: [],
    ...(failure === undefined ? {} : { failure }), ...over };
}

/** Every port throws unless the test gives it an answer. */
function untouched<T extends object>(name: string): T {
  return new Proxy({}, { get: (_target, member) => () => { throw new Error(`${name}.${String(member)} must not be called`); } }) as T;
}
type RequeueCall = { ctx: CoreCallContext; request: GraphWrite<RequeueTaskInput> };
function workflowWith(rows: TaskRow[], options: {
  requeue?: (request: GraphWrite<RequeueTaskInput>) => WriteResult<TaskRequeueOutcomeV1>; noRequeuePort?: boolean;
  executions?: WorkflowDependencies['executions']; evidence?: WorkflowDependencies['evidence'];
  sessions?: WorkflowDependencies['sessions'];
} = {}) {
  const calls: RequeueCall[] = [];
  const tasks = rows.map(row => row.definition);
  const deps: WorkflowDependencies = {
    tasks: untouched('tasks'), sessions: options.sessions ?? untouched('sessions'), executions: options.executions ?? untouched('executions'),
    runtime: untouched('runtime'), evidence: options.evidence ?? untouched('evidence'), checks: untouched('checks'),
    sourceAuthority: untouched('sourceAuthority'),
    plans: { ...untouched<WorkflowDependencies['plans']>('plans'),
      queryGoal: async () => ({ status: 'ready', value: { goal } }) as never,
      queryTaskGraph: async () => ({ status: 'ready', value: { plan: { ref: planRef, tasks,
        assignments: tasks.map(task => ({ taskId: task.taskId, role: 'builder', instruction: 'work' })) }, tasks: rows } }) as never },
    // A claim owner without the optional `requeueTask` member (the Proxy would answer every member).
    claims: options.noRequeuePort === true ? { claimTask: untouched<WorkflowDependencies['claims']>('claims').claimTask }
      : { ...untouched<WorkflowDependencies['claims']>('claims'),
      requeueTask: async (callCtx, request) => {
        calls.push({ ctx: callCtx, request });
        if (options.requeue === undefined) throw new Error('requeueTask must not be called');
        return options.requeue(request);
      } },
    configuration: { consumerId: 'a2-rework-consumer', bindings: [{ workspace: { projectId: P, workspaceId: W },
      sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: { schemaVersion: 1, bindingId: 'b', templateId: 'builder', templateRevision: '1', bindingVersion: 1,
        policyRevision: 'p' }, budget: BINDING_BUDGET }] },
  };
  return { workflow: createWorkflow(deps), calls };
}
const selectWork = (taskId?: string): WorkflowAdvanceInput => ({ schemaVersion: 1, goalRef, flowId: 'a2-rework-flow',
  sessionHint: null, kind: 'select_work', ...(taskId === undefined ? {} : { taskId }) });
const REQUEUE: TaskAutomationVerdictV1 = { kind: 'requeue', failureClass: 'check_failed', retryAfterRefusal: false };

/** The `requeue_task` request a `select_work` answered with (asserting the answer's shape). */
async function requeueRequestOf(workflow: ReturnType<typeof createWorkflow>, input: WorkflowAdvanceInput, callCtx = ctx): Promise<{
  next: WorkflowAdvanceInput; request: GraphWrite<RequeueTaskInput> }> {
  const result = await workflow.advanceWork(callCtx, input);
  expect(result).toMatchObject({ status: 'ready', value: { state: 'advance', receipt: null, reason: null,
    next: { kind: 'perform', operation: { kind: 'requeue_task' } } } });
  if (result.status !== 'ready' || result.value.next?.kind !== 'perform' || result.value.next.operation.kind !== 'requeue_task') {
    throw new Error('a requeue_task was expected');
  }
  return { next: result.value.next, request: result.value.next.operation.request };
}

it('AV-12: select_work returns the automatic requeue pinned to the Goal, the afterRun and the absent refusal (k = 0)', async () => {
  const { workflow, calls } = workflowWith([rowOf('work-1', failureOf('work-1', REQUEUE))]);
  const { next, request } = await requeueRequestOf(workflow, selectWork('work-1'));
  expect(next).toMatchObject({ flowId: 'a2-rework-flow', taskId: 'work-1', sessionHint: null });
  expect(request.input).toEqual({ taskRef: { projectId: P, goalId: G, taskId: 'work-1' }, afterRunRef: runRefOf('work-1'),
    reason: 'auto-rework:check_failed#1' });
  expect(request.meta.expected).toEqual([{ ref: goalRef, revision: 3 }, { ref: runRefOf('work-1'), revision: 5 },
    { ref: refusalRefOf('work-1'), revision: 0 }]);
  expect(request.meta.requestId).toMatch(/^wf-auto:[0-9a-f]{64}$/);
  // The selection only reads: no owner write happened.
  expect(calls).toHaveLength(0);
});

it('W-23: the requestId is derived from the request alone, so another flow and operator send the same identity and the owner replays its receipt', async () => {
  const rows = [rowOf('work-1', failureOf('work-1', REQUEUE))];
  // A one-request ledger: the same requestId replays the recorded answer (the owner's identity rule).
  const ledger = new Map<string, WriteResult<TaskRequeueOutcomeV1>>();
  const owner = (request: GraphWrite<RequeueTaskInput>): WriteResult<TaskRequeueOutcomeV1> => {
    const recorded = ledger.get(request.meta.requestId);
    if (recorded !== undefined && recorded.status === 'committed') return { ...recorded, replayed: true };
    const answer = committed({ kind: 'requeued', requeue: { ref: { afterRunId: 'run-work-1' } } as never });
    ledger.set(request.meta.requestId, answer);
    return answer;
  };
  const { workflow, calls } = workflowWith(rows, { requeue: owner });
  // A UI 推进 flow selecting the Task, then the start-up re-drive's own flow at Goal level under another operator.
  const ui = await requeueRequestOf(workflow, selectWork('work-1'));
  const redriveActor = { kind: 'system' as const, id: 'a2-rework-redrive' };
  const redriveCtx: CoreCallContext = { ...ctx, principal: { kind: 'host', actor: redriveActor },
    materialReader: { kind: 'host', projectId: P, workspaceId: W, actor: redriveActor } };
  const redrive = await requeueRequestOf(workflow, { ...selectWork(), flowId: `startup-redrive:${G}` }, redriveCtx);
  expect(redrive.request).toEqual(ui.request);
  expect(await workflow.advanceWork(ctx, ui.next)).toMatchObject({ status: 'ready', value: { state: 'advance',
    receipt: { kind: 'requeue_task', result: { status: 'committed', replayed: false } } } });
  // The answer is lost; the other driver's retry gets the original receipt, not a second request.
  expect(await workflow.advanceWork(redriveCtx, redrive.next)).toMatchObject({ status: 'ready', value: { state: 'advance',
    next: { kind: 'select_work', flowId: `startup-redrive:${G}` },
    receipt: { kind: 'requeue_task', result: { status: 'committed', replayed: true } } } });
  expect(calls.map(call => call.request.meta.requestId)).toEqual([ui.request.meta.requestId, ui.request.meta.requestId]);
  expect(ledger.size).toBe(1);
});

it('ND-8, §13.4 #21: the retry after a stale refusal pins TaskReworkRefusal@k, so it is a new request with a new requestId', async () => {
  const fresh = await requeueRequestOf(workflowWith([rowOf('work-1', failureOf('work-1', REQUEUE, { count: 1 }))]).workflow,
    selectWork('work-1'));
  const retry = await requeueRequestOf(workflowWith([rowOf('work-1', failureOf('work-1',
    { ...REQUEUE, retryAfterRefusal: true }, { count: 1, refusalRevision: 1 }))]).workflow, selectWork('work-1'));
  expect(fresh.request.input.reason).toBe('auto-rework:check_failed#2');
  expect(retry.request.meta.expected[2]).toEqual({ ref: refusalRefOf('work-1'), revision: 1 });
  expect(retry.request.meta.requestId).not.toBe(fresh.request.meta.requestId);
});

it('ND-7: an interruption is requeued without counting it; the reason keeps the current count', async () => {
  const { request } = await requeueRequestOf(workflowWith([rowOf('work-1', failureOf('work-1',
    { kind: 'requeue', failureClass: 'interrupted', retryAfterRefusal: false }, { failureClass: 'interrupted', count: 1 }))]).workflow,
  selectWork('work-1'));
  expect(request.input.reason).toBe('auto-rework:interrupted#1');
  expect(request.input).not.toHaveProperty('budget');
});

it('AV-11, §13.4 #19: stopped/budget_exhausted is requeued only with the binding\'s larger budget', async () => {
  const exhausted = (floor: number): TaskAutomationVerdictV1 => ({ kind: 'stopped', reason: 'budget_exhausted',
    detail: { minTokenBudgetExclusive: floor } });
  const { request } = await requeueRequestOf(workflowWith([rowOf('work-1', failureOf('work-1', exhausted(500),
    { failureClass: 'run_failed' }))]).workflow, selectWork('work-1'));
  expect(request.input).toMatchObject({ reason: 'auto-rework:run_failed#1', budget: BINDING_BUDGET });
  // The binding's budget is not larger: the stop stands and nothing is requeued.
  const same = workflowWith([rowOf('work-1', failureOf('work-1', exhausted(1000), { failureClass: 'run_failed' }))]);
  expect(await same.workflow.advanceWork(ctx, selectWork('work-1'))).toMatchObject({ status: 'ready',
    value: { state: 'waiting', next: null, reason: 'the selected Task work-1 is not executable right now' } });
  expect(same.calls).toHaveLength(0);
});

it('§4.3 "stopped": a stopped Task is skipped and the next Task of the Goal is reworked', async () => {
  const capped: TaskAutomationVerdictV1 = { kind: 'stopped', reason: 'auto_rework_cap_reached', detail: { operation: 'requeue' } };
  const { workflow } = workflowWith([rowOf('work-1', failureOf('work-1', capped)), rowOf('work-2', failureOf('work-2', REQUEUE))]);
  const { next, request } = await requeueRequestOf(workflow, selectWork());
  expect(next).not.toHaveProperty('taskId');
  expect(request.input.taskRef.taskId).toBe('work-2');
  // With the stopped Task alone, the Goal waits on its gap; no rework is attempted.
  expect(await workflowWith([rowOf('work-1', failureOf('work-1', capped))]).workflow.advanceWork(ctx, selectWork()))
    .toMatchObject({ status: 'ready', value: { state: 'waiting', next: null,
      reason: 'required work cannot advance: work-1: failed with an existing Run' } });
});

/** A formally completed Run of `taskId` with nothing left to reconcile, read through `readExecution`. */
function completedRunReads(taskId: string): { executions: WorkflowDependencies['executions']; reads: RunRef[] } {
  const reads: RunRef[] = [];
  const run = { ref: runRefOf(taskId), task: { projectId: P, goalId: G, taskId }, revision: 5, status: 'ended',
    outcome: 'completed' } as unknown as RunSnapshot;
  return { reads, executions: { ...untouched<WorkflowDependencies['executions']>('executions'),
    readExecution: async (_callCtx, runRef) => {
      reads.push(runRef);
      return { status: 'ready', value: { run } } as never;
    } } };
}
/** The chain-head read of a work Run, answering `answer` and recording each subject Run read. */
function chainHeadReads(answer: unknown): { evidence: WorkflowDependencies['evidence']; reads: RunRef[] } {
  const reads: RunRef[] = [];
  return { reads, evidence: { ...untouched<WorkflowDependencies['evidence']>('evidence'),
    queryOriginalVerification: async (_callCtx, query) => {
      reads.push(query.subjectRunRef);
      return answer as never;
    } } };
}
it('§4.3 "stopped", AV-6 (FC-11, P10): a Task on an invalid round chain is skipped without reading its Run or chain; the next Task is reworked', async () => {
  const ambiguous: TaskAutomationVerdictV1 = { kind: 'stopped', reason: 'not_reworkable', detail: { cause: 'round_ambiguous' } };
  const invalid = rowOf('work-1', { ...failureOf('work-1', ambiguous), failureClass: null, notReworkableCause: 'round_ambiguous' },
    { effectivePhase: 'blocked' });
  // The chain read of the invalid chain answers `incomplete`, as the evidence owner does (VD-14).
  const runs = completedRunReads('work-1');
  const chains = chainHeadReads({ status: 'rejected', code: 'incomplete', reason: 'the round chain is invalid' });
  const { workflow } = workflowWith([invalid, rowOf('work-2', failureOf('work-2', REQUEUE))],
    { executions: runs.executions, evidence: chains.evidence });
  const { request } = await requeueRequestOf(workflow, selectWork());
  expect(request.input.taskRef.taskId).toBe('work-2');
  // Alone, the Goal waits on its gap, not on the chain read.
  const alone = workflowWith([invalid], { executions: runs.executions, evidence: chains.evidence });
  expect(await alone.workflow.advanceWork(ctx, selectWork())).toMatchObject({ status: 'ready', value: { state: 'waiting',
    next: null, reason: 'required work cannot advance: work-1: blocked with an existing Run' } });
  expect(runs.reads).toEqual([]);
  expect(chains.reads).toEqual([]);
});

it('AV-3: a requeued Task (P4) is claimed only while its verdict is claim_requeued; a stopped verdict claims nothing', async () => {
  const requeueRef: TaskRequeueRef = { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: 'work-1', afterRunId: 'run-work-1' };
  const unknown: TaskAutomationVerdictV1 = { kind: 'stopped', reason: 'unknown_outcome', detail: {} };
  // The executions/sessions ports throw if the claim path is tried.
  const { workflow } = workflowWith([rowOf('work-1', failureOf('work-1', unknown), { effectivePhase: 'pending', requeueRef,
    eligibility: { eligible: true, reasons: [] } as never })]);
  expect(await workflow.advanceWork(ctx, selectWork('work-1'))).toMatchObject({ status: 'ready',
    value: { state: 'waiting', next: null, reason: 'the selected Task work-1 is not executable right now' } });
});

it('a Host whose claim owner publishes no requeueTask selects no automatic requeue and refuses the step as unsupported', async () => {
  const { workflow } = workflowWith([rowOf('work-1', failureOf('work-1', REQUEUE))], { noRequeuePort: true });
  expect(await workflow.advanceWork(ctx, selectWork('work-1'))).toMatchObject({ status: 'ready',
    value: { state: 'waiting', next: null } });
  const perform: WorkflowAdvanceInput = { ...selectWork('work-1'), kind: 'perform',
    operation: { kind: 'requeue_task', request: { input: {}, meta: { requestId: 'r', expected: [] } } } as unknown as WorkflowOperation };
  expect(await workflow.advanceWork(ctx, perform)).toEqual({ status: 'rejected', code: 'unsupported',
    reason: 'the Task claim owner does not publish requeueTask' });
});

const committed = (value: TaskRequeueOutcomeV1): WriteResult<TaskRequeueOutcomeV1> =>
  ({ status: 'committed', value, replayed: false, cursor: 'cursor-1' as never });
const rejected = (code: CoreRejection['code'], reason: string): WriteResult<TaskRequeueOutcomeV1> => ({ status: 'rejected', code, reason });

it.each([
  ['a committed requeue', committed({ kind: 'requeued', requeue: { ref: { afterRunId: 'run-work-1' } } as never })],
  ['a committed policy refusal', committed({ kind: 'refused', refusal: { code: 'no_new_basis' } as never })],
  ['a revision_conflict (another write moved the facts)', rejected('revision_conflict', 'the Goal changed since the caller read it')],
])('perform requeue_task: %s goes back to select_work with the receipt kept', async (_label, answer) => {
  const { workflow, calls } = workflowWith([rowOf('work-1', failureOf('work-1', REQUEUE))], { requeue: () => answer });
  const { next } = await requeueRequestOf(workflow, selectWork('work-1'));
  const result = await workflow.advanceWork(ctx, next);
  expect(result).toEqual({ status: 'ready', value: { state: 'advance', reason: null, next: selectWork('work-1'),
    receipt: { kind: 'requeue_task', result: answer } } });
  // TD-6: the owner is called once, as the Workflow automation actor in the same trusted scope and signal.
  expect(calls).toHaveLength(1);
  const call = calls[0]!;
  expect(call.ctx).toEqual({ projectId: P, workspaceId: W, principal: { kind: 'host', actor: WORKFLOW_AUTOMATION_ACTOR },
    materialReader: { kind: 'host', projectId: P, workspaceId: W, actor: WORKFLOW_AUTOMATION_ACTOR }, signal });
  expect(call.ctx.signal).toBe(signal);
  if (next.kind !== 'perform' || next.operation.kind !== 'requeue_task') throw new Error('a requeue_task was expected');
  expect(call.request).toEqual(next.operation.request);
});

it.each([
  ['busy', 'resume the Goal first'],
  ['forbidden', 'the caller cannot rework this Task'],
  ['unavailable', 'the workspace source is not readable: gone'],
])('perform requeue_task: a %s refusal waits with its code', async (code, reason) => {
  const answer = rejected(code as CoreRejection['code'], reason);
  const { workflow } = workflowWith([rowOf('work-1', failureOf('work-1', REQUEUE))], { requeue: () => answer });
  const { next } = await requeueRequestOf(workflow, selectWork('work-1'));
  expect(await workflow.advanceWork(ctx, next)).toEqual({ status: 'ready', value: { state: 'waiting', next: null,
    reason: `${code}: ${reason}`, receipt: { kind: 'requeue_task', result: answer } } });
});

// A.2 step 6 (OWED §1, W-21 beyond the reusable, occupied, kernel_turn_open and archived branches the Host scenarios
// drive): `recoverable` health is written by no production path and a claim Session that is `not_found` needs a
// deleted record, so these two branches are proved here over owner doubles.
it.each([
  ['recoverable', 'waits rather than moving the continuation off its history'],
  ['not_found', 'goes to the default selection without a hint (chooseSession(null)) and opens a new Session with the requeue'],
])('W-21 (§12.2, A.2 step 6): a requeued Task whose afterRun claim Session is %s %s', async (state: string, _branch: string) => {
  const requeueRef: TaskRequeueRef = { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: 'work-1', afterRunId: 'run-work-1' };
  const claimSession = { projectId: P, sessionId: 'claim-session-1' };
  const reads: string[] = [];
  const builder = { kind: 'legacy_template' as const, templateId: 'builder', templateRevision: '1' };
  const executions = { ...untouched<WorkflowDependencies['executions']>('executions'),
    readExecution: async (_ctx: CoreCallContext, runRef: RunRef) => {
      reads.push(`readExecution ${runRef.runId}`);
      return { status: 'ready', value: { run: { ref: runRef }, outbox: { claim: { sessionRef: claimSession } } } } as never;
    } } as WorkflowDependencies['executions'];
  const sessions = { ...untouched<WorkflowDependencies['sessions']>('sessions'),
    readSession: async (_ctx: CoreCallContext, sessionRef: { sessionId: string }) => {
      reads.push(`readSession ${sessionRef.sessionId}`);
      if (state === 'not_found') return { status: 'not_found' } as never;
      return { status: 'ready', value: { record: { ref: { aggregateType: 'Session', ...claimSession }, revision: 4, workspaceId: W,
        lifecycle: 'active', health: 'recoverable', occupancy: null, role: builder }, links: [] } } as never;
    },
    findSessions: async () => {
      reads.push('findSessions');
      return { status: 'ready', value: { items: [], nextCursor: null } } as never;
    } } as WorkflowDependencies['sessions'];
  const claimRequeued: TaskAutomationVerdictV1 = { kind: 'claim_requeued', requeueRef, budget: null };
  const { workflow } = workflowWith([rowOf('work-1', failureOf('work-1', claimRequeued), { effectivePhase: 'pending', requeueRef,
    eligibility: { eligible: true, reasons: [] } as never })], { executions, sessions });
  const result = await workflow.advanceWork(ctx, selectWork('work-1'));
  if (state === 'recoverable') {
    expect(result).toEqual({ status: 'ready', value: { state: 'waiting', next: null, receipt: null,
      reason: 'the afterRun claim Session is recoverable' } });
    expect(reads, 'no other Session is looked for').toEqual(['readExecution run-work-1', 'readSession claim-session-1']);
  } else {
    expect(result).toMatchObject({ status: 'ready', value: { state: 'advance', receipt: null, next: { kind: 'perform',
      operation: { kind: 'create_session', requeue: { requeueRef, budget: null } } } } });
    // chooseSession(hint=null): no hint is read, the directory is (and has no reusable Session of the role).
    expect(reads).toEqual(['readExecution run-work-1', 'readSession claim-session-1', 'findSessions']);
  }
});
