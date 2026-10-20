/**
 * A.2 step 6, scenario C3 (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" row
 * `tests/scenarios/C3-reply-other-session.test.ts`; §6.1 contract (e) `requeue.newInputs[].replyBody`
 * ("发给新 Run 所在 Session 之外时内联正文，否则 null"), `previous.wait`; §4 P17 / TASK-22, FC-3;
 * §12.2 W-21 for the Session the requeue is claimed in).
 *
 * Run 1 sends a wait message to a member Session B and yields (P5). While it waits, a person cancels
 * it (P17: `failed/continuation_cancelled`). B's answer then arrives (one read-only Query on B), and a
 * person requeues the Task with the answered message as its new input. Run 2 writes the result file and
 * the Goal completes. The reply is long, so a bounded copy is cut.
 *
 * - Run 2 in the same Session (Run 1's Session is reusable): the reply reaches Run 2 once, through the
 *   Kernel input channel (`run.input_accepted` of the message's response part); the brief lists only the
 *   reference (`replyBody: null`).
 * - Run 2 in another Session (Run 1's Session was archived first, so the claim goes to a new Session):
 *   the input channel does not reach the reply there; the brief inlines its bounded text.
 * - The same with another work Task's Session reusable (§8 W-21 (d): `chooseSession(hint=null)` takes
 *   the first reusable card): that Session has completed history of its own, so it is not seeded from
 *   Run 1's (§6.1 contract (e), LA-1): `other_session`, Run 1's history is lost, and the brief still
 *   inlines the bounded reply.
 *
 * The §11 invariants are checked after every step that changes records. Scripted model replies only;
 * no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { CONTINUATION_BRIEF_LIMITS } from '../../src/contracts/continuation-brief.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { AG2B_QUERY_ROLE, AG2B_WORK_ROLE, AG2B_WORK_TASK_ID, createAG2bSession } from '../helpers/AG2b-collaboration-fixture.js';
import { submitControl, TASK } from '../helpers/A2-restart-fixture.js';
import { assertInvariants, cleanupScenarios, openHostScenario, SCENARIO_OPERATOR, type HostScenario } from './harness.js';
import { acceptedMessageInputs, archiveSession, consult, occurrences } from './support/brief.js';
import {
  briefOf, editThenText, execution, operatorRequeue, readMessage, selectedRun, stepOf,
} from './support/common.js';

afterEach(cleanupScenarios);

const QUESTION = 'C3: which file should Run 1 write? Answer when you can.';
const REPLY_HEAD = 'C3-REPLY-HEAD write src/ag2b-result.txt.';
const REPLY_TAIL = 'C3-REPLY-TAIL';
/** Longer than one bounded text (`CONTINUATION_BRIEF_LIMITS.textChars`), so a bounded copy is cut before the tail. */
const REPLY = `${REPLY_HEAD} ${'detail '.repeat(700)}${REPLY_TAIL}`;
/** The second work Task of the unseeded variant (same work role as the AG2b work Task). */
const OTHER_TASK_ID = 'ag2b-work-c3-other';
const OTHER_TEXT = 'C3-OTHER-TASK: the other Task answers in its own Session';

type Answered = { h: HostScenario; run1Ref: RunRef; messageRef: SessionMessageRef; sessionA: string };

/**
 * Run 1 sends a wait message to B and yields; a person cancels the wait (P17); B answers through one
 * read-only Query. Answers the scenario, Run 1, the wait message and Run 1's Session. With `otherTask`,
 * the Goal has a second work Task whose one Run answers `otherTask` (scripted between Run 1 and Run 2),
 * and the registered check PASSes every round, so that Run needs no tool call.
 */
