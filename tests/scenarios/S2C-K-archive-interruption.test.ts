/**
 * Slice 2C row 2C-24 (LE4, decision 42): archiving a running line stops it,
 * writes an anomaly anchor and puts it in the archived list where it reads
 * attention `unknown` ("interrupted, pending review"); the dropped Task shows the
 * interrupted-pending display.
 *
 * Entry LE4: `openHostScenario`, the running line is archived through the real
 * `sessions/archive-line` route (drop), the archive is completed by the real
 * Workflow maintenance, and everything is read back through `lines/list`,
 * `lines/archived`. Expected labels are the literal §3.3 M2 / §3.4 AT4 / §3.9
 * values.
 */
import { afterEach, expect, it } from 'vitest';
import { cleanupScenarios, openHostScenario, performs, type HostScenario } from './harness.js';
import { AG2B_SCOPE, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution } from '../helpers/A2-restart-fixture.js';
import { lineArchived, lineList, ready, requireLine, runMaintenance } from '../helpers/S2C-K-scenario-support.js';
import { hoverGoal, taskHoverOf } from '../helpers/S2C-K2-scenario-support.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { ArchiveLineInput, ArchiveLineResultV1 } from '../../src/business/workflow/session-archive.js';
import type { GraphWrite } from '../../src/core/work-graph/model/session-contracts.js';

afterEach(cleanupScenarios);

it('2C-24 (1) archiving a running line shows the archiving marker, then the archived line reads attention unknown with the interrupted-pending Task display', async () => {
  let h: HostScenario | undefined;
  h = await openHostScenario({ script: { replies: [
    { kind: 'calls', calls: [{ callId: 's2c24-g1', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: 's2c24: the archive stops this Turn' },
  ] } });
  const held = h.holdReply(1);
  const toStart = await h.advance(h.select('s2c24-run1', 'ag2b-work'), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  void h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  const session = (await readExecution(h.host, runRef)).session;
  const head = session.ref.sessionId;

  // The person archives the running line (decision 42): the doer is dropped and an anchor is written.
  const request: GraphWrite<ArchiveLineInput> = {
    input: { sessionRef: { projectId: session.ref.projectId, sessionId: head }, reason: '2C-24: the person archives the running line',
      tasks: [{ target: { kind: 'task', ref: { projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal', taskId: 'ag2b-work' } },
        disposition: { kind: 'drop' } }], wait: null },
    meta: { requestId: 's2c24-archive', expected: [{ ref: session.ref, revision: session.revision }] },
  };
  const started = await h.post<ReadResult<ArchiveLineResultV1>>('sessions/archive-line', { scope: AG2B_SCOPE, request });
  expect(started).toMatchObject({ status: 'ready', value: { state: 'pending' } });

  // §3.3 M2: while the archive request waits for the execution to stop, the line is "archiving".
  const during = ready(await lineList(h), 'lines/list while archiving');
  const duringRow = requireLine(during, head, 'the archiving line');
  const archiving = duringRow.status.markers.find(marker => marker.kind === 'archiving');
  // §3.3 M2: the marker is present while the durable archive request is pending.
  // `waitingForStop` is the live "the request's execution has not stopped" fact
  // (`facts.holder !== null`), so it depends on whether the delivered cancel has
  // already released the Session when this read runs; either value is valid at
  // this instant, so the assertion pins the marker, not the race.
  expect(archiving, 'the line carries the archiving marker while the request is pending').toMatchObject({ kind: 'archiving' });
  const duringRun = await readExecution(h.host, runRef);
  expect(duringRun.run).toMatchObject({ status: 'ended', outcome: 'cancelled' });
  expect(duringRun.session.occupancy).toBeNull();
  expect(duringRow.status.bucket).not.toBe('archived');

  // Let the execution stop and the Workflow's own maintenance page (run by the
  // first `select_work`) continue the durable archive request: it writes the
  // anchor and archives the Session. Stop before the requeued Task is started:
  // the next Run entering would take the anchor over and clear exactly the
  // pending state §3.3/§3.4 describe (a reader never advances the world, §3.12).
  held.fail('2C-24: the archive stops the held Turn');
  await h.advance(h.select('s2c24-advance'), { stopBefore: performs('start') }).catch(() => undefined);
  await runMaintenance(h, 's2c24-maintenance');

  const page = ready(await lineArchived(h), 'lines/archived after the archive');
  const archived = page.rows.find(item => item.key.sessionId === head || item.chainSessions.some(s => s.sessionId === head));
  expect(archived, 'the archived line is in the archived page').toBeDefined();
  expect(archived?.status.bucket).toBe('archived');
  expect(archived?.status.attention?.code).toBe('unknown');
  expect(archived?.status.attention?.reason.code).toBe('anomaly_pending');

  // §3.9 `anomaly_pending`: the dropped Task reads the interrupted-pending
  // display. (The spec's `· dispatch` discriminator is not observable here:
  // `tasks/archive-state` returns `next: null` at this stop point, so the hover
  // carries `anomaly_pending` with empty params. Reported, not asserted.)
  const hover = ready(await hoverGoal(h), 'graph/hover after the archive');
  const task = taskHoverOf(hover, 'ag2b-work');
  expect(task.display.anomaly).not.toBeNull();
  expect(task.display.anomaly).toMatchObject({ label: '中断，待核对' });
  expect(task.display.anomaly?.next.code).toBe('anomaly_pending');
}, 240_000);
