/**
 * WK fixture steps 3–5 (fixture spec v2.2 §2, SR4 §7): one 20-goal wake world, one real commit and the restart world.
 *
 * W-F1's `openS7BWorld` is the only world opener. Step 3 registers G01–G20 on one fresh registry at the
 * frozen registration cursor 10 (`makeCommitCursor`); the world is already past it (head 14), so step 4's
 * next real commit is 15. Step 4 takes the Host's real send step (`tests/helpers/S7A-fixture.ts:554`:
 * `world.dispatch('messages/send', world.systemContext(), ...)`), whose route result carries the commit
 * cursor. Step 5 builds 19 real waits (open/answered/expired) and one released unprocessed action on its
 * own new Goal/plan/line, then offers the caller the same-directory crash. Nothing is read from or written
 * to a store, and no record, context or notice is built here.
 */
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import { makeCommitCursor, type GoalRef } from '../../src/contracts/ledger.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import {
  createGoalWaitWakes, type GoalWaitRegistries, type GoalWaitWakes,
} from '../../src/app/goal-wait-wakes.js';
import { advanceUntil, driveWorkflow } from './A2-restart-fixture.js';
import { graphWrite } from './AG2b-collaboration-fixture.js';
import { committed } from './S1-session-facts-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import { openS7BWorld, answerS7BWait, expireS7BWait, listed, readS7BWaits, runS7BWait } from './S7B-fixture.js';
import { basisOf } from './S7B2-WK-basis.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from './S6A-request-fixture.js';
import type { S6AHostWorld } from './S6A-host-fixture.js';
import { adoptS6BPlan, createS6BLine } from './S6B1-fixture.js';
import { approveS7A2Message, driveS7A2Release, readS7A2DispatchBasis } from './S7A2-fixture.js';
import { sessionOf, setS7AAutonomy } from './S7A-fixture.js';

export type S7B2WakeWorld = {
  world: S6AHostWorld;
  waits: GoalWaitWakes;
  /** The one registry per scope the loop's adapter and the driver share (the Host's shape). */
  registries: GoalWaitRegistries;
  scope: WorkspaceScope;
  /** The recipient of step 4's real send; created before the registration read. */
  recipient: S6ASession;
  goals: readonly GoalRef[];
  /** The frozen registration cursor 10 (`makeCommitCursor(10)`), older than the world's head 14. */
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
      recipient: fixture.recipient.ref, text: 'S7B2 WK matching commit', intent: 'inquiry', needsReply: false,
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
  /** The released action's own Goal, distinct from every wait Goal. */
  releasedGoal: GoalRef;
  states: readonly S7B2RestartWaitState[];
};

/**
 * Step 5. 19 real yielded waits on 19 Goals (7 answered, 5 expired on the injected clock, 7 left open), plus
 * one released unprocessed `action_request` from its own real Goal/plan/line: 19 wait Goals plus the released
 * Goal. Every state is read back through `readS7BWaits`; the released action is read from the recipient's
 * inbox and must carry the new Goal. SQLite only: the caller crashes the Host (`world.crash`) and observes
 * the reopened Host's real drain.
 */
export async function restartGoalWaits(options: { backend: 'sqlite' }): Promise<S7B2RestartWorld> {
  const { world, clock } = await openS7BWorld(options);
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
  const releasedGoal = (await main.createGoal('s7b2-wk-restart-released', 'S7B2 WK restart released goal')).ref;
  const plan = await adoptS6BPlan(main, releasedGoal, { label: 's7b2-wk-restart-released',
    taskIds: ['s7b2-wk-restart-released-task'], role: S6A_WORK_ROLE.templateId });
  const line = await sessionOf(world, await createS6BLine(main, { label: 's7b2-wk-restart-released-line',
    role: S6A_WORK_ROLE, tasks: [plan.tasks[0]!] }));
  await setS7AAutonomy(world, releasedGoal, 'every_step');
  const basis = await readS7A2DispatchBasis(world, releasedGoal);
  await world.scripted.script(line, [{ kind: 'calls', calls: [{ callId: 's7b2-wk-restart-released',
    name: 'send_session_message', args: { recipient: waits[0]!.sender.ref,
      text: 'S7B2 WK restart released action', intent: 'action_request', needsReply: true, expected: basis } }] },
  { kind: 'text', text: 'S7B2 WK restart released action saved' }]);
  const next = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: releasedGoal,
    flowId: 's7b2-wk-restart-released', sessionHint: line.ref, kind: 'select_work',
    taskId: plan.tasks[0]!.taskId }, 'claim_task');
  await driveWorkflow(world.ag2b, next, { stopBefore: 'open_checks' });
  const awaiting = (await listed(world, 'inbox', waits[0]!.sender))
    .find(message => message.sender.kind === 'work_run' && message.intent === 'action_request');
  if (awaiting === undefined || awaiting.release !== 'awaiting'
    || awaiting.goalRef?.goalId !== releasedGoal.goalId) {
    throw new Error(`S7B2: the restart's action is ${JSON.stringify(awaiting?.release)}`);
  }
  // The person approves, then the Workflow's one release step writes `released` with `approvedAt`, which is
  // the field the released-action index orders and the restart read requires.
  const approved = await approveS7A2Message(world, awaiting, 'restart-released');
  if (approved.release !== 'approved') {
    throw new Error(`S7B2: the restart's action approval is ${String(approved.release)}`);
  }
  const released = await driveS7A2Release(world, { goal: releasedGoal, messageRef: approved.ref,
    label: 'restart-released' });
  if (released.message.goalRef?.goalId !== releasedGoal.goalId) {
    throw new Error(`S7B2: the restart's released action is on ${String(released.message.goalRef?.goalId)}`);
  }
  return {
    world, waitGoals: waits.map(wait => wait.goal), releasedGoal, states,
  };
}
