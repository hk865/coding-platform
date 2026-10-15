/**
 * Slice 2C row 2C-23 (LE4, decision 54, RUN-24): a human- or Goal-paused Run that
 * a Host restart interrupted reads as `paused` with the `paused_interrupted`
 * reason and the "continue" control, and every control is submitted through the
 * real routes.
 *
 * Entry LE4: `tests/scenarios/harness.ts` `openHostScenario` / `restart()`, all
 * reads through the real `lines/*` routes, all writes through `controls/submit`,
 * `tasks/requeue` and `goals/control`. Expected words/params/controls are the
 * literal §3.2 T0, §3.9 and §3.10 values; no database is read.
 */
import { afterEach, expect, it } from 'vitest';
import { cleanupScenarios, openHostScenario, type HostScenario } from './harness.js';
import { AG2B_SCOPE, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution, submitControl } from '../helpers/A2-restart-fixture.js';
import { goalControlled } from './support/control.js';
import { requeueBodyOf } from './support/common.js';
import {
  controlOf, lineArchived, lineList, ready, requireControl, requireLine, runMaintenance,
} from '../helpers/S2C-K-scenario-support.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';

afterEach(cleanupScenarios);

/** The RUN-24 (paused-interrupted) ScriptedModel: pause the Run at its second request. */
const PAUSE_REPLIES = [
  { kind: 'calls' as const, calls: [{ callId: 's2c23-g1', name: 'read', args: { path: 'src/module.ts' } }] },
  { kind: 'calls' as const, calls: [{ callId: 's2c23-g2', name: 'read', args: { path: 'src/module.ts' } }] },
];

/** The Session the work Run runs in, read through the public `executions/read` route. */
async function headSessionId(h: HostScenario): Promise<string> {
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Task must have a Run');
  return (await readExecution(h.host, runRef)).session.ref.sessionId;
}

it('2C-23 (1) a human-paused Run interrupted by the restart reads paused_interrupted (by you), lists only continue, survives maintenance, and continues in the original Session', async () => {
  let h: HostScenario | undefined;
  h = await openHostScenario({ script: { replies: PAUSE_REPLIES,
    duringReply: async (index) => {
      if (index !== 1 || h === undefined) return;
      const runRef = (await h.taskRow()).execution;
      if (runRef === null) throw new Error('the work Run must be selected');
      await submitControl(h.host, runRef, 'pause', '2C-23: the person pauses the Run', 's2c23-pause');
    } } });
  await h.advance(h.select('s2c23-run1', 'ag2b-work'));
  const head = await headSessionId(h);

  // Before the crash: T3a, the person paused it.
  let list = ready(await lineList(h), 'lines/list before the crash');
  let row = requireLine(list, head, 'the paused line before the crash');
  expect(row.status.own).toBe('paused');
  expect(row.status.ownReason.code).toBe('paused_by_you');

  await h.restart({ crash: true });
  list = ready(await lineList(h), 'lines/list after the crash');
  row = requireLine(list, head, 'the RUN-24 line');
  expect(row.status.own).toBe('paused');
  expect(row.status.ownReason).toMatchObject({ code: 'paused_interrupted', params: { by: 'you', goal: 'active' } });
  expect(row.status.bucket).toBe('standby');

  // §3.10 T0: one continue per paused-interrupted Task; pause/resume/cancel are not given.
  const cont = requireControl(row, 'continue', 'the RUN-24 continue control');
  expect(cont).toMatchObject({ availability: 'available', route: 'tasks/requeue', reasonCode: null });
  for (const kind of ['pause', 'resume', 'cancel'] as const) {
    expect(controlOf(row, kind), `the RUN-24 line lists no ${kind}`).toBeUndefined();
  }

  // Maintenance ran and did not archive the paused line (decision 54).
  await runMaintenance(h, 's2c23-advance');
  const archived = ready(await lineArchived(h), 'lines/archived');
  expect(archived.rows.map(item => item.key.sessionId)).not.toContain(head);
  expect(requireLine(ready(await lineList(h), 'lines/list after maintenance'), head).status.own).toBe('paused');

  // Every pause/resume/cancel submission is refused with the guard's code; the reason names continue.
  const runRef = (await h.taskRow()).execution!;
  const run = (await readExecution(h.host, runRef)).run;
  for (const kind of ['pause', 'resume', 'cancel'] as const) {
    const answer = await h.answer('controls/submit', graphWrite(AG2B_SCOPE, { runRef, kind, reason: null },
      `s2c23-${kind}-refused`, [{ ref: runRef, revision: run.revision }]));
    expect(answer, `${kind} on an ended RUN-24 Run`).toMatchObject({ status: 'rejected', code: 'busy' });
  }

  // The person continues: tasks/requeue is accepted.
  const body = await requeueBodyOf(h.host, runRef, 's2c23-continue', '继续');
  const continued = await h.post<WriteResult<TaskRequeueOutcomeV1>>('tasks/requeue', body);
  expect(continued).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });

  // K closes the dangling Turn and the continuation is claimed in the original Session (same line).
  await h.advance(h.select('s2c23-continue-claim', 'ag2b-work'), { stopBefore: (input) => input.kind === 'perform' && input.operation.kind === 'start' });
  const listAfter = ready(await lineList(h), 'lines/list after continue');
  expect(requireLine(listAfter, head, 'the continued line')).toBeDefined();
  const nextRun = (await h.taskRow()).execution;
  expect(nextRun).not.toBeNull();
  expect((await readExecution(h.host, nextRun!)).session.ref.sessionId).toBe(head);
  expect(requireLine(listAfter, head).status.own).toBe('starting');
}, 240_000);

