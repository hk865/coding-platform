/**
 * A.2 step 5.9, part 2: the Workflow's automatic successor round (C5; docs/refactor/STATE-MACHINES-SPEC.md
 * §15.2 5.9, §9 VD-12 and the VR-14 Workflow row of §9.6, §13.7 points 4 and 9, §4 AV-7a..AV-7d and the GV
 * table) over controlled owner doubles.
 *
 * - `select_work` reads a work Task's `reverify` verdict (AV-7d) on its finalized chain head and returns
 *   `perform reverify_round`: `predecessorRoundRef` = the head the failure facts read, `expected` pinning
 *   the head at its revision and `TaskReworkRefusal(reverify, head)@k` (k = 0 without a refusal), reason
 *   `auto-reverify:<class>#<autoCount>` (a Host-interruption exemption keeps the count), and a requestId
 *   derived from the request alone, so another flow or operator sends the same identity (W-23) and a
 *   stale refusal's retry is a new request. With `needsFinalize` (FC-13) the open head is finalized first.
 *   A finalized non-PASS head whose verdict is `stopped` skips the Task; the other Tasks continue.
 * - A gate: GV-9 (`reverify` with `onlyIfSourceChanged`) and GV-10 (INCONCLUSIVE, without it) return the
 *   same step for the gate's own chain head; with GV-3's `needsFinalize` the gate's open head is finalized
 *   first; a `stopped` gate (GV-8 `gate_needs_fix`, and the other stop reasons) waits with the stop reason
 *   as its code and what a person can do about it.
 * - `perform reverify_round` calls the evidence owner once as `WORKFLOW_AUTOMATION_ACTOR`
 *   (`automationContext`) and maps the answer as 5.8: a commit (`reverified` or `refused`) and
 *   `revision_conflict` → `select_work`; any other refusal → `waiting('<code>: …')`; no `reverifyRound`
 *   port → no automatic successor and the step `unsupported`.
 * - `finalize_checks` answered `busy` on a round that is already finalized (a stale replay) goes back to
 *   `select_work`; `busy` on a round still open waits.
 *
 * Only the owners a step reads answer; every other port throws if touched. The real platform paths are
 * `tests/app/A2-automation-verdict.test.ts` (work) and `tests/scenarios/C5-gate-fix.test.ts`
 * (gate).
 */
import { expect, it } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowOperation } from '../../src/business/workflow/contracts.js';
import type { WorkflowDependencies } from '../../src/business/workflow/ports.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { CoreRejection, WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { RuntimeTask } from '../../src/contracts/plan.js';
import type { FailingCheckFactV1, TaskAutomationVerdictV1, TaskFailureFactsV1 } from '../../src/contracts/task-failure.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { RoundSnapshot, VerificationRoundRef } from '../../src/contracts/verification.js';
import type { ReverifyOutcomeV1, ReverifyRoundInput } from '../../src/core/work-graph/model/evidence-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type { TaskRow } from '../../src/core/work-graph/model/plan-contracts.js';

const P = 'a2-reverify-wf-project', W = 'a2-reverify-wf-workspace', G = 'a2-reverify-wf-goal';
const actor = { kind: 'human' as const, id: 'a2-reverify-wf-operator' };
const signal = new AbortController().signal;
const ctx: CoreCallContext = { projectId: P, workspaceId: W, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId: P, workspaceId: W, actor }, signal };
const goalRef = { aggregateType: 'Goal' as const, projectId: P, goalId: G };
const planRef = { aggregateType: 'PlanRevision' as const, projectId: P, planId: 'a2-reverify-wf-plan', revision: 1 };
const goal: GoalSnapshot = { ref: goalRef, workspaceRef: { aggregateType: 'Workspace', projectId: P, workspaceId: W },
  objective: 'A2 reverify', desiredState: 'active', desiredStateRevision: 1, desiredStateRequestedBy: null,
  activePlanRevision: planRef as never, revision: 3, since: 'c0000000001' as GoalSnapshot['since'] };

