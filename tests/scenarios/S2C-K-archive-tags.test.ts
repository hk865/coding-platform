/**
 * Slice 2C row 2C-05 (LE4): the archived-line labels. Case (2) — a person
 * archives a line still holding an unfinished Task with "drop" (the archive
 * step), so the line reads only "archived" (L22/A3), never "done".
 *
 * Entry LE4: the line is archived through the real `sessions/archive-line`
 * route (drop) and read back through `lines/archived`. The done cases (1), (3),
 * (3'), (4) need a completed Task and a real registered check, which this
 * sandbox cannot run (bubblewrap); they are reported, not faked. Case (5)
 * (handoff predecessor) needs a real handoff continuation fixture.
 */
import { afterEach, expect, it } from 'vitest';
import { cleanupScenarios, openHostScenario, performs, type HostScenario } from './harness.js';
import {
  AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_ROLE, createAG2bSession, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution } from '../helpers/A2-restart-fixture.js';
import { lineArchived, ready, runMaintenance } from '../helpers/S2C-K-scenario-support.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { SessionRef, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { ArchiveLineInput, ArchiveLineResultV1 } from '../../src/business/workflow/session-archive.js';
import type { GraphWrite } from '../../src/core/work-graph/model/session-contracts.js';

afterEach(cleanupScenarios);

