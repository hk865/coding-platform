/**
 * WK fixture steps 3–5 (fixture spec v2.2 §2, SR4 §7): one 20-goal wake world, one real commit and the restart world.
 *
 * W-F1's `openS7BWorld` is the only world opener. Step 3 registers G01–G20 on one fresh registry at the
 * frozen registration cursor 10 (`makeCommitCursor`); the world is already past it (head 16), so step 4's
 * next real commit is 17. Step 4 takes the Host's real send step (`tests/helpers/S7A-fixture.ts:554`:
 * `world.dispatch('messages/send', world.systemContext(), ...)`), whose route result carries the commit
 * cursor. Step 5 builds 19 real waits (open/answered/expired) and one persisted `open` dispatch request on its
 * own new Goal/plan/line, then offers the caller the same-directory crash. Nothing is read from or written
 * to a store, and no record, context or notice is built here.
 */
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import { makeCommitCursor, type GoalRef } from '../../src/contracts/ledger.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import {
  createGoalWaitWakes, type GoalWaitRegistries, type GoalWaitWakes,
} from '../../src/app/goal-wait-wakes.js';
import { graphWrite } from './AG2b-collaboration-fixture.js';
import { committed } from './S1-session-facts-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import { openS7BWorld, answerS7BWait, expireS7BWait, readS7BWaits, runS7BWait } from './S7B-fixture.js';
import { basisOf } from './S7B2-WK-basis.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6APlatform, type S6ASession } from './S6A-request-fixture.js';
import type { S6AHostWorld } from './S6A-host-fixture.js';
import { adoptS6BPlan } from './S6B1-fixture.js';
import { setS7D1Open } from './S7D1-allocation-world.js';
import { holdS7AQueryRound, setS7AAutonomy } from './S7A-fixture.js';

export type S7B2WakeWorld = {
  world: S6AHostWorld;
  waits: GoalWaitWakes;
  /** The one registry per scope the loop's adapter and the driver share (the Host's shape). */
  registries: GoalWaitRegistries;
  scope: WorkspaceScope;
  /** The recipient of step 4's real send; created before the registration read. */
  recipient: S6ASession;
  goals: readonly GoalRef[];
  /** The frozen registration cursor 10 (`makeCommitCursor(10)`), older than the world's head 16. */
  cursorAtRead: CommitCursor;
};

/** Step 3's world: W-F1's world, a recipient, one fresh registry and the 20 goal refs G01–G20. */
export async function openS7B2WakeWorld(
  options: Parameters<typeof openS7BWorld>[0],
): Promise<S7B2WakeWorld> {
  const { world } = await openS7BWorld(options);
  const recipient = await world.createWorkSession('s7b2-wk-recipient');
  const waits = createGoalWaitWakes();
  const scope: WorkspaceScope = { ...S6A_SCOPE };
  const goals: GoalRef[] = Array.from({ length: 20 }, (_, index) => ({
    aggregateType: 'Goal', projectId: scope.projectId,
    goalId: `G${String(index + 1).padStart(2, '0')}`,
  }));
  return {
    world, waits, registries: { all: () => [{ scope, waits }] }, scope, recipient, goals,
    cursorAtRead: makeCommitCursor(10),
  };
}

/** Step 3. One registration per goal at the frozen registration cursor 10. */
export function registerGoalWaits(fixture: S7B2WakeWorld): void {
  for (const goal of fixture.goals) {
    fixture.waits.register(basisOf(goal.projectId, goal.goalId, ['SessionMessage']), fixture.cursorAtRead);
  }
}

/** Step 4. The Host's real send step (one SessionMessage commit); answers the commit cursor. */
export async function commitGoalWait(
  fixture: S7B2WakeWorld,
): Promise<{ cursor: CommitCursor }> {
  const sent = await fixture.world.dispatch('messages/send', fixture.world.systemContext(),
    graphWrite(fixture.scope, {
      recipient: fixture.recipient.ref, text: 'S7B2 WK matching commit', needsReply: false,
    }, 's7b2-wk-matching-commit'));
  const receipt = committed(sent as WriteResult<SessionMessage>);
  return { cursor: receipt.cursor };
}

/** Step 5's wait states, as the public `sessions/facts` read names them. */
export type S7B2RestartWaitState = 'open' | 'answered' | 'expired';

export type S7B2RestartWorld = {
  world: S6AHostWorld;
  /** The 19 real wait Goal refs, in wait-creation order. */
  waitGoals: readonly GoalRef[];
  /** The open dispatch request's own Goal, distinct from every wait Goal. */
  openDispatchGoal: GoalRef;
  states: readonly S7B2RestartWaitState[];
};