const runRefOf = (taskId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId: `run-${taskId}` });
const roundRefOf = (taskId: string, roundId = `round-${taskId}`, runId = 'run-work-1'): VerificationRoundRef =>
  ({ aggregateType: 'VerificationRound', projectId: P, workspaceId: W, goalId: G, taskId, runId, roundId });
const refusalRefOf = (taskId: string) => ({ aggregateType: 'TaskReworkRefusal' as const, projectId: P, goalId: G, taskId,
  operation: 'reverify' as const, subjectId: `round-${taskId}` });

const TIMED_OUT: FailingCheckFactV1 = { checkId: 'unit', phase: 'finished', outcome: 'INCONCLUSIVE', cause: 'process_timed_out',
  reportRef: null };
const HOST_RESTART: FailingCheckFactV1 = { checkId: 'unit', phase: 'interrupted', outcome: null, cause: 'host_restart',
  reportRef: null };
const FAILED: FailingCheckFactV1 = { checkId: 'unit', phase: 'finished', outcome: 'FAIL', cause: null, reportRef: null };

type HeadOptions = { outcome?: 'FAIL' | 'INCONCLUSIVE'; checks?: FailingCheckFactV1[]; gapCodes?: string[]; autoCount?: number };
function headOf(taskId: string, options: HeadOptions = {}): NonNullable<TaskFailureFactsV1['round']> {
  return { roundRef: roundRefOf(taskId), revision: 4, status: 'finalized', outcome: options.outcome ?? 'INCONCLUSIVE',
    failingChecks: options.checks ?? [TIMED_OUT], gapCodes: options.gapCodes ?? [], sourceDigest: 'a'.repeat(64),
    workspaceRevision: 2, ordinal: 1, autoCount: options.autoCount ?? 0 };
}
const reverifyOf = (taskId: string, over: Partial<Extract<TaskAutomationVerdictV1, { kind: 'reverify' }>> = {}): TaskAutomationVerdictV1 =>
  ({ kind: 'reverify', roundRef: roundRefOf(taskId), needsFinalize: false, onlyIfSourceChanged: false,
    failureClass: 'check_incomplete', retryAfterRefusal: false, ...over });

function failureOf(taskId: string, verdict: TaskAutomationVerdictV1,
  over: { head?: TaskFailureFactsV1['round']; refusalRevision?: number; subjectKind?: 'work' | 'gate' } = {}): TaskFailureFactsV1 {
  const head = over.head === undefined ? headOf(taskId) : over.head;
  return {
    subjectKind: over.subjectKind ?? 'work', runRef: runRefOf('work-1'), runRevision: 5, attemptRef: null, sessionRef: null,
    failureClass: head?.outcome === 'FAIL' ? 'check_failed' : 'check_incomplete', notReworkableCause: null, run: null,
    interruption: null, stop: null, round: head, source: { atFailure: null, lastChecked: null, sinceFailure: 'unknown' },
    requeueActors: [], reverifyActors: ['human', 'system', 'agent'],
    automation: { cap: 3, requeueAutoCount: 0, coveringRequeue: null, lastRefusal: null, verdict,
      lastReverifyRefusal: over.refusalRevision === undefined ? null : { ref: refusalRefOf(taskId), revision: over.refusalRevision,
        code: 'no_new_basis', reason: 'the same key as round 1', requestedBy: { ...WORKFLOW_AUTOMATION_ACTOR }, refusedAt: 't',
        stale: true } },
  };
}
function definitionOf(taskId: string, taskKind: 'work' | 'gate' = 'work'): RuntimeTask {
  return taskKind === 'gate'
    ? { taskId, title: taskId, requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending',
      scope: { kind: 'goal' } }
    : { taskId, title: taskId, requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
      scope: { kind: 'goal' }, executionIntent: 'request_execution' };
}
function rowOf(taskId: string, failure: TaskFailureFactsV1 | undefined, over: Partial<TaskRow> = {}): TaskRow {
  return { ref: { projectId: P, goalId: G, taskId }, definition: definitionOf(taskId), effectivePhase: 'blocked',
    disposition: 'active', currentAttempt: null, execution: runRefOf(taskId), eligibilityScope: 'task_state',
    eligibility: { eligible: false, reasons: [] } as never, relations: [], inputRequirements: [], legacyDependencies: [],
    ...(failure === undefined ? {} : { failure }), ...over };
}
const SATISFIED_WORK = rowOf('work-1', undefined, { effectivePhase: 'satisfied' });
const gateRowOf = (verdict: TaskAutomationVerdictV1, head = headOf('gate-1', { outcome: 'FAIL', checks: [FAILED] })): TaskRow =>
  rowOf('gate-1', failureOf('gate-1', verdict, { head, subjectKind: 'gate' }), { definition: definitionOf('gate-1', 'gate'),
    effectivePhase: 'failed', execution: null });

