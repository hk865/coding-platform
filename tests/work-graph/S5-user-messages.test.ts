/** Slice 5 UM01–UM13: real owner histories and actual Store observations. */
import { afterEach, describe, expect, it } from 'vitest';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionAnnotationV1, DecisionSelectionV1, DecisionSourceV1, UserDecisionBodyV1 } from '../../src/contracts/goal-decisions.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { PlatformDutyV1 } from '../../src/contracts/platform-duty.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../src/contracts/ledger.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import {
  encodeSessionMessageRecord, encodeSessionMessageSentEvent, sessionMessageFromEvent,
  SESSION_MESSAGE_CONTENT_TYPE,
} from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { synchronizeB2Commits } from '../helpers/B2-execution-fixture.js';
import {
  GOAL_B, GOAL_REVISION, PLAN_B1, T, openS5DecisionFixture,
  type S5DecisionFixture, type S5FixtureKind, type S5Records,
} from '../helpers/S5-decision-fixture.js';
import {
  committed, ready, refKey, workContext, realOwners, sendDecision,
  decisionInput, modelRequests, storedJson,
} from '../helpers/S5-user-message-support.js';

const fixtures: S5DecisionFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

async function harness(kind: S5FixtureKind, duties: readonly PlatformDutyV1[] | null = ['executor']) {
  const f = await openS5DecisionFixture(kind, { duties: duties ?? [] });
  fixtures.push(f);
  const build = (records: S5Records = f.records) => realOwners(f, duties, records);
  const owners = build();
  const work = workContext(f);
  const meta = (requestId: string, expected: VersionPin[] = []) => ({ requestId, expected });
  const send = (requestId: string, intent: 'notify' | 'decision_request', forged: { duties?: string[] } = {}) => {
    const input = {
      ...decisionInput(f), intent, text: 'user message',
      needsReply: intent === 'decision_request', waitAfterSend: intent === 'decision_request',
      options: intent === 'decision_request' ? decisionInput(f).options : [],
      objects: intent === 'decision_request' ? decisionInput(f).objects : [], ...forged,
    };
    return owners.mailbox.sendUserMessage(work, { input, meta: meta(requestId, [{ ref: GOAL_B, revision: GOAL_REVISION }]) });
  };
  const plans = createPlanService({ records: f.records, now: f.now, eventId: f.newId });
  // A Task's definition is stored in the Plan; its current phase is derived
  // from persisted Run/Attempt/Lease facts, not from the fixture's cached Plan.
  const readTask = async () => {
    const graph = ready(await plans.queryTaskGraph(f.ctx, { goalRef: GOAL_B, planRef: PLAN_B1 }));
    const task = graph.tasks.find(row => row.ref.taskId === f.claimRA.task.taskId);
    expect(task).toBeDefined();
    if (task === undefined) throw new Error('claimed Task missing from the stored graph');
    expect(task).toMatchObject({ ref: f.claimRA.task, effectivePhase: 'running', execution: f.runRA.ref });
    return task;
  };
  return { f, ...owners, build, work, meta, send, readTask };
}

/** Answer rows start from a real adviser send, with source pins supplied by its owner. */
async function answerHarness(kind: S5FixtureKind) {
  const h = await harness(kind, ['adviser']);
  const { message, card } = await sendDecision(h.f, h, 'um-setup-send');
  const request = (requestId: string, text: string, annotations: DecisionAnnotationV1[] = [],
    selection: DecisionSelectionV1 = { kind: 'option', optionId: 'accept' }, revision = 1) => ({
    input: { source: card.source, selection, text, annotations },
    meta: h.meta(requestId, [{ ref: message.ref, revision }, ...card.source.pins]),
  });
  const answer = (...args: Parameters<typeof request>) => h.decisions.answerDecision(h.f.ctx, request(...args));
  const readStoredMessage = () => h.mailbox.readMessage(h.f.ctx, message.ref);
  return { ...h, message, card, request, answer, readStoredMessage };
}

