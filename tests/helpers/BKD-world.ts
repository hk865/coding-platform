/**
 * BK-D's one world for the partial-acceptance and default reply-deadline rows: the DNR Host with the adopted Plan
 * `t-a`/`t-b` and the Goal gate, the Host's routes and `workflow/advance`, plus the S7B settings route and waits.
 * Every prior state is a public step; no store is read and no record is built here.
 */
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskGraph } from '../../src/contracts/task-graph.js';
import type { GoalDisplayV1 } from '../../src/core/work-graph/state/goal-machine.js';
import { graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { driveWorkflow } from './A2-restart-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from './S6A-request-fixture.js';
import { createS6BLine } from './S6B1-fixture.js';
import { ready, s7aGoalControlPins, sessionOf } from './S7A-fixture.js';
import { openDNRWorld, type DNRWorld } from './S7D2-DNR-node-world.js';

export type BKDWorld = { readonly world: DNRWorld['world']; readonly goal: GoalRef;
  task: DNRWorld['task']; close(): Promise<void> };
/** Goal 1 with the adopted Plan `t-a`, `t-b` and the AG2b Goal gate; both Tasks start pending. */
export async function openBKDWorld(backend: 'memory' | 'sqlite' = 'memory'): Promise<BKDWorld> {
  const dnr = await openDNRWorld({ label: 'bkd', autonomy: 'after_plan_confirmation',
    taskIds: ['t-a', 't-b'], backend });
  return { world: dnr.world, goal: dnr.goal, task: dnr.task, close: dnr.close };
}
/** A line responsible for `taskId`; the same requestId returns the line an earlier step already made. */
export async function bkdLine(w: BKDWorld, taskId: string) {
  return await sessionOf(w.world, await createS6BLine(s6aCardsWorkspace(w.world, S6A_SCOPE),
    { label: `bkd-${taskId}`, role: S6A_WORK_ROLE, tasks: [w.task(taskId)] }));
}
/** The line's one text Run, driven to the Task's `satisfied`; returns the Workflow's steps. */
export async function driveBKDWork(w: BKDWorld, taskId: string) {
  const line = await bkdLine(w, taskId);
  await w.world.scripted.script(line, [{ kind: 'text', text: `BKD ${taskId} done` }]);
  return await driveWorkflow(w.world.ag2b, { schemaVersion: 1, goalRef: w.goal, flowId: `bkd-${taskId}`,
    sessionHint: line.ref, kind: 'select_work', taskId });
}
export const bkdGraph = async (w: BKDWorld): Promise<TaskGraph> =>
  ready(await w.world.post('tasks/query', plain(S6A_SCOPE, { goalRef: w.goal })), 'the BK-D task graph');
export async function bkdDisplay(w: BKDWorld): Promise<GoalDisplayV1> {
  const read = await w.world.post('goals/display', plain(S6A_SCOPE, { goalRef: w.goal }));
  return ready<{ display: GoalDisplayV1 }>(read, 'goals/display').display;
}
/** The write under test; `expected` defaults to the two pins a screen reads now. */
export async function acceptPartial(w: BKDWorld, input: {
  rationale: string; requestId: string; expected?: readonly VersionPin[];
}): Promise<Record<string, unknown>> {
  return await bkdPost(w.world, 'goals/accept-partial', graphWrite(S6A_SCOPE,
    { goalRef: w.goal, rationale: input.rationale }, input.requestId,
    [...(input.expected ?? await s7aGoalControlPins(w.world, w.goal))]));
}
/** Every active work Task to `satisfied`, stopped before `complete_goal`, so the accept write's step 9 is tested. */
export async function satisfyBKDGoal(w: BKDWorld): Promise<void> {
  const work = (await bkdGraph(w)).tasks.filter(row => row.definition.taskKind === 'work'
    && row.definition.disposition === 'active');
  for (const row of work) await driveBKDWork(w, row.ref.taskId);
  await driveWorkflow(w.world.ag2b, { schemaVersion: 1, goalRef: w.goal, flowId: 'bkd-satisfy',
    sessionHint: null, kind: 'select_work' }, { stopBefore: 'complete_goal' });
  const unfinished = (await bkdGraph(w)).tasks.filter(row => row.definition.requirementLevel === 'required'
    && (row.definition.taskKind === 'work' || row.definition.taskKind === 'gate')
    && row.effectivePhase !== 'satisfied').map(row => row.ref.taskId);
  if (unfinished.length > 0) throw new Error(`BKD: the Workflow did not satisfy ${unfinished.join(', ')}`);
}
/** One published core route as the Host's page; an unpublished suffix answers `not_found` with JSON. */
export async function bkdPost(world: DNRWorld['world'], suffix: string,
  body: unknown): Promise<Record<string, unknown>> {
  return (await world.post(suffix, body)).body as Record<string, unknown>;
}
/** `goals/control` with the two pins a screen reads now. */
export async function bkdControl(w: BKDWorld, control: 'pause' | 'cancel',
  requestId: string): Promise<Record<string, unknown>> {
  return await bkdPost(w.world, 'goals/control', graphWrite(S6A_SCOPE,
    { goalRef: w.goal, control, reason: `BKD operator ${control}` }, requestId,
    await s7aGoalControlPins(w.world, w.goal)));
}
/** The settings route the BK-D ruling freezes before its input is in the settings map. */
export type SettingsAnswer = { status: string; code?: string; reason?: string; value?: unknown };
export const settingsOf = async (world: DNRWorld['world'], route: string, input: unknown):
Promise<SettingsAnswer> => await world.settings(route as never, input as never) as SettingsAnswer;
/** The frozen `replyDeadline` field; read as `unknown` until the settings type carries it. */
export async function replyDeadlineOf(world: DNRWorld['world']): Promise<unknown> {
  return ((await settingsOf(world, 'snapshot', {}))?.value as { replyDeadline?: unknown } | undefined)?.replyDeadline;
}