/** Every port throws unless the test gives it an answer. */
function untouched<T extends object>(name: string): T {
  return new Proxy({}, { get: (_target, member) => () => { throw new Error(`${name}.${String(member)} must not be called`); } }) as T;
}
type ReverifyCall = { ctx: CoreCallContext; request: GraphWrite<ReverifyRoundInput> };
function workflowWith(rows: TaskRow[], options: {
  reverify?: (request: GraphWrite<ReverifyRoundInput>) => WriteResult<ReverifyOutcomeV1>; noReverifyPort?: boolean;
  evidence?: Partial<WorkflowDependencies['evidence']>; executions?: WorkflowDependencies['executions'];
} = {}) {
  const calls: ReverifyCall[] = [];
  const tasks = rows.map(row => row.definition);
  const evidence: WorkflowDependencies['evidence'] = { ...untouched<WorkflowDependencies['evidence']>('evidence'), ...options.evidence };
  if (options.noReverifyPort === true) delete (evidence as { reverifyRound?: unknown }).reverifyRound;
  else {
    evidence.reverifyRound = async (callCtx, request) => {
      calls.push({ ctx: callCtx, request });
      if (options.reverify === undefined) throw new Error('reverifyRound must not be called');
      return options.reverify(request);
    };
  }
  const deps: WorkflowDependencies = {
    tasks: untouched('tasks'), sessions: untouched('sessions'), executions: options.executions ?? untouched('executions'),
    runtime: untouched('runtime'), evidence, checks: untouched('checks'), sourceAuthority: untouched('sourceAuthority'),
    plans: { ...untouched<WorkflowDependencies['plans']>('plans'),
      queryGoal: async () => ({ status: 'ready', value: { goal } }) as never,
      queryTaskGraph: async () => ({ status: 'ready', value: { plan: { ref: planRef, tasks,
        assignments: tasks.filter(task => task.taskKind === 'work').map(task => ({ taskId: task.taskId, role: 'builder',
          instruction: 'work' })) }, tasks: rows } }) as never },
    // No automatic requeue: the claim owner publishes none.
    claims: { claimTask: untouched<WorkflowDependencies['claims']>('claims').claimTask },
    configuration: { consumerId: 'a2-reverify-wf-consumer', bindings: [{ workspace: { projectId: P, workspaceId: W },
      sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: { schemaVersion: 1, bindingId: 'b', templateId: 'builder', templateRevision: '1', bindingVersion: 1,
        policyRevision: 'p' }, budget: { tokenBudget: 1000, deadline: null } }] },
  };
  return { workflow: createWorkflow(deps), calls };
}
const selectWork = (taskId?: string): WorkflowAdvanceInput => ({ schemaVersion: 1, goalRef, flowId: 'a2-reverify-wf-flow',
  sessionHint: null, kind: 'select_work', ...(taskId === undefined ? {} : { taskId }) });

/** The `reverify_round` request a `select_work` answered with (asserting the answer's shape). */
async function reverifyRequestOf(workflow: ReturnType<typeof createWorkflow>, input: WorkflowAdvanceInput, callCtx = ctx): Promise<{
  next: WorkflowAdvanceInput; request: GraphWrite<ReverifyRoundInput> }> {
  const result = await workflow.advanceWork(callCtx, input);
  expect(result).toMatchObject({ status: 'ready', value: { state: 'advance', receipt: null, reason: null,
    next: { kind: 'perform', operation: { kind: 'reverify_round' } } } });
  if (result.status !== 'ready' || result.value.next?.kind !== 'perform' || result.value.next.operation.kind !== 'reverify_round') {
    throw new Error('a reverify_round was expected');
  }
  return { next: result.value.next, request: result.value.next.operation.request };
}

