/**
 * PL-06 / §5.5.3: the refinement-need `goal_cause/no_adviser` derivation.
 *
 * Real steps only: the S6A Host world's own governance and Goals, an adopted
 * Plan whose later segment is a required active `plan_only` work placeholder,
 * a real secretary line, and the real duty resolver the composition injects.
 * The reader is the production `createGoalDecisionCauseReader` over the world's
 * real records/plans/recipients. No record is written by hand and no store is
 * read directly.
 *
 * The queue half is read through the real Host route `decisions/queue`: the
 * same production source wraps this reader, so the card and the Workflow's
 * no-adviser branch judge one cause. The secretary's mailbox is read through
 * `messages/inbox`/`messages/outbox`; a real adviser line then lets the same
 * Plan version emit its one `refine:` through `workflow/advance`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import {
  SYSTEM_ROUND_ACTOR, systemRoundMessageRef, systemRoundRequestId, type SystemRoundV1,
} from '../../src/contracts/plan-round.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { createGoalDecisionCauseReader } from '../../src/core/work-graph/tasks/goal-decision-reader.js';
import { advanceUntil } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { openS6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { committed, sessionOf } from '../helpers/S7A-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

/** The production reader over the world's real owners, including the real duty resolver. */
function openCauseReader(world: S6AHostWorld) {
  return createGoalDecisionCauseReader({
    records: world.platform.disconnect.records,
    plans: world.platform.plans,
    recipients: world.platform.recipients,
  });
}

/**
 * An adopted Plan with one executable work task and a later-segment required
 * active `plan_only` placeholder: the refinement need §5.5.3 names.
 */
async function adoptRefinementPlan(world: S6AHostWorld, goal: GoalRef): Promise<void> {
  const ws = s6aCardsWorkspace(world, S6A_SCOPE);
  await governS6B(world, ws, world.goals);
  const base = await adoptS6BPlan(ws, goal, {
    label: 'pl06-base', taskIds: ['pl06-base-task'], role: 'builder',
  });
  const plan = base.plan;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2,
    planId: 'pl06-refined',
    planRevision: plan.planRevision + 1,
    goalId: goal.goalId,
    stages: structuredClone(plan.stages),
    tasks: [
      ...structuredClone(plan.tasks).map(task => task.taskId === 'pl06-base-task'
        ? { ...task, disposition: 'cancelled' as const } : task),
      {
        taskId: 'pl06-refine-placeholder',
        title: 'Refine the later segment',
        requirementLevel: 'required',
        taskKind: 'work',
        disposition: 'active',
        phase: 'pending',
        scope: { kind: 'goal' },
        executionIntent: 'plan_only',
      },
    ],
    assignments: structuredClone(plan.assignments ?? []),
    obligations: structuredClone(plan.obligations),
    taskHierarchy: structuredClone(plan.taskHierarchy),
    executionDag: structuredClone(plan.executionDag),
    taskRelations: structuredClone(plan.taskRelations ?? []),
    inputRequirements: structuredClone(plan.inputRequirements ?? []),
  };
  const proposed = committed<{ ref: unknown; revision: number }>(await ws.post('plans/propose', graphWrite(
    ws.scope, {
      goalRef: goal, basedOn: plan.ref, draft,
      reason: { text: 'PL-06 later-segment refinement placeholder', sources: [] },
    }, 'pl06-refine-propose',
  )), 'the refinement plan proposal');
  committed(await ws.post('plans/apply', graphWrite(ws.scope, {
    proposalRef: proposed.ref,
    expectedProposalRevision: proposed.revision,
    decisionRefs: [],
  }, 'pl06-refine-apply')), 'the refinement plan adoption');
}