it('2C-05 (2) archiving a line that still holds an unfinished Task with drop reads only "archived" (A3/DE3), standby and read-only', async () => {
  let h: HostScenario | undefined;
  h = await openHostScenario({ script: { replies: [
    { kind: 'calls', calls: [{ callId: 's2c05-g1', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: 's2c05: the drop stops this Turn' },
  ] } });
  const held = h.holdReply(1);
  const toStart = await h.advance(h.select('s2c05-run1', 'ag2b-work'), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  void h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next)).catch(() => undefined);
  await held.reached;
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Run must be selected');
  const session = (await readExecution(h.host, runRef)).session;
  const head = session.ref.sessionId;

  const request: GraphWrite<ArchiveLineInput> = {
    input: { sessionRef: { projectId: session.ref.projectId, sessionId: head }, reason: '2C-05 (2): drop the unfinished Task',
      tasks: [{ target: { kind: 'task', ref: { projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal', taskId: 'ag2b-work' } },
        disposition: { kind: 'drop' } }], wait: null },
    meta: { requestId: 's2c05-drop', expected: [{ ref: session.ref, revision: session.revision }] },
  };
  const started = await h.post<ReadResult<ArchiveLineResultV1>>('sessions/archive-line', { scope: AG2B_SCOPE, request });
  expect(started).toMatchObject({ status: 'ready' });
  held.fail('2C-05: the drop stops the held Turn');
  await h.advance(h.select('s2c05-advance'), { maxSteps: 8 }).catch(() => undefined);
  await runMaintenance(h, 's2c05-maintenance');

  const page = ready(await lineArchived(h), 'lines/archived');
  const archived = page.rows.find(item => item.key.sessionId === head || item.chainSessions.some(s => s.sessionId === head));
  expect(archived, 'the dropped line is archived').toBeDefined();
  expect(archived?.status.archivedTag).toBe('plain');
  expect(archived?.status.own).toBe('standby');
  expect(archived?.status.bucket).toBe('archived');
  expect(archived?.status.readOnly).toBe(true);
  expect(archived?.status.doneEvidence).toBe('complete');
}, 240_000);

/**
 * The public `sessions/read` card shape this case reads: the record's revision
 * and every work link with its interval. `since` is the claim commit cursor.
 */
type SessionCardRead = {
  record: { ref: { projectId: string; sessionId: string }; revision: number };
  links: { ref: { target: WorkLinkTarget; relation: string }; revision: number; since: CommitCursor; until: CommitCursor | null }[];
};

/**
 * Item 10 (lead ruling, §3.10/SES-15): the claim commit of a REUSED Session
 * opens the claimed Task's `responsible` link when the Session has no open one
 * to it, in the same commit, and a replayed claim opens nothing new.
 *
 * `S` is a fresh idle work Session that already holds one OPEN responsible link
 * (to the other seeded Task) — the durable stand-in for an executor's terminal
 * link that maintenance has not closed yet. The Workflow reuses `S` for
 * `ag2b-work`; the reproduced bug is that the claim left `S` with no link to its
 * running Task, so an archive could not drop it. The real "S finishes Y through
 * the registered check" flow is 2C-05 (3)/(3'), which needs bwrap.
 */
it('2C-10 (LE4) a reused Session gains the claimed Task\'s open responsible link in the claim commit, and replaying the claim opens nothing new', async () => {
  const h: HostScenario = await openHostScenario({ workIds: ['ag2b-work', 'ag2b-work-2'] });
  const yTarget: WorkLinkTarget = { kind: 'task', ref: {
    projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: 'ag2b-work-2' } };
  const created = await createAG2bSession(h.host, 's2c10-s', AG2B_WORK_ROLE,
    [{ target: yTarget, relation: 'responsible' }]);
  const sRef: SessionRef = created.sessionRef;

  // The Workflow's ordinary selection finds S (idle, same role) and builds the
  // claim for X; stop BEFORE the claim perform so the exact request can be
  // performed twice through the real route.
  const selected = await h.advance(h.select('s2c10-select', 'ag2b-work'), { stopBefore: performs('claim_task') });
  const claimPerform = selected.next;
  if (claimPerform === null) throw new Error('X must reach its claim perform');

  const first = await h.advance(claimPerform, { stopBefore: performs('start') });
  const receipt = first.receipts.find(entry => entry.kind === 'claim_task');
  if (receipt === undefined || receipt.result.status !== 'committed') {
    throw new Error(`X must commit its claim: ${JSON.stringify(first.receipts)}`);
  }
  expect(receipt.result.value.sessionRef, 'the Workflow reused S for X').toEqual(sRef);
  const claimCursor = receipt.result.cursor;

  const afterClaim = ready(await h.post<ReadResult<SessionCardRead>>('sessions/read', plain(AG2B_SCOPE, sRef)),
    'sessions/read after the claim');
  const xLinks = afterClaim.links.filter(link => link.ref.relation === 'responsible'
    && link.ref.target.kind === 'task' && link.ref.target.ref.taskId === 'ag2b-work');
  expect(xLinks, 'the reused Session gains exactly one responsible link to X').toHaveLength(1);
  expect(xLinks[0]?.until, 'the new link is open').toBeNull();
  expect(xLinks[0]?.since, 'the link cursor is the claim commit cursor').toBe(claimCursor);
  const yLinks = afterClaim.links.filter(link => link.ref.relation === 'responsible'
    && link.ref.target.kind === 'task' && link.ref.target.ref.taskId === 'ag2b-work-2');
  expect(yLinks, 'the existing open link is kept').toHaveLength(1);
  expect(yLinks[0]?.until).toBeNull();

  // Replaying the exact same claim request writes nothing new: one X link, the
  // same revision and the original `since` cursor.
  await h.advance(claimPerform, { stopBefore: performs('start') });
  const afterReplay = ready(await h.post<ReadResult<SessionCardRead>>('sessions/read', plain(AG2B_SCOPE, sRef)),
    'sessions/read after the replay');
  const replayedLinks = afterReplay.links.filter(link => link.ref.relation === 'responsible'
    && link.ref.target.kind === 'task' && link.ref.target.ref.taskId === 'ag2b-work');
  expect(replayedLinks, 'a replay opens no second link').toHaveLength(1);
  expect(replayedLinks[0]?.revision).toBe(xLinks[0]?.revision);
  expect(replayedLinks[0]?.since).toBe(claimCursor);
}, 240_000);

/**
 * Item 10's other half: a reused Session that ALREADY holds an open responsible
 * link to the claimed Task opens nothing in the claim commit (the E16 transfer
 * destination / a re-claim). The link keeps its revision and its original
 * `since` cursor; only the occupancy revision moves.
 */
it('2C-10 (LE4) a reused Session that already holds an open responsible link to the Task opens nothing new', async () => {
  const h: HostScenario = await openHostScenario({ workIds: ['ag2b-work'] });
  const target: WorkLinkTarget = { kind: 'task', ref: {
    projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: 'ag2b-work' } };
  const created = await createAG2bSession(h.host, 's2c10b-s', AG2B_WORK_ROLE,
    [{ target, relation: 'responsible' }]);
  const sRef: SessionRef = created.sessionRef;
  const linksTo = (card: SessionCardRead) => card.links.filter(link => link.ref.relation === 'responsible'
    && link.ref.target.kind === 'task' && link.ref.target.ref.taskId === 'ag2b-work');
  const before = linksTo(ready(await h.post<ReadResult<SessionCardRead>>('sessions/read', plain(AG2B_SCOPE, sRef)),
    'sessions/read before the claim'));
  expect(before, 'the initial link is open').toHaveLength(1);
  expect(before[0]?.until).toBeNull();

  const selected = await h.advance(h.select('s2c10b-select', 'ag2b-work'), { stopBefore: performs('claim_task') });
  const claimPerform = selected.next;
  if (claimPerform === null) throw new Error('X must reach its claim perform');
  const first = await h.advance(claimPerform, { stopBefore: performs('start') });
  const receipt = first.receipts.find(entry => entry.kind === 'claim_task');
  if (receipt === undefined || receipt.result.status !== 'committed') {
    throw new Error(`X must commit its claim: ${JSON.stringify(first.receipts)}`);
  }
  expect(receipt.result.value.sessionRef, 'the Workflow reused S for X').toEqual(sRef);

  const after = linksTo(ready(await h.post<ReadResult<SessionCardRead>>('sessions/read', plain(AG2B_SCOPE, sRef)),
    'sessions/read after the claim'));
  expect(after, 'the already-open link is not reopened').toHaveLength(1);
  expect(after[0]?.revision).toBe(before[0]?.revision);
  expect(after[0]?.since).toBe(before[0]?.since);
  expect(after[0]?.until).toBeNull();
}, 240_000);
