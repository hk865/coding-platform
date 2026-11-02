/**
 * PL-14 (v3 §9-14, §5.8, C-35/PLT-16): SQLite only — the stage-end notice's
 * identity and position survive a real close and a real new Host on the same
 * directory. The same adopted PlanRevision and stage must yield exactly one
 * `plan_notice` on both entry points, with the same `itemKey` and the gate
 * round's `since` as `position`; a restart never appends a second item.
 *
 * The world is the real one: a real work line (`createS6BLine`), the public
 * `plans/propose` + `plans/apply`, the Workflow driving the stage work and then
 * the stage gate through `advanceGate` (an explicit `taskId` never advances a
 * gate), and both public notice entry points (`main/read` and
 * `decisions/queue`). The Host restarts on the same SQLite directory.
 */
import { describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import type { PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import {
  createS6BLine, lineBinding, twoStageDraft,
} from '../helpers/PL-taskbook-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, usageOf, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { committedValue, readyValue } from '../helpers/S6A-memory-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { checkConfiguration, sessionOf } from '../helpers/S7A-fixture.js';
import { governS6B } from '../helpers/S6B1-fixture.js';

const ADVISER_ROLE = platformRoleProfile('adviser').template;

type Adopted = {
  proposalRef: PlanProposalRef; proposalRevision: number; plan: PlanRevisionSnapshot;
};

async function adoptTwoStage(main: S6ACardsWorkspace, goal: GoalRef,
  draft: PlanRevisionDraft): Promise<Adopted> {
  const proposed = committedValue<{ ref: PlanProposalRef; revision: number }>(
    await main.post('plans/propose', graphWrite(main.scope, {
      goalRef: goal, basedOn: null, draft,
      reason: { text: 'PL-14 two-stage plan', sources: [] },
    }, 'pl14-propose')), 'the PL-14 proposal');
  committedValue(await main.post('plans/apply', graphWrite(main.scope, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, 'pl14-apply')), 'the PL-14 adoption');
  const plan = await main.activePlan(goal);
  if (plan === null) throw new Error(`PL-14: ${goal.goalId} has no Plan after the adoption`);
  return { proposalRef: proposed.ref, proposalRevision: proposed.revision, plan };
}

async function readNotices(main: S6ACardsWorkspace, goal: GoalRef): Promise<{
  main: readonly Record<string, unknown>[]; queue: readonly Record<string, unknown>[];
}> {
  const mainPage = readyValue<{ notices: Record<string, unknown>[] }>(
    await main.route('main/read', { goalId: goal.goalId, cursor: null }), 'main/read');
  const queue = readyValue<{ notices: Record<string, unknown>[] }>(
    await main.route('decisions/queue', {
      workspace: { projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId },
      goalRef: goal, sections: ['notices'], page: { limit: 100 },
    }), 'decisions/queue');
  return { main: mainPage.notices, queue: queue.notices };
}

/**
 * The real first segment and its stage gate, up to and including the gate's
 * committed `open_checks` receipt. The world is SQLite, so the row closes the
 * Host and starts a new Host on the same directory. The caller closes it.
 */
async function openGatedWorld(): Promise<{
  world: S6AHostWorld;
  main: S6ACardsWorkspace;
  goal: GoalRef;
  adopted: Adopted;
  gateReceipts: WorkflowStepReceipt[];
}> {
  const world = await openS6AHostWorld({
    backend: 'sqlite',
    extraHostOptions: {
      checks: checkConfiguration({ ...OPERATOR, kind: 'human' }),
      // The Host's own consume pass: one adviser-profile consumer at 25 ms.
      inputConsumers: [{
        scope: S6A_SCOPE,
        sessionRef: { projectId: S6A_SCOPE.projectId, sessionId: 'pl14-consumer' },
        goalRef: { aggregateType: 'Goal' as const, projectId: S6A_SCOPE.projectId, goalId: 'pl14-consumer' },
        queryProfileId: 'pl14-adviser-binding', heartbeatMs: 25,
      }],
    },
    extraBindings: [
      lineBinding('pl14-adviser-binding', ADVISER_ROLE, 'PL-14 trusted adviser guidance'),
    ],
  });
  try {
    await world.setResumeOnStartup(false);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await governS6B(world, main, world.goals);
    const goal = world.goals.first;
    const adopted = await adoptTwoStage(main, goal, twoStageDraft(goal, 'pl-14'));
    // The real line responsible for the stage's work and its stage gate. The two
    // triples are the plan's own task ids, not a copy of the work task.
    const work = { projectId: goal.projectId, goalId: goal.goalId, taskId: 'stage-work' };
    const gateTask = { projectId: work.projectId, goalId: work.goalId, taskId: 'stage-gate' };
    const line = await createS6BLine(main, {
      label: 'pl14', role: S6A_WORK_ROLE, tasks: [work, gateTask],
    });
    const session = await sessionOf(world, line);

    // The real Workflow performs the stage work, then — with no explicit
    // taskId — its selection reaches `advanceGate`, which finalizes the real
    // stage-gate VerificationRound.
    await world.scripted.script(session, [
      { kind: 'text', text: 'stage one work done', usage: usageOf(100) },
    ]);
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal,
      flowId: 'pl14-work', sessionHint: line.ref, kind: 'select_work', taskId: 'stage-work' });
    const gateReceipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal,
      flowId: 'pl14-gate', sessionHint: line.ref, kind: 'select_work' }, { receipts: gateReceipts });
    return { world, main, goal, adopted, gateReceipts };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