describe('PL-06 no_adviser', () => {
  it('derives one goal_cause/no_adviser with the Goal pin, then stops once an adviser line exists', async () => {
    const world = await openS6AHostWorld({ backend: 'memory' });
    worlds.push(world);
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    await adoptRefinementPlan(world, world.goals.first);
    // A real secretary line exists but must never be the adviser recipient.
    const secretary = await sessionOf(world,
      await createS6BLine(ws, { label: 'secretary', role: platformRoleProfile('secretary').template }));
    const ctx = ws.humanContext();
    const goalRead = await world.platform.plans.queryGoal(ctx, world.goals.first);
    expect(goalRead.status).toBe('ready');
    if (goalRead.status !== 'ready') return;
    const goal = goalRead.value.goal;
    const reader = openCauseReader(world);

    const before = await reader.readGoalDecisionCauses(ctx, { goalRef: goal.ref });
    expect(before.status).toBe('ready');
    if (before.status !== 'ready') return;
    const noAdviser = before.value.filter(cause => cause.code === 'no_adviser');
    expect(noAdviser).toHaveLength(1);
    const cause = noAdviser[0]!;
    expect(cause.code).toBe('no_adviser');
    expect(cause.taskRef).toBeNull();
    expect(cause.runRef).toBeNull();
    expect(cause.action).toBeNull();
    expect(cause.source.kind).toBe('goal_cause');
    expect(cause.source.subject).toEqual({ kind: 'goal', goalRef: goal.ref });
    // The Goal pin comes from `cause()` and is the whole affected set.
    expect(cause.source.pins).toEqual([{ ref: goal.ref, revision: goal.revision }]);

    // The queue card is the same formal cause: `decisions/queue` over the real
    // Host, one `goal_cause/no_adviser`, never the 7D2 `adviser_creation` card.
    const goalCards = await ws.readCards(goal.ref);
    const parsedCode = (card: { source: { key: string } }): unknown => {
      try { return (JSON.parse(card.source.key) as { code?: unknown }).code; } catch { return undefined; }
    };
    const noAdviserCards = goalCards.filter(card => card.source.kind === 'goal_cause'
      && parsedCode(card) === 'no_adviser');
    expect(noAdviserCards).toHaveLength(1);
    expect(noAdviserCards[0]!.source).toMatchObject({
      kind: 'goal_cause',
      subject: { kind: 'goal', goalRef: goal.ref },
      pins: [{ ref: goal.ref, revision: goal.revision }],
    });
    expect(goalCards.some(card => card.source.kind === 'adviser_creation')).toBe(false);

    // The no-adviser pass sends no round to the secretary. Read the real
    // mailbox routes; the system round would carry the Host sender.
    const select: WorkflowAdvanceInput = {
      schemaVersion: 1, goalRef: goal.ref, flowId: 'pl06-gap', sessionHint: null, kind: 'select_work',
    };
    const waited = await world.post('workflow/advance', plain(S6A_SCOPE, select));
    expect(waited.body).toMatchObject({ status: 'ready', value: { state: 'waiting' } });
    const noHostRound = (messages: readonly { sender: { kind: string } }[]): boolean =>
      messages.every(message => message.sender.kind !== 'host');
    expect(noHostRound(await listed(world, 'inbox', secretary))).toBe(true);
    expect(noHostRound(await listed(world, 'outbox', secretary))).toBe(true);

    // The real adviser line: the SAME formal read and the SAME queue drop the
    // derived cause, and the same Plan version can now emit its one `refine:`.
    const adviser = await sessionOf(world,
      await createS6BLine(ws, { label: 'adviser', role: platformRoleProfile('adviser').template }));
    const after = await reader.readGoalDecisionCauses(ctx, { goalRef: goal.ref });
    expect(after.status).toBe('ready');
    if (after.status !== 'ready') return;
    expect(after.value.some(entry => entry.code === 'no_adviser')).toBe(false);
    expect((await ws.readCards(goal.ref)).some(card => card.source.kind === 'goal_cause'
      && parsedCode(card) === 'no_adviser')).toBe(false);

    const round: SystemRoundV1 = {
      kind: 'refine', goalRef: goal.ref,
      target: { kind: 'task', taskId: 'pl06-refine-placeholder' }, planRevision: 2,
    };
    const requestId = systemRoundRequestId(round);
    expect(requestId.status).toBe('ready');
    if (requestId.status !== 'ready') throw new Error('PL-06: the refine round has no request id');
    expect(requestId.value).toBe(`refine:${goal.ref.goalId}:pl06-refine-placeholder:2`);
    const expected = systemRoundMessageRef(S6A_SCOPE, requestId.value);
    expect(expected.status).toBe('ready');
    if (expected.status !== 'ready') throw new Error('PL-06: the refine round has no message ref');

    const sendStep = await advanceUntil(world.ag2b, { ...select, flowId: 'pl06-refine' }, 'send_system_round');
    const sent = await world.post('workflow/advance', plain(S6A_SCOPE, sendStep));
    expect(sent.body).toMatchObject({
      status: 'ready',
      value: { receipt: { kind: 'send_system_round', result: { status: 'committed' } } },
    });
    const adviserInbox = await listed(world, 'inbox', adviser);
    const delivered = adviserInbox.filter(message => message.ref.messageId === expected.value.messageId);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      ref: expected.value,
      sender: { kind: 'host', actor: SYSTEM_ROUND_ACTOR },
      intent: 'action_request', needsReply: true,
    });
  }, 120_000);
});