async function waitCancelledThenAnswered(label: string, otherTask: ScriptedReply | null = null): Promise<Answered> {
  const send = { callId: `${label}-send`, name: 'send_session_message',
    args: { recipient: {}, text: QUESTION, intent: 'inquiry', needsReply: true, waitAfterSend: true } as Record<string, unknown> };
  const replies: ScriptedReply[] = [{ kind: 'calls', calls: [send] }, ...(otherTask === null ? [] : [otherTask]),
    ...editThenText(`${label}-run2`)];
  const h = await openHostScenario({ script: { replies, queryReplies: [{ kind: 'text', text: REPLY }] },
    ...(otherTask === null ? {} : { workIds: [AG2B_WORK_TASK_ID, OTHER_TASK_ID], check: 'pass' as const }) });
  const recipient = (await createAG2bSession(h.host, `${label}-member-b`, AG2B_QUERY_ROLE,
    [{ target: { kind: 'task', ref: TASK }, relation: 'participates' }])).sessionRef;
  send.args['recipient'] = { projectId: recipient.projectId, sessionId: recipient.sessionId };
  await assertInvariants(h, `${label}: member Session B`, stepOf(h, 'other', `${label}: member Session B`));

  // Run 1 sends the wait message and yields with a durable continuation (P5); nobody has answered yet.
  const yielded = await h.advance(h.select(`${label}-1`, AG2B_WORK_TASK_ID));
  expect(yielded.state).toBe('waiting');
  expect(await h.advance(h.select(`${label}-1b`, AG2B_WORK_TASK_ID)))
    .toMatchObject({ state: 'waiting', reason: 'the continuation wait has not been answered yet', receipts: [] });
  const run1Ref = await selectedRun(h);
  const run1 = await execution(h, run1Ref);
  expect(run1.run).toMatchObject({ status: 'ended', outcome: 'yielded', continuation: { kind: 'wait_reply' } });
  const messageRef = run1.run.continuation?.messageRef;
  if (messageRef === undefined) throw new Error('Run 1 must wait on its message');
  expect(await readMessage(h, messageRef)).toMatchObject({ status: 'pending', intent: 'inquiry', needsReply: true, waitAfterSend: true,
    recipient: { sessionId: recipient.sessionId }, sender: { kind: 'work_run', sessionRef: { sessionId: run1.session.ref.sessionId } } });

  // P17: the person cancels the wait; the Task is failed/continuation_cancelled and is not continued.
  await submitControl(h.host, run1Ref, 'cancel', 'the person stops the wait', `${label}-cancel`);
  await assertInvariants(h, `${label}: the wait cancelled`, stepOf(h, 'other', `${label}: the wait cancelled`));
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'continuation_cancelled' } });

  // The reply arrives: B answers the message through one read-only Query.
  expect(await consult(h, messageRef)).toMatchObject({ status: 'ready', value: { state: 'responded' } });
  await assertInvariants(h, `${label}: B answered`, stepOf(h, 'other', `${label}: B answered`));
  expect(await readMessage(h, messageRef)).toMatchObject({ status: 'responded' });
  expect(h.modelCalls(), 'Run 1 (the wait message) and B\'s Query').toBe(2);
  return { h, run1Ref, messageRef, sessionA: run1.session.ref.sessionId };
}

/**
 * The person requeues the Task after Run 1 with the answered message as the new input; Run 2 completes the Goal.
 * `earlierWorkCalls`: the work model calls before Run 2 (Run 1's, and the other Task's Run's in the variant).
 */
async function requeueWithReply(answered: Answered, label: string, earlierWorkCalls = 1) {
  const { h, run1Ref, messageRef } = answered;
  const requeued = await operatorRequeue(h.host, run1Ref, `${label}-requeue`, 'the person continues with B\'s answer',
    AG2B_WORK_TASK_ID, { newInputRefs: [{ kind: 'session_message', ref: messageRef }] });
  // FC-3: a cancelled wait is class `cancelled`, stopped by a person.
  expect(requeued).toMatchObject({ status: 'committed', value: { kind: 'requeued', requeue: { afterRunRef: run1Ref,
    failureClass: 'cancelled', stopRequester: 'human', requestedBy: SCENARIO_OPERATOR,
    newInputRefs: [{ kind: 'session_message', ref: messageRef }] } } });
  await assertInvariants(h, `${label}: requeued with the reply`, stepOf(h, 'task_requeued', `${label}: requeued with the reply`));
  const done = await h.advance(h.select(`${label}-2`, AG2B_WORK_TASK_ID));
  expect(done.state).toBe('completed');
  const run2Ref = await selectedRun(h);
  expect(run2Ref.runId).not.toBe(run1Ref.runId);
  const run2 = await execution(h, run2Ref);
  const bound = await briefOf(h.host, run2Ref);
  if (bound === null) throw new Error('Run 2 must bind its brief');
  expect(bound.brief).toMatchObject({ mode: 'rework', failureClass: 'cancelled',
    previous: { runRef: run1Ref, outcome: 'yielded', cancelledBy: 'human', wait: { messageRef, status: 'responded' } } });
  // Run 2's model requests (the earlier work Runs made the first ones; B's Query is on the query model).
  const run2Requests = h.modelRequests().slice(earlierWorkCalls);
  expect(run2Requests).toHaveLength(2);
  expect(h.modelCalls(), 'the earlier work Runs, B\'s Query, Run 2 (edit and final text)').toBe(earlierWorkCalls + 3);
  return { run2Ref, run2, brief: bound.brief, run2Requests };
}