describe('PL-14: stage end notice across a real Host restart', () => {
  it('SQLite only: one item per entry point with the same itemKey and position after close and reopen', async () => {
    const { world, main, goal, adopted, gateReceipts } = await openGatedWorld();
    try {
      expect(adopted.plan.stages.map(stage => stage.stageId)).toEqual(['stage-one', 'stage-two']);
      expect(adopted.plan.tasks.map(task => task.taskId)).toEqual(
        expect.arrayContaining(['stage-work', 'stage-gate', 'stage-next']));

      // P6R-04: the real gate advance's returned steps carry the committed
      // `open_checks` receipt for `stage-gate`; its creation-commit cursor is
      // exactly the round's `since` and therefore the notice position.
      const opened = gateReceipts.find(receipt => receipt.kind === 'open_checks'
        && receipt.result.status === 'committed'
        && receipt.result.value.subject.taskId === 'stage-gate');
      if (opened === undefined || opened.kind !== 'open_checks' || opened.result.status !== 'committed') {
        throw new Error('UNPROVEN PL-14 position: the real gate advance returned no committed `open_checks` '
          + 'receipt for `stage-gate`; the gate step / round creation is missing '
          + '(owner: P4, src/business/workflow/workflow.ts:2507).');
      }

      const itemKey = `stage-end:${adopted.plan.planId}:1:stage-one`;
      const first = await readNotices(main, goal);
      const firstMain = first.main.filter(item => item['category'] === 'plan_notice');
      const firstQueue = first.queue.filter(item => item['category'] === 'plan_notice');
      expect(firstMain).toHaveLength(1);
      expect(firstQueue).toHaveLength(1);
      expect(firstMain[0]?.['itemKey']).toBe(itemKey);
      expect(firstQueue[0]?.['itemKey']).toBe(itemKey);
      const position = firstMain[0]?.['position'] as Record<string, unknown>;
      expect(position['kind']).toBe('commit');
      expect(position['cursor']).toBe(opened.result.cursor);

      // L-09: a real close and a real new Host on the same SQLite directory.
      // The stage-end identity is the adopted PlanRevision and stage, and the
      // position is the gate round's creation cursor; the persisted facts must
      // yield the same single item with the same key and position, never a
      // second item and never a moved position.
      await world.reopen();
      const restarted = await readNotices(main, goal);
      const restartedMain = restarted.main.filter(item => item['category'] === 'plan_notice');
      const restartedQueue = restarted.queue.filter(item => item['category'] === 'plan_notice');
      expect(restartedMain).toHaveLength(1);
      expect(restartedQueue).toHaveLength(1);
      expect(restartedMain[0]?.['itemKey']).toBe(itemKey);
      expect(restartedQueue[0]?.['itemKey']).toBe(itemKey);
      expect(restartedMain[0]?.['itemKey']).toBe(restartedQueue[0]?.['itemKey']);
      expect(restartedMain[0]?.['position']).toEqual(position);
      expect(restartedQueue[0]?.['position']).toEqual(position);
    } finally {
      await world.close();
    }
  });
});
