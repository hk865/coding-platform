/**
 * Slice 2C row 2C-32 (LE4, §3.7 E9, DESIGN §4.5 L861/L883, decision 43, S1-ANCHOR-02).
 *
 * A RUN-24 (human pause interrupted by the Host restart) line holds a Task whose
 * reason is `paused_interrupted`; the person archives it through the real
 * `sessions/archive-line` route (drop), the archive combination writes the
 * anomaly anchor, and the line reads archived / retired with attention
 * `anomaly_pending`. The dropped Task reads "中断，待核对 · 等你点'继续'". When the
 * person continues the Task, a DIFFERENT Session claims it, and once the Run with
 * the anchor enters, the archived line stops reading the anchor as pending.
 *
 * Entry LE4: `openHostScenario`, `restart({ crash: true })`, the real
 * `lines/list`, `lines/archived`, `graph/hover`, `sessions/archive-line`,
 * `tasks/requeue` routes; expected values are the literal §3.6 A1, §3.7 E9 and
 * §3.9 words. No database is read.
 *
 * The operator archive of the retired (health `unavailable`, no occupancy)
 * RUN-24 line must write the anomaly anchor through the archive owner's guarded
 * anchor selection in `business/workflow/session-archive.ts` (lead ruling
 * 2026-10-15, row 2C-32): the line reads `anomaly_pending` and the dropped Task
 * reads "中断，待核对 · 等你点继续".
 */
import { afterEach, expect, it } from 'vitest';
import { cleanupScenarios, openHostScenario, performs, type HostScenario } from './harness.js';
import { AG2B_SCOPE } from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution, submitControl } from '../helpers/A2-restart-fixture.js';
import {
  archivedLineContaining, controlOf, lineArchived, lineList, ready, requireControl, requireLine, runMaintenance,
} from '../helpers/S2C-K-scenario-support.js';
import { PAUSE_ON_SECOND_REPLY, hoverGoal, taskHoverOf } from '../helpers/S2C-K2-scenario-support.js';
import { requeueBodyOf } from './support/common.js';
import type { ArchiveLineInput, ArchiveLineResultV1 } from '../../src/business/workflow/session-archive.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';
import type { GraphWrite } from '../../src/core/work-graph/model/session-contracts.js';

afterEach(cleanupScenarios);

it('2C-32 archiving a paused-interrupted line drops its Task, reads archived/retired with attention anomaly_pending, and continuing in another Session clears the anchor', async () => {
  let h: HostScenario | undefined;
  h = await openHostScenario({ script: { replies: [...PAUSE_ON_SECOND_REPLY, { kind: 'text', text: '2C-32: the continuation Run ends' }],
    duringReply: async (index) => {
      if (index !== 1 || h === undefined) return;
      const runRef = (await h.taskRow()).execution;
      if (runRef === null) throw new Error('the work Run must be selected');
      await submitControl(h.host, runRef, 'pause', '2C-32: the person pauses the Run', 's2c32-pause');
    } } });
  await h.advance(h.select('s2c32-run1', 'ag2b-work'));
  const pausedRun = (await h.taskRow()).execution;
  if (pausedRun === null) throw new Error('the work Run must be selected');
  const head = (await readExecution(h.host, pausedRun)).session.ref.sessionId;

  await h.restart({ crash: true });
  const before = requireLine(ready(await lineList(h), 'lines/list before the archive'), head, 'the RUN-24 line');
  expect(before.status.own).toBe('paused');
  expect(before.status.ownReason.code).toBe('paused_interrupted');

  // §3.7 E9: the person archives the paused line and puts the Task down.
  const session = (await readExecution(h.host, pausedRun)).session;
  const request: GraphWrite<ArchiveLineInput> = {
    input: { sessionRef: { projectId: session.ref.projectId, sessionId: head }, reason: '2C-32: the person archives the paused line',
      tasks: [{ target: { kind: 'task', ref: { projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal', taskId: 'ag2b-work' } },
        disposition: { kind: 'drop' } }], wait: null },
    meta: { requestId: 's2c32-archive', expected: [{ ref: session.ref, revision: session.revision }] },
  };
  const started = await h.post<ReadResult<ArchiveLineResultV1>>('sessions/archive-line', { scope: AG2B_SCOPE, request });
  expect(started).toMatchObject({ status: 'ready' });
  await h.advance(h.select('s2c32-archive-advance'), { maxSteps: 16 }).catch(() => undefined);
  await runMaintenance(h, 's2c32-archive-maint');

  const page = ready(await lineArchived(h), 'lines/archived after the archive');
  const archived = archivedLineContaining(page, head);
  expect(archived, 'the archived paused line is in the archived page').toBeDefined();
  expect(archived?.status.bucket).toBe('archived');
  expect(archived?.status.archivedTag).toBe('retired');
  expect(archived?.status.own).toBe('retired');
  expect(archived?.status.readOnly).toBe(true);
  const hover = ready(await hoverGoal(h), 'graph/hover after the archive');
  const task = taskHoverOf(hover, 'ag2b-work');
  expect(archived?.status.attention?.code).toBe('unknown');
  expect(archived?.status.attention?.reason.code).toBe('anomaly_pending');
  const reactivate = requireControl(archived!, 'reactivate', 'the archived retired reactivate control');
  expect(reactivate).toMatchObject({ availability: 'unavailable', reasonCode: 'reactivate_refused_retired' });

  // §3.9 `anomaly_pending · human_continue`: the dropped Task reads "中断，待核对 · 等你点继续".
  expect(task.display.anomaly, 'the dropped Task keeps its unclaimed anchor').not.toBeNull();
  expect(task.display.anomaly).toMatchObject({ label: '中断，待核对' });
  expect(task.display.anomaly?.next).toMatchObject({ code: 'anomaly_pending', params: { next: 'human_continue' } });

  // The person continues: the Task is requeued and dispatched to a DIFFERENT Session (decision 43).
  const body = await requeueBodyOf(h.host, pausedRun, 's2c32-continue', '继续');
  const continued = await h.post<WriteResult<TaskRequeueOutcomeV1>>('tasks/requeue', body);
  expect(continued).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
  await h.advance(h.select('s2c32-continue-claim', 'ag2b-work'));
  const nextRun = (await h.taskRow()).execution;
  expect(nextRun).not.toBeNull();
  const nextSession = (await readExecution(h.host, nextRun!)).session.ref.sessionId;
  expect(nextSession, 'the continuation is a different Session, hence another line').not.toBe(head);

  // The Run with the anchor entered: the archived line no longer reads the anchor as pending.
  const afterPage = ready(await lineArchived(h), 'lines/archived after the continuation');
  const afterRow = archivedLineContaining(afterPage, head);
  expect(afterRow, 'the archived line is still archived').toBeDefined();
  expect(afterRow?.status.attention?.reason.code, 'the anchor was taken over').not.toBe('anomaly_pending');
  expect(controlOf(afterRow!, 'continue')).toBeUndefined();
}, 240_000);