it('AV-7d: select_work returns the automatic reverify_round pinned to the head and the absent refusal; the requestId is the request\'s alone (W-23)', async () => {
  const rows = [rowOf('work-1', failureOf('work-1', reverifyOf('work-1')))];
  const { workflow, calls } = workflowWith(rows);
  const { next, request } = await reverifyRequestOf(workflow, selectWork('work-1'));
  expect(next).toMatchObject({ flowId: 'a2-reverify-wf-flow', taskId: 'work-1', sessionHint: null });
  // No `onlyIfSourceChanged` for check_incomplete (AV-7d); the reason names the class and the successor's count.
  expect(request.input).toEqual({ predecessorRoundRef: roundRefOf('work-1'), reason: 'auto-reverify:check_incomplete#1' });
  expect(request.meta.expected).toEqual([{ ref: roundRefOf('work-1'), revision: 4 }, { ref: refusalRefOf('work-1'), revision: 0 }]);
  expect(request.meta.requestId).toMatch(/^wf-auto:[0-9a-f]{64}$/);
  // The start-up re-drive's own flow at Goal level, under another operator, sends the same request.
  const redriveActor = { kind: 'system' as const, id: 'a2-reverify-wf-redrive' };
  const redriveCtx: CoreCallContext = { ...ctx, principal: { kind: 'host', actor: redriveActor },
    materialReader: { kind: 'host', projectId: P, workspaceId: W, actor: redriveActor } };
  const redrive = await reverifyRequestOf(workflow, { ...selectWork(), flowId: `startup-redrive:${G}` }, redriveCtx);
  expect(redrive.request).toEqual(request);
  // The selection only reads: no owner write happened.
  expect(calls).toHaveLength(0);
});

it('§13.7 points 4 and 9: a Host-interruption exemption keeps the count; the retry after a stale refusal pins @k and is a new request', async () => {
  const interrupted = headOf('work-1', { checks: [HOST_RESTART], gapCodes: ['interrupted_check'], autoCount: 2 });
  const exempt = await reverifyRequestOf(workflowWith([rowOf('work-1', failureOf('work-1', reverifyOf('work-1'),
    { head: interrupted }))]).workflow, selectWork('work-1'));
  expect(exempt.request.input.reason).toBe('auto-reverify:check_incomplete#2');
  const fresh = await reverifyRequestOf(workflowWith([rowOf('work-1', failureOf('work-1', reverifyOf('work-1'),
    { head: headOf('work-1', { autoCount: 1 }) }))]).workflow, selectWork('work-1'));
  expect(fresh.request.input.reason).toBe('auto-reverify:check_incomplete#2');
  const retry = await reverifyRequestOf(workflowWith([rowOf('work-1', failureOf('work-1',
    reverifyOf('work-1', { retryAfterRefusal: true }), { head: headOf('work-1', { autoCount: 1 }), refusalRevision: 1 }))]).workflow,
  selectWork('work-1'));
  expect(retry.request.meta.expected[1]).toEqual({ ref: refusalRefOf('work-1'), revision: 1 });
  expect(retry.request.meta.requestId).not.toBe(fresh.request.meta.requestId);
});

