/**
 * A.2 step 5.8, part 1: the Workflow's result mapping (docs/refactor/STATE-MACHINES-SPEC.md
 * §15.2 5.8 "结果映射"; C8, C5) over controlled owner doubles.
 *
 * - A Run that `start` or `observe` returns ended with a known failure
 *   (`crashed`, `failed`, `budget_exhausted`, `cancelled`, nothing left to
 *   reconcile) goes back to `select_work`, keeping the flow, the Session hint
 *   and an explicit Task selection; the failure facts and the automation
 *   verdict decide there.
 * - A failed end that still has something to reconcile (a quarantined
 *   reconciliation, an unknown entry authorization) waits with that blocker
 *   (`runUnresolvedBlocker`, hard limit 1); a Run still open, a yielded wait, an
 *   unknown outcome and a completed but quarantined Run keep `normalEnd`'s reason.
 * - A finalize that is not a clean PASS (FAIL, INCONCLUSIVE, a legacy PASS with
 *   gaps) goes back to `select_work`.
 *
 * Only the one owner each step calls answers; every other port throws if
 * touched. The real platform path is `tests/app/A2-automation-verdict.test.ts`.
 */
import { expect, it } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowOperation } from '../../src/business/workflow/contracts.js';
import type { WorkflowDependencies } from '../../src/business/workflow/ports.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunOutcome, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { RoundSnapshot } from '../../src/contracts/verification.js';
import type { FinalizedChecks } from '../../src/core/work-graph/evidence/contracts.js';

const P = 'a2-mapping-project', W = 'a2-mapping-workspace', G = 'a2-mapping-goal';
const AT = '2026-10-06T00:00:00.000Z';
const actor = { kind: 'human' as const, id: 'a2-mapping-operator' };
const ctx: CoreCallContext = { projectId: P, workspaceId: W, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId: P, workspaceId: W, actor }, signal: new AbortController().signal };
const goalRef = { aggregateType: 'Goal' as const, projectId: P, goalId: G };
const sessionHint = { projectId: P, sessionId: 'a2-mapping-session' };

function runOf(over: Partial<RunSnapshot>): RunSnapshot {
  return {
    ref: { aggregateType: 'Run', projectId: P, goalId: G, runId: 'a2-mapping-run' }, revision: 4, schemaVersion: 1,
    task: { projectId: P, goalId: G, taskId: 'work-1' }, attemptId: 'a2-mapping-attempt',
    planRef: { aggregateType: 'PlanRevision', projectId: P, planId: 'a2-mapping-plan' },
    roleBinding: { schemaVersion: 1, bindingId: 'b', templateId: 'builder', templateRevision: '1', bindingVersion: 1, policyRevision: 'p' },
    budget: { tokenBudget: 1000, deadline: null }, workspaceSnapshot: { workspaceId: W, revision: 1 },
    status: 'ended', outcome: 'completed', exitCode: 0, lastEventSeq: 2, lastRuntimeEventId: 'rt', lastFactEventId: 'ev',
    envelope: null, startedAt: AT, endedAt: AT, ...over,
  };
}
const ended = (outcome: RunOutcome, over: Partial<RunSnapshot> = {}): RunSnapshot =>
  runOf({ outcome, exitCode: outcome === 'completed' ? 0 : null, ...over });
const QUARANTINED: RunSnapshot['reconciliation'] = { status: 'quarantined', basis: { kind: 'live_clean' }, recordedAt: AT,
  observation: { kind: 'unresolved', reason: 'a tool call has no result', observedThroughPosition: 3, unresolvedToolCallIds: ['call-1'] } };

