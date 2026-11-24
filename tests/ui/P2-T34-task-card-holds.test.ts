import { describe, expect, it } from 'vitest';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { TaskGraph } from '../../src/contracts/task-graph.js';
import { asRecord, asText } from '../../src/ui/values.js';
import { findButton } from './helpers/boot-page.js';
import { settle } from './helpers/E3D-page.js';
import { bootE3N, textOf } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { P1World } from '../helpers/P1-round-fixture.js';
import { openP1World } from '../helpers/P1-round-fixture.js';
import { platformSettle, placeScribeStop } from '../helpers/P1-platform-entry.js';
import { cancelByPlan, holdOf, performClaim, pointerRef, requestOf, write } from '../helpers/P1-reads.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { dexcAnswer } from '../helpers/S7D2-coldstart-world.js';

/**
 * P2 T34 (frozen `p2-frozen.md:348`, §2.8 task card): a Task card with holds (including the scribe's
 * cause), a dispatch request and a waiting stop card. The card shows who placed each hold, why and when
 * it lapses; "撤销暂缓"; the dispatch request (waiting line / claimed by line Y / void and reason); and,
 * while the stop card waits, "先答卡、暂不领". Release-all is the write path `tasks/hold/release`.
 *
 * Today `NodeDetailV1.task` has no hold/dispatch/stop fields (`contracts/work-line.ts:315-321`) and the
 * route is not registered (0 hits in `src/app/core-routes.ts`), so both `it`s are red at the first card
 * assertion ("入口还没有"). The world is P1's H3 composition (`tests/work-graph/P1-claim-holds.test.ts:224-240`).
 */

type T34World = { p1: P1World; title: string };

async function openT34(): Promise<T34World> {
  const p1 = await openP1World({ backend: 'memory', running: true, autonomy: 'every_step' });
  try {
    const [a, s] = await p1.holdRounds([p1.lines.A, p1.lines.S], 'p2-t34');
    expect(await p1.world.platform.claimHolds.place(s.ctx, write({
      taskRef: p1.task.tB, reason: 'P1 H3 secretary hold',
    }, 't34-secretary'))).toMatchObject({ status: 'committed' });
    const runB = p1.runB;
    if (runB === null) throw new Error('P2-T34: tB is not running');
    expect(await placeScribeStop(p1.world, {
      taskRef: p1.task.tB, reason: 'P1 H3 scribe stop', sourceMessage: a.source, run: runB,
      operationId: 'p2-t34-scribe',
    }, 't34-scribe')).toMatchObject({ status: 'committed' });
    expect(await p1.world.platform.actionRequests.requestStop(s.ctx, write({
      taskRef: p1.task.tB, reason: 'P2 T34 stop',
    }, 't34-stop'))).toMatchObject({ status: 'needs_decision' });
    expect(await p1.world.platform.actionRequests.requestDispatch(a.ctx, write({
      taskRef: p1.task.tA, reason: 'P2 T34 dispatch', preferredLine: p1.lines.E.ref,
    }, 't34-dispatch'))).toMatchObject({ status: 'needs_decision' });

    const graph = ready<TaskGraph>(await p1.world.post('tasks/query', plain(S6A_SCOPE, {
      goalRef: p1.goal,
    })), 'tasks/query');
    const row = graph.tasks.find((task) => task.ref.taskId === 'p1-tb');
    const title = row === undefined ? '' : asText(asRecord(row.definition)['title']);
    if (title === '') throw new Error('P2-T34: the tB Task has no title');
    return { p1, title };
  } catch (error) {
    await p1.close().catch(() => undefined);
    throw error;
  }
}

function graphOf(p1: P1World): Promise<TaskGraph> {
  return p1.world.post('tasks/query', plain(S6A_SCOPE, { goalRef: p1.goal }))
    .then((reply) => ready<TaskGraph>(reply.body, 'tasks/query'));
}

