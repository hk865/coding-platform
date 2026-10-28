/**
 * SMK2 §1 (STATE-MACHINES W-11, `docs/refactor/STATE-MACHINES-SPEC.md:4065`; start-up step 6b
 * `:4038-4043`): closing the Host pauses live Work at its next safe point instead of cancelling it;
 * the next start settles the Run as an interrupted Run and re-drives the Task.
 *
 * SQLite only: every row reopens the same ledger and Kernel store (tests/RULES.md:193-195).
 * Public routes, the reconcile report `restart` returns, and public reads only; no database read.
 * Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import type { TaskExecutionPage } from '../../src/app/core-http-types.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import { AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution } from '../helpers/A2-restart-fixture.js';
import { readReady } from '../helpers/S6B3-fixture.js';
import { cleanupScenarios, openHostScenario, performs, waitFor, type HostScenario } from './harness.js';
import { readCall } from './support/common.js';

afterEach(async () => {
  await cleanupScenarios();
});

it('SMK2-1: closing the Host while the driver-run Work Turn calls the model pauses it at the next safe point; the report lists W-11 (no cancel control, no task_cancelled/human_cancel) and the start-up re-drive gives a second Run in the same Session', async () => {
  let h!: HostScenario;
  h = await openHostScenario({ script: { replies: [readCall('smk2-1'), { kind: 'text', text: 'SMK2-1: the second Run answered' }] } });
  const held = h.holdReply(0);
  expect(await h.answer('workflow/driver-start', plain(AG2B_SCOPE, {
    advance: h.select('smk2-1', AG2B_WORK_TASK_ID), queryProfileIds: [] }))).toMatchObject({ status: 'ready' });
  await held.reached;
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the driver must have started the Work Run');

  const report = await h.restart({ closeWhileHeld: held });
  // W-11: the clean interruption is reconciled once, on this Run.
  const line = report.report?.runs.find(entry => entry.ref === JSON.stringify(runRef));
  expect(line, 'the interrupted Run is reconciled under W-11').toMatchObject({ row: 'W-11', status: 'reconciled',
    reason: 'interrupted_clean' });
  const settled = (await readExecution(h.host, runRef)).run;
  expect([settled.status, settled.outcome], 'the close did not cancel the Run').not.toEqual(['ended', 'cancelled']);
  expect(settled).toMatchObject({ status: 'ended', outcome: 'crashed',
    reconciliation: { observation: { kind: 'interrupted_clean', kernelPaused: true, pausedIntentRef: null } } });
  expect(settled.controlState?.intentRef, 'the Run carries no cancel pointer').toBeUndefined();
  expect(settled.controlState?.desiredState).not.toBe('cancelled');
  const task = await h.taskRow();
  expect(task.failure?.failureClass, 'the Task is not failed cancelled').not.toBe('cancelled');
  expect(task.failure?.automation.verdict, 'the Task is not failed human_cancel').not.toMatchObject(
    { kind: 'stopped', reason: 'task_cancelled', detail: { fence: 'human_cancel' } });

  // Step 6b with `resumeOnStartup` on: the same Session gets the continuation Run.
  const runs = async (): Promise<TaskExecutionPage['items']> => {
    const read = await h.post<ReadResult<TaskExecutionPage>>('executions/list', plain(AG2B_SCOPE,
      { goalRef: AG2B_GOAL_REF, taskId: AG2B_WORK_TASK_ID, page: { afterCursor: null, limit: 10 } }));
    return readReady(read, 'executions/list').items;
  };
  const listed = await waitFor(runs, items => items.some(item => item.run.ref.runId !== runRef.runId), 'the second Run');
  const second = listed.find(item => item.run.ref.runId !== runRef.runId);
  if (second === undefined) throw new Error('the second Run must be listed');
  expect(second.session.ref.sessionId).toBe((await readExecution(h.host, runRef)).session.ref.sessionId);
}, 240_000);

it('SMK2-2: closing the Host while the public executions/start handler is in flight pauses the Run at the next safe point; the close settles and the report lists W-11', async () => {
  let h!: HostScenario;
  h = await openHostScenario({ script: { replies: [readCall('smk2-2'), { kind: 'text', text: 'SMK2-2: a final reply the closing Host must not reach' }] } });
  const held = h.holdReply(0);
  const toStart = await h.advance(h.select('smk2-2', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  const next = toStart.next;
  if (next === null || next.kind !== 'perform' || next.operation.kind !== 'start') {
    throw new Error('the Workflow must stop before the Run start');
  }
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the claimed Work Task must have a Run');
  // The public route a real caller uses for the prepared Run; its handler holds the model call.
  const starting = h.post<ReadResult<unknown>>('executions/start', plain(AG2B_SCOPE, next.operation.request));
  await held.reached;
  const [report] = await Promise.all([h.restart({ closeWhileHeld: held }), starting]);
  expect(report.report?.runs.find(entry => entry.ref === JSON.stringify(runRef)),
    'the in-flight handler\'s Run is reconciled under W-11').toMatchObject({ row: 'W-11', status: 'reconciled',
    reason: 'interrupted_clean' });
}, 240_000);
