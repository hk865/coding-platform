/**
 * A.2 step 5.5 through the real Host over HTTP (docs/refactor/STATE-MACHINES-SPEC.md
 * §2 GOAL-04…06, GOAL-09/10/14/15, GOAL-17/18/20/27 display, §2.4, §9 VD-9;
 * routes `goals/control` and `goals/display`).
 *
 * The Workflow claims the work Task over `workflow/advance` on a real SQLite
 * ledger and Kernel. The operator then pauses, resumes or cancels the Goal over
 * `goals/control`: the Goal commit stops new work at once, and the Host fan-out
 * submits one control per affected Run under `GOAL_FAN_OUT_ACTOR` with a
 * deterministic requestId (re-sending the request adds no intent). The display
 * shows each Run's actual state. A paused Goal opens no round and begins no
 * check (VD-9); the resumed Goal completes. A resume sent while the fan-out
 * pause is still queued waits for it: the driver observes the pause landing
 * and then resumes the Run (GOAL-14 "驱动等观察到达后重试"). The scripted model
 * answers with one edit and one text per Run; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PLATFORM_TOKEN_META_NAME, PLATFORM_TOKEN_PLACEHOLDER, type GoalControlOutcomeV1, type GoalDisplayHostReadV1,
  type TaskExecutionRecord,
} from '../../src/app/core-http-types.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import { GOAL_FAN_OUT_ACTOR } from '../../src/contracts/task-requeue.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_GOAL_REF, AG2B_RESULT_FILE, AG2B_RESULT_TEXT, AG2B_SCOPE, AG2B_WORK_TASK_ID, cleanupAG2b, corePost, graphWrite, plain,
  seedAG2bWorkGraph, startAG2bHost, type AG2bHost, type AG2bOverrides,
} from '../helpers/AG2b-collaboration-fixture.js';

const temporary: string[] = [];
afterEach(async () => {
  await cleanupAG2b();
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

const REPLIES: ScriptedReply[] = [
  { kind: 'calls', calls: [{ callId: 'a2-goal-edit', name: 'edit', args: { mode: 'create', path: AG2B_RESULT_FILE, newText: AG2B_RESULT_TEXT } }] },
  { kind: 'text', text: 'A2 goal control: the result file is written' },
];

async function startHost(beforeReply?: AG2bOverrides['beforeReply']): Promise<AG2bHost> {
  const publicDir = await mkdtemp(join(tmpdir(), 'a2-goal-control-public-'));
  temporary.push(publicDir);
  await writeFile(join(publicDir, 'index.html'),
    `<!doctype html><meta name="${PLATFORM_TOKEN_META_NAME}" content="${PLATFORM_TOKEN_PLACEHOLDER}">`);
  const host = await startAG2bHost(publicDir, { replies: REPLIES, ...(beforeReply === undefined ? {} : { beforeReply }) });
  await seedAG2bWorkGraph(host);
  return host;
}

async function post<T>(host: AG2bHost, suffix: string, body: unknown): Promise<T> {
  const response = await corePost(host.base, suffix, host.token, body);
  expect(response.status, suffix).toBe(200);
  return await response.json() as T;
}

/** A refused graph write: the HTTP error boundary carries the exact rejection body. */
async function refused(host: AG2bHost, suffix: string, body: unknown): Promise<CoreRejection> {
  const response = await corePost(host.base, suffix, host.token, body);
  expect(response.status, suffix).not.toBe(200);
  return await response.json() as CoreRejection;
}

/** `select_work` for the work Task; `goalLevel` lets the Workflow go on to the gate and the Goal completion. */
const selectWork = (flowId: string, goalLevel = false): WorkflowAdvanceInput => ({ schemaVersion: 1, goalRef: AG2B_GOAL_REF, flowId,
  sessionHint: null, kind: 'select_work', ...(goalLevel ? {} : { taskId: AG2B_WORK_TASK_ID }) });

