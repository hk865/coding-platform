/**
 * Slice 2C row 2C-05 (LE4): the archived-line labels, cases (1), (3), (3'),
 * (4) and (5).
 *
 * IMPORTANT — this file MUST NOT be run in the normal DSH sandbox. Every case
 * completes its Tasks through the REAL registered check process: the harness
 * registers the `ag2b-static` check (`check: 'pass'`) and the Workflow's
 * `open_checks` / `run_check` perform steps start the real Kernel
 * `ProcessSandbox`. That needs bubblewrap (bwrap), which is not available here,
 * so the check ends `unsupported` / `sandbox_unavailable` and the Task never
 * reaches `satisfied`. The lead runs this file under bwrap. Do NOT "fix" a
 * failure by replacing the real check with a hand-built Host observation — the
 * LE3 route does that (`tests/helpers/S2C-L-check-support.ts`) and cannot reach
 * an archived "done" line, which is exactly what these cases pin.
 *
 * Entry LE4: `openHostScenario`, the real registered check, `lines/list`,
 * `lines/archived`, `sessions/archive-line`, `sessions/reactivate`. Expected
 * values are the literal §3.6 A2/A3, L22 and the L1a truth table.
 */
import { afterEach, expect, it } from 'vitest';
import { cleanupScenarios, openHostScenario, performs, type HostScenario } from './harness.js';
import {
  AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_ROLE, graphWrite, listSessions, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution } from '../helpers/A2-restart-fixture.js';
import {
  archivedLineContaining, lineArchived, ready, requireControl, runMaintenance,
} from '../helpers/S2C-K-scenario-support.js';
import { NO_REDRIVE } from './support/common.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { SessionRef, SessionWorkLinkRef, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { ArchiveLineInput, ArchiveLineResultV1 } from '../../src/business/workflow/session-archive.js';
import type { GraphWrite } from '../../src/core/work-graph/model/session-contracts.js';

afterEach(cleanupScenarios);

/** The one Task triple of the seeded AG2b Goal. */
function taskRef(taskId: string): { projectId: string; goalId: string; taskId: string } {
  return { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId };
}

/**
 * Completes one seeded Task through the REAL registered check: `h.advance`
 * drives claim → start → `open_checks` → `run_check` (the real process) →
 * finalize → complete. Returns the Session that ran it.
 */
async function completeTask(h: HostScenario, flowId: string, taskId: string): Promise<RunRef> {
  await h.advance(h.select(flowId, taskId));
  const row = await h.taskRow(taskId);
  expect(row.effectivePhase, `Task ${taskId} must be satisfied through the real check`).toBe('satisfied');
  const runRef = row.execution;
  if (runRef === null) throw new Error(`Task ${taskId} must keep its Run`);
  return runRef;
}

/** The `sessions/archive-line` (drop) body for one Task of a Session. */
function dropBody(session: SessionRef & { revision: number }, taskId: string, requestId: string): GraphWrite<ArchiveLineInput> {
  return {
    input: { sessionRef: { projectId: session.projectId, sessionId: session.sessionId },
      reason: `2C-05: archive ${requestId}`,
      tasks: [{ target: { kind: 'task', ref: taskRef(taskId) }, disposition: { kind: 'drop' } }], wait: null },
    meta: { requestId, expected: [{ ref: { aggregateType: 'Session', projectId: session.projectId,
      sessionId: session.sessionId }, revision: session.revision }] },
  };
}

/** The Session card of a Run, with its current revision (for archive pins). */
async function sessionOf(h: HostScenario, runRef: RunRef): Promise<SessionRef & { revision: number }> {
  const session = (await readExecution(h.host, runRef)).session;
  return { projectId: session.ref.projectId, sessionId: session.ref.sessionId, revision: session.revision };
}

/** The Session's CURRENT revision through the public read (the archive pin after any link write). */
async function currentSession(h: HostScenario, ref: SessionRef): Promise<SessionRef & { revision: number }> {
  const card = ready(await h.post<ReadResult<{ record: { ref: SessionRef; revision: number } }>>('sessions/read',
    plain(AG2B_SCOPE, ref)), `sessions/read ${ref.sessionId}`);
  return { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId, revision: card.record.revision };
}