async function expectMessageEvent(f: S5DecisionFixture, cursor: Parameters<S5Records['eventAt']>[0],
  type: string, message: SessionMessage) {
  const located = await f.records.eventAt(cursor);
  expect(located.status).toBe('ready');
  if (located.status !== 'ready') throw new Error('message event missing');
  expect(located.value.cursor).toBe(cursor);
  expect(located.value.event.eventType).toBe(type);
  const decoded = sessionMessageFromEvent(located.value.event);
  expect(decoded).toEqual({ status: 'decoded', value: message });
}

function expectNoNewFields(value: object) {
  for (const field of ['goalRef', 'decision', 'application', 'since', 'noticeAutomationCap']) {
    expect(Object.prototype.hasOwnProperty.call(value, field)).toBe(false);
  }
}

describe.each(['memory', 'sqlite'] as const)('S5 user messages %s', kind => {
  it('UM01 adviser sends one User P/W message from S/RA, outside the Session inbox', async () => {
    const h = await harness(kind, ['adviser']);
    const before = await h.f.storeSnapshot();
    const sent = committed(await h.send('um01', 'decision_request'));
    expect(sent.value.recipient).toEqual({ kind: 'user', projectId: 'P', workspaceId: 'W' });
    expect(sent.value.sender).toEqual({
      kind: 'work_run', sessionRef: h.f.sessionS, runRef: h.f.runRA.ref,
      roleBinding: h.f.runRA.roleBinding, generation: h.f.claimRA.generation,
    });
    expect(sent.value).toMatchObject({ goalRef: GOAL_B, status: 'pending', revision: 1,
      intent: 'decision_request', needsReply: true, waitAfterSend: true });
    const key = refKey(sent.value.ref);
    expect((await h.f.userMessagesByGoal('B')).filter(candidate => candidate === key)).toHaveLength(1);
    const inbox = ready(await h.mailbox.readInbox(h.f.ctx, { recipient: h.f.sessionS, page: { limit: 50 } }));
    expect(inbox.items.filter(item => refKey(item.ref) === key)).toHaveLength(0);
    const after = await h.f.storeSnapshot();
    expect(after.recordCount - before.recordCount).toBe(1);
    expect(after.eventCount - before.eventCount).toBe(1);
    expect(after.lastCursor).toBe(sent.cursor);
    expect(modelRequests(after)).toEqual(modelRequests(before));
    await expectMessageEvent(h.f, sent.cursor, 'SessionMessageSent', sent.value);
  });

  it('UM02 executor decision send is forbidden with zero record, event and claim changes', async () => {
    const h = await harness(kind);
    const before = await h.f.storeSnapshot();
    expect(await h.send('um02', 'decision_request')).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await h.f.storeSnapshot()).toEqual(before);
  });

  it('UM03 executor notify commits pending@1 without changing the stored Task/Plan or calling a model', async () => {
    const h = await harness(kind);
    const taskBefore = await h.readTask();
    const goalBefore = await storedJson(h.f, GOAL_B);
    const planBefore = await storedJson(h.f, PLAN_B1);
    const before = await h.f.storeSnapshot();
    const sent = committed(await h.send('um03', 'notify'));
    expect(sent.value).toMatchObject({ status: 'pending', revision: 1, intent: 'notify' });
    expect(sent.value).not.toHaveProperty('needsReply');
    expect(sent.value).not.toHaveProperty('waitAfterSend');
    expect(await h.readTask()).toEqual(taskBefore);
    expect(await storedJson(h.f, GOAL_B)).toBe(goalBefore);
    expect(await storedJson(h.f, PLAN_B1)).toBe(planBefore);
    const after = await h.f.storeSnapshot();
    expect(after.eventCount - before.eventCount).toBe(1);
    expect(modelRequests(after)).toEqual(modelRequests(before));
    await expectMessageEvent(h.f, sent.cursor, 'SessionMessageSent', sent.value);
  });

  it('UM04 caller JSON claiming scribe cannot override trusted executor duties', async () => {
    const h = await harness(kind);
    const before = await h.f.storeSnapshot();
    expect(await h.send('um04', 'decision_request', { duties: ['scribe'] })).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await h.f.storeSnapshot()).toEqual(before);
  });

  it('UM05 absent duties is unsupported while the legacy Session notify still commits', async () => {
    const h = await harness(kind, null);
    const before = await h.f.storeSnapshot();
    expect(await h.send('um05', 'decision_request')).toMatchObject({ status: 'rejected', code: 'unsupported' });
    expect(await h.f.storeSnapshot()).toEqual(before);
    const legacy = committed(await h.mailbox.sendMessage(h.f.ctx, {
      input: { recipient: h.f.sessionSecond, text: 'legacy notify' }, meta: h.meta('um05-legacy'),
    }));
    expect(legacy.value).toMatchObject({ recipient: h.f.sessionSecond, status: 'pending', revision: 1 });
    await expectMessageEvent(h.f, legacy.cursor, 'SessionMessageSent', legacy.value);
  });

  it('UM06 operator text and fm annotation read back exactly, leaving stored Task/Plan unchanged', async () => {
    const h = await answerHarness(kind);
    const text = '  Adopt B1\n';
    const annotation: DecisionAnnotationV1 = { objectKey: refKey(h.card.objects[1]!), text: 'fix here' };
    const taskBefore = await h.readTask();
    const goalBefore = await storedJson(h.f, GOAL_B);
    const planBefore = await storedJson(h.f, PLAN_B1);
    const before = await h.f.storeSnapshot();
    const answered = committed(await h.answer('um06', text, [annotation]));
    expect(answered.value).toMatchObject({ status: 'responded', revision: 2, readAt: T, application: null,
      response: { decision: { selection: { kind: 'option', optionId: 'accept' }, annotations: [annotation], requiresApplication: true } } });
    expect(ready(await h.readStoredMessage())).toEqual(answered.value);
    const body = ready(await h.mailbox.readMessageBody(h.f.ctx, { messageRef: h.message.ref, part: 'response' }));
    expect(body.text).toBe(text);
    const answer = ready(await h.decisions.readDecisionAnswer(h.f.ctx, { source: h.card.source }));
    const expectedBody: UserDecisionBodyV1 = { schemaVersion: 1, kind: 'user_decision_response',
      selection: { kind: 'option', optionId: 'accept' }, text, annotations: [annotation] };
    expect(answer).toEqual({ message: answered.value, body: expectedBody });
    expect(await h.readTask()).toEqual(taskBefore);
    expect(await storedJson(h.f, GOAL_B)).toBe(goalBefore);
    expect(await storedJson(h.f, PLAN_B1)).toBe(planBefore);
    expect(modelRequests(await h.f.storeSnapshot())).toEqual(modelRequests(before));
  });

  it('UM07 two entrances with one requestId preserve one response/event and replay without allocations', async () => {
    const h = await answerHarness(kind);
    const before = await h.f.storeSnapshot();
    const first = committed(await h.answer('um07', 'yes'));
    const afterFirst = await h.f.storeSnapshot();
    expect(afterFirst.recordCount).toBe(before.recordCount);
    expect(afterFirst.eventCount - before.eventCount).toBe(1);
    expect(afterFirst.claims).toEqual(before.claims);
    expect(afterFirst.lastCursor).toBe(first.cursor);
    expect(first.value).toMatchObject({ ref: h.message.ref, status: 'responded', revision: 2 });
    // Wiring 2 §2.3 P02/L11: the receipt carries the reply position bound to this commit's receipt cursor
    // (already tied to the ledger head by afterFirst.lastCursor above); the recorded event keeps the pending null.
    expect(first.value.responseSince).toBe(first.cursor);
    await expectMessageEvent(h.f, first.cursor, 'SessionMessageResponded', { ...first.value, responseSince: null });
    const allocations = { ...h.f.allocationCounts };
    const secondOwner = h.build();
    const second = await secondOwner.decisions.answerDecision(h.f.ctx, h.request('um07', 'yes'));
    expect(second).toEqual({ status: 'committed', value: first.value, cursor: first.cursor, replayed: true });
    expect(h.f.allocationCounts).toEqual(allocations);
    expect(await h.f.storeSnapshot()).toEqual(afterFirst);
    expect(ready(await h.readStoredMessage())).toEqual(first.value);
  });

  it('UM08 both pending@1 readers reach commit and the CAS loser cannot overwrite the response', async () => {
    const h = await answerHarness(kind);
    const synchronized = synchronizeB2Commits(h.f.records);
    const built = h.build(synchronized.records);
    const race = (requestId: string, text: string) => built.decisions.answerDecision(h.f.ctx, h.request(requestId, text));
    const before = await h.f.storeSnapshot();
    const requests = [{ requestId: 'um08-a', text: 'first' }, { requestId: 'um08-b', text: 'second' }];
    const results = await Promise.all(requests.map(async request => ({
      text: request.text, result: await race(request.requestId, request.text),
    })));
    expect(synchronized.arrivals()).toBe(2);
    const winners = results.filter(({ result }) => result.status === 'committed');
    const losers = results.filter(({ result }) => result.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toMatchObject({ result: { status: 'rejected', code: 'revision_conflict' } });
    const winner = winners[0];
    if (winner === undefined || winner.result.status !== 'committed') throw new Error('missing sole CAS winner');
    expect(ready(await h.readStoredMessage())).toEqual(winner.result.value);
    expect(winner.result.value).toMatchObject({ status: 'responded', revision: 2 });
    const response = ready(await h.mailbox.readMessageBody(h.f.ctx, { messageRef: h.message.ref, part: 'response' }));
    expect(response.text).toBe(winner.text);
    const expectedBody: UserDecisionBodyV1 = { schemaVersion: 1, kind: 'user_decision_response',
      selection: { kind: 'option', optionId: 'accept' }, text: winner.text, annotations: [] };
    expect(ready(await h.decisions.readDecisionAnswer(h.f.ctx, { source: h.card.source })))
      .toEqual({ message: winner.result.value, body: expectedBody });
    expect((await h.f.storeSnapshot()).eventCount - before.eventCount).toBe(1);
  });

  it('UM09 16385 UTF-8 bytes including spaces/newlines is capacity with zero ledger changes', async () => {
    const h = await answerHarness(kind);
    const before = await h.f.storeSnapshot();
    const text = ' \n'.repeat(8192) + 'x';
    expect(Buffer.byteLength(text, 'utf8')).toBe(16385);
    expect(await h.answer('um09', text)).toMatchObject({ status: 'rejected', code: 'capacity' });
    expect(await h.f.storeSnapshot()).toEqual(before);
  });

  it('UM10 the user answer rejects a Session message while the original work_run response still commits', async () => {
    const h = await harness(kind);
    const sent = committed(await h.mailbox.sendMessage(h.f.ctx, {
      input: { recipient: h.f.sessionS, text: 'old session mail' }, meta: h.meta('um10-send'),
    }));
    expect(sent.value.decision).toBeUndefined();
    const source: DecisionSourceV1 = { kind: 'message',
      key: decisionSourceKey({ kind: 'message', messageRef: sent.value.ref }), goalRef: GOAL_B, pins: [] };
    const before = await h.f.storeSnapshot();
    expect(await h.decisions.answerDecision(h.f.ctx, {
      input: { source, selection: { kind: 'option', optionId: 'accept' }, text: 'no', annotations: [] },
      meta: h.meta('um10-answer', [{ ref: sent.value.ref, revision: 1 }]),
    })).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await h.f.storeSnapshot()).toEqual(before);
    const replied = committed(await h.mailbox.respondMessage(h.work, {
      input: { messageRef: sent.value.ref, text: 'legacy reply' },
      meta: h.meta('um10-reply', [{ ref: sent.value.ref, revision: 1 }]),
    }));
    expect(replied.value).toMatchObject({ status: 'responded', revision: 2 });
    expect(ready(await h.mailbox.readMessageBody(h.f.ctx, { messageRef: sent.value.ref, part: 'response' })).text).toBe('legacy reply');
  });

  it('UM11 the same operator with a fresh request after reading responded@2 cannot overwrite it', async () => {
    const h = await answerHarness(kind);
    committed(await h.answer('um11-a', 'first'));
    const storedBefore = ready(await h.readStoredMessage());
    expect(storedBefore).toMatchObject({ status: 'responded', revision: 2 });
    const before = await h.f.storeSnapshot();
    expect(await h.answer('um11-b', 'second', [], { kind: 'option', optionId: 'accept' }, storedBefore.revision))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(ready(await h.readStoredMessage())).toEqual(storedBefore);
    expect(await h.f.storeSnapshot()).toEqual(before);
  });

  it('UM12 a genuinely old absent-field Session message keeps its frozen ack DTO/receipt and origin absence', async () => {
    const h = await harness(kind);
    const userBefore = await h.f.userMessagesByGoal('B');
    const claimsBefore = (await h.f.storeSnapshot()).claims;
    const sender = { kind: 'host' as const, actor: h.f.operatorActor };
    const sendIdentity = { projectId: 'P', workspaceId: 'W', sender, requestId: 'um12-old-send' };
    const sendIdentityKey = 'session-message-send:' + sha256Hex(canonicalJson({ operation: 'send', ...sendIdentity }));
    const ref = { aggregateType: 'SessionMessage' as const, projectId: 'P', workspaceId: 'W',
      messageId: 'session-message-' + sha256Hex(canonicalJson(sendIdentity)) };
    const sourceRef = { kind: 'workspace' as const, refId: 'W', revision: '3' };
    const body = await h.f.bodies.put({ contentType: SESSION_MESSAGE_CONTENT_TYPE,
      body: canonicalJson({ schemaVersion: 1, projectId: 'P', workspaceId: 'W', messageId: ref.messageId,
        part: 'message', sender, text: 'old session mail' }), sourceRefs: [sourceRef],
      origin: { kind: 'platform_operation', projectId: 'P', workspaceId: 'W', actor: h.f.operatorActor,
        requestId: 'session-message-body:' + sha256Hex(`${sendIdentityKey}|message`) }, requestedAt: T });
    expect(body.status).toBe('ready');
    if (body.status !== 'ready') throw new Error('old body seed failed');
    // This is the complete pre-slice-5 wire shape, without defaulted optional fields.
    const oldPending: SessionMessage = { ref, schemaVersion: 1, revision: 1, sender,
      recipient: h.f.sessionS, bodyRef: body.value.ref, sourceRef: body.value.ref.source,
      createdAt: T, status: 'pending', readAt: null, response: null };
    const oldSent = encodeSessionMessageSentEvent({ eventId: sha256Hex(`${sendIdentityKey}|sent`), eventType: 'SessionMessageSent',
      schemaVersion: 1, occurredAt: T, projectId: 'P', workspaceId: 'W', requestId: 'um12-old-send', actor: sender, message: oldPending });
    const seeded = await h.f.seedCommit([encodeSessionMessageRecord(oldPending)], { events: [oldSent] });
    expect(seeded.status).toBe('committed');
    expect(sessionMessageFromEvent(oldSent)).toEqual({ status: 'decoded', value: oldPending });
    // Rebase onto slice 1 (lead): an old Message reads with the slice-1 §2.9 defaults.
    expect(ready(await h.mailbox.readMessage(h.f.ctx, ref))).toEqual({ ...oldPending, replyHandler: null, archiveWaitDisposition: null });
    expectNoNewFields(JSON.parse(await storedJson(h.f, ref)));
    const before = await h.f.storeSnapshot();
    if (before.lastCursor === null) throw new Error('seeded ledger has no cursor');
    const expectedCursor = makeCommitCursor(seqOfCommitCursor(before.lastCursor) + 1);
    // Rebase onto slice 1 (lead): the ack writes the decoded Message, which carries the
    // slice-1 §2.9 read defaults; no slice-5 field is added (expectNoNewFields).
    const oldAckDto: SessionMessage = { ref, schemaVersion: 1, revision: 2, sender,
      recipient: h.f.sessionS, bodyRef: body.value.ref, sourceRef: body.value.ref.source,
      createdAt: T, status: 'read', readAt: T, response: null, replyHandler: null, archiveWaitDisposition: null };
    const ackRequest = { input: { messageRef: ref }, meta: h.meta('um12-ack', [{ ref, revision: 1 }]) };
    const acked = await h.mailbox.ackMessage(h.work, ackRequest);
    expect(acked).toEqual({ status: 'committed', value: oldAckDto, cursor: expectedCursor, replayed: false });
    const result = committed(acked);
    expectNoNewFields(result.value);
    const ackSender = { kind: 'work_run' as const, sessionRef: h.f.sessionS,
      runRef: h.f.runRA.ref, generation: h.f.claimRA.generation };
    const ackIdentityKey = 'session-message-ack:' + sha256Hex(canonicalJson({
      operation: 'ack', projectId: 'P', workspaceId: 'W', sender: ackSender, requestId: 'um12-ack',
    }));
    const fingerprint = sha256Hex(canonicalJson({ operation: 'ack', projectId: 'P', workspaceId: 'W',
      sender: ackSender, payload: { messageRef: ref }, expected: [{ ref, revision: 1 }] }));
    const receipt = await h.f.records.lookupCommit({ identityKey: ackIdentityKey, fingerprint });
    expect(receipt).toEqual({ status: 'ready', value: { status: 'committed', replayed: true, identityKey: ackIdentityKey,
      cursor: expectedCursor, eventIds: [sha256Hex(`${ackIdentityKey}|read`)], versions: [{ refKey: refKey(ref), revision: 2 }] } });
    const rawAfter = await storedJson(h.f, ref);
    expect(JSON.parse(rawAfter)).toStrictEqual(oldAckDto);
    expectNoNewFields(JSON.parse(rawAfter));
    await expectMessageEvent(h.f, expectedCursor, 'SessionMessageRead', oldAckDto);
    const after = await h.f.storeSnapshot();
    expect(after.recordCount).toBe(before.recordCount);
    expect(after.eventCount - before.eventCount).toBe(1);
    expect(after.claims).toEqual(claimsBefore);
    const allocations = { ...h.f.allocationCounts };
    const replay = await h.mailbox.ackMessage(h.work, ackRequest);
    expect(replay).toEqual({ status: 'committed', value: oldAckDto, cursor: expectedCursor, replayed: true });
    expectNoNewFields(committed(replay).value);
    expect(h.f.allocationCounts).toEqual(allocations);
    expect(await h.f.storeSnapshot()).toEqual(after);
    expect(await storedJson(h.f, ref)).toBe(rawAfter);
    expect(await h.f.userMessagesByGoal('B')).toEqual(userBefore);
  });

  it('UM13 status buckets move on answer and stay correct after reopening the same SQLite file', async () => {
    const h = await answerHarness(kind);
    const key = refKey(h.message.ref);
    expect(await h.f.messagesByWorkspaceStatus('pending')).toContain(key);
    expect(await h.f.messagesByWorkspaceStatus('responded')).not.toContain(key);
    committed(await h.answer('um13', '  Adopt B1\n', [{ objectKey: refKey(h.card.objects[1]!), text: 'fix here' }]));
    const pending = await h.f.messagesByWorkspaceStatus('pending');
    const responded = await h.f.messagesByWorkspaceStatus('responded');
    expect(pending).not.toContain(key);
    expect(responded.filter(item => item === key)).toHaveLength(1);
    if (kind === 'sqlite') {
      await h.f.reopen();
      expect(await h.f.messagesByWorkspaceStatus('pending')).toEqual(pending);
      expect(await h.f.messagesByWorkspaceStatus('responded')).toEqual(responded);
    }
  });
});