/**
 * The restart composition's released page read through the published `open` dispatch read
 * (`platform.actionRequests.listOpenDispatchesInProject`, 2.5/2.7) until G3 moves the composition itself. The
 * page's cursor is the Goal list's published source cursor; the open read has no `after` cursor, so one page is all.
 */
export function openDispatchReleasePage(platform: S6APlatform) {
  return {
    async readReleasedActions(ctx: CoreCallContext, input: { scope: WorkspaceScope }) {
      const open = await platform.actionRequests.listOpenDispatchesInProject(ctx, {
        projectId: input.scope.projectId, workspaceId: input.scope.workspaceId,
      });
      if (open.status !== 'ready') return open;
      const list = await platform.goalList.readGoalList(ctx, { workspace: input.scope });
      if (list.status !== 'ready') return list;
      if (list.value.sourceCursor === null) throw new Error('the open-dispatch page has no published cursor');
      return {
        status: 'ready' as const,
        value: {
          goals: open.value.map(item => ({ goalId: item.goalId })),
          readThrough: list.value.sourceCursor,
          nextCursor: null,
        },
      };
    },
  };
}

/**
 * Step 5. 19 real yielded waits on 19 Goals (7 answered, 5 expired on the injected clock, 7 left open), plus
 * one persisted `open` dispatch request from its own real Goal/plan/line: 19 wait Goals plus the request's
 * Goal. Every wait state is read back through `readS7BWaits`; the request is read through the public
 * `actionRequests.readRequest` and must be `open`. SQLite only: the caller crashes the Host (`world.crash`)
 * and observes the reopened Host's real drain.
 */
export async function restartGoalWaits(options: { backend: 'sqlite' }): Promise<S7B2RestartWorld> {
  const { world, clock } = await openS7BWorld(options);
  await setS7D1Open(world, 'executor', 40, 0, 's7b2-wk-restart-executors');
  const waits: Awaited<ReturnType<typeof runS7BWait>>[] = [];
  for (let index = 1; index <= 19; index += 1) {
    waits.push(await runS7BWait(world, { label: `s7b2-wk-restart-${String(index).padStart(2, '0')}` }));
  }
  const states: S7B2RestartWaitState[] = Array.from({ length: 19 }, () => 'open');
  for (let index = 1; index <= 7; index += 1) {
    const wait = waits[index]!;
    await answerS7BWait(world, { goal: wait.goal, recipient: wait.recipient, message: wait.message,
      task: wait.tasks[1]!, label: `s7b2-wk-restart-answer-${index}` });
    states[index] = 'answered';
  }
  clock.advance(86_400_001);
  for (let index = 8; index <= 12; index += 1) {
    await expireS7BWait(world, { messageRef: waits[index]!.message });
    states[index] = 'expired';
  }
  for (let index = 0; index < waits.length; index += 1) {
    const wait = waits[index]!;
    const read = await readS7BWaits(world, { session: wait.sender, messageRef: wait.message });
    if (read.waitByRef.state.state !== states[index]) {
      throw new Error(`S7B2: wait ${index + 1} is ${read.waitByRef.state.state}, expected ${states[index]}`);
    }
  }
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const openDispatchGoal = (await main.createGoal('s7b2-wk-restart-released', 'S7B2 WK restart released goal')).ref;
  const plan = await adoptS6BPlan(main, openDispatchGoal, { label: 's7b2-wk-restart-released',
    taskIds: ['s7b2-wk-restart-released-task'], role: S6A_WORK_ROLE.templateId });
  const task = plan.tasks[0];
  if (task === undefined) throw new Error('S7B2: the restart plan has no task to dispatch');
  // The one persisted `open` dispatch request is the restart fact now (2.5/2.7): a real secretary request
  // round asks for the Task under `after_plan_confirmation`, so the target loop may claim it after a restart.
  await setS7AAutonomy(world, openDispatchGoal, 'after_plan_confirmation');
  const dispatched = await holdS7AQueryRound(world, { label: 's7b2-wk-restart-released',
    goalId: openDispatchGoal.goalId }, async context => world.platform.actionRequests.requestDispatch(context, {
      input: { taskRef: { projectId: openDispatchGoal.projectId, goalId: openDispatchGoal.goalId, taskId: task.taskId },
        reason: 'the restart must find this open dispatch' },
      meta: { requestId: 's7b2-wk-restart-released', expected: [] },
    }));
  if (dispatched.status !== 'requested') {
    throw new Error(`S7B2: the restart's dispatch request is ${JSON.stringify(dispatched)}`);
  }
  const request = await world.platform.actionRequests.readRequest(world.humanContext(),
    { ref: dispatched.actionRef });
  if (request.status !== 'ready' || request.value.state !== 'open') {
    throw new Error(`S7B2: the restart's dispatch request is ${JSON.stringify(request)}`);
  }
  return {
    world, waitGoals: waits.map(wait => wait.goal), openDispatchGoal, states,
  };
}