type CardLink = { ref: SessionWorkLinkRef; revision: number; since: string; until: string | null };
type CardLike = { record: { ref: { aggregateType: 'Session'; projectId: string; sessionId: string }; revision: number;
  lifecycle: string }; links: CardLink[] };

/** The public Session card. */
async function sessionCard(h: HostScenario, ref: SessionRef): Promise<CardLike> {
  return ready(await h.post<ReadResult<CardLike>>('sessions/read', plain(AG2B_SCOPE, ref)), `sessions/read ${ref.sessionId}`);
}

/** The card's `responsible` link record to one Task, open or closed. */
function responsibleLinkOf(card: CardLike, taskId: string): CardLink | undefined {
  return card.links.find(link => link.ref.relation === 'responsible' && link.ref.target.kind === 'task'
    && link.ref.target.ref.taskId === taskId);
}

/** The Task id named by an archive receipt's subject key (the canonical link target). */
function taskIdOfKey(subjectKey: string): string | null {
  return /"taskId":"([^"]+)"/.exec(subjectKey)?.[1] ?? null;
}

it('2C-05 (1) a finished executor line past the threshold is archived by maintenance as archived·done (DE2) with reactivate available', async () => {
  const h = await openHostScenario({ automation: NO_REDRIVE, check: 'pass',
    script: { replies: [{ kind: 'text', text: '2C-05 (1): the Task completes through the registered check' }] } });
  const runRef = await completeTask(h, 's2c05c1', 'ag2b-work');
  const session = await sessionOf(h, runRef);

  // The direct root's clock is 2026-10-06, eight days after the Host's
  // 2026-09-28, so the executor line is past the one-day archive threshold. One
  // pass closes the terminal responsibility, the next archives.
  await runMaintenance(h, 's2c05c1-1');
  await runMaintenance(h, 's2c05c1-2');

  const page = ready(await lineArchived(h), 'lines/archived after the maintenance');
  const archived = archivedLineContaining(page, session.sessionId);
  expect(archived, 'the finished executor line is archived').toBeDefined();
  expect(archived?.status.archivedTag).toBe('done');
  expect(archived?.status.own).toBe('done');
  expect(archived?.status.bucket).toBe('archived');
  expect(archived?.status.doneEvidence).toBe('complete');
  expect(requireControl(archived!, 'reactivate', 'the archived done reactivate control').availability).toBe('available');
}, 240_000);