it('FC-13 (needsFinalize): the open head with only interrupted checks is finalized first; nothing is reverified yet', async () => {
  const openHead = { ref: roundRefOf('work-1'), revision: 6, status: 'open', outcome: null, gaps: [],
    subject: { projectId: P, goalId: G, taskId: 'work-1' },
    checks: [{ checkId: 'lint', phase: 'finished', outcome: 'PASS' }, { checkId: 'unit', phase: 'interrupted', outcome: null }] };
  const run = { ref: runRefOf('work-1'), task: { projectId: P, goalId: G, taskId: 'work-1' }, revision: 5, status: 'ended',
    outcome: 'completed' } as unknown as RunSnapshot;
  const executions = { ...untouched<WorkflowDependencies['executions']>('executions'),
    readExecution: async () => ({ status: 'ready', value: { run } }) as never };
  const row = rowOf('work-1', failureOf('work-1', reverifyOf('work-1', { needsFinalize: true }), { head: { ...headOf('work-1'),
    status: 'open', outcome: null, failingChecks: [HOST_RESTART] } }));
  const { workflow, calls } = workflowWith([row], { executions,
    evidence: { queryOriginalVerification: async () => ({ status: 'ready', value: openHead }) as never } });
  expect(await workflow.advanceWork(ctx, selectWork('work-1'))).toMatchObject({ status: 'ready', value: { state: 'advance',
    next: { kind: 'perform', operation: { kind: 'finalize_checks', request: { input: { roundRef: roundRefOf('work-1') },
      meta: { expected: [{ ref: roundRefOf('work-1'), revision: 6 }] } } } } } });
  expect(calls).toHaveLength(0);
});

it('§15.2 5.9: a stopped verdict on a finalized non-PASS head skips the Task; the next Task is reverified', async () => {
  const stopped: TaskAutomationVerdictV1 = { kind: 'stopped', reason: 'no_new_basis', detail: { operation: 'reverify' } };
  const rows = [rowOf('work-1', failureOf('work-1', stopped)), rowOf('work-2', failureOf('work-2', reverifyOf('work-2')))];
  const { request } = await reverifyRequestOf(workflowWith(rows).workflow, selectWork());
  expect(request.input.predecessorRoundRef).toEqual(roundRefOf('work-2'));
  // Alone, the Goal waits on its gap; neither the Run nor the chain is read.
  expect(await workflowWith([rows[0]!]).workflow.advanceWork(ctx, selectWork())).toMatchObject({ status: 'ready',
    value: { state: 'waiting', next: null, reason: 'required work cannot advance: work-1: blocked with an existing Run' } });
  expect(await workflowWith([rows[0]!]).workflow.advanceWork(ctx, selectWork('work-1'))).toMatchObject({ status: 'ready',
    value: { state: 'waiting', next: null, reason: 'the selected Task work-1 is not executable right now' } });
});

it('GV-9: a gate whose FAIL head may be re-verified gets reverify_round on its own chain with onlyIfSourceChanged', async () => {
  const verdict = reverifyOf('gate-1', { onlyIfSourceChanged: true, failureClass: 'check_failed' });
  const { request } = await reverifyRequestOf(workflowWith([SATISFIED_WORK, gateRowOf(verdict)]).workflow, selectWork());
  expect(request.input).toEqual({ predecessorRoundRef: roundRefOf('gate-1'), reason: 'auto-reverify:check_failed#1',
    onlyIfSourceChanged: true });
  expect(request.meta.expected).toEqual([{ ref: roundRefOf('gate-1'), revision: 4 }, { ref: refusalRefOf('gate-1'), revision: 0 }]);
});

it('GV-10: a gate whose INCONCLUSIVE head may be re-verified gets reverify_round without the source condition', async () => {
  const verdict = reverifyOf('gate-1', { onlyIfSourceChanged: false, failureClass: 'check_incomplete' });
  const { workflow, calls } = workflowWith([SATISFIED_WORK, gateRowOf(verdict, headOf('gate-1'))]);
  const { request } = await reverifyRequestOf(workflow, selectWork());
  expect(request.input).toEqual({ predecessorRoundRef: roundRefOf('gate-1'), reason: 'auto-reverify:check_incomplete#1' });
  expect(request.meta.expected).toEqual([{ ref: roundRefOf('gate-1'), revision: 4 }, { ref: refusalRefOf('gate-1'), revision: 0 }]);
  expect(calls).toHaveLength(0);
});

