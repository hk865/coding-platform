/** The one shared body for the DRV §5.1 driver rows: the Host route and direct-port reads and starts,
 * a Task's execution list, the driver assembly D-P5/D-P6 use, and the ordinary memory world. */
import { expect } from 'vitest';
import type { TaskExecutionPage } from '../../src/app/core-http-types.js';
import {
  createCollaborationDriver, type CollaborationChange, type CollaborationDriver, type CollaborationSnapshot,
} from '../../src/app/collaboration-driver.js';
import type { GoalWaitWakes } from '../../src/app/goal-wait-wakes.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RunControlPort } from '../../src/core/work-graph/tasks/control-contracts.js';
import { waitFor } from '../scenarios/harness.js';
import { plain } from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import type { S6AHostWorld } from './S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from './S6A-request-fixture.js';
import { adoptS6BPlan } from './S6B1-fixture.js';
import { ready } from './S7A-fixture.js';
import { openS7BWorld } from './S7B-fixture.js';

/** One Task's runs in a Goal, through the Host's own `executions/list`. */
export const runsOf = async (world: S6AHostWorld, goalRef: GoalRef,
  taskId: string): Promise<TaskExecutionPage['items']> => ready<TaskExecutionPage>(
  await world.post('executions/list', plain(S6A_SCOPE,
    { goalRef, taskId, page: { afterCursor: null, limit: 10 } })), 'executions/list').items;

/** The Host route read of the Goal driver or one of its Task watches. */
export const driverRead = async (world: S6AHostWorld, goalRef: GoalRef, taskId?: string):
Promise<ReadResult<CollaborationSnapshot>> => (await world.post('workflow/driver-read', plain(S6A_SCOPE,
  taskId === undefined ? { goalRef } : { goalRef, taskId }))).body as ReadResult<CollaborationSnapshot>;

/** The Host route start of the one accepted Goal-level driver. */
export const startGoalDriver = async (world: S6AHostWorld, goalRef: GoalRef, flowId: string): Promise<void> => {
  const started = await world.post('workflow/driver-start', plain(S6A_SCOPE, { advance: {
    schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work',
  }, queryProfileIds: [] }));
  expect(started.body).toMatchObject({ status: 'ready' });
};

/** The Host route start of a Task-only driver. */
export const startTaskDriver = async (world: S6AHostWorld, goalRef: GoalRef, taskId: string,
  flowId: string): Promise<void> => {
  const started = await world.post('workflow/driver-start', plain(S6A_SCOPE, { advance: {
    schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work', taskId,
  }, queryProfileIds: [] }));
  expect(started.body).toMatchObject({ status: 'ready' });
};

/** The driver's last Workflow result carries a real wait basis. */
export const parkedOnBasis = (snapshot: CollaborationSnapshot): boolean =>
  snapshot.last?.status === 'ready' && snapshot.last.value.waitBasis !== undefined;

/** The direct port read of a driver's own `read` (D-P4 and D-P5 share this shape). */
export const portDriverRead = async (driver: CollaborationDriver,
  ctx: Parameters<CollaborationDriver['read']>[0], goal: GoalRef, taskId?: string): Promise<CollaborationSnapshot> =>
  ready<CollaborationSnapshot>(await driver.read(ctx,
    taskId === undefined ? { goalRef: goal } : { goalRef: goal, taskId }), 'the driver read');

/** Polls the direct port read until `predicate` holds; `waitFor` owns the loop. */
export const waitPortDriver = (driver: CollaborationDriver,
  ctx: Parameters<CollaborationDriver['read']>[0], goal: GoalRef, taskId: string | undefined,
  predicate: (snapshot: CollaborationSnapshot) => boolean, what: string): Promise<CollaborationSnapshot> =>
  waitFor(async () => await portDriverRead(driver, ctx, goal, taskId), predicate, what);

/** Polls the Host route read until `predicate` holds; `waitFor` owns the loop. */
export async function waitDriver(world: S6AHostWorld, goalRef: GoalRef, taskId: string | undefined,
  predicate: (snapshot: CollaborationSnapshot) => boolean, what: string): Promise<CollaborationSnapshot> {
  const read = await waitFor(async () => await driverRead(world, goalRef, taskId),
    result => result.status === 'ready' && predicate(result.value), what);
  if (read.status !== 'ready') throw new Error(`${what}: ${JSON.stringify(read)}`);
  return read.value;
}

/** The driver over the world's real platform ports (D-P5 and D-P6 share this shape). */
export function buildDrvDriver(world: S6AHostWorld, waits: GoalWaitWakes,
  cursorOf: () => CommitCursor | null, options: {
    controls?: RunControlPort; onChange?: (change: CollaborationChange) => void;
  } = {}): CollaborationDriver {
  return createCollaborationDriver({
    workflow: world.platform.workflow,
    runtime: world.platform.runtime,
    sessions: world.platform.sessions,
    executions: world.platform.executions,
    mailbox: world.platform.messages,
    controls: options.controls ?? world.platform.controls,
    profiles: [],
    goalWaits: () => waits,
    observedCursor: cursorOf,
    ...(options.onChange === undefined ? {} : { onChange: options.onChange }),
  });
}

/** One memory Host world with its cards workspace, Goal and first adopted Plan (the ordinary DRV world). */
export async function openDrvWorld(label: string, taskIds: readonly string[], title = `DRV ${label}`) {
  const { world } = await openS7BWorld({ backend: 'memory' });
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const goal = (await main.createGoal(`${label}-goal`, title)).ref;
  const { tasks } = await adoptS6BPlan(main, goal, { label, taskIds, role: S6A_WORK_ROLE.templateId });
  return { world, main, goal, tasks };
}