it('2C-05 (3) dropping an unfinished X while the same archive closes an already-terminal Y reads only "archived" (DE3), not done', async () => {
  const h = await openHostScenario({ automation: NO_REDRIVE, check: 'pass',
    workIds: ['ag2b-work', 'ag2b-work-2'],
    script: { replies: [
      { kind: 'text', text: '2C-05 (3): Y completes through the registered check' },
      { kind: 'calls', calls: [{ callId: 's2c05c3-x1', name: 'read', args: { path: 'src/module.ts' } }] },
      { kind: 'text', text: '2C-05 (3): X is never answered' },
    ] } });
  // Y is completed first on S. The advance that completes it also runs a maintenance page (`advanceWork` runs one
  // after each committed perform step), which closes Y's responsibility as `terminal` at once; it is reopened below.
  const yRun = await completeTask(h, 's2c05c3-y', 'ag2b-work-2');
  const s = await sessionOf(h, yRun);
  const sKey = { projectId: s.projectId, sessionId: s.sessionId };

  // X is started and held unfinished; its responsibility is transferred to S so
  // one line owns both X (unfinished) and Y (terminal).
  const held = h.holdReply(1);
  const toStart = await h.advance(h.select('s2c05c3-x', 'ag2b-work'), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('X must reach the start');
  const xAdvance = h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const xRun = (await h.taskRow('ag2b-work')).execution;
  if (xRun === null) throw new Error('X must run');
  const xSession = (await readExecution(h.host, xRun)).session;
  await held.fail('2C-05 (3): the drop stops X');
  // X's Run ends inside the background advance (it releases the Session): wait for it, so the X card, the S card
  // and the archive pin below are read after the last write of that advance.
  await xAdvance;
  const xCard = ready(await h.post<ReadResult<{ record: { ref: unknown; revision: number };
    links: { ref: { target: WorkLinkTarget; relation: string }; revision: number; until: unknown }[] }>>(
    'sessions/read', plain(AG2B_SCOPE, { projectId: xSession.ref.projectId, sessionId: xSession.ref.sessionId })),
  'sessions/read of X');

  const xLink = xCard.links.find(link => link.ref.relation === 'responsible'
    && link.ref.target.kind === 'task' && link.ref.target.ref.taskId === 'ag2b-work');
  if (xLink === undefined) throw new Error('X must hold its responsible link');
  // Item 10 makes X's own claim open the link on the Session the Workflow
  // reused; when that already is S, X and Y are on one line and the transfer is
  // a no-op the service refuses (same source and destination). Only a different
  // X Session still needs the E16 transfer.
  if (xSession.ref.sessionId !== s.sessionId) {
    const yCard = (await listSessions(h.host)).find(card => card.record.ref.sessionId === s.sessionId);
    if (yCard === undefined) throw new Error('S must be in the Session directory');
    const destination: SessionWorkLinkRef = { ...sKey, aggregateType: 'SessionWorkLink',
      target: xLink.ref.target, relation: 'responsible' };
    const transfer = await h.post<ReadResult<unknown>>('sessions/transfer-responsibility', graphWrite(AG2B_SCOPE,
      { from: { projectId: xSession.ref.projectId, sessionId: xSession.ref.sessionId },
        to: sKey, target: xLink.ref.target }, 's2c05c3-transfer', [
        { ref: xCard.record.ref, revision: xCard.record.revision },
        { ref: yCard.record.ref, revision: yCard.record.revision },
        { ref: xLink.ref, revision: xLink.revision },
        { ref: destination, revision: 0 },
      ]));
    expect(transfer, JSON.stringify(transfer)).toMatchObject({ status: 'committed' });
  }

  // S must hold the unfinished X AND the already-satisfied Y when the archive runs, but every Workflow advance closes
  // a terminal link at once. So Y's link is reopened through the public `sessions/link` route, with nothing between
  // that and the archive request.
  const yTarget: WorkLinkTarget = { kind: 'task', ref: taskRef('ag2b-work-2') };
  const beforeRelink = await sessionCard(h, sKey);
  const yClosed = responsibleLinkOf(beforeRelink, 'ag2b-work-2');
  if (yClosed === undefined) throw new Error('S must keep its link record to Y');
  expect(yClosed.until, "the maintenance page already closed Y's link").not.toBeNull();
  const relinked = await h.answer('sessions/link', graphWrite(AG2B_SCOPE,
    { sessionRef: sKey, target: yTarget, relation: 'responsible', active: true }, 's2c05c3-relink-y',
    [{ ref: beforeRelink.record.ref, revision: beforeRelink.record.revision }, { ref: yClosed.ref, revision: yClosed.revision }]));
  expect(relinked.status, JSON.stringify(relinked)).toBe('committed');

  // Before the archive: both links are open on S, Y is satisfied and X is not.
  const beforeArchive = await sessionCard(h, sKey);
  expect(responsibleLinkOf(beforeArchive, 'ag2b-work')?.until, 'X is open on S').toBeNull();
  expect(responsibleLinkOf(beforeArchive, 'ag2b-work-2')?.until, 'Y is open on S').toBeNull();
  expect((await h.taskRow('ag2b-work-2')).effectivePhase).toBe('satisfied');
  expect((await h.taskRow('ag2b-work')).effectivePhase).toBe('failed');

  // ONE archive request selects only X (drop). The combination disposes X first (its close carries `archiveStep`),
  // then closes the unselected, already-satisfied Y as `terminal` (session-archive.ts step 6 and E12).
  const answered = await h.post<ReadResult<ArchiveLineResultV1>>('sessions/archive-line', { scope: AG2B_SCOPE,
    request: dropBody({ ...sKey, revision: beforeArchive.record.revision }, 'ag2b-work', 's2c05c3-archive') });
  const result = ready(answered, 'sessions/archive-line of S');
  expect(result.state).toBe('archived');
  const closes = result.receipts.filter(receipt => receipt.step === 'responsibility');
  expect(closes.map(receipt => taskIdOfKey(receipt.subjectKey)), 'X is disposed first, then Y is closed')
    .toEqual(['ag2b-work', 'ag2b-work-2']);
  const afterArchive = await sessionCard(h, sKey);
  expect(afterArchive.record.lifecycle).toBe('archived');
  expect(responsibleLinkOf(afterArchive, 'ag2b-work')?.until, "X's close is the archive's first link close").toBe(closes[0]!.cursor);
  expect(responsibleLinkOf(afterArchive, 'ag2b-work-2')?.until, "Y's close is the later one").toBe(closes[1]!.cursor);
  await runMaintenance(h, 's2c05c3-maintenance');

  const page = ready(await lineArchived(h), 'lines/archived after the mixed archive');
  const archived = archivedLineContaining(page, s.sessionId);
  expect(archived, 'the line is archived').toBeDefined();
  expect(archived?.status.archivedTag).toBe('plain');
  expect(archived?.status.own).toBe('standby');
  expect(archived?.status.doneEvidence).toBe('complete');
}, 240_000);

it('2C-05 (3\') the 22-Task variant reads only "archived" with doneEvidence incomplete and reason done_unproven (DE5)', async () => {
  const workIds = ['ag2b-work', ...Array.from({ length: 21 }, (_, index) => `ag2b-work-${index + 2}`)];
  const replies = [
    { kind: 'calls' as const, calls: [{ callId: 's2c05cp-x1', name: 'read', args: { path: 'src/module.ts' } }] },
    ...Array.from({ length: 21 }, () => ({ kind: 'text' as const, text: '2C-05 (3p): a terminal Task completes' })),
  ];
  const h = await openHostScenario({ automation: NO_REDRIVE, check: 'pass', workIds, script: { replies } });

  // The Workflow's maintenance page closes a terminal responsibility at the next advance, so 21 terminal links can
  // never still be open when X is dropped. The 22 closures are built in the order DE5 needs instead: X is dropped
  // by an archive first, the line is reactivated, and 21 other Tasks complete on it (each link closed `terminal`);
  // maintenance then archives the finished line again. The newest 21 closures are `terminal`, X's `archiveStep`
  // is the 22nd, and the total exceeds 21.
  const held = h.holdReply(0);
  const toStart = await h.advance(h.select('s2c05cp-x', 'ag2b-work'), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('X must reach the start');
  const xAdvance = h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const xRun = (await h.taskRow('ag2b-work')).execution;
  if (xRun === null) throw new Error('X must run');
  const s = await sessionOf(h, xRun);
  const sKey = { projectId: s.projectId, sessionId: s.sessionId };
  const dropStarted = await h.post<ReadResult<ArchiveLineResultV1>>('sessions/archive-line', { scope: AG2B_SCOPE,
    request: dropBody(s, 'ag2b-work', 's2c05cp-archive') });
  expect(dropStarted, JSON.stringify(dropStarted)).toMatchObject({ status: 'ready' });
  await held.fail('2C-05 (3p): the drop stops X');
  await xAdvance;
  await runMaintenance(h, 's2c05cp-drop-maint');
  const beforeReactivate = await currentSession(h, sKey);
  const reactivated = await h.answer('sessions/reactivate', graphWrite(AG2B_SCOPE,
    { sessionRef: sKey, reason: '2C-05 (3p): reactivate the line' }, 's2c05cp-reactivate',
    [{ ref: { aggregateType: 'Session', projectId: s.projectId, sessionId: s.sessionId }, revision: beforeReactivate.revision }]));
  expect(reactivated, JSON.stringify(reactivated)).toMatchObject({ status: 'committed' });
  for (let index = 0; index < 21; index += 1) {
    const taskId = workIds[index + 1]!;
    await h.advance({ ...h.select(`s2c05cp-t${index}`, taskId), sessionHint: sKey });
    const row = await h.taskRow(taskId);
    expect(row.effectivePhase, `Task ${taskId} must be satisfied through the real check`).toBe('satisfied');
    if (row.execution === null) throw new Error(`Task ${taskId} must keep its Run`);
    expect((await sessionOf(h, row.execution)).sessionId, `Task ${taskId} runs on the reactivated line`).toBe(s.sessionId);
  }
  await runMaintenance(h, 's2c05cp-again-1');
  await runMaintenance(h, 's2c05cp-again-2');

  const page = ready(await lineArchived(h), 'lines/archived after the 22-Task archive');
  const archived = archivedLineContaining(page, s.sessionId);
  expect(archived, 'the line is archived').toBeDefined();
  expect(archived?.status.archivedTag).toBe('plain');
  expect(archived?.status.own).toBe('standby');
  expect(archived?.status.doneEvidence).toBe('incomplete');
  expect(archived?.status.ownReason.code).toBe('done_unproven');
}, 480_000);

it('2C-05 (4) archive(drop) → reactivate → complete and close a Task → archive again still reads only "archived" (the known mislabel)', async () => {
  const h = await openHostScenario({ automation: NO_REDRIVE, check: 'pass', workIds: ['ag2b-work', 'ag2b-work-2'],
    script: { replies: [
      { kind: 'text', text: '2C-05 (4): the first Task is dropped' },
      { kind: 'text', text: '2C-05 (4): the second Task completes' },
    ] } });

  // Drop the first run of the seeded Task, archive the line, then reactivate it.
  // The first (and only, before the drop) Run asks for work reply 0; holding
  // reply 1 would wait forever (indexes are global and start at 0).
  const held = h.holdReply(0);
  const toStart = await h.advance(h.select('s2c05c4-drop', 'ag2b-work'), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Task must reach the start');
  const firstAdvance = h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const firstRun = (await h.taskRow('ag2b-work')).execution;
  if (firstRun === null) throw new Error('the first Run must exist');
  const session = await sessionOf(h, firstRun);
  // Record the archive request while the Turn is still held (the sibling case
  // (2) order), THEN stop the Turn: the pending stop is what the archive flow
  // follows. Failing the held call first leaves the Session occupied by a Run
  // the archive no longer drives, so the line never reaches "archived".
  const dropStarted = await h.post<ReadResult<ArchiveLineResultV1>>('sessions/archive-line', { scope: AG2B_SCOPE,
    request: dropBody(session, 'ag2b-work', 's2c05c4-drop-archive') });
  expect(dropStarted, JSON.stringify(dropStarted)).toMatchObject({ status: 'ready' });
  await held.fail('2C-05 (4): the drop stops the first Run');
  await firstAdvance;
  // The maintenance page continues the registered archive; no goal-level advance here, which would re-dispatch the
  // dropped Task (decision 43) to another line and complete it there.
  await runMaintenance(h, 's2c05c4-drop-maint');

  const pageAfterDrop = ready(await lineArchived(h), 'lines/archived after the drop');
  const dropped = archivedLineContaining(pageAfterDrop, session.sessionId);
  expect(dropped, 'the dropped line is archived').toBeDefined();
  const sessionKey = { projectId: session.projectId, sessionId: session.sessionId };
  const beforeReactivate = await currentSession(h, sessionKey);
  const reactivated = await h.answer('sessions/reactivate', graphWrite(AG2B_SCOPE,
    { sessionRef: sessionKey, reason: '2C-05 (4): reactivate the dropped line' }, 's2c05c4-reactivate',
    [{ ref: { aggregateType: 'Session', projectId: session.projectId, sessionId: session.sessionId }, revision: beforeReactivate.revision }]));
  expect(reactivated, JSON.stringify(reactivated)).toMatchObject({ status: 'committed' });

  // Complete the Task on the reactivated line and close it as terminal, then
  // archive again: the old `archiveStep` closure is still read, so DE3 holds and
  // the line is only "archived" (the documented mislabel).
  // ANOTHER Task, on the reactivated line (a (line, Task) responsible link is one record: completing the dropped Task
  // here would re-close that record as `terminal`, and the line would rightly read DE2 "done").
  await h.advance({ ...h.select('s2c05c4-complete', 'ag2b-work-2'), sessionHint: sessionKey });
  const second = await h.taskRow('ag2b-work-2');
  expect(second.effectivePhase, 'the second Task is satisfied through the real check').toBe('satisfied');
  if (second.execution === null) throw new Error('the second Task must keep its Run');
  const sessionAgain = await sessionOf(h, second.execution);
  expect(sessionAgain.sessionId, 'the reactivated line runs the second Task').toBe(session.sessionId);
  // Item 10: that claim opened the line's link to the second Task; it is closed as terminal, and the direct root's
  // clock is eight days later (as in (1)), so maintenance archives the finished executor line again.
  await runMaintenance(h, 's2c05c4-again-1');
  await runMaintenance(h, 's2c05c4-again-2');

  const page = ready(await lineArchived(h), 'lines/archived after the second archive');
  const archived = archivedLineContaining(page, sessionAgain.sessionId);
  expect(archived, 'the re-archived line is archived').toBeDefined();
  expect(archived?.status.archivedTag).toBe('plain');
  expect(archived?.status.own).toBe('standby');
  // DE3: every closed link was read (2 <= 21, none unknown); the drop's `archiveStep` close is among them.
  expect(archived?.status.doneEvidence).toBe('complete');
  // AT4: the drop's anchor on this line is not picked up yet; the dropped Task waits for dispatch (decision 43).
  expect(archived?.status.attention).toMatchObject({ code: 'unknown', reason: { code: 'anomaly_pending', params: { next: 'dispatch' } } });
}, 240_000);

it('2C-05 (5) a handoff predecessor is archived and writes the handed_to reason', async () => {
  const h = await openHostScenario({ automation: NO_REDRIVE, check: 'pass',
    script: { replies: [{ kind: 'text', text: '2C-05 (5): the predecessor Turn completes' }] } });
  // A live predecessor P that stopped with its Task unfinished (A1 would label a retired P "retired"), a handoff
  // successor created through `sessions/create`, and P archived handing its Task to the successor (DESIGN §1.1:
  // the original line stops writing, then hands over and is archived).
  // P's first work reply is global index 0; `holdReply(1)` waited forever.
  const held = h.holdReply(0);
  const toStart = await h.advance(h.select('s2c05c5-p', 'ag2b-work'), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('P must reach the start');
  const pAdvance = h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const pRun = (await h.taskRow('ag2b-work')).execution;
  if (pRun === null) throw new Error('P must run');
  const pSession = (await readExecution(h.host, pRun)).session;
  const pRef: SessionRef = { projectId: pSession.ref.projectId, sessionId: pSession.ref.sessionId };
  await held.fail('2C-05 (5): P stops before the handoff');
  await pAdvance;

  const created = await h.post<{ status: string; value: { ref: { projectId: string; sessionId: string } } }>(
    'sessions/create', plain(AG2B_SCOPE, {
      workspace: AG2B_SCOPE, role: AG2B_WORK_ROLE, recommendedRefs: [], initialLinks: [],
      provenance: { schemaVersion: 1, kind: 'handoff', from: pRef },
      meta: { requestId: 's2c05c5-handoff', expected: [] },
    }));
  expect(created.status, JSON.stringify(created)).toBe('completed');
  const successor: SessionRef = { projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId };

  const pNow = await currentSession(h, pRef);
  const started = await h.post<ReadResult<ArchiveLineResultV1>>('sessions/archive-line', { scope: AG2B_SCOPE, request: {
    input: { sessionRef: pRef, reason: '2C-05 (5): handoff', wait: null,
      tasks: [{ target: { kind: 'task', ref: taskRef('ag2b-work') }, disposition: { kind: 'transfer', to: successor } }] },
    meta: { requestId: 's2c05c5-archive', expected: [{ ref: { aggregateType: 'Session', projectId: pRef.projectId,
      sessionId: pRef.sessionId }, revision: pNow.revision }] } } });
  expect(started, JSON.stringify(started)).toMatchObject({ status: 'ready' });
  await h.advance(h.select('s2c05c5-archive-advance'), { maxSteps: 16 }).catch(() => undefined);
  await runMaintenance(h, 's2c05c5-maintenance');

  const page = ready(await lineArchived(h), 'lines/archived after the handoff');
  const archived = archivedLineContaining(page, pRef.sessionId);
  expect(archived, 'the handoff predecessor is archived').toBeDefined();
  expect(archived?.status.archivedTag).toBe('plain');
  expect(archived?.status.own).toBe('standby');
  expect(archived?.status.ownReason.code).toBe('handed_to');
  // The successor names the predecessor's line; the row's "已交给 <线>" text comes
  // from this handoff edge (LR2's `s2c-session-by-kind-from` lookup).
  expect(successor.sessionId).not.toBe(pRef.sessionId);
}, 240_000);