it('GV-3 (needsFinalize): a gate\'s open head with only interrupted checks is finalized first; nothing is reverified yet', async () => {
  const openHead = { ref: roundRefOf('gate-1'), revision: 6, status: 'open', outcome: null, gaps: [],
    subject: { projectId: P, goalId: G, taskId: 'gate-1' },
    checks: [{ checkId: 'lint', phase: 'finished', outcome: 'PASS' }, { checkId: 'unit', phase: 'interrupted', outcome: null }] };
  const heads: unknown[] = [];
  const row = gateRowOf(reverifyOf('gate-1', { needsFinalize: true }), { ...headOf('gate-1'), status: 'open', outcome: null,
    failingChecks: [HOST_RESTART] });
  const { workflow, calls } = workflowWith([SATISFIED_WORK, row], { evidence: {
    queryRoundChainHead: async (_ctx, query) => { heads.push(query); return { status: 'ready', value: openHead } as never; } } });
  expect(await workflow.advanceWork(ctx, selectWork())).toMatchObject({ status: 'ready', value: { state: 'advance',
    next: { kind: 'perform', operation: { kind: 'finalize_checks', request: { input: { roundRef: roundRefOf('gate-1') },
      meta: { expected: [{ ref: roundRefOf('gate-1'), revision: 6 }] } } } } } });
  // The gate's own chain (VD-15), read without a subject Run.
  expect(heads).toEqual([{ subject: { projectId: P, goalId: G, taskId: 'gate-1' }, subjectRunRef: null }]);
  expect(calls).toHaveLength(0);
});

it('GV-8: a stopped gate waits with its stop reason as the code; a Task handle never reaches the gate', async () => {
  const needsFix: TaskAutomationVerdictV1 = { kind: 'stopped', reason: 'gate_needs_fix',
    detail: { operation: 'reverify', failingChecks: [FAILED] } };
  const { workflow, calls } = workflowWith([SATISFIED_WORK, gateRowOf(needsFix)]);
  const result = await workflow.advanceWork(ctx, selectWork());
  expect(result).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null, receipt: null } });
  if (result.status !== 'ready') throw new Error('the selection must answer');
  expect(result.value.reason).toBe('gate_needs_fix: the goal gate gate-1 is not re-verified automatically; '
    + 'a person decides (add a fix Task, or re-verify)');
  expect(await workflow.advanceWork(ctx, selectWork('work-1'))).toMatchObject({ status: 'ready',
    value: { state: 'completed', reason: 'the selected Task work-1 is satisfied' } });
  expect(calls).toHaveLength(0);
});

it.each([
  ['no_new_basis', { operation: 'reverify' }, 'a person decides (add a fix Task, or re-verify)'],
  ['auto_rework_cap_reached', { operation: 'reverify' }, 'a person decides (add a fix Task, or re-verify)'],
  ['verification_uncovered', { operation: 'reverify' }, 'register a check that covers the requirement in the Host settings'],
  ['not_reworkable', { cause: 'round_chain_limit' }, 'its round chain cannot grow; a person decides'],
] as const)('a gate stopped with %s waits with what a person can do about it', async (reason, detail, advice) => {
  const { workflow, calls } = workflowWith([SATISFIED_WORK, gateRowOf({ kind: 'stopped', reason, detail })]);
  expect(await workflow.advanceWork(ctx, selectWork())).toEqual({ status: 'ready', value: { state: 'waiting', next: null,
    receipt: null, reason: `${reason}: the goal gate gate-1 is not re-verified automatically; ${advice}` } });
  expect(calls).toHaveLength(0);
});

const committed = (value: ReverifyOutcomeV1): WriteResult<ReverifyOutcomeV1> =>
  ({ status: 'committed', value, replayed: false, cursor: 'cursor-1' as never });
const rejected = (code: CoreRejection['code'], reason: string): WriteResult<ReverifyOutcomeV1> => ({ status: 'rejected', code, reason });

