/**
 * E3-UI read-side fields (UI 读口补字段): the decision card's `taskRef`, `runRef` and `openedAt`.
 *
 * D1–D3 read the one `goal_cause` card of `tests/helpers/S7B-L46-fixture.ts:252` (`readL46Card`): a failed real
 * Workflow Run whose cause already carries the Task and Run. D4 reads an `initial_plan_pending` cause card (no Run
 * yet). E1 reads a `required_task_deferred` cause card: its source carries a Task pin, but the cause itself names
 * no Task. E2 records a real Host-restart interruption and reads its `goal_cause` card. D5 drives the same L46
 * world's Workflow `automation_confirmation` wait and reads its `decisionCause` through `workflow/advance`.
 * F1/F2 answer a deferred-Task and a plan-pending cause with `other`, leave it unapplied, and read the answered
 * card directly and through the queue: §9a's cause refs and explicit null time must survive the saved answer.
 *
 * §9a/§9b (lead 11-07 20:4x) are the frozen rows: a failed-Run card takes `openedAt` from the Run's `endedAt`; a
 * plan-pending card has null; a deferred-Task card passes the cause's null `taskRef`, not the pin; an interruption
 * card opens at the interruption's `detectedAt`. E2 is SQLite only because it restarts the Host
 * (`tests/RULES.md:193–:195`); every other row is memory.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, RuntimeTask } from '../../src/contracts/plan.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { AG2B_SCOPE, ag2bPlanDraft, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { openS7BL46World, readL46Card } from '../helpers/S7B-L46-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7C1World, S7C1_CREATE_ROLE, type S7C1World } from '../helpers/S7C-member-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { cleanupScenarios, openHostScenario, performs } from '../scenarios/harness.js';
import { editThenText } from '../scenarios/support/common.js';

afterEach(cleanupScenarios, 120_000);

const worlds: S7C1World[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(target => target.close())); });

/** The field the production change adds; the cast keeps this test tree typechecking before it lands. */
const cardTaskRefOf = (card: DecisionCardV1): unknown => (card as { taskRef?: unknown }).taskRef;
const cardRunRefOf = (card: DecisionCardV1): unknown => (card as { runRef?: unknown }).runRef;

function cardCode(card: DecisionCardV1): string | null {
  if (card.source.kind !== 'goal_cause') return null;
  const parsed = JSON.parse(card.source.key) as { code?: unknown };
  return typeof parsed.code === 'string' ? parsed.code : null;
}

async function cardOfCause(target: S7C1World, goal: GoalRef, code: string): Promise<DecisionCardV1> {
  const queue = valueOf<DecisionQueueReadV1>(await target.main.route('decisions/queue', {
    workspace: S6A_SCOPE, goalRef: goal, sections: ['waiting_answer'], page: { limit: 100 },
  }), 'ready', 'decisions/queue');
  const listed = queue.waitingAnswer.find(card => cardCode(card) === code);
  if (listed === undefined) {
    throw new Error(`E3UI: no ${code} card for ${goal.goalId}: ${JSON.stringify(queue.waitingAnswer.map(cardCode))}`);
  }
  return valueOf<DecisionCardV1>(await target.main.route('decisions/card', { source: listed.source }),
    'ready', `decisions/card ${code}`);
}

/** Answer a cause card with `other` (no application), then read the answered card directly and through the queue. */
async function answerOtherAndRead(target: S7C1World, goal: GoalRef, card: DecisionCardV1, requestId: string):
Promise<{ direct: DecisionCardV1; queued: DecisionCardV1 }> {
  valueOf(await target.main.post('decisions/answer', graphWrite(S6A_SCOPE, {
    source: card.source, selection: { kind: 'other' }, text: '', annotations: [],
  }, requestId, card.source.pins)), 'ready', `${requestId} answer`);
  const direct = valueOf<DecisionCardV1>(await target.main.route('decisions/card', { source: card.source }),
    'ready', `${requestId} direct card`);
  const queue = valueOf<DecisionQueueReadV1>(await target.main.route('decisions/queue', {
    workspace: S6A_SCOPE, goalRef: goal, sections: ['answered_pending_application'], page: { limit: 100 },
  }), 'ready', `${requestId} queue`);
  const queued = queue.answeredPendingApplication.find(candidate => candidate.source.key === card.source.key);
  if (queued === undefined) throw new Error(`${requestId}: the answered card is not in the queue`);
  return { direct, queued };
}