it('C3 (P17, same Session): Run 2 continues in Run 1\'s Session; the reply enters once through run.input_accepted and the brief lists only its reference', async () => {
  const answered = await waitCancelledThenAnswered('c3-same');
  const { run2Ref, run2, brief, run2Requests } = await requeueWithReply(answered, 'c3-same');
  const { h, messageRef, sessionA } = answered;

  expect(run2.outbox.claim.sessionRef.sessionId, 'W-21: Run 1\'s Session is reusable').toBe(sessionA);
  expect(brief.session).toMatchObject({ continuity: 'same_session_history', sessionRef: { sessionId: sessionA } });
  // The brief lists the reply only by reference: the history gets it through the input channel (§6.1 contract (e):
  // replyBody 发给新 Run 所在 Session 之外时内联正文，否则 null).
  expect(brief.requeue.newInputs).toEqual([{ kind: 'session_message', ref: messageRef, replyBody: null }]);
  // The reply entered once, as the response part of the original message, accepted by Run 2's Turn.
  const run2KernelRunId = run2.run.executionHistory?.kernel.runId;
  expect(acceptedMessageInputs(h.database).filter(input => input.messageId === messageRef.messageId))
    .toEqual([{ runId: run2KernelRunId, messageId: messageRef.messageId, part: 'response', text: REPLY }]);
  expect(await readMessage(h, messageRef)).toMatchObject({ acceptedInputs: [{ part: 'response', executionRef: run2Ref,
    kernel: { runId: run2KernelRunId } }] });
  // So the model sees it once: not a second time from the brief.
  for (const [index, request] of run2Requests.entries()) {
    const text = JSON.stringify(request.messages);
    expect(occurrences(text, REPLY_HEAD), `Run 2 request ${String(index)}`).toBe(1);
    expect(occurrences(text, REPLY_TAIL), `Run 2 request ${String(index)}: the whole reply`).toBe(1);
  }
  expect(run2Ref.runId).not.toBe(answered.run1Ref.runId);
}, 120_000);

it('C3 (P17, other Session): with Run 1\'s Session archived, Run 2 continues in another Session and its brief carries the bounded reply text', async () => {
  const answered = await waitCancelledThenAnswered('c3-other');
  const { h, messageRef, sessionA } = answered;
  // The person retires Run 1's Session (the invariants are checked after each of its commits); W-21: the requeue is
  // claimed in another Session.
  await archiveSession(h, { projectId: TASK.projectId, sessionId: sessionA }, 'c3-other');
  const { run2, brief, run2Requests } = await requeueWithReply(answered, 'c3-other');

  const sessionOfRun2 = run2.outbox.claim.sessionRef.sessionId;
  expect(sessionOfRun2).not.toBe(sessionA);
  // LA-1: the new Session is seeded with the archived Session's completed history (the yielded Turn has a terminal).
  expect(brief.session).toMatchObject({ continuity: 'other_session_seeded', sessionRef: { sessionId: sessionOfRun2 },
    seededFrom: { sessionRef: { sessionId: sessionA } } });
  // The brief inlines the reply text, bounded: cut at `textChars` and marked truncated (§15.2 row: 内联有界的回复正文;
  // §6.1 contract (e) `replyBody: BoundedTextV1`, whose `truncated` says whether anything was cut).
  const bounded = REPLY.slice(0, CONTINUATION_BRIEF_LIMITS.textChars);
  expect(brief.requeue.newInputs).toEqual([{ kind: 'session_message', ref: messageRef,
    replyBody: { text: bounded, truncated: true } }]);
  expect(brief.requeue.newInputs).toMatchObject([{ kind: 'session_message', ref: messageRef,
    replyBody: { text: expect.stringContaining(REPLY_HEAD) } }]);
  // The input channel does not reach the reply in the other Session: only the brief carries it, once.
  expect(acceptedMessageInputs(h.database).filter(input => input.messageId === messageRef.messageId)).toEqual([]);
  const first = JSON.stringify(run2Requests[0]?.messages);
  expect(occurrences(first, REPLY_HEAD)).toBe(1);
  expect(occurrences(first, REPLY_TAIL), 'the bounded copy ends before the tail').toBe(0);
  // The seeded history is Run 1's Turn (its wait message; the brief does not quote it).
  expect(first, 'LA-1: Run 1\'s history seeds the new Session').toContain(QUESTION);
}, 120_000);