async function taskDetail(p1: P1World, taskId: 'p1-ta' | 'p1-tb'): Promise<unknown> {
  const graph = await graphOf(p1);
  const detail = ready<{ section: string; task: unknown }>(
    await p1.world.post('graph/detail', plain(S6A_SCOPE, {
      goalRef: p1.goal,
      node: { kind: 'task', ref: { projectId: p1.goal.projectId, goalId: p1.goal.goalId, taskId },
        planRef: graph.plan.ref },
      section: 'summary', page: { afterCursor: null, limit: 20 },
    })), 'graph/detail');
  expect(detail.section).toBe('summary');
  return detail.task;
}

/** The workspace's waiting action cards (`decisions/queue`, `waiting_answer`). */
async function waitingActionCards(p1: P1World) {
  const queue = ready<DecisionQueueReadV1>(await p1.world.post('decisions/queue', plain(S6A_SCOPE, {
    workspace: S6A_SCOPE, goalRef: p1.goal, sections: ['waiting_answer'], page: { limit: 100 },
  })), 'decisions/queue');
  return queue.waitingAnswer.filter((entry) => String(entry.source.kind) === 'action_release');
}

async function waitingActionCard(p1: P1World, taskId: string) {
  return (await waitingActionCards(p1)).find((entry) => entry.taskRef?.taskId === taskId);
}