async function advance(host: AG2bHost, input: WorkflowAdvanceInput): Promise<Extract<WorkflowAdvanceResult, { status: 'ready' }>['value']> {
  const result = await post<WorkflowAdvanceResult>(host, 'workflow/advance', plain(AG2B_SCOPE, input));
  if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
  return result.value;
}

/** Advance until the next step is `stopBefore` (not performed) or the Workflow settles. */
async function advanceUntil(host: AG2bHost, input: WorkflowAdvanceInput, stopBefore: string | null):
Promise<{ next: WorkflowAdvanceInput | null; last: Awaited<ReturnType<typeof advance>> }> {
  let current = input;
  for (let guard = 0; guard < 32; guard += 1) {
    const value = await advance(host, current);
    if (value.next === null) return { next: null, last: value };
    if (stopBefore !== null && value.next.kind === 'perform' && value.next.operation.kind === stopBefore) return { next: value.next, last: value };
    current = value.next;
  }
  throw new Error('the Workflow did not settle');
}

async function readGoal(host: AG2bHost): Promise<GoalSnapshot> {
  const read = await post<ReadResult<{ goal: GoalSnapshot }>>(host, 'goals/read', plain(AG2B_SCOPE, AG2B_GOAL_REF));
  if (read.status !== 'ready') throw new Error(`the Goal must be readable: ${JSON.stringify(read)}`);
  return read.value.goal;
}

async function control(host: AG2bHost, kind: 'pause' | 'resume' | 'cancel', requestId: string, goalRevision?: number) {
  const revision = goalRevision ?? (await readGoal(host)).revision;
  return graphWrite(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF, control: kind, reason: `operator ${kind}` }, requestId,
    [{ ref: AG2B_GOAL_REF, revision }]);
}