/** One work task plus `ag2bPlanDraft`'s gate and obligation; D4 leaves it active, E1 defers it. */
function goalCausePlanDraft(goal: GoalRef, taskId: string, disposition: 'active' | 'deferred'): PlanRevisionDraft {
  const draft = ag2bPlanDraft([taskId]);
  return {
    ...draft, planId: `${goal.goalId}-plan`, goalId: goal.goalId,
    tasks: draft.tasks.map((task): RuntimeTask => task.taskKind !== 'work' ? task : { ...task, disposition }),
    assignments: (draft.assignments ?? []).map(assignment => ({ ...assignment,
      role: S7C1_CREATE_ROLE.templateId, instruction: `E3UI ${assignment.taskId}` })),
  };
}

async function createGoalWithDraft(target: S7C1World, goalId: string, taskId: string,
  disposition: 'active' | 'deferred', adopt: boolean): Promise<GoalRef> {
  const goal = (await target.main.createGoal(goalId, `E3UI ${goalId}`)).ref;
  const proposed = valueOf<{ ref: unknown; revision: number }>(await target.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn: null, draft: goalCausePlanDraft(goal, taskId, disposition),
    reason: { text: `E3UI ${goalId} plan`, sources: [] },
  }, `${goalId}-propose`)), 'committed', `the ${goalId} Plan proposal`);
  if (adopt) {
    valueOf(await target.main.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
    }, `${goalId}-apply`)), 'committed', `the ${goalId} Plan adoption`);
  }
  return goal;
}

describe('D: a goal_cause card carries its cause refs and time', () => {
  let opened: Awaited<ReturnType<typeof openS7BL46World>>;
  beforeAll(async () => { opened = await openS7BL46World({ backend: 'memory' }); });
  afterAll(async () => { await opened.world.close(); });

  it('D1 a failed-Run card carries the Task of its cause', async () => {
    /* Named mutation: `goalCauseCard` writes `taskRef: null`; the `toEqual(world.tasks.A)` below goes red. */
    const card = await readL46Card(opened.world, opened.goalRef);
    expect(cardTaskRefOf(card)).toEqual(opened.tasks.A);
  });

  it('D2 a failed-Run card carries the Run of its cause', async () => {
    /* Named mutation: `goalCauseCard` writes `runRef: null`; the `toEqual(world.run)` below goes red. */
    const card = await readL46Card(opened.world, opened.goalRef);
    expect(cardRunRefOf(card)).toEqual(opened.run);
  });

  it('D3 a failed-Run card opens at the Run endedAt', async () => {
    /* Named mutation: `goalCauseCard.openedAt` goes back to null; the `toBe(endedAt)` below goes red. */
    const card = await readL46Card(opened.world, opened.goalRef);
    const ended = ready<TaskExecutionRecord>(await opened.world.post('executions/read',
      plain(S6A_SCOPE, opened.run)), 'the L46 failed Run');
    expect(card.openedAt).toBe(ended.run.endedAt);
  });

  it('D4 a plan-pending cause card has no openedAt', async () => {
    /* Named mutation: `goalCauseCard.openedAt` takes a non-null wall-clock time; the `toBeNull` below goes red. */
    const target = await openS7C1World({ adviser: false });
    worlds.push(target);
    const goal = await createGoalWithDraft(target, 'e3ui-d4-goal', 'e3ui-d4-work', 'active', false);
    const card = await cardOfCause(target, goal, 'initial_plan_pending');
    expect(card.openedAt).toBeNull();
  });

  it('D5 the automation wait opens the cause at the failed Run endedAt', async () => {
    /* Named mutation: `task-gate.ts:548` writes `openedAt: null`; the `toBe(endedAt)` below goes red. */
    const waited = ready<Extract<WorkflowAdvanceResult, { status: 'ready' }>['value']>(
      await opened.world.post('workflow/advance', plain(S6A_SCOPE, {
        schemaVersion: 1, goalRef: opened.goalRef, sessionHint: null, kind: 'select_work',
        flowId: 'e3ui-d5-a', taskId: opened.tasks.A.taskId,
      })), 'the L46 automation wait');
    const ended = ready<TaskExecutionRecord>(await opened.world.post('executions/read',
      plain(S6A_SCOPE, opened.run)), 'the L46 failed Run');
    expect(waited).toMatchObject({ state: 'waiting', reason: 'automation_confirmation_required:system_requeue' });
    expect(waited.decisionCause?.openedAt).toBe(ended.run.endedAt);
  });

  it('E1 a deferred-Task cause card passes the cause null taskRef, not its Task pin', async () => {
    /* Named mutation: `goalCauseCard.taskRef` is taken from `cause.source.pins` (the one Task pin); the
     * `toBeNull` below goes red. */
    const target = await openS7C1World({ adviser: false });
    worlds.push(target);
    const goal = await createGoalWithDraft(target, 'e3ui-e1-goal', 'e3ui-e1-work', 'deferred', true);
    const card = await cardOfCause(target, goal, 'required_task_deferred');

    // The pin is the reason this row exists: the cause names no Task, the source carries one.
    expect(card.source.pins.some(pin => (pin.ref as { aggregateType?: string }).aggregateType === 'Task')).toBe(true);
    expect(cardTaskRefOf(card)).toBeNull();
  });

  it('F1 an answered deferred-Task cause card still passes the cause null taskRef', async () => {
    /* Named mutation: `mergeCards` keeps the existing answer's `taskRef` (the one Task pin) instead of the live
     * card's; the two `toBeNull` assertions below go red. */
    const target = await openS7C1World({ adviser: false });
    worlds.push(target);
    const goal = await createGoalWithDraft(target, 'e3ui-f1-goal', 'e3ui-f1-work', 'deferred', true);
    const card = await cardOfCause(target, goal, 'required_task_deferred');
    expect(cardTaskRefOf(card)).toBeNull();

    const answered = await answerOtherAndRead(target, goal, card, 'e3ui-f1-answer');
    expect(answered.direct.state).toBe('answered_pending_application');
    expect(cardTaskRefOf(answered.direct)).toBeNull();
    expect(cardTaskRefOf(answered.queued)).toBeNull();
  });

  it('F2 an answered plan-pending cause card still has no openedAt', async () => {
    /* Named mutation: `mergeCards` falls back to the existing answer's `openedAt` when the live card's is null;
     * the two `toBeNull` assertions below go red. */
    const target = await openS7C1World({ adviser: false });
    worlds.push(target);
    const goal = await createGoalWithDraft(target, 'e3ui-f2-goal', 'e3ui-f2-work', 'active', false);
    const card = await cardOfCause(target, goal, 'initial_plan_pending');
    expect(card.openedAt).toBeNull();

    const answered = await answerOtherAndRead(target, goal, card, 'e3ui-f2-answer');
    expect(answered.direct.state).toBe('answered_pending_application');
    expect(answered.direct.openedAt).toBeNull();
    expect(answered.queued.openedAt).toBeNull();
  });
});

