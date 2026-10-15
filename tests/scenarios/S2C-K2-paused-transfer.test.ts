/**
 * Slice 2C row 2C-35 (LE4, §3.2 T3/T4/T5, §3.10, L16): the overlaps.
 *
 * Task X ran on G, the person paused it and the Host restart interrupted it
 * (RUN-24, G retired). The responsibility is transferred to H through the real
 * `sessions/transfer-responsibility` route; H then claims another Task Y and Y's
 * Run is running. H is `working` (T5), never `paused`; its `responsibleNow`
 * still lists X with `phaseCause.code === 'paused_interrupted'` and the
 * `afterRunRef` of G's Run. Once Y ends and H is idle, T3(c) makes H `paused`
 * with an available `continue`.
 *
 * Entry LE4: `openHostScenario`, `restart({ crash: true })`, `lines/list`, the
 * real transfer route and the Workflow's claim/start.
 */
import { afterEach, expect, it } from 'vitest';
import { cleanupScenarios, openHostScenario, performs, type HostScenario } from './harness.js';
import {
  AG2B_SCOPE, AG2B_WORK_ROLE, createAG2bSession, graphWrite, listSessions, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution, submitControl } from '../helpers/A2-restart-fixture.js';
import { lineList, ready, requireControl, requireLine } from '../helpers/S2C-K-scenario-support.js';
import { PAUSE_ON_SECOND_REPLY } from '../helpers/S2C-K2-scenario-support.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionWorkLinkRef } from '../../src/contracts/core/identity.js';
import type { WorkLineListV1 } from '../../src/contracts/work-line.js';

afterEach(cleanupScenarios);

it('2C-35 T3(c) requires no occupancy: after the transfer H is working while Y runs and paused only when idle, and X keeps its paused_interrupted cause', async () => {
  let h: HostScenario | undefined;
  let heldIndex = -1;
  h = await openHostScenario({ workIds: ['ag2b-work', 'ag2b-work-2'],
    script: { replies: [...PAUSE_ON_SECOND_REPLY, { kind: 'text', text: '2C-35: Y ends' }],
      duringReply: async (index) => {
        if (index !== 1 || h === undefined) return;
        const runRef = (await h.taskRow('ag2b-work')).execution;
        if (runRef === null) throw new Error('X must have a Run');
        await submitControl(h.host, runRef, 'pause', '2C-35: the person pauses X', 's2c35-pause');
      } } });
  await h.advance(h.select('s2c35-x', 'ag2b-work'));
  const xRun = (await h.taskRow('ag2b-work')).execution;
  if (xRun === null) throw new Error('X must have a Run');
  const g = (await readExecution(h.host, xRun)).session;
  const gRef = { projectId: g.ref.projectId, sessionId: g.ref.sessionId };
  await h.restart({ crash: true });

  // A fresh, idle work Session H receives X's responsibility through the real route.
  const hCreated = await createAG2bSession(h.host, 's2c35-h', AG2B_WORK_ROLE);
  const hRef = hCreated.sessionRef;
  const gAfter = (await listSessions(h.host)).find(card => card.record.ref.sessionId === gRef.sessionId);
  if (gAfter === undefined) throw new Error('G must be in the Session directory');
  const source = gAfter.links.find(link => link.ref.relation === 'responsible'
    && link.ref.target.kind === 'task' && link.ref.target.ref.taskId === 'ag2b-work');
  if (source === undefined) throw new Error('G must still hold the responsible link to X');
  const destination: SessionWorkLinkRef = { ...hRef, aggregateType: 'SessionWorkLink',
    target: source.ref.target, relation: 'responsible' };
  const transfer = await h.post<ReadResult<unknown>>('sessions/transfer-responsibility', graphWrite(AG2B_SCOPE,
    { from: gRef, to: hRef, target: source.ref.target }, 's2c35-transfer', [
      { ref: gAfter.record.ref, revision: gAfter.record.revision },
      { ref: hCreated.sessionAggregateRef, revision: hCreated.revision },
      { ref: source.ref, revision: source.revision },
      { ref: destination, revision: 0 },
    ]));
  expect(transfer).toMatchObject({ status: 'committed' });

  // H claims Y and Y's Run is held running: read H mid-run.
  heldIndex = 2;
  const held = h.holdReply(heldIndex);
  const toStart = await h.advance(h.select('s2c35-y', 'ag2b-work-2'), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start of Y');
  const startDrive = h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next));
  await held.reached;

  let list: WorkLineListV1 = ready(await lineList(h), 'lines/list while Y runs');
  let row = requireLine(list, hRef.sessionId, 'the H line while Y runs');
  expect(row.status.own, 'T4/T5 wins while Y occupies H').not.toBe('paused');
  const xBrief = row.responsibleNow.find(brief => brief.task.taskId === 'ag2b-work');
  expect(xBrief, 'H now owns X').toBeDefined();
  expect(xBrief?.phaseCause).toMatchObject({ code: 'paused_interrupted' });
  expect(xBrief?.phaseCause?.detail).toMatchObject({ afterRunRef: { runId: xRun.runId } });

  // Y ends and H is idle: only now does T3(c) make H paused, with an available continue.
  held.release();
  await startDrive;
  list = ready(await lineList(h), 'lines/list after Y ends');
  row = requireLine(list, hRef.sessionId, 'the H line when idle');
  expect(row.status.own).toBe('paused');
  expect(row.status.ownReason).toMatchObject({ code: 'paused_interrupted' });
  expect(requireControl(row, 'continue', 'the H continue control')).toMatchObject({ availability: 'available', route: 'tasks/requeue' });
}, 240_000);
