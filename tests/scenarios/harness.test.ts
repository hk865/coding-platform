/**
 * A.2 step 6: smoke scenarios of the shared scenario harness (tests/scenarios/harness.ts).
 *
 * 1. Host mode: the Workflow claims, runs and passes a work Task (claim → Run → round PASS →
 *    satisfied); a clean restart (HL-06 → HL-01) reconciles nothing and writes nothing (Kernel
 *    snapshot included); a peer Host on the same files holds no lease (HL-02) and writes nothing;
 *    the next Host continues the script at the next reply, and the counters add both Hosts' calls.
 * 2. Host mode crash: the second model call of the Turn is held, the Host is abandoned with its lock
 *    naming an exited process; the next Host takes the lock over (HL-03), ends the Run interrupted
 *    (W-11) and calls no model while it reconciles; the second Host's own model call is held and
 *    released (the hold indexes are global); draining the abandoned Host keeps every invariant.
 * 3. Platform mode: the same Task through the composition root in process; a reopen keeps every
 *    record and count, and the script continues.
 * 4. `stepOfReceipt`: the step kind, actor and policy `advance()` checks each receipt with.
 * 5. Platform mode seams: `registerCheck('fail')` is a new configuration revision the round freezes;
 *    the FAIL is reworked automatically until `setAutomation` sets cap 0, and the Workflow then stops.
 *
 * Every step that changes records is followed by the §11 invariant check (with the step's
 * `FuzzStep` inside `advance()`, and after every restart). Scripted replies only.
 */
import { afterEach, expect, it } from 'vitest';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  assertInvariants, checkRevisionOf, cleanupScenarios, hostCtx, openHostScenario, openPlatformScenario, performs, SCENARIO_OPERATOR,
  stepOfReceipt, type Driven,
} from './harness.js';
import { committedOutcomesOf, editThenText } from './support/common.js';

afterEach(cleanupScenarios);

const WORK_2 = 'ag2b-work-2';

function kinds(driven: Driven): string[] {
  return driven.receipts.map(receipt => receipt.kind);
}

