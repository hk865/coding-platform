/**
 * Slice 2C row 2C-34 (LE4, §3.10, L16, §0.2): the controls that need the Host's
 * real routes. A result-unknown Work line attests through
 * `executions/resolve-unknown`; a result-unknown Query line attests through
 * `queries/resolve-unknown`; a standby (paused-interrupted) and a working line
 * archive through `sessions/archive-line`; an archived retired line's
 * `reactivate` is refused with `reactivate_refused_retired` and its `ask` is
 * `not_yet`.
 *
 * Entry LE4: `openHostScenario`, `restart({ crash: true })`, `runMaintenance`,
 * the real `lines/list`, `lines/archived`, and the control routes named by each
 * control. Expected values are the literal §3.10 table.
 */
import { afterEach, expect, it } from 'vitest';
import { cleanupScenarios, openHostScenario, performs, type HostScenario } from './harness.js';
import {
  AG2B_SCOPE, claimBusyQuery, createAG2bSession, graphWrite, plain, seedAG2bWorkGraph, startAG2bHost, startBusyQuery,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  deferred, moveKernelAside, post, publicDirectory, readExecution, readQuery, submitControl, tempDir, writeStaleLock,
} from '../helpers/A2-restart-fixture.js';
import {
  archivedLineContaining, lineArchived, lineList, ready, requireControl, requireLine, runMaintenance,
} from '../helpers/S2C-K-scenario-support.js';
import { PAUSE_ON_SECOND_REPLY } from '../helpers/S2C-K2-scenario-support.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { ArchiveLineInput } from '../../src/business/workflow/session-archive.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { WorkLineListV1 } from '../../src/contracts/work-line.js';
import type { GraphWrite } from '../../src/core/work-graph/model/session-contracts.js';

afterEach(cleanupScenarios);