/** Every port throws unless the test gives it an answer. */
function untouched<T extends object>(name: string): T {
  return new Proxy({}, { get: (_target, member) => () => { throw new Error(`${name}.${String(member)} must not be called`); } }) as T;
}
function workflowWith(answers: { run?: RunSnapshot; finalized?: Pick<FinalizedChecks, 'outcome' | 'applicable' | 'gaps'> }) {
  const deps: WorkflowDependencies = {
    tasks: untouched('tasks'), plans: untouched('plans'), sessions: untouched('sessions'), claims: untouched('claims'),
    executions: untouched('executions'), checks: untouched('checks'), sourceAuthority: untouched('sourceAuthority'),
    runtime: { ...untouched<WorkflowDependencies['runtime']>('runtime'),
      startRun: async () => ({ status: 'ready', value: { run: answers.run } }) as never,
      observeRun: async () => ({ status: 'ready', value: { run: answers.run } }) as never },
    evidence: { ...untouched<WorkflowDependencies['evidence']>('evidence'),
      finalizeChecks: async () => ({ status: 'committed', replayed: false,
        value: { snapshot: {} as RoundSnapshot, evidence: [], ...answers.finalized } }) as never },
  };
  return createWorkflow(deps);
}
/** A perform of `kind` with an opaque request: the Workflow hands it to the one owner unchanged. */
function perform(kind: 'start' | 'observe' | 'finalize_checks'): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef, flowId: 'a2-mapping-flow', sessionHint, taskId: 'work-1', kind: 'perform',
    operation: { kind, request: { meta: { requestId: 'r', expected: [] } } } as unknown as WorkflowOperation };
}
const SELECT_WORK = { schemaVersion: 1, goalRef, flowId: 'a2-mapping-flow', sessionHint, kind: 'select_work', taskId: 'work-1' };

it.each([
  ['crashed (a Kernel run.failed)', ended('crashed')],
  ['failed', ended('failed')],
  ['budget_exhausted', ended('budget_exhausted')],
  ['cancelled', ended('cancelled')],
])('start and observe: a Run that ended %s goes back to select_work with the receipt kept', async (_label, run) => {
  for (const kind of ['start', 'observe'] as const) {
    const result = await workflowWith({ run }).advanceWork(ctx, perform(kind));
    expect(result, kind).toEqual({ status: 'ready', value: { state: 'advance', reason: null, next: SELECT_WORK,
      receipt: { kind, result: { status: 'ready', value: { run } } } } });
  }
});

it.each([
  ['still running', runOf({ status: 'running', outcome: null, exitCode: null, endedAt: null }), 'the Run a2-mapping-run is still running'],
  ['yielded (a wait)', ended('yielded'), 'the Run a2-mapping-run ended with outcome yielded'],
  ['outcome_unknown', ended('outcome_unknown'), 'the Run a2-mapping-run ended with outcome outcome_unknown'],
  ['crashed but quarantined', ended('crashed', { reconciliation: QUARANTINED }), 'run a2-mapping-run is quarantined and not reconciled'],
  ['crashed with an unknown entry authorization', ended('crashed', { executionAuthorization: { phase: 'unknown' } as never }),
    'run a2-mapping-run carries an unreconciled unknown entry authorization'],
  ['completed but quarantined', ended('completed', { reconciliation: QUARANTINED }), 'the Run a2-mapping-run reconciliation is quarantined'],
])('start and observe: a Run %s keeps waiting with its reason', async (_label, run, reason) => {
  for (const kind of ['start', 'observe'] as const) {
    expect(await workflowWith({ run }).advanceWork(ctx, perform(kind)), kind).toMatchObject({ status: 'ready',
      value: { state: 'waiting', next: null, reason, receipt: { kind } } });
  }
});

it.each([
  ['FAIL', { outcome: 'FAIL' as const, applicable: false, gaps: [] }],
  ['INCONCLUSIVE', { outcome: 'INCONCLUSIVE' as const, applicable: false, gaps: [{ code: 'interrupted_check' as const, message: 'm' }] }],
  ['a legacy PASS with gaps', { outcome: 'PASS' as const, applicable: true, gaps: [{ code: 'pending_check' as const, message: 'm' }] }],
])('finalize_checks: a %s round goes back to select_work with the receipt kept', async (_label, finalized) => {
  const result = await workflowWith({ finalized }).advanceWork(ctx, perform('finalize_checks'));
  expect(result).toMatchObject({ status: 'ready', value: { state: 'advance', reason: null, next: SELECT_WORK,
    receipt: { kind: 'finalize_checks', result: { status: 'committed', value: finalized } } } });
});