describe('E2: a restart interruption opens its cause card at the interruption time', () => {
  it('E2 a restart-interruption cause card opens at the interruption detectedAt', async () => {
    /* Named mutation: the `interrupted_pending_resume` branch writes `openedAt: null`; the `toBe(detectedAt)`
     * below goes red. SQLite only: the row needs the Host restart (`tests/RULES.md:193–:195`). */
    const h = await openHostScenario({ workIds: ['t1', 't2'],
      script: { replies: [...editThenText('e3ui-e2'),
        { kind: 'text', text: 'E3UI E2: the person starts the work after the interruption' }] } });
    const driven = await h.advance(h.select('e3ui-e2', 't1'), { stopBefore: performs('run_check') });
    expect(driven.state).toBe('stopped');
    await h.restart();

    const display = await h.goalDisplay();
    const interruption = display.causes.find(cause => cause.code === 'interrupted_pending_resume');
    expect(interruption).toBeDefined();
    const detectedAt = (interruption as { detectedAt?: string }).detectedAt;
    expect(typeof detectedAt).toBe('string');

    const queue = ready<DecisionQueueReadV1>(await h.post('decisions/queue', plain(AG2B_SCOPE, {
      workspace: AG2B_SCOPE, sections: ['waiting_answer'], page: { limit: 100 },
    })), 'the E2 queue');
    const listed = queue.waitingAnswer.find(card => cardCode(card) === 'interrupted_pending_resume');
    expect(listed).toBeDefined();
    if (listed === undefined) return;
    const card = ready<DecisionCardV1>(await h.post('decisions/card',
      plain(AG2B_SCOPE, { source: listed.source })), 'the E2 interruption card');
    expect(card.openedAt).toBe(detectedAt);
  }, 240_000);
});
