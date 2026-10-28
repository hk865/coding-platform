/** Slice 5 round 2, table sections 0-1 and 2.3: R2C01-R2C08 on both stores. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolveDecisionInputV1, ResolveDecisionReadV1 } from '../../src/business/workflow/contracts.js';
import type { DecisionSelectionV1 } from '../../src/contracts/goal-decisions.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import {
  GOAL_A, GOAL_B, GOAL_C, PLAN_A1, PLAN_A2, PLAN_B1, T, WORKSPACE_SCOPE,
  goalBasisOf, openS5DecisionFixture, type S5DecisionFixture, type S5FixtureKind,
} from '../helpers/S5-decision-fixture.js';
import { committed, goalAt, keyOf, messageAt, pin, ready } from '../helpers/S5-application-support.js';
import {
  adoptA2, assembleS5R2C, completeA1, controlA, observeC,
  readConflict, settingsEvent, type S5R2C,
} from '../helpers/S5R2-c-support.js';

const fixtures: S5DecisionFixture[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T);
});
afterEach(async () => {
  try { for (const f of fixtures.splice(0)) await f.close(); }
  finally { vi.useRealTimers(); }
});

async function open(kind: S5FixtureKind, completion = false) {
  const f = completion
    ? await openS5DecisionFixture(kind, { catalog: 'modules', requirementKind: 'static' })
    : await openS5DecisionFixture(kind, { catalog: 'modules' });
  fixtures.push(f);
  return assembleS5R2C(f);
}

const WAIT: DecisionSelectionV1 = { kind: 'conflict_wait', earlier: GOAL_A, later: GOAL_B };
const ORDER: DecisionSelectionV1 = { kind: 'conflict_order', goalOrder: [GOAL_C, GOAL_B, GOAL_A] };
const PARALLEL: DecisionSelectionV1 = { kind: 'conflict_parallel', earlier: GOAL_A, later: GOAL_B };

async function requestFor(x: S5R2C, requestId: string, selection: DecisionSelectionV1, aRevision = 7):
  Promise<GraphWrite<ResolveDecisionInputV1>> {
  const card = await readConflict(x, aRevision);
  // The answer command gets ONLY the card's source pins (§3.3 line 625).
  // The real Workflow constructs its own settings pins, including GoalPhase/C.
  return { input: { source: card.source, selection, text: 'Apply this structured conflict choice.', annotations: [] },
    meta: { requestId, expected: structuredClone(card.source.pins) } };
}

function appliedReceipts(result: ResolveDecisionReadV1) {
  expect(result.state).toBe('applied');
  const answer = committed(result.answer);
  if (result.action === null || result.action.status !== 'committed' || result.application === null) {
    throw new Error('applied requires all three receipts');
  }
  return { answer, action: committed(result.action as WriteResult<{ goals: GoalSnapshot[] }>), application: committed(result.application) };
}

async function firstApplication(x: S5R2C, request: GraphWrite<ResolveDecisionInputV1>) {
  const before = await observeC(x);
  const first = appliedReceipts(ready(await x.resolveDecision(x.f.ctx, request)));
  expect(first.answer).toMatchObject({ replayed: false, value: { revision: 1, status: 'responded',
    response: { decision: { source: request.input.source, selection: request.input.selection, requiresApplication: true } } } });
  expect(first.action.replayed).toBe(false);
  expect(first.application).toMatchObject({ replayed: false, value: { ref: first.answer.value.ref, revision: 2 } });
  const event = await settingsEvent(x, first.action.cursor);
  expect(event.payload.value).toEqual(first.action.value);
  expect(event.payload.proof).toMatchObject({ acknowledgementRef: first.answer.value.ref,
    capturedPins: request.input.source.pins });
  const after = await observeC(x);
  expect(after.store.eventCount - before.store.eventCount).toBe(3);
  expect(after.runtimeCalls).toBe(0);
  expect(x.faults).toEqual({ goalAPhase: false, goalCSettings: false, phaseHits: 0, settingsHits: 0 });
  return first;
}

/** Compare the saved values AND cursors of all three commits, not current rows. */
function expectReplay(result: ResolveDecisionReadV1, first: ReturnType<typeof appliedReceipts>) {
  expect(result.answer).toEqual({ ...first.answer, replayed: true });
  // R2C02/R2C04 deliberately fail HERE today: action is unavailable instead
  // of the original committed receipt. All setup and fault checks run first.
  expect(result.action).toEqual({ ...first.action, replayed: true });
  expect(result.application).toEqual({ ...first.application, replayed: true });
  expect(result.state).toBe('applied');
}