it('C3 (P17, another Task\'s Session): with Run 1\'s Session archived and another work Task\'s Session reusable, Run 2 continues there without Run 1\'s history (other_session) and its brief carries the bounded reply text', async () => {
  const answered = await waitCancelledThenAnswered('c3-unseeded', { kind: 'text', text: OTHER_TEXT });
  const { h, messageRef, sessionA } = answered;
  // The other work Task runs to completion in its own Session S2 (the person picks S2 for it through `sessionHint`;
  // Run 1's Session A is reusable then, so without the hint it would be claimed there): S2 has history of its own.
  const otherTask = { ...TASK, taskId: OTHER_TASK_ID };
  const s2 = (await createAG2bSession(h.host, 'c3-unseeded-s2', AG2B_WORK_ROLE,
    [{ target: { kind: 'task', ref: otherTask }, relation: 'responsible' }])).sessionRef;
  await assertInvariants(h, 'c3-unseeded: Session S2', stepOf(h, 'other', 'c3-unseeded: Session S2'));
  const other = await h.advance({ ...h.select('c3-unseeded-other', OTHER_TASK_ID), sessionHint: s2 });
  expect(other.receipts.map(receipt => receipt.kind)).toEqual(expect.arrayContaining(['claim_task', 'start', 'complete_task']));
  expect(other.receipts.map(receipt => receipt.kind)).not.toContain('create_session');
  expect(await h.taskRow(OTHER_TASK_ID)).toMatchObject({ effectivePhase: 'satisfied' });
  const otherRun = await execution(h, await selectedRun(h, OTHER_TASK_ID));
  expect(otherRun.session.ref.sessionId).toBe(s2.sessionId);
  expect(otherRun.session).toMatchObject({ lifecycle: 'active', health: 'available', occupancy: null });
  expect(otherRun.session.historyCursor, 'S2 has completed history of its own').not.toBeNull();
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'continuation_cancelled' } });

  // The person retires Run 1's Session; W-21 (d): `chooseSession(hint=null)` takes the first reusable card, S2.
  await archiveSession(h, { projectId: TASK.projectId, sessionId: sessionA }, 'c3-unseeded');
  const { run2, brief, run2Requests } = await requeueWithReply(answered, 'c3-unseeded', 2);
  expect(run2.outbox.claim.sessionRef.sessionId).toBe(s2.sessionId);
  // §6.1 contract (e), LA-1: the claim Session has its own history cursor, so it is not seeded from Session A.
  expect(brief.session).toMatchObject({ continuity: 'other_session', sessionRef: { sessionId: s2.sessionId }, seededFrom: null });
  // The brief inlines the reply text, bounded, as in the seeded case (§6.1 contract (e)).
  const bounded = REPLY.slice(0, CONTINUATION_BRIEF_LIMITS.textChars);
  expect(brief.requeue.newInputs).toEqual([{ kind: 'session_message', ref: messageRef,
    replyBody: { text: bounded, truncated: true } }]);
  expect(brief.requeue.newInputs).toMatchObject([{ kind: 'session_message', ref: messageRef,
    replyBody: { text: expect.stringContaining(REPLY_HEAD) } }]);
  // The input channel does not reach the reply in S2 (the message is Session A's): only the brief carries it, once.
  expect(acceptedMessageInputs(h.database).filter(input => input.messageId === messageRef.messageId)).toEqual([]);
  const first = JSON.stringify(run2Requests[0]?.messages);
  expect(occurrences(first, REPLY_HEAD)).toBe(1);
  expect(occurrences(first, REPLY_TAIL), 'the bounded copy ends before the tail').toBe(0);
  // §8 W-21 (d): the model continues S2's own history; Run 1's completed history is lost, and the brief says so.
  expect(first, 'S2\'s own history').toContain(OTHER_TEXT);
  expect(first, 'Session A\'s history is not in S2').not.toContain(QUESTION);
  expect(first).toContain(`接续方式：在新的 Session ${s2.sessionId} 中继续，没有上一次的对话历史。`);
}, 120_000);