it('host mode: claim → Run → PASS → satisfied; a clean restart and a peer Host write nothing; the next Host continues the script and the counters add up', async () => {
  const h = await openHostScenario({ workIds: [AG2B_WORK_TASK_ID, WORK_2],
    script: { replies: [...editThenText('smoke-work-1'), { kind: 'text', text: 'scenario smoke: work-2 finds the result file' }] } });
  await assertInvariants(h, 'seeded');
  expect(h.counts()).toMatchObject({ modelCalls: 0, kernelRecords: 0, kernelTurnsStarted: 0, kernelSessionRevisions: 0, checksBegun: 0 });

  const first = await h.advance(h.select('smoke-1', AG2B_WORK_TASK_ID));
  expect(kinds(first)).toEqual(expect.arrayContaining(['create_session', 'claim_task', 'start', 'open_checks', 'run_check',
    'finalize_checks', 'complete_task']));
  expect(committedOutcomesOf(first)).toEqual(['PASS']);
  // advance() checked the invariants after every receipt, with the step's kind.
  expect(h.invariantLabels).toEqual(['seeded', 'smoke-1#1 create_session', 'smoke-1#2 claim_task', 'smoke-1#3 prepare', 'smoke-1#4 start',
    'smoke-1#5 open_checks', 'smoke-1#6 run_check', 'smoke-1#7 finalize_checks', 'smoke-1#8 complete_task']);
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'satisfied' });
  expect(await h.taskRow(WORK_2)).toMatchObject({ effectivePhase: 'pending' });
  const afterRun = h.counts();
  expect(afterRun).toMatchObject({ modelCalls: 2, kernelTurnsStarted: 1, checksBegun: 1 });
  expect(afterRun.kernelRecords).toBeGreaterThan(1);
  expect(afterRun.kernelSessionRevisions).toBeGreaterThan(0);
  const kernelAfterRun = h.kernelSnapshot();
  expect(kernelAfterRun.sessions).toHaveLength(1);
  expect(h.ledgerEventTypes()).toEqual(expect.arrayContaining(['TaskClaimed', 'ExecutionEntryAuthorized']));

  // HL-06 then HL-01: nothing was left open, so the reconcile has nothing to do and writes nothing. The new
  // Host registers another check, a new configuration revision (LA-4).
  const report = await h.restart({ check: 'pass' });
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-01',
    report: { runs: [], queries: [], checks: [], controls: [], redriveGoals: [], problems: [] } });
  expect(h.invariantLabels.at(-1)).toBe('restart 1');
  expect(h.counts(), 'the restart called no model and wrote no record').toEqual(afterRun);
  expect(h.kernelSnapshot(), 'the Kernel store is unchanged, byte for byte').toEqual(kernelAfterRun);
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'satisfied' });
  // HL-02: a second live Host on the same files reconciles nothing and writes nothing.
  const peer = await h.startPeer();
  expect(peer.host.reconcile).toMatchObject({ lease: 'held_by_other', leaseRow: 'HL-02', report: null });
  expect(h.counts()).toEqual(afterRun);
  // The composition root on the same files reads the same records.
  const graph = await (await h.direct()).plans.queryTaskGraph(hostCtx(), { goalRef: { aggregateType: 'Goal',
    projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal' } });
  expect(graph.status === 'ready' && graph.value.tasks.find(row => row.ref.taskId === AG2B_WORK_TASK_ID)?.effectivePhase).toBe('satisfied');

  // The second Host answers with the script's third reply: work-2, then the gate, then the Goal.
  const second = await h.advance(h.select('smoke-2'));
  expect(second.state).toBe('completed');
  expect(committedOutcomesOf(second)).toEqual(['PASS', 'PASS']);
  expect(h.host.scripted.calls(), 'the second Host made one call').toBe(1);
  expect(h.modelCalls(), 'both Hosts, counted together; the peer made none').toBe(3);
  expect(h.counts()).toMatchObject({ kernelTurnsStarted: 2, checksBegun: 3 });
  expect(await h.goalDisplay()).toMatchObject({ phase: 'COMPLETED' });
  // The invariant check read this scenario's records: both Runs and their claims, and the rounds' frozen
  // configuration revisions (work-1 before the restart; work-2 and the gate after it).
  expect(h.lastWorld?.runs).toHaveLength(2);
  expect(h.lastWorld?.events.filter(event => event.eventType === 'TaskClaimed')).toHaveLength(2);
  expect(h.lastWorld?.rounds.map(round => round.configuration.configurationRevision).sort())
    .toEqual([checkRevisionOf(1), checkRevisionOf(2), checkRevisionOf(2)]);
}, 120_000);

it('host mode crash: a Host abandoned mid-Turn is taken over (HL-03); the Run ends interrupted (W-11) with no model call during the reconcile; the next Host\'s call is held and released', async () => {
  const h = await openHostScenario({ automation: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: false }, check: 'pass',
    script: { replies: [{ kind: 'calls', calls: [{ callId: 'smoke-read', name: 'read', args: { path: 'src/module.ts' } }] },
      { kind: 'text', text: 'scenario crash: never answered' }, { kind: 'text', text: 'scenario crash: the second Host answers' }] } });
  const held = h.holdReply(1);
  const toStart = await h.advance(h.select('smoke-crash', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  expect(toStart.state).toBe('stopped');
  // The Workflow `start` step stays in flight on the crashed Host until the cleanup fails the held call.
  void h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  await assertInvariants(h, 'mid-Turn');
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Task must have a Run while its Turn calls the model');
  const atCrash = h.counts();
  expect(atCrash).toMatchObject({ modelCalls: 2, kernelTurnsStarted: 1 });

  const report = await h.restart({ crash: true });
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03',
    report: { runs: [{ ref: JSON.stringify(runRef), row: 'W-11', status: 'reconciled', reason: 'interrupted_clean' }], problems: [] } });
  expect(h.modelCalls(), 'the reconcile called no model').toBe(atCrash.modelCalls);
  expect(h.counts()).toMatchObject({ kernelTurnsStarted: 1, checksBegun: 0 });
  expect(h.invariantLabels.at(-1)).toBe('restart 1 (crash)');
  expect(h.lastWorld?.runs).toMatchObject([{ status: 'ended', outcome: 'crashed' }]);
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'failed', failure: { failureClass: 'interrupted' } });

  // The second Host requeues (uncounted, W-11), claims in a new Session and calls the model: global index 2 is held.
  const secondCall = h.holdReply(2);
  const drive = h.advance(h.select('smoke-crash-2', AG2B_WORK_TASK_ID));
  const request = await secondCall.reached;
  expect(request.requestId).toBeTruthy();
  expect(h.host.scripted.calls(), 'the second Host made one call, held').toBe(1);
  expect(h.modelCalls()).toBe(3);
  secondCall.release();
  const second = await drive;
  expect(kinds(second)).toEqual(expect.arrayContaining(['requeue_task', 'create_session', 'claim_task', 'start', 'complete_task']));
  expect(committedOutcomesOf(second)).toEqual(['PASS']);
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'satisfied' });
  expect(h.lastWorld?.requeues).toMatchObject([{ failureClass: 'interrupted', automation: { automatic: true, counted: false, cap: 3 } }]);
  expect(h.abandonedCalls(), 'the abandoned Host started no model call').toEqual([]);

  // Draining the abandoned Host (its held call fails) keeps the ledger's invariants.
  const runs = h.lastWorld?.runs.length;
  await h.drainAbandoned();
  await assertInvariants(h, 'after draining the abandoned Host');
  expect(h.lastWorld?.runs).toHaveLength(runs!);
}, 120_000);