it('2C-23 (2) a Goal-fan-out-paused Run interrupted by the restart reads paused_interrupted (by goal, goal paused); continue is unavailable until the Goal resumes and GOAL-29 continues it in the original Session', async () => {
  let h: HostScenario | undefined;
  h = await openHostScenario({ script: { replies: PAUSE_REPLIES,
    duringReply: async (index) => {
      if (index !== 0 || h === undefined) return;
      await goalControlled(h.host, 'pause', 's2c23-goal-pause');
    } } });
  const held = h.holdReply(0);
  const toStart = await h.advance(h.select('s2c23-run1', 'ag2b-work'), { stopBefore: (input) => input.kind === 'perform' && input.operation.kind === 'start' });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  void h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const runRef = (await h.taskRow()).execution!;
  const head = (await readExecution(h.host, runRef)).session.ref.sessionId;

  await h.restart({ crash: true });
  const list = ready(await lineList(h), 'lines/list after the goal-pause crash');
  const row = requireLine(list, head, 'the goal-paused RUN-24 line');
  expect(row.status.own).toBe('paused');
  expect(row.status.ownReason).toMatchObject({ code: 'paused_interrupted', params: { by: 'goal', goal: 'paused' } });
  const cont = requireControl(row, 'continue', 'the goal-paused RUN-24 continue control');
  expect(cont.availability).toBe('unavailable');
  expect(cont.reasonCode).toBe('busy');

  // The Goal resumes: GOAL-29 continues it in the original Session.
  await goalControlled(h.host, 'resume', 's2c23-goal-resume');
  await h.advance(h.select('s2c23-goal-continue', 'ag2b-work'), { stopBefore: (input) => input.kind === 'perform' && input.operation.kind === 'start' });
  const nextRun = (await h.taskRow()).execution;
  expect(nextRun).not.toBeNull();
  expect((await readExecution(h.host, nextRun!)).session.ref.sessionId).toBe(head);
}, 240_000);

it('2C-23 (3) a human pause followed by a Goal pause reads paused_interrupted (by you, goal paused), refuses continue, and the resumed Goal does not auto-continue a human pause', async () => {
  let h: HostScenario | undefined;
  h = await openHostScenario({ script: { replies: PAUSE_REPLIES,
    duringReply: async (index) => {
      if (index !== 1 || h === undefined) return;
      const runRef = (await h.taskRow()).execution;
      if (runRef === null) throw new Error('the work Run must be selected');
      await submitControl(h.host, runRef, 'pause', '2C-23: the person pauses the Run', 's2c23b-pause');
    } } });
  await h.advance(h.select('s2c23b-run1', 'ag2b-work'));
  const runRef = (await h.taskRow()).execution!;
  const head = (await readExecution(h.host, runRef)).session.ref.sessionId;
  await h.restart({ crash: true });
  // Now pause the Goal too.
  await goalControlled(h.host, 'pause', 's2c23b-goal-pause');

  const row = requireLine(ready(await lineList(h), 'lines/list'), head, 'the human+goal paused line');
  expect(row.status.own).toBe('paused');
  expect(row.status.ownReason).toMatchObject({ code: 'paused_interrupted', params: { by: 'you', goal: 'paused' } });
  const cont = requireControl(row, 'continue', 'the continue control');
  expect(cont.availability).toBe('unavailable');
  expect(cont.reasonCode).toBe('busy');

  // Resuming the Goal does not continue a human pause (GOAL-29 never selects it); continue becomes available.
  await goalControlled(h.host, 'resume', 's2c23b-goal-resume');
  const afterResume = requireLine(ready(await lineList(h), 'lines/list after resume'), head);
  expect(requireControl(afterResume, 'continue').availability).toBe('available');
  const before = (await h.taskRow()).execution;
  expect(before).toEqual(runRef);
}, 240_000);

it('2C-23 (4) a cancelled Goal makes continue unavailable with a reason naming the cancelled Goal', async () => {
  let h: HostScenario | undefined;
  h = await openHostScenario({ script: { replies: PAUSE_REPLIES,
    duringReply: async (index) => {
      if (index !== 1 || h === undefined) return;
      const runRef = (await h.taskRow()).execution;
      if (runRef === null) throw new Error('the work Run must be selected');
      await submitControl(h.host, runRef, 'pause', '2C-23: the person pauses the Run', 's2c23c-pause');
    } } });
  await h.advance(h.select('s2c23c-run1', 'ag2b-work'));
  const head = await headSessionId(h);
  await h.restart({ crash: true });
  await goalControlled(h.host, 'cancel', 's2c23c-goal-cancel');

  const row = requireLine(ready(await lineList(h), 'lines/list'), head, 'the cancelled-Goal line');
  expect(row.status.own).toBe('paused');
  expect(row.status.ownReason).toMatchObject({ code: 'paused_interrupted', params: { by: 'you', goal: 'cancelled' } });
  const cont = requireControl(row, 'continue', 'the continue control');
  expect(cont.availability).toBe('unavailable');
}, 240_000);