describe('P2-T34 the Task card holds, dispatch request and waiting stop', () => {
  it('T34-1 graph/detail task carries both holds, the stop Run and the dispatch request', async () => {
    const { p1 } = await openT34();
    try {
      const task = await taskDetail(p1, 'p1-tb');
      const text = JSON.stringify(task);
      /* The first P2 assertion: the secretary's hold reason on the Task projection.
         Expected present; current false (no hold field on NodeDetailV1.task). */
      expect(text, 'graph/detail task 的暂缓').toContain('P1 H3 secretary hold');
      expect(text).toContain('P1 H3 scribe stop');
      expect(text).toContain('scribe_stop');
      const hold = await holdOf(p1, p1.task.tB);
      expect(hold, 'tB hold').not.toBeNull();
      if (hold !== null) {
        const reason = hold.reasons.find((entry) => entry.reason === 'P1 H3 secretary hold');
        expect(reason, 'the secretary hold reason').toBeDefined();
        if (reason !== undefined) expect(text).toContain(reason.placedAt);
        /* 谁: the secretary's hold names the asking line. */
        expect(text).toContain(p1.lines.S.ref.sessionId);
      }
      const runB = p1.runB;
      if (runB !== null) expect(text).toContain(runB.runId);
      expect(text).toContain('P2 T34 stop');

      const dispatch = await taskDetail(p1, 'p1-ta');
      const dispatchText = JSON.stringify(dispatch);
      expect(dispatchText).toContain('P2 T34 dispatch');
      expect(dispatchText).toContain(p1.lines.E.ref.sessionId);
      /* 等目标循环领（现在挡着的原因）: the pending request names the target loop's own blocker. */
      const dispatchView = asRecord(asRecord(dispatch)['dispatch']);
      expect(asRecord(dispatchView['request'])['state'], 'the dispatch request waits for the loop').toBe('pending');
      expect(asRecord(asRecord(dispatchView['targetLoopBlockers'])['blockers']).length, 'the target loop blocker')
        .toBeGreaterThan(0);
    } finally {
      await p1.close();
    }
  }, 180_000);

  it('T34-3 a claimed dispatch request names the claiming line and the claim-time Plan', async () => {
    const { p1 } = await openT34();
    try {
      /* tA is claimable; the pending dispatch request does not block the plain claim
         (P1 D10, `tests/work-graph/P1-dispatch.test.ts:210-219`).
         gl-frozen.md:14 / :172 (b group): a named advance reads the same claimHold, so end tB's Run
         first (M-04, `P2-T14-action-rounds.test.ts:131-132`); the claimed line is re-read from the
         receipt, not hardcoded. Mutation guarded: GL-2 reverted (a named task skips the hold) — the
         claim would come back `claim_task` while tB's Run is live. */
      await p1.endB();
      const claimed = await performClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 'p2-t34-claim'));
      expect(claimed).toMatchObject({ status: 'committed' });
      const graph = await graphOf(p1);
      const detail = asRecord(await taskDetail(p1, 'p1-ta'));
      const dispatchView = asRecord(detail['dispatch']);
      /* 已由线 Y 领取: the line that claimed is the receipt's own SessionRef. */
      const claimedSessionId = asRecord(asRecord(asRecord(claimed)['value'])['sessionRef'])['sessionId'];
      expect(claimedSessionId, 'the claim receipt names its line').toEqual(expect.any(String));
      expect(dispatchView['request'], 'graph/detail task 的派活领取').toMatchObject({
        state: 'applied', outcome: { kind: 'applied', session: { sessionId: claimedSessionId } },
      });
      expect(asRecord(dispatchView['claimedPlanRef'])['planId'], 'the claim-time Plan')
        .toBe(graph.plan.ref.planId);
    } finally {
      await p1.close();
    }
  }, 180_000);

  it('T34-2 the card shows 撤销暂缓 and release-all posts tasks/hold/release', async () => {
    const { p1, title } = await openT34();
    const booted = await bootE3N(p1.world, 'TaskMap', { search: '?goal=' + p1.goal.goalId });
    try {
      await settle(() => textOf(booted.page.root).includes(title), 15_000);
      const node = findButton(booted.page.root, title);
      expect(node, 'the tB task node').toBeDefined();
      if (node !== undefined) {
        click(node);
        await settle(() => textOf(booted.page.root).includes('暂缓')
          || textOf(booted.page.root).includes('撤销'), 5_000);
      }
      /* The first assertion of the card row: the release-all entry. Expected defined;
         current undefined (the detail has no hold/dispatch group). */
      const release = findButton(booted.page.root, '撤销暂缓');
      expect(release, 'the 撤销暂缓 button').toBeDefined();
      if (release !== undefined) {
        click(release);
        await settle(() => booted.log.calls.some((call) => call.route === 'tasks/hold/release'
          && call.reply !== undefined), 5_000);
      }
      const call = booted.log.calls.filter((entry) => entry.route === 'tasks/hold/release').at(-1);
      expect(call, 'tasks/hold/release').toBeDefined();
      if (call !== undefined) {
        expect(asText(asRecord(asRecord(call.input)['taskRef'])['taskId'])).toBe('p1-tb');
        expect(asRecord(call.reply)['status']).toBe('committed');
      }
    } finally {
      await booted.page.restore();
      await p1.close();
    }
  }, 180_000);

  it('T34-4 the Task card hold section names when each hold lapses', async () => {
    const { p1 } = await openT34();
    try {
      const detail = asRecord(await taskDetail(p1, 'p1-tb'));
      const holds = (detail['holds'] as unknown[]).map((entry) => asRecord(entry));
      expect(holds.map((hold) => hold['reason']), '暂缓栏').toEqual(
        expect.arrayContaining(['P1 H3 secretary hold', 'P1 H3 scribe stop']));
      /* 何时失效: each reason carries the rule the claim owner judges it by. */
      expect(holds.map((hold) => asRecord(hold['expiry'])['rule']), '何时失效').toEqual(
        expect.arrayContaining(['same_source_settled_candidate', 'never']));
    } finally {
      await p1.close();
    }
  });

  it('T34-5 a voided dispatch request shows 作废 and its reason', async () => {
    const { p1 } = await openT34();
    try {
      const request = pointerRef((await holdOf(p1, p1.task.tA))?.openDispatch);
      expect(request, 'tA has an open dispatch request').not.toBeNull();
      if (request === null) throw new Error('P2-T34: no dispatch request on tA');
      await cancelByPlan(p1, p1.task.tA, 'p2-t34-void');
      // P2 §2.5: the caller that judged the cause passes it and the adopted Plan revision it read.
      const plan = await p1.world.platform.plans.queryGoal(p1.world.humanContext(), p1.goal, { scope: 'project' });
      if (plan.status !== 'ready' || plan.value.goal.activePlanRevision === null) {
        throw new Error('P2-T34: the settle Goal has no adopted Plan revision');
      }
      expect(await platformSettle(p1.world, request, 'P2 T34 void', 'p2-t34-settle',
        { kind: 'task_cancelled', planRevision: plan.value.goal.activePlanRevision }),
      'the Goal loop voids the request of the cancelled Task').toMatchObject({ status: 'committed' });
      const detail = asRecord(await taskDetail(p1, 'p1-ta'));
      expect(asRecord(asRecord(detail['dispatch'])['request']), '作废').toMatchObject({
        state: 'void', outcome: { kind: 'void', reason: 'P2 T34 void' },
      });
    } finally {
      await p1.close();
    }
  });

  it('T34-6 a waiting stop card says 先答卡、暂不领 on the Task card', async () => {
    const { p1 } = await openT34();
    try {
      const detail = asRecord(await taskDetail(p1, 'p1-tb'));
      /* 叫停卡等时: the stop request's own claim answer is "answer the card first". */
      expect(asRecord(detail['stop']), '叫停卡等时').toMatchObject({
        claim: 'answer_card_first', request: { state: 'pending' },
      });
    } finally {
      await p1.close();
    }
  });

  it('T34-7 a waiting dispatch card does not block the claim, and the claim closes the card', async () => {
    const { p1 } = await openT34();
    try {
      expect(await waitingActionCard(p1, 'p1-ta'), 'the dispatch card waits').toBeDefined();
      /* gl-frozen.md:14 / :172 (b group): the named claim reads claimHold, so end tB's Run first (M-04,
         `P2-T14-action-rounds.test.ts:131-132`); the claimed line comes from the receipt. Mutation
         guarded: GL-2 reverted (a named task skips the hold) — the claim would skip the live node. */
      await p1.endB();
      const claimed = await performClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 'p2-t34-card-claim'));
      expect(claimed).toMatchObject({ status: 'committed' });
      expect(await waitingActionCard(p1, 'p1-ta'), 'the claim closes the waiting card').toBeUndefined();
      const detail = asRecord(await taskDetail(p1, 'p1-ta'));
      const claimedSessionId = asRecord(asRecord(asRecord(claimed)['value'])['sessionRef'])['sessionId'];
      expect(claimedSessionId, 'the claim receipt names its line').toEqual(expect.any(String));
      expect(asRecord(asRecord(detail['dispatch'])['request']), '已由线').toMatchObject({
        state: 'applied', outcome: { kind: 'applied',
          session: { sessionId: claimedSessionId } },
      });
    } finally {
      await p1.close();
    }
  });

  it('T34-8 the Task detail shows the stop steps and why no stop was sent', async () => {
    const { p1 } = await openT34();
    try {
      const card = await waitingActionCard(p1, 'p1-tb');
      expect(card, 'the stop card waits').toBeDefined();
      if (card === undefined) throw new Error('P2-T34: no waiting stop card');
      const request = pointerRef((await holdOf(p1, p1.task.tB))?.pendingStop);
      expect(request).not.toBeNull();
      if (request === null) throw new Error('P2-T34: no pending stop request');
      await p1.endB();
      const answered = await dexcAnswer(p1.world, card, 'approve', '', 'p2-t34-stop-answer');
      expect(answered, 'the stop card answer commits').toMatchObject({ status: 'ready' });
      expect(await requestOf(p1, request), 'the ended Run is run_ended').toMatchObject({
        state: 'released', outcome: { notSent: 'run_ended' },
      });
      const text = JSON.stringify(await taskDetail(p1, 'p1-tb'));
      expect(text, '叫停各步').toContain('P2 T34 stop');
      expect(text, '没送原因').toContain('run_ended');
    } finally {
      await p1.close();
    }
  });
});