async function display(host: AG2bHost): Promise<GoalDisplayHostReadV1> {
  const read = await post<ReadResult<GoalDisplayHostReadV1>>(host, 'goals/display', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
  if (read.status !== 'ready') throw new Error(`the Goal display must be readable: ${JSON.stringify(read)}`);
  return read.value;
}

async function readRun(host: AG2bHost, runRef: RunRef): Promise<TaskExecutionRecord> {
  const read = await post<ReadResult<TaskExecutionRecord>>(host, 'executions/read', plain(AG2B_SCOPE, runRef));
  if (read.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(read)}`);
  return read.value;
}

async function readIntent(host: AG2bHost, ref: unknown): Promise<ControlIntentSnapshotV1> {
  const read = await post<ReadResult<ControlIntentSnapshotV1>>(host, 'controls/read', plain(AG2B_SCOPE, ref));
  if (read.status !== 'ready') throw new Error(`the intent must be readable: ${JSON.stringify(read)}`);
  return read.value;
}

async function claimedRun(host: AG2bHost, flowId: string): Promise<{ runRef: RunRef; next: WorkflowAdvanceInput }> {
  // select_work → create_session → claim; stop before the prepare of the claimed Run.
  const claimed = await advanceUntil(host, selectWork(flowId), 'prepare');
  if (claimed.next === null) throw new Error(`the Workflow did not reach the prepare: ${JSON.stringify(claimed.last)}`);
  const graph = await post<ReadResult<{ tasks: Array<{ ref: { taskId: string }; execution: RunRef | null }> }>>(
    host, 'tasks/query', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
  if (graph.status !== 'ready') throw new Error('the task graph must be readable');
  const runRef = graph.value.tasks.find(row => row.ref.taskId === AG2B_WORK_TASK_ID)?.execution ?? null;
  if (runRef === null) throw new Error('the work Task must be claimed');
  return { runRef, next: claimed.next };
}

it('goals/control pause, then resume: the claimed Run is paused and resumed by the fan-out; a paused Goal starts nothing; the Goal completes', async () => {
  const host = await startHost();
  try {
    const { runRef, next } = await claimedRun(host, 'a2-goal-pause');
    const before = await readGoal(host);
    expect(before).toMatchObject({ desiredState: 'active', activePlanRevision: { planId: 'ag2b-plan' } });

    // GOAL-04 + GOAL-09: the Goal commit, then the not-entered Run is paused by the platform (D-7).
    const pauseBody = await control(host, 'pause', 'a2-goal-pause-1', before.revision);
    const paused = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control', pauseBody);
    if (paused.status !== 'committed') throw new Error(`pause: ${JSON.stringify(paused)}`);
    expect(paused.replayed).toBe(false);
    expect(paused.value.goal).toMatchObject({ desiredState: 'paused', revision: before.revision + 1,
      desiredStateRevision: before.revision + 1, desiredStateRequestedBy: host.actor });
    expect(paused.value.fanOut).toMatchObject({ epoch: before.revision + 1, control: 'pause', problem: null,
      runs: [{ runRef, outcome: 'submitted', reason: null }] });
    const pauseIntentRef = paused.value.fanOut.runs[0]!.intentRef;
    const pauseIntent = await readIntent(host, pauseIntentRef);
    expect(pauseIntent).toMatchObject({ kind: 'pause', status: 'applied', requestedBy: GOAL_FAN_OUT_ACTOR,
      reason: `goal:${AG2B_GOAL_REF.goalId}:pause@${String(before.revision + 1)}`,
      observation: { origin: 'platform_not_entered', kind: 'paused' } });
    expect((await readRun(host, runRef)).run).toMatchObject({ status: 'starting', controlState: { desiredState: 'paused' } });

    // GOAL-20: PAUSED with each Run's actual state (runStops order 5), never "all stopped".
    const pausedView = await display(host);
    expect(pausedView.display).toMatchObject({ phase: 'PAUSED', row: 'GOAL-20',
      runStops: [{ runRef, stop: { kind: 'paused' } }] });
    expect(pausedView.liveRuns).toEqual([runRef]);

    // The same request again replays the Goal commit and adds no intent (§2.3 re-drive).
    const again = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control', pauseBody);
    expect(again).toMatchObject({ status: 'committed', replayed: true, value: { goal: paused.value.goal,
      fanOut: { runs: [{ runRef, outcome: 'already_submitted', intentRef: pauseIntentRef }] } } });
    // A new pause is busy; nothing is selected or entered while the Goal is paused (D-9).
    expect(await refused(host, 'goals/control', await control(host, 'pause', 'a2-goal-pause-2')))
      .toMatchObject({ code: 'busy', reason: 'the Goal is already paused' });
    const waitingSelect = await advance(host, selectWork('a2-goal-pause-2'));
    expect(waitingSelect).toMatchObject({ state: 'waiting', next: null,
      reason: 'the Goal is paused; no work is selected while the Goal is not active' });
    const blockedStart = await advanceUntil(host, next, null);
    expect(blockedStart.last.state).toBe('waiting');
    expect(host.scripted.calls(), 'no model call while the Goal is paused').toBe(0);

    // GOAL-05 + GOAL-14: the operator resumes; the fan-out resumes the Run it paused.
    const resumed = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control',
      await control(host, 'resume', 'a2-goal-resume-1'));
    if (resumed.status !== 'committed') throw new Error(`resume: ${JSON.stringify(resumed)}`);
    expect(resumed.value.goal).toMatchObject({ desiredState: 'active', desiredStateRevision: before.revision + 2 });
    expect(resumed.value.fanOut).toMatchObject({ control: 'resume', runs: [{ runRef, outcome: 'submitted' }] });
    expect(await readIntent(host, resumed.value.fanOut.runs[0]!.intentRef)).toMatchObject({ kind: 'resume', status: 'applied',
      requestedBy: GOAL_FAN_OUT_ACTOR, observation: { origin: 'platform_not_entered', kind: 'resumed' } });
    expect((await display(host)).display).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', runStops: null });

    // The Workflow continues the same claim; the round passes and the Goal completes (GOAL-18).
    const done = await advanceUntil(host, selectWork('a2-goal-resume', true), null);
    expect(done.last).toMatchObject({ state: 'completed' });
    expect(await readFile(join(host.root, AG2B_RESULT_FILE), 'utf8')).toBe(AG2B_RESULT_TEXT);
    expect(host.scripted.calls()).toBe(2);
    expect((await display(host)).display).toMatchObject({ phase: 'COMPLETED', row: 'GOAL-18' });
    // §2.4: a Goal completed for its active Plan has no work to stop.
    expect(await refused(host, 'goals/control', await control(host, 'pause', 'a2-goal-pause-3')))
      .toMatchObject({ code: 'invalid', reason: 'the Goal is completed for its active Plan; it has no work to stop' });
  } finally {
    await host.host.close();
  }
}, 120_000);

it('goals/control cancel: the claimed Run ends at once, the Goal is terminal and adopts no Plan', async () => {
  const host = await startHost();
  try {
    const { runRef } = await claimedRun(host, 'a2-goal-cancel');
    const cancelled = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control',
      await control(host, 'cancel', 'a2-goal-cancel-1'));
    if (cancelled.status !== 'committed') throw new Error(`cancel: ${JSON.stringify(cancelled)}`);
    expect(cancelled.value.goal.desiredState).toBe('cancelled');
    // GOAL-10: the not-entered Run is cancelled by the platform; its Session is released.
    expect(cancelled.value.fanOut.runs).toMatchObject([{ runRef, outcome: 'submitted' }]);
    const ended = await readRun(host, runRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'cancelled', startedAt: null });
    expect(ended.session.occupancy).toBeNull();
    // GOAL-17: CANCELLED with the Run's actual end (runStops order 1).
    expect((await display(host)).display).toMatchObject({ phase: 'CANCELLED', row: 'GOAL-17',
      runStops: [{ runRef, stop: { kind: 'ended', outcome: 'cancelled' } }] });
    // §2.4: cancelled is terminal.
    expect(await refused(host, 'goals/control', await control(host, 'cancel', 'a2-goal-cancel-2')))
      .toMatchObject({ code: 'busy', reason: 'the Goal is already cancelled' });
    expect(await refused(host, 'goals/control', await control(host, 'resume', 'a2-goal-cancel-3')))
      .toMatchObject({ code: 'invalid' });
    expect(await refused(host, 'goals/control', await control(host, 'pause', 'a2-goal-cancel-4')))
      .toMatchObject({ code: 'invalid' });
    const goal = await readGoal(host);
    const draft = { schemaVersion: 2, planId: 'ag2b-plan-2', planRevision: 2, goalId: AG2B_GOAL_REF.goalId, stages: [],
      tasks: [], assignments: [], obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
      taskRelations: [], inputRequirements: [] };
    expect(await refused(host, 'plans/propose', graphWrite(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF,
      basedOn: goal.activePlanRevision, draft, reason: { text: 'after the cancel', sources: [] } }, 'a2-goal-cancel-plan')))
      .toMatchObject({ code: 'invalid', reason: 'the Goal is cancelled; its plan can no longer change' });
    expect(await advance(host, selectWork('a2-goal-cancel-2'))).toMatchObject({ state: 'waiting',
      reason: 'the Goal is cancelled; no work is selected while the Goal is not active' });
    expect(host.scripted.calls()).toBe(0);
  } finally {
    await host.host.close();
  }
}, 120_000);

it('VD-9: a paused Goal opens no round and begins no check; after the resume the same chain completes', async () => {
  const host = await startHost();
  try {
    // The Run ends normally; stop before its round opens (`open_checks`).
    const beforeOpen = await advanceUntil(host, selectWork('a2-goal-vd9'), 'open_checks');
    if (beforeOpen.next === null) throw new Error(`the Workflow did not reach the round: ${JSON.stringify(beforeOpen.last)}`);
    expect(host.scripted.calls()).toBe(2);
    const paused = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control',
      await control(host, 'pause', 'a2-goal-vd9-pause-1'));
    // The ended Run is not in the fan-out set (GOAL-15).
    expect(paused).toMatchObject({ status: 'committed', value: { fanOut: { control: 'pause', runs: [] } } });
    const openRefused = await advance(host, beforeOpen.next);
    expect(openRefused).toMatchObject({ state: 'waiting', next: null });
    expect(openRefused.reason).toContain('no new check process starts until the Goal is resumed');
    await post(host, 'goals/control', await control(host, 'resume', 'a2-goal-vd9-resume-1'));

    // The round opens; pause again before the check begins.
    const beforeCheck = await advanceUntil(host, selectWork('a2-goal-vd9-2'), 'run_check');
    if (beforeCheck.next === null) throw new Error(`the Workflow did not reach the check: ${JSON.stringify(beforeCheck.last)}`);
    await post(host, 'goals/control', await control(host, 'pause', 'a2-goal-vd9-pause-2'));
    const checkRefused = await advance(host, beforeCheck.next);
    expect(checkRefused).toMatchObject({ state: 'waiting', next: null });
    expect(checkRefused.reason).toContain('the Goal is paused; no new check process starts');
    await post(host, 'goals/control', await control(host, 'resume', 'a2-goal-vd9-resume-2'));

    const done = await advanceUntil(host, selectWork('a2-goal-vd9-3'), null);
    expect(done.last).toMatchObject({ state: 'completed' });
    expect(host.scripted.calls(), 'the pauses added no model call').toBe(2);
  } finally {
    await host.host.close();
  }
}, 120_000);

it('GOAL-11/14 with a live Kernel Turn: the fan-out pause lands at the next safe point; the resume re-enters the original Turn', async () => {
  let host: AG2bHost | undefined;
  let pausedDuringTurn: WriteResult<GoalControlOutcomeV1> | undefined;
  host = await startHost(async (_request, index) => {
    // The Run entered and its Turn calls the model: the operator pauses the Goal now.
    if (index !== 0 || host === undefined) return;
    pausedDuringTurn = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control',
      await control(host, 'pause', 'a2-goal-live-pause'));
  });
  try {
    const first = await advanceUntil(host, selectWork('a2-goal-live'), null);
    expect(first.last.state).toBe('waiting');
    expect(host.scripted.calls(), 'the pause landed before the second model request').toBe(1);
    if (pausedDuringTurn?.status !== 'committed') throw new Error(`pause: ${JSON.stringify(pausedDuringTurn)}`);
    const [runResult] = pausedDuringTurn.value.fanOut.runs;
    // GOAL-11: queued for the entered Run and delivered to its live handle.
    expect(runResult).toMatchObject({ outcome: 'submitted', reason: null });
    const runRef = runResult!.runRef;
    const pauseIntent = await readIntent(host, runResult!.intentRef);
    expect(pauseIntent).toMatchObject({ kind: 'pause', status: 'applied', requestedBy: GOAL_FAN_OUT_ACTOR,
      observation: { kind: 'paused' } });
    if (pauseIntent.status !== 'applied') throw new Error('the fan-out pause must be applied');
    expect('origin' in pauseIntent.observation, 'a Kernel observation, not a platform one').toBe(false);
    expect((await readRun(host, runRef)).run).toMatchObject({ status: 'running', controlState: { desiredState: 'paused' } });
    expect((await display(host)).display).toMatchObject({ phase: 'PAUSED', runStops: [{ runRef, stop: { kind: 'paused' } }] });

    // GOAL-14: the resume is queued and the original Turn is re-entered in the background.
    const resumed = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control',
      await control(host, 'resume', 'a2-goal-live-resume'));
    expect(resumed.status === 'committed' && resumed.value.fanOut.runs).toMatchObject([
      { runRef, outcome: 'submitted', reason: 're-entry of the original Turn started' }]);
    let ended: TaskExecutionRecord['run'] | null = null;
    for (let wait = 0; wait < 200 && ended === null; wait += 1) {
      const run = (await readRun(host, runRef)).run;
      if (run.status === 'ended') ended = run;
      else await new Promise(resolve => setTimeout(resolve, 50));
    }
    expect(ended).toMatchObject({ outcome: 'completed' });
    expect(host.scripted.calls()).toBe(2);
    const done = await advanceUntil(host, selectWork('a2-goal-live-2', true), null);
    expect(done.last).toMatchObject({ state: 'completed' });
    expect((await display(host)).display).toMatchObject({ phase: 'COMPLETED' });
  } finally {
    await host.host.close();
  }
}, 120_000);

it('GOAL-14 retry: a resume sent while the fan-out pause is still queued follows once the pause lands; the Turn is re-entered and completes', async () => {
  let host: AG2bHost | undefined;
  let paused: WriteResult<GoalControlOutcomeV1> | undefined;
  let resumed: WriteResult<GoalControlOutcomeV1> | undefined;
  let waitingView: GoalDisplayHostReadV1 | undefined;
  host = await startHost(async (_request, index) => {
    // The Run entered and its first model request is in flight: pause, then resume at once.
    if (index !== 0 || host === undefined) return;
    paused = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control', await control(host, 'pause', 'a2-goal-retry-pause'));
    resumed = await post<WriteResult<GoalControlOutcomeV1>>(host, 'goals/control', await control(host, 'resume', 'a2-goal-retry-resume'));
    waitingView = await display(host);
  });
  try {
    await advanceUntil(host, selectWork('a2-goal-retry'), null);
    if (paused?.status !== 'committed' || resumed?.status !== 'committed') {
      throw new Error(`controls: ${JSON.stringify([paused, resumed])}`);
    }
    const [pauseResult] = paused.value.fanOut.runs;
    expect(pauseResult).toMatchObject({ outcome: 'submitted', reason: null });
    const runRef = pauseResult!.runRef;
    // The pause is queued until the next safe point: the resume row waits for it (GOAL-14), it does not give up.
    expect(resumed.value.fanOut.runs).toEqual([{ runRef, outcome: 'skipped', intentRef: null,
      reason: 'the fan-out pause is queued; the resume follows once it is applied and paused' }]);
    // The active Goal keeps the waiting Run visible (runStops exist only while the Goal is not active).
    expect(waitingView?.display).toMatchObject({ phase: 'RUNNING', runStops: null });
    expect(waitingView?.resumePending).toEqual([{ runRef, intentRef: pauseResult!.intentRef, intentKind: 'pause', status: 'queued' }]);
    expect(waitingView?.reentryFailures).toEqual([]);

    // The pause lands at the safe point after the first reply; the driver then submits the resume and re-enters the Turn.
    let ended: TaskExecutionRecord['run'] | null = null;
    for (let wait = 0; wait < 300 && ended === null; wait += 1) {
      const run = (await readRun(host, runRef)).run;
      if (run.status === 'ended') ended = run;
      else await new Promise(resolve => setTimeout(resolve, 50));
    }
    expect(ended).toMatchObject({ outcome: 'completed' });
    expect(host.scripted.calls(), 'the paused Turn went on with the second reply').toBe(2);
    expect(await readIntent(host, pauseResult!.intentRef)).toMatchObject({ kind: 'pause', status: 'applied',
      observation: { kind: 'paused' } });
    const resumeIntent = await readIntent(host, ended!.controlState?.intentRef);
    expect(resumeIntent).toMatchObject({ kind: 'resume', status: 'applied', requestedBy: GOAL_FAN_OUT_ACTOR,
      reason: `goal:${AG2B_GOAL_REF.goalId}:resume@${String(resumed.value.goal.desiredStateRevision)}` });
    const after = await display(host);
    expect(after.resumePending).toEqual([]);
    const done = await advanceUntil(host, selectWork('a2-goal-retry-2', true), null);
    expect(done.last).toMatchObject({ state: 'completed' });
    expect(await readFile(join(host.root, AG2B_RESULT_FILE), 'utf8')).toBe(AG2B_RESULT_TEXT);
    expect(host.scripted.calls()).toBe(2);
  } finally {
    await host.host.close();
  }
}, 120_000);