/** The `sessions/archive-line` (drop) body for one Task of a Session. */
function archiveDropBody(session: SessionRecord, taskId: string,
  requestId: string, confirmUnknownStopped = false): GraphWrite<ArchiveLineInput> {
  return {
    input: { sessionRef: { projectId: session.ref.projectId, sessionId: session.ref.sessionId }, reason: `2C-34: archive ${requestId}`,
      tasks: [{ target: { kind: 'task', ref: { projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal', taskId } },
        disposition: { kind: 'drop' } }], wait: null, confirmUnknownStopped },
    meta: { requestId, expected: [{ ref: session.ref, revision: session.revision }] },
  };
}

it('2C-34 (1) an outcome-unknown Work line lists attest_unknown on executions/resolve-unknown and the submission is accepted', async () => {
  let h: HostScenario | undefined;
  h = await openHostScenario({ script: { replies: [
    { kind: 'calls', calls: [{ callId: 's2c34a-g1', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: '2C-34: the missing-Kernel Turn is never answered' },
  ] } });
  const held = h.holdReply(1);
  const toStart = await h.advance(h.select('s2c34a-run1', 'ag2b-work'), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  void h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  const head = (await readExecution(h.host, runRef)).session.ref.sessionId;

  await moveKernelAside(h.database);
  await h.restart({ crash: true });
  const row = requireLine(ready(await lineList(h), 'lines/list after the unknown reconcile'), head, 'the unknown Work line');
  expect(row.status.own).toBe('retired');
  expect(row.status.attention?.code).toBe('unknown');

  const attest = requireControl(row, 'attest_unknown', 'the Work attest_unknown control');
  expect(attest).toMatchObject({ availability: 'available', route: 'executions/resolve-unknown', target: { runRef } });
  const run = (await readExecution(h.host, runRef)).run;
  const committed = await h.post<WriteResult<unknown>>('executions/resolve-unknown', graphWrite(AG2B_SCOPE,
    { runRef, reason: '2C-34: checked by hand' }, 's2c34a-attest', [{ ref: runRef, revision: run.revision }]));
  expect(committed).toMatchObject({ status: 'committed' });
}, 240_000);

it('2C-34 (2) an outcome-unknown Query line lists attest_unknown on queries/resolve-unknown and the submission is accepted', async () => {
  // The HostScenario script has no hook for a Query model call (only Work `duringReply`), so the
  // Query mid-Turn crash uses the raw KE3 fixture (the same `startAG2bHost` harness.ts builds on).
  const root = await tempDir('s2c34b-ws-');
  const database = await tempDir('s2c34b-db-');
  const publicDir = await publicDirectory();
  const reached = deferred();
  const hold = deferred();
  const first = await startAG2bHost(publicDir, { root, database, queryReplies: [{ kind: 'text', text: '2C-34: never answered' }],
    queryBeforeReply: async () => { reached.resolve(); await hold.promise; } });
  let inFlight: Promise<unknown> = Promise.resolve();
  let session: Awaited<ReturnType<typeof createAG2bSession>> | undefined;
  let refs: Awaited<ReturnType<typeof claimBusyQuery>> | undefined;
  try {
    await seedAG2bWorkGraph(first);
    session = await createAG2bSession(first, 's2c34b-session');
    refs = await claimBusyQuery(first, session, 's2c34b');
    inFlight = startBusyQuery(first, refs, 's2c34b').catch(() => undefined);
    await reached.promise;
    await writeStaleLock(database);
    await moveKernelAside(database);
  } catch (error) {
    hold.reject(new Error('2C-34 (2) setup failed'));
    await inFlight;
    await first.host.close();
    throw error;
  }
  const second = await startAG2bHost(publicDir, { root, database });
  try {
    if (session === undefined || refs === undefined) throw new Error('the Query setup must have run');
    const list = ready(await post<ReadResult<WorkLineListV1>>(second, 'lines/list', plain(AG2B_SCOPE, { workspace: AG2B_SCOPE })),
      'lines/list after the unknown Query reconcile');
    const row = requireLine(list, session.sessionRef.sessionId, 'the unknown Query line');
    // T1 precedes T2: a retired Session with an unknown holder keeps own `retired` and attention `unknown`.
    expect(row.status.own).toBe('retired');
    expect(row.status.attention?.code).toBe('unknown');
    expect(row.status.attention?.reason.code).toBe('unknown_query');
    const attest = requireControl(row, 'attest_unknown', 'the Query attest_unknown control');
    expect(attest).toMatchObject({ availability: 'available', route: 'queries/resolve-unknown', target: { queryRunRef: refs.queryRunRef } });
    const query = await readQuery(second, refs.queryJobRef);
    const committed = await post<WriteResult<unknown>>(second, 'queries/resolve-unknown', graphWrite(AG2B_SCOPE,
      { queryRunRef: refs.queryRunRef, reason: '2C-34: the consultation was answered by hand' }, 's2c34b-attest',
      [{ ref: refs.queryRunRef, revision: query.run.revision }]));
    expect(committed).toMatchObject({ status: 'committed' });
  } finally {
    await second.host.close();
    hold.reject(new Error('2C-34 (2) cleanup'));
    await inFlight;
    await first.host.close().catch(() => undefined);
  }
}, 240_000);

it('2C-34 (3) a standby paused-interrupted line lists archive on sessions/archive-line and the submission is accepted', async () => {
  let h: HostScenario | undefined;
  h = await openHostScenario({ script: { replies: PAUSE_ON_SECOND_REPLY, duringReply: async (index) => {
    if (index !== 1 || h === undefined) return;
    const runRef = (await h.taskRow()).execution;
    if (runRef === null) throw new Error('the work Run must be selected');
    await submitControl(h.host, runRef, 'pause', '2C-34: the person pauses the Run', 's2c34c-pause');
  } } });
  await h.advance(h.select('s2c34c-run1', 'ag2b-work'));
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  await h.restart({ crash: true });
  const session = (await readExecution(h.host, runRef)).session;

  const row = requireLine(ready(await lineList(h), 'lines/list'), session.ref.sessionId, 'the RUN-24 line');
  expect(row.status.bucket).toBe('standby');
  const archive = requireControl(row, 'archive', 'the standby archive control');
  expect(archive).toMatchObject({ availability: 'available', route: 'sessions/archive-line' });
  const started = await h.answer('sessions/archive-line',
    { scope: AG2B_SCOPE, request: archiveDropBody(session, 'ag2b-work', 's2c34c-archive') });
  expect(started).toMatchObject({ status: 'ready' });
}, 240_000);

it('2C-34 (4) an archived retired line refuses reactivate with reactivate_refused_retired and its ask is not_yet', async () => {
  let h: HostScenario | undefined;
  h = await openHostScenario({ script: { replies: [
    { kind: 'calls', calls: [{ callId: 's2c34d-g1', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: '2C-34: the missing-Kernel Turn is never answered' },
  ] } });
  const held = h.holdReply(1);
  const toStart = await h.advance(h.select('s2c34d-run1', 'ag2b-work'), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  void h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  const head = (await readExecution(h.host, runRef)).session.ref.sessionId;
  await moveKernelAside(h.database);
  await h.restart({ crash: true });

  // The retired line is archived by hand (drop), then read from the archived page.
  const session = (await readExecution(h.host, runRef)).session;
  const started = await h.answer('sessions/archive-line',
    { scope: AG2B_SCOPE, request: archiveDropBody(session, 'ag2b-work', 's2c34d-archive', true) });
  expect(started).toMatchObject({ status: 'ready' });
  await h.advance(h.select('s2c34d-advance'), { maxSteps: 16 }).catch(() => undefined);
  await runMaintenance(h, 's2c34d-maint');

  const page = ready(await lineArchived(h), 'lines/archived');
  const archived = archivedLineContaining(page, head);
  expect(archived, 'the retired line archives').toBeDefined();
  expect(archived?.status.archivedTag).toBe('retired');
  const reactivate = requireControl(archived!, 'reactivate', 'the archived retired reactivate control');
  expect(reactivate).toMatchObject({ availability: 'unavailable', reasonCode: 'reactivate_refused_retired' });
  const ask = requireControl(archived!, 'ask', 'the archived retired ask control');
  expect(ask).toMatchObject({ availability: 'not_yet', reasonCode: 'not_yet' });
}, 240_000);
