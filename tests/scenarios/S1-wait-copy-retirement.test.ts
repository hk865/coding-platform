/** IT20: three independent lines, all driven through owner/Runtime entries. */
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { SessionRef, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { ArchiveLineInput } from '../../src/business/workflow/session-archive.js';
import type { GraphWrite, SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import { deriveSessionInputId, type SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import {
  AG2B_GOAL_REF, AG2B_QUERY_ROLE, AG2B_SCOPE, AG2B_WORK_ROLE, AG2B_WORK_TASK_ID,
  createAG2bSession, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { installS1ScenarioClock, ready, retireS1Session } from '../helpers/S1-runtime-scenario-fixture.js';
import { waitReplyDeliveryText } from '../helpers/S7B-delivery-samples.js';
import {
  assertInvariants, cleanupScenarios, hostCtx, openHostScenario, performs, type HostScenario, type ScenarioCommit,
} from './harness.js';
import { acceptedMessageInputs, consult } from './support/brief.js';
import { NO_REDRIVE, execution, selectedRun, stepOf, WORK_TARGET } from './support/common.js';
import { invariantStoreOf, readInvariantWorld } from '../state/invariants.js';

let restoreClock: (() => void) | undefined;
beforeEach(() => { restoreClock = installS1ScenarioClock(); });
afterEach(async () => { try { await cleanupScenarios(); } finally { restoreClock?.(); } });

const QUESTION = 'IT20: which file should the interrupted work write?';
const REPLY = 'IT20 reply: write src/ag2b-result.txt with the result text.';
const SECOND_TASK_ID = 'it20-second';
const SECOND_TARGET: WorkLinkTarget = { kind: 'task', ref: { projectId: AG2B_SCOPE.projectId,
  goalId: AG2B_GOAL_REF.goalId, taskId: SECOND_TASK_ID } };
type WaitLine = { runRef: RunRef; messageRef: SessionMessageRef; sessionRef: SessionRef; member: SessionRef };
const checked = (h: HostScenario, label: string) => assertInvariants(h, label, stepOf(h, 'other', label));
const card = async (h: HostScenario, session: SessionRef) =>
  ready(await h.post<ReadResult<SessionCard>>('sessions/read', plain(AG2B_SCOPE, session)));
const message = async (h: HostScenario, ref: SessionMessageRef) =>
  ready(await h.post<ReadResult<SessionMessage>>('messages/read', plain(AG2B_SCOPE, ref)));

async function yieldWait(h: HostScenario, label: string, taskId: string, target: WorkLinkTarget,
  send: { callId: string; name: string; args: Record<string, unknown> }, source?: SessionRef): Promise<WaitLine> {
  const member = (await createAG2bSession(h.host, `${label}-member`, AG2B_QUERY_ROLE,
    [{ target, relation: 'participates' }])).sessionRef;
  await checked(h, `${label}: create recipient`);
  send.args['recipient'] = member;
  const yielded = await h.advance({ ...h.select(`${label}-yield`, taskId), sessionHint: source ?? null });
  expect(yielded.state).toBe('waiting');
  const runRef = await selectedRun(h, taskId);
  const record = await execution(h, runRef);
  expect(record.run).toMatchObject({ status: 'ended', outcome: 'yielded', continuation: { kind: 'wait_reply' } });
  const messageRef = record.run.continuation?.messageRef;
  if (messageRef === undefined) throw new Error('the real yielded Run must name its wait message');
  return { runRef, messageRef, sessionRef: { projectId: record.session.ref.projectId, sessionId: record.session.ref.sessionId }, member };
}

async function sourceExecutions(h: HostScenario, session: SessionRef) {
  const world = await readInvariantWorld(invariantStoreOf(h.database), AG2B_SCOPE.projectId);
  return { work: world.outboxes.filter(o => o.claim.sessionRef.sessionId === session.sessionId).map(o => o.claim.runRef),
    query: world.queryRuns.filter(q => q.run.executionState?.sessionRef.sessionId === session.sessionId).map(q => q.ref) };
}

it('IT20 (wait transfer, answered copy, retired reply): the original question is unchanged and consumed once; the answered copy is archived; a different retired line with no continuation shows exactly one undelivered reply source and is never auto-forwarded; reads and refreshes add no model call', async () => {
  const commits: ScenarioCommit[] = [];
  const sendLine1 = { callId: 'it20-line1-send', name: 'send_session_message',
    args: { recipient: {}, text: QUESTION, intent: 'inquiry', needsReply: true, waitAfterSend: true } as Record<string, unknown> };
  const sendLine3 = { callId: 'it20-line3-send', name: 'send_session_message',
    args: { recipient: {}, text: QUESTION, intent: 'inquiry', needsReply: true, waitAfterSend: true } as Record<string, unknown> };
  const h = await openHostScenario({ automation: NO_REDRIVE, check: 'pass',
    workIds: [AG2B_WORK_TASK_ID, SECOND_TASK_ID], script: {
      replies: [{ kind: 'calls', calls: [sendLine1] }, { kind: 'text', text: 'D used the transferred reply' },
        { kind: 'calls', calls: [sendLine3] }],
      queryReplies: Array.from({ length: 3 }, () => ({ kind: 'text' as const, text: REPLY })),
    },
    // Refreeze §5: every committed batch with its cursor and events; R and P are
    // the two commits named below, taken from this log, not from record fields.
    commitObserver: batch => { commits.push(batch); } });
  const platform = await h.direct();

  // Line 1: E answers; D is a DIFFERENT, Work-capable handler and successor.
  const line1 = await yieldWait(h, 'it20-line1', AG2B_WORK_TASK_ID, WORK_TARGET, sendLine1);
  const original = await message(h, line1.messageRef);
  expect(original.status).toBe('pending');
  expect({ intent: original.intent, needsReply: original.needsReply, waitAfterSend: original.waitAfterSend })
    .toEqual({ intent: 'inquiry', needsReply: true, waitAfterSend: true });
  expect(original.sender).toMatchObject({ kind: 'work_run', sessionRef: line1.sessionRef });
  expect(original.recipient).toEqual(line1.member);
  const D = (await createAG2bSession(h.host, 'it20-handler', AG2B_WORK_ROLE)).sessionRef;
  await checked(h, 'it20: create D');
  expect(D).not.toEqual(line1.member);
  const s = await card(h, line1.sessionRef);
  const archive: GraphWrite<ArchiveLineInput> = { input: { sessionRef: line1.sessionRef,
    reason: 'Transfer responsibility and the wait to D',
    tasks: [{ target: WORK_TARGET, disposition: { kind: 'transfer', to: D } }],
    wait: { kind: 'transfer', runRef: line1.runRef, messageRef: line1.messageRef, to: D } },
    meta: { requestId: 'it20-archive', expected: [{ ref: s.record.ref, revision: s.record.revision }] } };
  const archived = ready(await platform.workflow.archiveLine(hostCtx(), archive));
  await checked(h, 'it20: transfer and archive S');
  expect({ state: archived.state, lifecycle: archived.session.lifecycle, request: archived.session.archiveRequest,
    occupancy: archived.session.occupancy }).toEqual({ state: 'archived', lifecycle: 'archived', request: null, occupancy: null });
  expect(await consult(h, line1.messageRef)).toMatchObject({ status: 'ready', value: { state: 'responded' } });
  await checked(h, 'it20: E answers the transferred wait');
  const answered = await message(h, line1.messageRef);
  expect((answered.acceptedInputs ?? []).filter(a => a.part === 'response')).toEqual([]);
  expect(answered.replyHandler?.sessionRef).toEqual(D);

  // Claim/start D through ordinary dispatch. Stop before checks so no unrelated
  // task is advanced. The real before_model boundary supplies and confirms m.
  const driven = await h.advance({ ...h.select('it20-D', AG2B_WORK_TASK_ID), sessionHint: D },
    { stopBefore: performs('open_checks') });
  expect(driven.state).toBe('stopped');
  const dRun = await selectedRun(h, AG2B_WORK_TASK_ID);
  const dRecord = await execution(h, dRun);
  expect({ projectId: dRecord.session.ref.projectId, sessionId: dRecord.session.ref.sessionId }).toEqual(D);
  expect(dRun).not.toEqual(line1.runRef);
  const consumed = await message(h, line1.messageRef);
  expect((consumed.acceptedInputs ?? []).filter(a => a.part === 'response').map(a =>
    ({ inputId: a.inputId, executionRef: a.executionRef }))).toEqual([
    { inputId: deriveSessionInputId(line1.messageRef, 'response'), executionRef: dRun }]);
  const accepted = acceptedMessageInputs(h.database).filter(a => a.messageId === line1.messageRef.messageId && a.part === 'response');
  expect(accepted.map(a => a.text)).toEqual([waitReplyDeliveryText({
    messageId: line1.messageRef.messageId, question: QUESTION, body: REPLY })]);
  expect({ sender: consumed.sender, recipient: consumed.recipient, bodyRef: consumed.bodyRef,
    intent: consumed.intent, needsReply: consumed.needsReply, waitAfterSend: consumed.waitAfterSend })
    .toEqual({ sender: original.sender, recipient: original.recipient, bodyRef: original.bodyRef,
      intent: original.intent, needsReply: original.needsReply, waitAfterSend: original.waitAfterSend });
  expect(ready(await platform.messages.readMessageBody(hostCtx(), { messageRef: line1.messageRef, part: 'message' })).text).toBe(QUESTION);
  expect(await sourceExecutions(h, line1.sessionRef)).toEqual({ work: [line1.runRef], query: [] });

  // Line 2: a real inquiry derives A-prime. Attachment archives that copy;
  // maintenance must not report it as newly archived a second time.
  const copySource = (await createAG2bSession(h.host, 'it20-copy-source', AG2B_QUERY_ROLE)).sessionRef;
  await checked(h, 'it20: create independent copy source');
  const sourceBefore = (await card(h, copySource)).record;
  const sent = await h.post<WriteResult<SessionMessage>>('messages/send', graphWrite(AG2B_SCOPE,
    { recipient: copySource, text: 'IT20 independent copy inquiry', intent: 'inquiry', needsReply: true }, 'it20-copy-inquiry', []));
  if (sent.status !== 'committed') throw new Error(`send inquiry: ${JSON.stringify(sent)}`);
  await checked(h, 'it20: send inquiry');
  expect(await consult(h, sent.value.ref)).toMatchObject({ status: 'ready', value: { state: 'responded' } });
  await checked(h, 'it20: answer attachment archives copy');
  const copy = (await message(h, sent.value.ref)).consultationDerivation?.childSessionRef;
  if (copy === undefined) throw new Error('the real inquiry must persist its derived copy');
  const copyRecord = (await card(h, copy)).record;
  expect({ lifecycle: copyRecord.lifecycle, occupancy: copyRecord.occupancy, request: copyRecord.archiveRequest })
    .toEqual({ lifecycle: 'archived', occupancy: null, request: null });
  expect((await card(h, copySource)).record).toEqual(sourceBefore);
  const beforeMaintenance = h.modelCalls();
  const maintained = ready(await platform.workflow.maintainSessions(hostCtx(), { workspace: AG2B_SCOPE, after: null }));
  await checked(h, 'it20: maintenance after copy attachment');
  expect({ archived: maintained.archived, pending: maintained.pending, failures: maintained.failures })
    .toEqual({ archived: [], pending: [], failures: [] });
  expect(h.modelCalls()).toBe(beforeMaintenance);
  expect((await card(h, copySource)).record).toEqual(sourceBefore);

  // Line 3: another source really yields, is retired by the health owner, and
  // archives WITHOUT a wait choice (the retirement exception), BEFORE replying.
  const source3 = (await createAG2bSession(h.host, 'it20-retired-source', AG2B_WORK_ROLE,
    [{ target: SECOND_TARGET, relation: 'responsible' }])).sessionRef;
  await checked(h, 'it20: create independent source S3');
  const line3 = await yieldWait(h, 'it20-line3', SECOND_TASK_ID, SECOND_TARGET, sendLine3, source3);
  expect(line3.sessionRef.sessionId).toBe(source3.sessionId);
  expect(line3.sessionRef.sessionId).not.toBe(line1.sessionRef.sessionId);
  expect(line3.sessionRef.sessionId).not.toBe(D.sessionId);
  const retired = await retireS1Session(h.database, hostCtx(), line3.sessionRef);
  expect(retired.status).toBe('observed');
  await checked(h, 'it20: health owner retires S3');
  const retiredCard = await card(h, line3.sessionRef);
  expect(retiredCard.record.health).toBe('unavailable');
  const retiredArchive = ready(await platform.workflow.archiveLine(hostCtx(), { input: { sessionRef: line3.sessionRef,
    reason: 'Retired without a continuation', tasks: [{ target: SECOND_TARGET, disposition: { kind: 'drop' } }], wait: null },
    meta: { requestId: 'it20-retired-archive', expected: [{ ref: retiredCard.record.ref, revision: retiredCard.record.revision }] } }));
  await checked(h, 'it20: retirement wait exception');
  expect(retiredArchive.state).toBe('archived');
  expect(retiredArchive.session.archiveRequest).toBeNull();
  expect(await consult(h, line3.messageRef)).toMatchObject({ status: 'ready', value: { state: 'responded' } });
  await checked(h, 'it20: late reply saved after retirement');
  const late = await message(h, line3.messageRef);
  if (late.response === null) throw new Error('the late reply must have its real response');
  const readUndelivered = platform.messages.readUndeliveredReplies;
  if (readUndelivered === undefined) throw new Error('readUndeliveredReplies must be wired');
  const input = { sessionRef: line3.sessionRef, page: { limit: 20 } };
  const undelivered = ready(await readUndelivered(hostCtx(), input));
  // Refreeze §5 item 3: R is the ONE observed commit carrying S3's
  // SessionHealthObserved(observed='unavailable'); P is the ONE observed commit
  // carrying the SessionMessageResponded event for line3's message. Both come
  // from the scenario's commit observer, never from the records under test.
  const healthCommits = commits.filter(batch => batch.events.some(event => {
    if (event.eventType !== 'SessionHealthObserved') return false;
    const body = JSON.parse(event.json) as { observed?: string; session?: { ref?: { sessionId?: string } } };
    return body.observed === 'unavailable' && body.session?.ref?.sessionId === line3.sessionRef.sessionId;
  }));
  expect(healthCommits).toHaveLength(1);
  const retiredAt = healthCommits[0]!.cursor;
  const replyCommits = commits.filter(batch => batch.events.some(event => {
    if (event.eventType !== 'SessionMessageResponded') return false;
    const body = JSON.parse(event.json) as { message?: { ref?: { messageId?: string } } };
    return body.message?.ref?.messageId === line3.messageRef.messageId;
  }));
  expect(replyCommits).toHaveLength(1);
  const repliedAt = replyCommits[0]!.cursor;
  expect(undelivered.items).toEqual([{ kind: 'retired_reply', messageRef: line3.messageRef, sourceSessionRef: line3.sessionRef,
    responseRef: late.response.bodyRef, respondedAt: late.response.respondedAt, hasContinuation: false, requiresUserRecipient: true,
    unavailableSince: retiredAt, responseSince: repliedAt }]);
  expect(undelivered.nextCursor).toBeNull();
  expect({ handler: late.replyHandler ?? null, disposition: late.archiveWaitDisposition ?? null,
    accepted: (late.acceptedInputs ?? []).filter(a => a.part === 'response') })
    .toEqual({ handler: null, disposition: null, accepted: [] });
  expect(acceptedMessageInputs(h.database).filter(a => a.messageId === line3.messageRef.messageId && a.part === 'response')).toEqual([]);
  expect(await sourceExecutions(h, line3.sessionRef)).toEqual({ work: [line3.runRef], query: [] });
  expect(await sourceExecutions(h, line1.sessionRef)).toEqual({ work: [line1.runRef], query: [] });

  const calls = h.modelCalls();
  await card(h, line1.sessionRef);
  await card(h, line3.sessionRef);
  expect(ready(await readUndelivered(hostCtx(), input))).toEqual(undelivered);
  expect(await message(h, line3.messageRef)).toEqual(late);
  expect(h.modelCalls()).toBe(calls);
  expect(acceptedMessageInputs(h.database).filter(a => a.messageId === line1.messageRef.messageId && a.part === 'response')).toEqual(accepted);
}, 120_000);
