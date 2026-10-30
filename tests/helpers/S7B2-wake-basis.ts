/**
 * BW fixture steps 6–8 (fixture spec v2.2 §2, SR8 §7): the one Goal whose Run yielded on a real `wait_reply`, the
 * driver built over the Host's own published ports, and that driver's one wake.
 *
 * The Goal, the Task and the yielded wait come from W-F1's `openS7BWorld`/`runS7BWait`; `cursorAtRead` is the
 * `sourceCursor` of a real `tasks/query` read, never constructed; the driver's dependencies are the world's platform
 * ports. No step reads a store, builds a record or a `CoreCallContext`, or stands in for a missing producer.
 */
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type {
  CollaborationDriver, CollaborationSnapshot, CollaborationState,
} from '../../src/app/collaboration-driver.js';
import { createCollaborationDriver } from '../../src/app/collaboration-driver.js';
import { createGoalWaitWakes, type GoalWaitWakes } from '../../src/app/goal-wait-wakes.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { TaskGraph } from '../../src/core/work-graph/model/plan-contracts.js';
import { plain } from './AG2b-collaboration-fixture.js';
import { S6A_SCOPE, type S6ASession } from './S6A-request-fixture.js';
import { waitForDriverState } from './S5R2-d-support.js';
import { ready } from './S7A-fixture.js';
import { openS7BWorld, runS7BWait } from './S7B-fixture.js';
import type { S6AHostWorld } from './S6A-host-fixture.js';

type BasisGoal = {
  world: S6AHostWorld;
  goal: GoalRef;
  /** The sender's Task: the one whose Run yielded on the reply wait. */
  task: TaskTriple;
  sender: S6ASession;
  recipient: S6ASession;
  run: RunRef;
  message: SessionMessage['ref'];
  cursorAtRead: CommitCursor;
};

/** Step 6. One real Goal/Task/wait from W-F1's world; the fact read's own watermark is the basis cursor. */
export async function openS7B2BasisGoal(
  options: Parameters<typeof openS7BWorld>[0],
): Promise<BasisGoal> {
  const { world } = await openS7BWorld(options);
  const wait = await runS7BWait(world, { label: 's7b2-bw' });
  const graph = ready<TaskGraph>(await world.post('tasks/query',
    plain(S6A_SCOPE, { goalRef: wait.goal })), 'the BW basis TaskGraph');
  return { world, goal: wait.goal, task: wait.tasks[0]!, sender: wait.sender, recipient: wait.recipient,
    run: wait.run, message: wait.message, cursorAtRead: graph.sourceCursor };
}

type BasisDriver = {
  driver: CollaborationDriver;
  /** The one registry the fixture's scope resolves to (the instance the driver registers into). */
  waits: GoalWaitWakes;
  /** One start, then the canonical bounded read of the state the driver settles in. */
  start(wanted?: CollaborationState): Promise<CollaborationSnapshot>;
  read(): Promise<CollaborationSnapshot>;
};

/** Step 7. The driver over the world's real ports, with this fixture's one registry and its read's cursor. */
export function startS7B2BasisDriver(basis: BasisGoal): BasisDriver {
  const waits = createGoalWaitWakes();
  const driver = createCollaborationDriver({
    workflow: basis.world.platform.workflow,
    runtime: basis.world.platform.runtime,
    sessions: basis.world.platform.sessions,
    executions: basis.world.platform.executions,
    mailbox: basis.world.platform.messages,
    controls: basis.world.platform.controls,
    profiles: [],
    goalWaits: () => waits,
    observedCursor: () => basis.cursorAtRead,
  });
  const read = async (): Promise<CollaborationSnapshot> => ready(
    await driver.read(basis.world.humanContext(), { goalRef: basis.goal }), 'the BW basis driver read');
  const start = async (wanted: CollaborationState = 'waiting_for_reply'): Promise<CollaborationSnapshot> => {
    ready(await driver.start(basis.world.humanContext(), {
      advance: { schemaVersion: 1, goalRef: basis.goal, flowId: 's7b2-bw-basis',
        sessionHint: basis.sender.ref, kind: 'select_work', taskId: basis.task.taskId },
      queryProfileIds: [],
    }), 'the BW basis driver start');
    await waitForDriverState({ ctx: basis.world.humanContext() }, driver, basis.goal, wanted);
    return await read();
  };
  return { driver, waits, start, read };
}

/** Step 8. The one wake of the parked goal, then the canonical bounded poll of the driver's own read. */
export async function wakeS7B2BasisGoal(
  basis: BasisGoal,
  started: BasisDriver,
  wanted: CollaborationState = 'waiting_for_reply',
): Promise<CollaborationSnapshot> {
  await started.driver.wake(basis.world.humanContext(), basis.goal);
  await waitForDriverState({ ctx: basis.world.humanContext() }, started.driver, basis.goal, wanted);
  return await started.read();
}