it.each([
  ['a committed successor round', committed({ kind: 'reverified', round: { ref: roundRefOf('work-1', 'round-2') } as never })],
  ['a committed policy refusal', committed({ kind: 'refused', refusal: { code: 'no_new_basis' } as never })],
  ['a revision_conflict (another write moved the head)', rejected('revision_conflict', 'the round chain head changed')],
])('perform reverify_round: %s goes back to select_work with the receipt kept', async (_label, answer) => {
  const { workflow, calls } = workflowWith([rowOf('work-1', failureOf('work-1', reverifyOf('work-1')))], { reverify: () => answer });
  const { next } = await reverifyRequestOf(workflow, selectWork('work-1'));
  expect(await workflow.advanceWork(ctx, next)).toEqual({ status: 'ready', value: { state: 'advance', reason: null,
    next: selectWork('work-1'), receipt: { kind: 'reverify_round', result: answer } } });
  // TD-6: the owner is called once, as the Workflow automation actor in the same trusted scope and signal.
  expect(calls).toHaveLength(1);
  const call = calls[0]!;
  expect(call.ctx).toEqual({ projectId: P, workspaceId: W, principal: { kind: 'host', actor: WORKFLOW_AUTOMATION_ACTOR },
    materialReader: { kind: 'host', projectId: P, workspaceId: W, actor: WORKFLOW_AUTOMATION_ACTOR }, signal });
  expect(call.ctx.signal).toBe(signal);
  if (next.kind !== 'perform' || next.operation.kind !== 'reverify_round') throw new Error('a reverify_round was expected');
  expect(call.request).toEqual(next.operation.request);
});

it.each([
  ['busy', 'finalize_first: round round-work-1 is open; finalize it before a successor round'],
  ['dependency_blocked', 'round_chain_limit: round round-work-1 is the 32nd of its chain'],
  ['unavailable', 'the workspace source is not readable: gone'],
])('perform reverify_round: a %s refusal waits with its code', async (code, reason) => {
  const answer = rejected(code as CoreRejection['code'], reason);
  const { workflow } = workflowWith([rowOf('work-1', failureOf('work-1', reverifyOf('work-1')))], { reverify: () => answer });
  const { next } = await reverifyRequestOf(workflow, selectWork('work-1'));
  expect(await workflow.advanceWork(ctx, next)).toEqual({ status: 'ready', value: { state: 'waiting', next: null,
    reason: `${code}: ${reason}`, receipt: { kind: 'reverify_round', result: answer } } });
});

it('a Host whose evidence owner publishes no reverifyRound selects no successor round and refuses the step as unsupported', async () => {
  const { workflow } = workflowWith([rowOf('work-1', failureOf('work-1', reverifyOf('work-1')))], { noReverifyPort: true });
  expect(await workflow.advanceWork(ctx, selectWork('work-1'))).toMatchObject({ status: 'ready',
    value: { state: 'waiting', next: null, reason: 'the selected Task work-1 is not executable right now' } });
  const perform: WorkflowAdvanceInput = { ...selectWork('work-1'), kind: 'perform',
    operation: { kind: 'reverify_round', request: { input: {}, meta: { requestId: 'r', expected: [] } } } as unknown as WorkflowOperation };
  expect(await workflow.advanceWork(ctx, perform)).toEqual({ status: 'rejected', code: 'unsupported',
    reason: 'the evidence owner does not publish reverifyRound' });
});

it('§15.2 5.9 (VR-07 Workflow row): finalize_checks answered busy on a finalized round goes back to select_work; on an open round it waits', async () => {
  const busy: WriteResult<never> = { status: 'rejected', code: 'busy', reason: 'the round is already finalized' };
  const finalizeOf = (status: RoundSnapshot['status']) => workflowWith([], { evidence: {
    finalizeChecks: async () => busy,
    readVerification: async () => ({ status: 'ready', value: { ref: roundRefOf('work-1'), status } }) as never } }).workflow;
  const perform: WorkflowAdvanceInput = { ...selectWork('work-1'), kind: 'perform', operation: { kind: 'finalize_checks',
    request: { input: { roundRef: roundRefOf('work-1') }, meta: { requestId: 'r', expected: [] } } } as unknown as WorkflowOperation };
  expect(await finalizeOf('finalized').advanceWork(ctx, perform)).toEqual({ status: 'ready', value: { state: 'advance',
    reason: null, next: selectWork('work-1'), receipt: { kind: 'finalize_checks', result: busy } } });
  expect(await finalizeOf('open').advanceWork(ctx, perform)).toEqual({ status: 'ready', value: { state: 'waiting',
    next: null, reason: 'the round is already finalized', receipt: { kind: 'finalize_checks', result: busy } } });
});