it('platform mode: claim → Run → PASS → satisfied in process; a reopen keeps the records and the counters, and the script continues', async () => {
  const h = await openPlatformScenario({ workIds: [AG2B_WORK_TASK_ID, WORK_2],
    script: { replies: [...editThenText('smoke-platform'), { kind: 'text', text: 'scenario smoke: work-2 finds the result file' }] } });
  await assertInvariants(h, 'seeded');
  const first = await h.advance(h.select('smoke-platform-1', AG2B_WORK_TASK_ID), { invariants: { label: 'platform-1' } });
  expect(committedOutcomesOf(first)).toEqual(['PASS']);
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'satisfied' });
  const afterRun = h.counts();
  expect(afterRun).toMatchObject({ modelCalls: 2, kernelTurnsStarted: 1 });

  await h.restart();
  expect(h.counts()).toEqual(afterRun);
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'satisfied' });
  const second = await h.advance(h.select('smoke-platform-2'), { invariants: { label: 'platform-2' } });
  expect(second.state).toBe('completed');
  expect(h.scripted.calls()).toBe(1);
  expect(h.modelCalls()).toBe(3);
  expect(await h.goalDisplay()).toMatchObject({ phase: 'COMPLETED' });
  expect(h.lastWorld?.runs).toHaveLength(2);
}, 120_000);

it('stepOfReceipt: the §11.11 step of each Workflow receipt, its actor and the policy in effect', () => {
  const policy = { schemaVersion: 1 as const, autoReworkLimit: 2, resumeOnStartup: false };
  const stepOf = (kind: string, result: unknown = { status: 'committed', value: {} }) =>
    stepOfReceipt({ kind, result } as unknown as WorkflowStepReceipt, SCENARIO_OPERATOR, policy, kind);
  const operator = { actor: SCENARIO_OPERATOR, automationPolicy: policy };
  const automation = { actor: { ...WORKFLOW_AUTOMATION_ACTOR }, automationPolicy: policy };
  expect(stepOf('claim_task')).toEqual({ kind: 'task_claimed', ...operator, label: 'claim_task' });
  expect(stepOf('start')).toMatchObject({ kind: 'entry_authorized', ...operator });
  expect(stepOf('open_checks')).toMatchObject({ kind: 'round_opened', ...operator });
  expect(stepOf('run_check')).toMatchObject({ kind: 'check_begun', ...operator });
  expect(stepOf('complete_goal')).toMatchObject({ kind: 'goal_completed', ...operator });
  expect(stepOf('finalize_checks')).toMatchObject({ kind: 'other', ...operator });
  expect(stepOf('requeue_task', { status: 'committed', value: { kind: 'requeued' } })).toMatchObject({ kind: 'task_requeued', ...automation });
  expect(stepOf('requeue_task', { status: 'committed', value: { kind: 'refused' } })).toMatchObject({ kind: 'task_rework_refused', ...automation });
  expect(stepOf('reverify_round', { status: 'committed', value: { kind: 'reverified' } })).toMatchObject({ kind: 'round_reverified', ...automation });
  expect(stepOf('reverify_round', { status: 'committed', value: { kind: 'refused' } })).toMatchObject({ kind: 'task_rework_refused', ...automation });
});

it('platform mode seams: a registered check is a new configuration revision; cap 0 stops the automatic rework', async () => {
  const h = await openPlatformScenario({ script: { replies: [{ kind: 'text', text: 'scenario seams: Run 1' },
    { kind: 'text', text: 'scenario seams: Run 2' }] } });
  h.registerCheck('fail');
  // Run 1 FAILs; the Workflow requeues automatically (#1 of 3), Run 2 FAILs too.
  const reworked = await h.advance(h.select('smoke-seams', AG2B_WORK_TASK_ID), { stopBefore: (input) => input.kind === 'perform'
    && input.operation.kind === 'requeue_task' && h.lastWorld !== undefined && h.lastWorld.requeues.length === 1 });
  expect(reworked.state).toBe('stopped');
  expect(committedOutcomesOf(reworked)).toEqual(['FAIL', 'FAIL']);
  expect(h.lastWorld?.rounds.map(round => round.configuration.configurationRevision)).toEqual([checkRevisionOf(2), checkRevisionOf(2)]);
  expect(h.lastWorld?.requeues).toMatchObject([{ failureClass: 'check_failed', automation: { automatic: true, counted: true,
    autoCount: 1, cap: 3 } }]);
  // C8: cap 0 from now on; the second automatic requeue would pass it, so the Workflow stops (AV-8).
  h.setAutomation({ schemaVersion: 1, autoReworkLimit: 0, resumeOnStartup: true });
  expect(h.automationPolicy()).toMatchObject({ autoReworkLimit: 0 });
  expect(await h.taskRow()).toMatchObject({ failure: { automation: { cap: 0,
    verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached' } } } });
  const before = h.counts();
  const stopped = await h.advance(h.select('smoke-seams-stopped', AG2B_WORK_TASK_ID));
  expect(stopped).toMatchObject({ state: 'waiting', receipts: [] });
  expect(h.counts()).toEqual(before);
}, 120_000);
