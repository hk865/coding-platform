/**
 * Slice 5 round 2, table §0–1 / §2.2 R2B01–R2B05 (memory only).
 * SPEC §3.3 exact non-message pins, §4.1/§4.5, §8.2 lines 1356–1357/1366.
 * B03/B04 deliberately expect the specified behavior at the paused-gate
 * blocker. Their setup must first prove the real GV-10 head and emitted card.
 */
import { afterEach, expect, it } from 'vitest';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import type { ResolveDecisionInputV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { committed, control, keyOf, ready } from '../helpers/S5-application-support.js';
import { GOAL_B, PLAN_B1, openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import {
  assembleB, crashWork, everyStep, gateHead, gateReverify, pausedSource, queueB, requeueRecords, selectB, waitingCard,
  type BOwners,
} from '../helpers/S5R2-b-support.js';

const fixtures: S5DecisionFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

async function open() {
  const fixture = await openS5DecisionFixture('memory');
  fixtures.push(fixture);
  return { fixture, owners: await assembleB(fixture) };
}

function answerRequest(source: DecisionSourceV1, requestId: string): GraphWrite<ResolveDecisionInputV1> {
  return { input: { source: structuredClone(source), selection: { kind: 'other' },
    text: 'Keep this instruction pending; do not start work merely because I answered.', annotations: [] },
  meta: { requestId, expected: structuredClone(source.pins) } };
}

async function waiting(fixture: S5DecisionFixture, owners: BOwners, input: WorkflowAdvanceInput,
  action: 'system_requeue' | 'auto_reverify', taskId: string) {
  const before = await fixture.storeSnapshot();
  let result = ready(await owners.workflow.advanceWork(fixture.ctx, input));
  // Table wording discrepancy (reported under UNDETERMINED): today's gate
  // select_work returns perform/reverify_round (workflow.ts:968–969), and its
  // gatePerform supplies the confirmation. Follow that actual returned step;
  // if selection later gates directly, the same decisive pause assertions run.
  if (action === 'auto_reverify' && result.state === 'advance') {
    expect(result).toMatchObject({ receipt: null, next: { kind: 'perform', operation: { kind: 'reverify_round',
      request: { input: { predecessorRoundRef: { projectId: 'P', goalId: 'B', taskId: 'b-gate' } } } } } });
    const step = result.next;
    if (step === null || step.kind !== 'perform' || step.operation.kind !== 'reverify_round') {
      throw new Error('gate selection must return its actual reverify step');
    }
    expect(await fixture.storeSnapshot()).toEqual(before);
    result = ready(await owners.workflow.advanceWork(fixture.ctx, step));
  }
  expect(result).toMatchObject({ state: 'waiting', next: null, receipt: null,
    reason: `automation_confirmation_required:${action}` });
  const cause = result.decisionCause;
  if (cause === undefined || cause === null) throw new Error('the Workflow must emit the automation cause');
  expect(cause).toMatchObject({ code: 'automation_confirmation_required', action,
    taskRef: { projectId: 'P', goalId: 'B', taskId }, runRef: fixture.claimRA.runRef,
    source: { kind: 'goal_cause', subject: { kind: 'goal', goalRef: GOAL_B } }, options: [] });
  const queue = await queueB(fixture, owners);
  const card = waitingCard(queue, cause.source);
  // The cause reader sorts affected refs, while the Workflow emits Task then
  // Run. Pins are an exact set (§3.3), not an ordered list.
  const sourcePins = [...card.source.pins];
  const byRef = (left: (typeof sourcePins)[number], right: (typeof sourcePins)[number]) =>
    keyOf(left.ref).localeCompare(keyOf(right.ref));
  expect(sourcePins.sort(byRef)).toEqual([...cause.source.pins].sort(byRef));
  expect(await fixture.storeSnapshot()).toEqual(before);
  expect(owners.runtimeCalls()).toBe(0);
  return { cause, card, queue };
}

async function assertAnswered(fixture: S5DecisionFixture, owners: BOwners,
  source: DecisionSourceV1, requestId: string) {
  const result = await owners.workflow.resolveDecision(fixture.ctx, answerRequest(source, requestId));
  // B04's decisive assertion: currently `rejected/not_found` from verifyRealCause,
  // before the answer owner allocates a body or writes the synthetic answer.
  expect(result).toMatchObject({ status: 'ready', value: { answer: { status: 'committed', replayed: false },
    action: null, application: null, state: 'answered' } });
  const resolved = ready(result);
  const answer = committed(resolved.answer);
  expect(answer.value).toMatchObject({ revision: 1, status: 'responded', goalRef: GOAL_B,
    response: { decision: { selection: { kind: 'other' }, annotations: [], requiresApplication: true,
      source: { kind: 'goal_cause', key: source.key, pins: source.pins } } } });
  const card = ready(await owners.reads.readDecisionCard(fixture.ctx, { source }));
  expect(card).toMatchObject({ cardKey: source.key, state: 'answered_pending_application',
    answerMessageRef: answer.value.ref, application: null });
  expect(owners.runtimeCalls()).toBe(0);
  return { answer, card };
}

it('R2B01 answers the emitted system-requeue card without requeuing the Task', async () => {
  const { fixture, owners } = await open();
  expect((await everyStep(fixture, owners, 'r2b01-settings')).value).toMatchObject({ ref: GOAL_B, revision: 8,
    settings: { autonomy: 'every_step', waitForGoalRef: null } });
  await crashWork(fixture, owners);
  const before = requeueRecords(await fixture.storeSnapshot());
  expect(before).toEqual([]);
  const emitted = await waiting(fixture, owners, selectB('r2b01-flow', 'b-work'), 'system_requeue', 'b-work');

  const answered = await assertAnswered(fixture, owners, emitted.card.source, 'r2b01-answer');
  // Both entry points use the Workflow's original source identity.
  expect(ready(await owners.reads.readDecisionCard(fixture.ctx, { source: emitted.cause.source })))
    .toEqual(answered.card);
  const after = await queueB(fixture, owners);
  expect(after.waitingAnswer.filter(card => card.cardKey === emitted.cause.source.key)).toEqual([]);
  expect(after.answeredPendingApplication.filter(card => card.cardKey === emitted.cause.source.key))
    .toEqual([answered.card]);
  expect(after.counts.waitingAnswer).toBe(emitted.queue.counts.waitingAnswer - 1);
  expect(after.counts.answeredPendingApplication).toBe(emitted.queue.counts.answeredPendingApplication + 1);
  expect(requeueRecords(await fixture.storeSnapshot())).toEqual(before);
});

it('R2B02 keeps the system-requeue card answerable after the operator pauses Goal B', async () => {
  const { fixture, owners } = await open();
  expect((await everyStep(fixture, owners, 'r2b02-settings')).value.revision).toBe(8);
  await crashWork(fixture, owners);
  const emitted = await waiting(fixture, owners, selectB('r2b02-flow', 'b-work'), 'system_requeue', 'b-work');
  const before = requeueRecords(await fixture.storeSnapshot());
  expect(before).toEqual([]);
  const paused = await control(fixture, 'pause', 'r2b02-pause');
  expect(paused.value).toMatchObject({ ref: GOAL_B, revision: 9, desiredState: 'paused' });
  const card = waitingCard(await queueB(fixture, owners), emitted.cause.source);
  expect(card.source.pins).toEqual(pausedSource(emitted.card.source, 9).pins);

  await assertAnswered(fixture, owners, card.source, 'r2b02-answer');
  expect(ready(await owners.settings.readGoalSettings(fixture.ctx, { goalRef: GOAL_B })).goal)
    .toMatchObject({ desiredState: 'paused', revision: 9 });
  expect(requeueRecords(await fixture.storeSnapshot())).toEqual(before);
});

it('R2B03 retains the emitted gate auto-reverify card in the queue after pause', async () => {
  const { fixture, owners } = await open();
  const head = await gateHead(fixture, owners);
  expect((await everyStep(fixture, owners, 'r2b03-settings')).value.revision).toBe(9);
  const emitted = await waiting(fixture, owners, gateReverify('r2b03-flow', head), 'auto_reverify', 'b-stage-gate');
  const paused = await control(fixture, 'pause', 'r2b03-pause');
  expect(paused.value).toMatchObject({ ref: GOAL_B, desiredState: 'paused', revision: 10 });
  const beforeRead = await fixture.storeSnapshot();
  const afterPause = await queueB(fixture, owners);
  expect(await fixture.storeSnapshot()).toEqual(beforeRead);

  // RED here today: pausedAutomationAction's gate branch returns null
  // (state/decision-policy.ts:195–196), so this matching card disappears.
  const card = waitingCard(afterPause, emitted.cause.source);
  expect(card).toMatchObject({ cardKey: emitted.card.cardKey, state: 'waiting_answer', readOnly: false });
  expect(card.source.pins).toEqual(pausedSource(emitted.card.source, 10).pins);
  expect(owners.runtimeCalls()).toBe(0);
});

it('R2B04 answers the emitted gate auto-reverify card while Goal B is paused', async () => {
  const { fixture, owners } = await open();
  const head = await gateHead(fixture, owners);
  expect((await everyStep(fixture, owners, 'r2b04-settings')).value.revision).toBe(9);
  const emitted = await waiting(fixture, owners, gateReverify('r2b04-flow', head), 'auto_reverify', 'b-stage-gate');
  const paused = await control(fixture, 'pause', 'r2b04-pause');
  expect(paused.value).toMatchObject({ ref: GOAL_B, desiredState: 'paused', revision: 10 });

  // Answer the already displayed card with the Goal pin from the actual pause
  // receipt. Do not call the broken queue/card reader as an extra precondition:
  // B04 must fail at resolveDecision, independently of B03. Only control moved;
  // affected Task/Run pins and the content basis still name the emitted cause.
  const source = pausedSource(emitted.card.source, paused.value.revision);
  expect(source.key).toBe(emitted.cause.source.key);
  expect(source.pins.filter(pin => keyOf(pin.ref) === keyOf(GOAL_B))).toEqual([{ ref: GOAL_B, revision: 10 }]);
  const before = requeueRecords(await fixture.storeSnapshot());
  await assertAnswered(fixture, owners, source, 'r2b04-answer');
  expect(ready(await owners.settings.readGoalSettings(fixture.ctx, { goalRef: GOAL_B })).goal)
    .toMatchObject({ desiredState: 'paused', revision: 10 });
  expect(requeueRecords(await fixture.storeSnapshot())).toEqual(before);
});

it('R2B05 replays the committed requeue step after the autonomy changes to every_step', async () => {
  const { fixture, owners } = await open();
  expect(ready(await owners.settings.readGoalSettings(fixture.ctx, { goalRef: GOAL_B })))
    .toMatchObject({ goal: { ref: GOAL_B, revision: 7 }, settings: { autonomy: 'after_plan_confirmation' } });
  const crashed = await crashWork(fixture, owners);
  expect(requeueRecords(await fixture.storeSnapshot())).toEqual([]);
  const selected = ready(await owners.workflow.advanceWork(fixture.ctx, selectB('r2b05-flow', 'b-work')));
  expect(selected).toMatchObject({ state: 'advance', receipt: null, next: { kind: 'perform',
    operation: { kind: 'requeue_task', request: { input: { taskRef: fixture.claimRA.task,
      afterRunRef: crashed.ref, reason: 'auto-rework:run_failed#1' } } } } });
  const step = selected.next;
  if (step === null || step.kind !== 'perform' || step.operation.kind !== 'requeue_task') {
    throw new Error('the real Workflow must select the requeue step');
  }
  const capturedStep = structuredClone(step);
  const first = ready(await owners.workflow.advanceWork(fixture.ctx, step));
  expect(first).toMatchObject({ state: 'advance', receipt: { kind: 'requeue_task',
    result: { status: 'committed', replayed: false, value: { kind: 'requeued' } } } });
  const receipt = first.receipt;
  if (receipt === null || receipt.kind !== 'requeue_task') throw new Error('missing first requeue receipt');
  const saved = committed(receipt.result);
  if (saved.value.kind !== 'requeued') throw new Error('the automatic requeue must commit, not a refusal');
  const ref = { aggregateType: 'TaskRequeue' as const, projectId: 'P', goalId: 'B', taskId: 'b-work',
    afterRunId: crashed.ref.runId };
  expect(saved.value.requeue).toMatchObject({ ref, revision: 1, task: fixture.claimRA.task, planRef: PLAN_B1,
    afterRunRef: crashed.ref, failureClass: 'run_failed', requestedBy: WORKFLOW_AUTOMATION_ACTOR,
    automation: { automatic: true, counted: true, autoCount: 1, cap: 3 } });
  expect(requeueRecords(await fixture.storeSnapshot())).toEqual([{ refKey: keyOf(ref), revision: 1 }]);
  expect((await everyStep(fixture, owners, 'r2b05-settings')).value).toMatchObject({ ref: GOAL_B, revision: 8,
    settings: { autonomy: 'every_step' } });

  const beforeRetry = await fixture.storeSnapshot();
  const allocations = { ...fixture.allocationCounts };
  const runtimeCalls = owners.runtimeCalls();
  const replay = ready(await owners.workflow.advanceWork(fixture.ctx, capturedStep));
  expect(replay).toMatchObject({ state: 'advance', reason: null, receipt: { kind: 'requeue_task',
    result: { status: 'committed', replayed: true, cursor: saved.cursor, value: saved.value } } });
  const replayReceipt = replay.receipt;
  if (replayReceipt === null || replayReceipt.kind !== 'requeue_task') throw new Error('missing replay receipt');
  expect(replayReceipt.result).toEqual({ ...saved, replayed: true });
  expect(replay.decisionCause ?? null).toBeNull();
  expect(replay.next).toEqual(first.next);
  expect(await fixture.storeSnapshot()).toEqual(beforeRetry);
  expect(fixture.allocationCounts).toEqual(allocations);
  expect(owners.runtimeCalls()).toBe(runtimeCalls);
  expect(runtimeCalls).toBe(0);
});