describe.each(['memory', 'sqlite'] as const)('S5 round 2 conflict coordination (%s)', kind => {
  it('R2C01 replays all three receipts after A is paused and resumed', async () => {
    const x = await open(kind);
    const request = await requestFor(x, 'r2c01', WAIT);
    const first = await firstApplication(x, request);
    expect(first.action.value.goals).toHaveLength(1);
    expect(first.action.value.goals[0]).toMatchObject({ ref: GOAL_B, revision: 8,
      settings: { waitForGoalRef: GOAL_A } });
    const originalA = await goalAt(x.f.records, GOAL_A);
    await controlA(x, 'pause', 7, 'r2c01-pause');
    await controlA(x, 'resume', 8, 'r2c01-resume');
    const resumedA = await goalAt(x.f.records, GOAL_A);
    expect(resumedA).toMatchObject({ revision: 9, desiredState: 'active', activePlanRevision: PLAN_A1 });
    expect(goalBasisOf(resumedA)).toEqual(goalBasisOf(originalA));
    const before = await observeC(x);
    const retry = ready(await x.resolveDecision(x.f.ctx, request));
    expect(await observeC(x)).toEqual(before);
    expectReplay(retry, first);
  });

  it('R2C02 replays the wait receipt even when A task graph is unavailable on retry', async () => {
    const x = await open(kind);
    const request = await requestFor(x, 'r2c02', WAIT);
    const first = await firstApplication(x, request);
    // The first real coordinator call went through this forwarding wrapper.
    expect(x.readsReached.goalAPhase).toBe(1);
    expect(first.action.value.goals).toHaveLength(1);
    expect(first.action.value.goals[0]).toMatchObject({ ref: GOAL_B, revision: 8,
      settings: { waitForGoalRef: GOAL_A } });
    const before = await observeC(x);
    x.faults.goalAPhase = true;
    // Probe the SAME wrapped dependency during the retry window. This proves
    // it is unavailable even after a fix correctly restores receipts without
    // consulting current facts; requiring the coordinator to read would ban
    // the spec's receipt-before-business-read fix.
    expect(await x.plans.queryTaskGraph(x.f.ctx, { goalRef: GOAL_A }))
      .toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(x.faults.phaseHits).toBe(1);
    const retry = ready(await x.resolveDecision(x.f.ctx, request));
    expect(x.faults.phaseHits).toBeGreaterThanOrEqual(1);
    expect(await observeC(x)).toEqual(before);
    // Current blocker: decision-actions.ts:176-177 reads before replay;
    // :225-227 returns action=unavailable, application=null.
    expectReplay(retry, first);
  });

  it('R2C03 replays the order receipt after uncaptured C changes autonomy', async () => {
    const x = await open(kind);
    const request = await requestFor(x, 'r2c03', ORDER);
    expect(request.input.source.pins.filter(entry => keyOf(entry.ref) === keyOf(GOAL_C))).toEqual([]);
    const first = await firstApplication(x, request);
    expect(first.action.value.goals.map(goal => ({ ref: goal.ref, revision: goal.revision, order: goalBasisOf(goal).settings.order })))
      .toEqual([{ ref: GOAL_C, revision: 8, order: 0 }, { ref: GOAL_B, revision: 7, order: 1 },
        { ref: GOAL_A, revision: 8, order: 2 }]);
    const changed = committed(await x.settings.setGoalSettings(x.f.ctx, {
      input: { goalRef: GOAL_C, autonomy: 'every_step', waitForGoalRef: null },
      meta: { requestId: 'r2c03-change-C', expected: [pin(GOAL_C, 8)] },
    }));
    expect(changed.value).toMatchObject({ ref: GOAL_C, revision: 9, settings: { order: 0, autonomy: 'every_step' } });
    const before = await observeC(x);
    const retry = ready(await x.resolveDecision(x.f.ctx, request));
    expect(await observeC(x)).toEqual(before);
    expectReplay(retry, first);
  });

  it('R2C04 replays the order receipt even when uncaptured C settings are unavailable', async () => {
    const x = await open(kind);
    const request = await requestFor(x, 'r2c04', ORDER);
    expect(request.input.source.pins.filter(entry => keyOf(entry.ref) === keyOf(GOAL_C))).toEqual([]);
    const first = await firstApplication(x, request);
    expect(x.readsReached.goalCSettings).toBe(1);
    expect(first.action.value.goals.map(goal => ({ ref: goal.ref, revision: goal.revision, order: goalBasisOf(goal).settings.order })))
      .toEqual([{ ref: GOAL_C, revision: 8, order: 0 }, { ref: GOAL_B, revision: 7, order: 1 },
        { ref: GOAL_A, revision: 8, order: 2 }]);
    const before = await observeC(x);
    x.faults.goalCSettings = true;
    // As in R2C02, exercise the injected read without requiring a repaired
    // coordinator to read current C before recovering its saved receipt.
    expect(await x.settings.readGoalSettings(x.f.ctx, { goalRef: GOAL_C }))
      .toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(x.faults.settingsHits).toBe(1);
    const retry = ready(await x.resolveDecision(x.f.ctx, request));
    expect(x.faults.settingsHits).toBeGreaterThanOrEqual(1);
    expect(await observeC(x)).toEqual(before);
    // Current blocker: decision-actions.ts:155-159 reads C before replay;
    // :225-227 returns action=unavailable, application=null.
    expectReplay(retry, first);
  });

  it('R2C05 applies a paused-A answer after resume with the original captured A pin', async () => {
    const x = await open(kind);
    await controlA(x, 'pause', 7, 'r2c05-pause');
    const request = await requestFor(x, 'r2c05', WAIT, 8);
    expect(request.input.source.pins.filter(entry => keyOf(entry.ref) === keyOf(GOAL_A))).toEqual([pin(GOAL_A, 8)]);
    const beforeAnswer = await x.f.storeSnapshot();
    const first = ready(await x.resolveDecision(x.f.ctx, request));
    const answer = committed(first.answer);
    expect(first).toMatchObject({ state: 'awaiting_resume', action: { status: 'rejected', code: 'busy' }, application: null });
    expect(answer).toMatchObject({ replayed: false, value: { revision: 1,
      response: { decision: { source: request.input.source } } } });
    expect((await x.f.storeSnapshot()).eventCount - beforeAnswer.eventCount).toBe(1);
    expect(await goalAt(x.f.records, GOAL_B)).toMatchObject({ revision: 7, settings: { waitForGoalRef: null } });
    await controlA(x, 'resume', 8, 'r2c05-resume');
    const retry = appliedReceipts(ready(await x.resolveDecision(x.f.ctx, request)));
    expect(retry.answer).toEqual({ ...answer, replayed: true });
    expect(retry.action.replayed).toBe(false);
    expect(retry.action.value.goals).toHaveLength(1);
    expect(retry.action.value.goals[0]).toMatchObject({ ref: GOAL_B, revision: 8,
      settings: { waitForGoalRef: GOAL_A } });
    expect(retry.application.replayed).toBe(false);
    const event = await settingsEvent(x, retry.action.cursor);
    expect(event.payload.proof).toMatchObject({ acknowledgementRef: answer.value.ref,
      capturedPins: request.input.source.pins, changes: [{ before: pin(GOAL_B, 7), after: pin(GOAL_B, 8) }] });
    if (event.payload.proof === null) throw new Error('GoalSettingsChanged must carry decision proof');
    expect(event.payload.proof.capturedPins.filter(entry => keyOf(entry.ref) === keyOf(GOAL_A))).toEqual([pin(GOAL_A, 8)]);
    expect(await x.f.decisionAnswersBySource(request.input.source.kind, request.input.source.key)).toEqual([keyOf(answer.value.ref)]);
    expect(x.runtimeCalls()).toBe(0);
  });

  it('R2C06 rejects a W2 decisionMessageRef in reorderGoals without writes', async () => {
    const x = await open(kind);
    const request = await requestFor(x, 'r2c06-answer', PARALLEL);
    const answer = committed(await x.decisions.answerDecision(x.f.ctx, request));
    expect((await messageAt(x.f.records, answer.value.ref)).ref).toEqual(answer.value.ref);
    expect(answer.value.ref).toMatchObject({ projectId: 'P', workspaceId: 'W' });
    expect(await goalAt(x.f.records, GOAL_C)).toMatchObject({ ref: GOAL_C, revision: 7 });
    const before = await observeC(x);
    const result = await x.settings.reorderGoals(x.f.ctx, {
      input: { workspace: WORKSPACE_SCOPE, goalOrder: [GOAL_A, GOAL_B, GOAL_C],
        decisionMessageRef: { ...answer.value.ref, workspaceId: 'W2' } },
      meta: { requestId: 'r2c06-reorder', expected: [pin(GOAL_A, 7), pin(GOAL_B, 7), pin(GOAL_C, 7)] },
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await observeC(x)).toEqual(before);
  });

  it('R2C07 rejects a W2 decisionMessageRef in resolveGoalConflict without writes', async () => {
    const x = await open(kind);
    const request = await requestFor(x, 'r2c07-answer', PARALLEL);
    const answer = committed(await x.decisions.answerDecision(x.f.ctx, request));
    expect((await messageAt(x.f.records, answer.value.ref)).ref).toEqual(answer.value.ref);
    expect(answer.value.ref).toMatchObject({ projectId: 'P', workspaceId: 'W' });
    const before = await observeC(x);
    const result = await x.settings.resolveGoalConflict(x.f.ctx, {
      input: { source: request.input.source, selection: { kind: 'conflict_parallel', earlier: GOAL_A, later: GOAL_B },
        decisionMessageRef: { ...answer.value.ref, workspaceId: 'W2' } },
      meta: { requestId: 'r2c07-conflict', expected: [pin(GOAL_A, 7), pin(GOAL_B, 7)] },
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await observeC(x)).toEqual(before);
  });

  it('R2C08 keeps the PA2/PB1 conflict waiting after formal PA1 completion', async () => {
    const x = await open(kind, true);
    const initialConflict = await readConflict(x);
    const completion = await completeA1(x);
    const completedGraph = ready(await x.plans.queryTaskGraph(x.f.ctx, { goalRef: GOAL_A }));
    expect(completedGraph.completion).toEqual({ status: 'recorded', snapshot: completion.value, selectedPlanMatches: true });
    const completedConflicts = ready(await x.reads.queryGoalConflicts(x.f.ctx, { workspace: WORKSPACE_SCOPE }));
    expect(completedConflicts.cards).toHaveLength(1);
    expect(completedConflicts.cards[0]).toMatchObject({ cardKey: initialConflict.cardKey,
      state: 'closed', closedReason: 'source_resolved', readOnly: true, actions: [] });
    await adoptA2(x);
    const graph = ready(await x.plans.queryTaskGraph(x.f.ctx, { goalRef: GOAL_A }));
    expect(graph.completion).toEqual({ status: 'recorded', snapshot: completion.value, selectedPlanMatches: false });
    expect(await goalAt(x.f.records, GOAL_B)).toMatchObject({ revision: 7, activePlanRevision: PLAN_B1 });
    const before = await observeC(x);
    const conflict = await readConflict(x, 8, 7, PLAN_A2);
    const queue = ready(await x.reads.queryDecisionQueue(x.f.ctx, { workspace: WORKSPACE_SCOPE, goalRef: GOAL_A,
      sections: ['waiting_answer', 'answered_pending_application', 'history'], page: { limit: 100 } }));
    const fromQueue = queue.waitingAnswer.filter(card => card.cardKey === conflict.cardKey);
    expect(fromQueue).toEqual([conflict]);
    expect(queue.answeredPendingApplication.filter(card => card.cardKey === conflict.cardKey)).toEqual([]);
    expect(queue.history.filter(card => card.cardKey === conflict.cardKey)).toEqual([]);
    expect(ready(await x.sources.readSource(x.f.ctx, conflict.source)))
      .toMatchObject({ closed: false, source: conflict.source });
    expect(await observeC(x)).toEqual(before);
    expect(x.runtimeCalls()).toBe(0);
  });
});
