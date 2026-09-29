/** C1 independent mailbox behavior. Running fixtures are domain seeds, not Runtime production proof. */
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../src/contracts/ledger.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { SESSION_MESSAGE_LOOKUP_INDEXES, SESSION_MESSAGE_CONTENT_TYPE } from '../../src/core/work-graph/communication/message-record-codecs.js';
import { SESSION_MAILBOX_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import type { ClaimFixtureKind } from '../helpers/task-claim-fixture.js';
import { AT, createC1Harness, envelopeFor, type C1Harness } from '../helpers/C1-mailbox-fixture.js';
const KINDS = ['memory','sqlite'] as const;
const systemActor = {kind:'system' as const,id:'c1-mailbox-body-system'};
const signal = () => new AbortController().signal;
const key = (ref:object) => canonicalJson(ref as unknown as JsonValue);
const harnesses: C1Harness[] = [];
async function open(kind: ClaimFixtureKind): Promise<C1Harness> {
  const harness = await createC1Harness(kind);
  harnesses.push(harness);
  return harness;
}
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
});

function sendRequest(recipient: SessionRef, text: string, requestId: string, expected: VersionPin[] = []) {
  return { input: { recipient, text }, meta: { requestId, expected } };
}

function messagePin(ref: SessionMessageRef, revision: number): VersionPin {
  return { ref, revision };
}

// --------------------------------------------------------------------------
// Domain behavior (items 1-8 of the C1 acceptance criteria)
// --------------------------------------------------------------------------

describe.each(KINDS)('C1 SessionMailbox real %s', kind => {
  it('uses one real ledger for the complete claimed execution and exact Session facts', async()=>{
    const h=await open(kind);
    const execution=await createRunStateReader({records:h.fixture.records}).readExecution(h.ctxHost,h.claim.runRef);
    expect(execution.status).toBe('ready');if(execution.status!=='ready')return;
    expect(execution.value.run).toEqual(h.currentRun);
    expect(execution.value.lease).toMatchObject({holderRunId:h.claim.runRef.runId,attemptId:h.claim.attemptRef.attemptId});
    expect(execution.value.outbox.claim).toEqual(h.claim);
    expect(execution.value.session.occupancy).toMatchObject({kind:'execution',executionRef:h.claim.runRef,generation:h.claim.generation});
    expect(await h.sessions.readSession(h.ctxHost,h.busySession)).toMatchObject({status:'ready',value:{record:execution.value.session}});
  });

  it('Host delivers durable mail to a busy and an archived Session without changing either record', async () => {
    const h = await open(kind);
    const beforeBusy = await h.sessions.readSession(h.ctxHost, h.busySession);
    expect(beforeBusy).toMatchObject({ status: 'ready' });
    if (beforeBusy.status !== 'ready') return;
    const busyBefore = beforeBusy.value.record;

    const busySend = await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.busySession, 'hello busy', 'c1-host-busy'));
    expect(busySend).toMatchObject({ status: 'committed' });
    if (busySend.status !== 'committed') return;
    expect(busySend.value).toMatchObject({ recipient: h.busySession, status: 'pending', readAt: null, response: null });

    // A pending inbox item must not prevent explicit archival.
    const pendingSend = await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.idleSession, 'hello idle', 'c1-host-idle'));
    expect(pendingSend).toMatchObject({ status: 'committed' });
    const idleCard = await h.sessions.readSession(h.ctxHost, h.idleSession);
    expect(idleCard).toMatchObject({ status: 'ready' });
    if (idleCard.status !== 'ready') return;
    const archived = await h.lifecycle.archiveSession(h.ctxHost, {
      input: { sessionRef: h.idleSession, reason: 'C1 pending mail must not block archival' },
      meta: { requestId: 'c1-archive-idle', expected: [{ ref: plainSessionRefToAggregate(h.idleSession), revision: idleCard.value.record.revision }] },
    });
    expect(archived).toMatchObject({ status: 'committed' });
    // An archived Session still receives durable mail.
    const archivedSend = await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.idleSession, 'hello archived', 'c1-host-archived'));
    expect(archivedSend).toMatchObject({ status: 'committed' });

    const afterBusy = await h.sessions.readSession(h.ctxHost, h.busySession);
    expect(afterBusy).toMatchObject({ status: 'ready' });
    if (afterBusy.status !== 'ready') return;
    expect(afterBusy.value.record).toEqual(busyBefore);

    const body = await h.mailbox.readMessageBody(h.ctxHost, { messageRef: busySend.value.ref, part: 'message' });
    expect(body).toMatchObject({ status: 'ready' });
    if (body.status === 'ready') expect(body.value).toMatchObject({ text: 'hello busy', part: 'message', usage: 'message' });
  });

  it('Host cannot fabricate an acknowledgement or a reply', async () => {
    const h = await open(kind);
    const sent = await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.idleSession, 'forbidden flows', 'c1-host-forbidden'));
    expect(sent).toMatchObject({ status: 'committed' });
    if (sent.status !== 'committed') return;
    const ack = await h.mailbox.ackMessage(h.ctxHost, {
      input: { messageRef: sent.value.ref },
      meta: { requestId: 'c1-host-ack', expected: [messagePin(sent.value.ref, sent.value.revision)] },
    });
    expect(ack).toMatchObject({ status: 'rejected', code: 'forbidden' });
    const respond = await h.mailbox.respondMessage(h.ctxHost, {
      input: { messageRef: sent.value.ref, text: 'host reply' },
      meta: { requestId: 'c1-host-respond', expected: [messagePin(sent.value.ref, sent.value.revision)] },
    });
    expect(respond).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('rejects extra send pins and query_run senders', async () => {
    const h = await open(kind);
    const withPin = await h.mailbox.sendMessage(h.ctxHost, {
      input: { recipient: h.idleSession, text: 'pinned' },
      meta: { requestId: 'c1-extra-pin', expected: [{ ref: plainSessionRefToAggregate(h.idleSession), revision: 1 }] },
    });
    expect(withPin).toMatchObject({ status: 'rejected', code: 'invalid' });

    const workspaceId = h.ctxWork.workspaceId as string;
    const queryRunRef = { aggregateType: 'QueryRun' as const, projectId: h.busySession.projectId, workspaceId, queryJobId: 'c1-job', runId: 'c1-query-run' };
    const ctxQuery: CoreCallContext = {
      projectId: h.busySession.projectId,
      workspaceId,
      principal: { kind: 'query_run', queryRunRef, initiator: { kind: 'system', id: 'c1-query' } },
      materialReader: { kind: 'run', requester: queryRunRef },
      signal: signal(),
    };
    const querySend = await h.mailbox.sendMessage(ctxQuery, sendRequest(h.idleSession, 'query', 'c1-query-send'));
    expect(querySend).toMatchObject({ status: 'rejected', code: 'unsupported' });
  });

  it('a valid running Run sends, while forged/ended/missing-envelope/unauthorized facts are denied', async () => {
    const h = await open(kind);
    const valid = await h.mailbox.sendMessage(h.ctxWork, sendRequest(h.busySession, 'from run', 'c1-work-valid'));
    expect(valid).toMatchObject({ status: 'committed' });

    // Ended Run.
    await h.commitRun({ ...h.currentRun, revision: h.currentRun.revision + 1, status: 'ended', outcome: 'completed', endedAt: AT });
    const ended = await h.mailbox.sendMessage(h.ctxWork, sendRequest(h.busySession, 'ended', 'c1-work-ended'));
    expect(ended).toMatchObject({ status: 'rejected', code: 'forbidden' });

    // Missing envelope.
    await h.commitRun({ ...h.currentRun, revision: h.currentRun.revision + 1, status: 'running', outcome: null, endedAt: null, envelope: null });
    const noEnvelope = await h.mailbox.sendMessage(h.ctxWork, sendRequest(h.busySession, 'no envelope', 'c1-work-no-envelope'));
    expect(noEnvelope).toMatchObject({ status: 'rejected', code: 'forbidden' });

    // Tool not authorized by the envelope.
    const restrictedTools = SESSION_MAILBOX_TOOL_NAMES.filter(name => name !== 'send_session_message');
    await h.commitRun({ ...h.currentRun, revision: h.currentRun.revision + 1, envelope: envelopeFor(h.currentRun, restrictedTools) });
    const unauthorized = await h.mailbox.sendMessage(h.ctxWork, sendRequest(h.busySession, 'unauthorized', 'c1-work-unauthorized'));
    expect(unauthorized).toMatchObject({ status: 'rejected', code: 'forbidden' });

    // Restore permissions so they cannot mask the independently forged caller binding.
    await h.commitRun({ ...h.currentRun, revision: h.currentRun.revision + 1, envelope: envelopeFor(h.currentRun) });
    const forgedRole: CoreCallContext = {...h.ctxWork, principal:{kind:'work_run',runRef:h.claim.runRef,roleBinding:{...h.currentRun.roleBinding,bindingVersion:h.currentRun.roleBinding.bindingVersion+1}}};
    const wrongRole = await h.mailbox.sendMessage(forgedRole, sendRequest(h.busySession, 'wrong role', 'c1-work-wrong-role'));
    expect(wrongRole).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('requires the exact B2 entered binding for a new work-run message', async () => {
    const h = await open(kind);
    const entered = h.currentRun.executionAuthorization;
    if (!entered || !('schemaVersion' in entered) || entered.schemaVersion !== 2) throw Error('test requires explicit entered domain seed');
    for (const phase of ['authorized', 'entering', 'unknown'] as const) {
      await h.commitRun({ ...h.currentRun, revision: h.currentRun.revision + 1,
        executionAuthorization: { ...entered, phase } });
      expect(await h.mailbox.sendMessage(h.ctxWork, sendRequest(h.busySession, phase, `c1-phase-${phase}`)))
        .toMatchObject({ status: 'rejected', code: 'forbidden' });
    }
    await h.commitRun({ ...h.currentRun, revision: h.currentRun.revision + 1,
      executionAuthorization: { ...entered, sessionGeneration: entered.sessionGeneration + 1 } });
    expect(await h.mailbox.sendMessage(h.ctxWork, sendRequest(h.busySession, 'stale generation', 'c1-phase-generation')))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('replays an identical send and rejects the same identity with a different payload', async () => {
    const h = await open(kind);
    const first = await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.idleSession, 'stable', 'c1-replay-send'));
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    if (first.status !== 'committed') return;
    const replay = await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.idleSession, 'stable', 'c1-replay-send'));
    expect(replay).toMatchObject({ status: 'committed', replayed: true });
    if (replay.status === 'committed') {
      expect(replay.value.ref).toEqual(first.value.ref);
      expect(replay.value.revision).toBe(first.value.revision);
      expect(replay.cursor).toBe(first.cursor);
    }
    const conflict = await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.idleSession, 'changed', 'c1-replay-send'));
    expect(conflict).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  });

  it('keeps pending -> read -> responded monotonic; reads never ack; the response slot is single', async () => {
    const h = await open(kind);
    const sent = await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.busySession, 'please handle', 'c1-lifecycle-send'));
    expect(sent).toMatchObject({ status: 'committed' });
    if (sent.status !== 'committed') return;

    const readOnce = await h.mailbox.readMessage(h.ctxWork, sent.value.ref);
    expect(readOnce).toMatchObject({ status: 'ready' });
    if (readOnce.status === 'ready') expect(readOnce.value.status).toBe('pending');

    const acked = await h.mailbox.ackMessage(h.ctxWork, {
      input: { messageRef: sent.value.ref },
      meta: { requestId: 'c1-ack', expected: [messagePin(sent.value.ref, sent.value.revision)] },
    });
    expect(acked).toMatchObject({ status: 'committed' });
    if (acked.status !== 'committed') return;
    expect(acked.value.status).toBe('read');
    expect(acked.value.readAt).not.toBeNull();

    const ackAgain = await h.mailbox.ackMessage(h.ctxWork, {
      input: { messageRef: sent.value.ref },
      meta: { requestId: 'c1-ack-2', expected: [messagePin(sent.value.ref, acked.value.revision)] },
    });
    expect(ackAgain).toMatchObject({ status: 'rejected', code: 'invalid' });

    const responded = await h.mailbox.respondMessage(h.ctxWork, {
      input: { messageRef: sent.value.ref, text: 'handled' },
      meta: { requestId: 'c1-respond', expected: [messagePin(sent.value.ref, acked.value.revision)] },
    });
    expect(responded).toMatchObject({ status: 'committed' });
    if (responded.status !== 'committed') return;
    expect(responded.value.status).toBe('responded');
    expect(responded.value.response).toMatchObject({ respondedAt: AT });

    const secondResponse = await h.mailbox.respondMessage(h.ctxWork, {
      input: { messageRef: sent.value.ref, text: 'different' },
      meta: { requestId: 'c1-respond-2', expected: [messagePin(sent.value.ref, responded.value.revision)] },
    });
    expect(secondResponse).toMatchObject({ status: 'rejected', code: 'invalid' });

    const senderRead = await h.mailbox.readMessage(h.ctxWork, sent.value.ref);
    expect(senderRead).toMatchObject({ status: 'ready', value: { status: 'responded' } });
  });

  it('bounds text at 16 KiB UTF-8 and returns capacity without truncation', async () => {
    const h = await open(kind);
    const atLimit = 'a'.repeat(16 * 1024);
    const accepted = await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.idleSession, atLimit, 'c1-size-ok'));
    expect(accepted).toMatchObject({ status: 'committed' });
    const over = 'a'.repeat(16 * 1024 + 1);
    const rejected = await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.idleSession, over, 'c1-size-over'));
    expect(rejected).toMatchObject({ status: 'rejected', code: 'capacity' });
  });

  it('never shares a body across two independent messages with identical text', async () => {
    const h = await open(kind);
    const first = await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.idleSession, 'same text', 'c1-scope-1'));
    const second = await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.idleSession, 'same text', 'c1-scope-2'));
    expect(first).toMatchObject({ status: 'committed' });
    expect(second).toMatchObject({ status: 'committed' });
    if (first.status !== 'committed' || second.status !== 'committed') return;
    expect(second.value.ref.messageId).not.toBe(first.value.ref.messageId);
    expect(second.value.bodyRef).not.toEqual(first.value.bodyRef);
  });

  it('limit-filtered inbox only returns the trusted recipient and validates the page', async () => {
    const h = await open(kind);
    await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.idleSession, 'idle one', 'c1-inbox-idle-1'));
    await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.busySession, 'busy one', 'c1-inbox-busy-1'));
    const page = await h.mailbox.readInbox(h.ctxWork, { recipient: h.busySession, status: 'pending', page: { limit: 10 } });
    expect(page).toMatchObject({ status: 'ready' });
    if (page.status === 'ready') {
      expect(page.value.items.map(item => item.recipient)).toEqual([h.busySession]);
      expect(page.value.items.every(item => item.status === 'pending')).toBe(true);
    }
    const badLimit = await h.mailbox.readInbox(h.ctxWork, { recipient: h.busySession, page: { limit: 0 } });
    expect(badLimit).toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  it('does not leak a message or its body to another Session and returns not_found for a guessed message', async () => {
    const h = await open(kind);
    const sent = await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.idleSession, 'for idle only', 'c1-isolation'));
    expect(sent).toMatchObject({ status: 'committed' });
    if (sent.status !== 'committed') return;
    const otherRead = await h.mailbox.readMessage(h.ctxWork, sent.value.ref);
    expect(otherRead).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await h.mailbox.readMessageBody(h.ctxWork,{messageRef:sent.value.ref,part:'message'})).toMatchObject({status:'rejected',code:'forbidden'});
    const forged = { ...sent.value.ref, messageId: 'guessed-message' } as SessionMessageRef;
    const guessed = await h.mailbox.readMessage(h.ctxWork, forged);
    expect(guessed).toMatchObject({ status: 'not_found' });
  });

  it('keeps platform message bodies unreadable to an ordinary Run while the Host historical read works', async () => {
    const h = await open(kind);
    const workspaceId = h.ctxWork.workspaceId as string;
    const actor = h.ctxHost.principal.kind === 'host' ? h.ctxHost.principal.actor : systemActor;
    const envelope = JSON.stringify({ schemaVersion: 1, projectId: h.busySession.projectId, workspaceId, messageId: 'c1-body', part: 'message', sender: { kind: 'host', actor }, text: 'stored body' });
    const stored = await h.materials.storeArtifact(h.ctxHost, {
      contentType: SESSION_MESSAGE_CONTENT_TYPE,
      body: envelope,
      sources: [{ kind: 'workspace', refId: workspaceId, revision: '1' }],
      origin: { kind: 'platform_operation', projectId: h.busySession.projectId, workspaceId, requestId: 'c1-body-store', actor },
    });
    expect(stored).toMatchObject({ status: 'stored' });
    if (stored.status !== 'stored') return;
    const runRead = await h.materials.openArtifact(h.ctxWork, { ref: stored.ref, usage: 'historical_explanation' });
    expect(runRead).toMatchObject({ status: 'rejected', code: 'forbidden' });
    const hostRead = await h.materials.openArtifact(h.ctxHost, { ref: stored.ref, usage: 'historical_explanation' });
    expect(hostRead).toMatchObject({ status: 'ready' });
    const sent = await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.busySession, 'readable body', 'c1-body-read'));
    expect(sent).toMatchObject({ status: 'committed' });
    if (sent.status !== 'committed') return;
    expect(await h.materials.openArtifact(h.ctxWork,{ref:sent.value.bodyRef,usage:'historical_explanation'})).toMatchObject({status:'rejected',code:'forbidden'});
    const body = await h.mailbox.readMessageBody(h.ctxWork, { messageRef: sent.value.ref, part: 'message' });
    expect(body).toMatchObject({ status: 'ready', value: { text: 'readable body' } });
  });

  it('declares recipient and sender Run lookup indexes with their frozen paths', () => {
    expect(SESSION_MESSAGE_LOOKUP_INDEXES).toEqual([
      { name: 'session-message-by-sender-session', aggregateType: 'SessionMessage',
        paths: ['ref.projectId', 'ref.workspaceId', 'sender.sessionRef.sessionId'] },
      { name: 'session-message-by-recipient', aggregateType: 'SessionMessage',
        paths: ['ref.projectId', 'ref.workspaceId', 'recipient.sessionId'] },
      { name: 'session-message-by-recipient-status', aggregateType: 'SessionMessage',
        paths: ['ref.projectId', 'ref.workspaceId', 'recipient.sessionId', 'status'] },
      { name: 'session-message-by-sender-run', aggregateType: 'SessionMessage',
        paths: ['ref.projectId', 'ref.workspaceId', 'sender.runRef.goalId', 'sender.runRef.runId'] },
    ]);
  });

  it('returns the real readThrough and reports an unmet atLeastCursor as not_ready', async () => {
    const h = await open(kind);
    const before = await h.mailbox.readInbox(h.ctxWork, { recipient: h.busySession, page: { limit: 10 } });
    expect(before).toMatchObject({ status: 'ready' });
    if (before.status !== 'ready') return;
    const sent = await h.mailbox.sendMessage(h.ctxHost, sendRequest(h.busySession, 'watermark', 'c1-watermark'));
    expect(sent).toMatchObject({ status: 'committed' });
    const after = await h.mailbox.readInbox(h.ctxWork, { recipient: h.busySession, page: { limit: 10 } });
    expect(after).toMatchObject({ status: 'ready' });
    if (after.status === 'ready') expect(after.value.sourceCursor).not.toBe(before.value.sourceCursor);
    // A future watermark must not be satisfied by a newer unrelated commit.
    const future = makeCommitCursor(seqOfCommitCursor(before.value.sourceCursor) + 1000);
    const unmet = await h.mailbox.readInbox(h.ctxWork, { recipient: h.busySession, page: { limit: 10, atLeastCursor: future } });
    expect(unmet).toMatchObject({ status: 'not_ready' });
  });
  it('retains the exact send/ack/respond receipts after the bound Run ends but denies a new request', async () => {
    const h = await open(kind);
    const send = sendRequest(h.busySession, 'receipt body', 'ended-send');
    const sent = await h.mailbox.sendMessage(h.ctxWork, send);
    expect(sent.status).toBe('committed'); if (sent.status !== 'committed') return;
    const ack = {input:{messageRef:sent.value.ref},meta:{requestId:'ended-ack',expected:[messagePin(sent.value.ref,sent.value.revision)]}};
    const acked = await h.mailbox.ackMessage(h.ctxWork,ack);
    expect(acked.status).toBe('committed'); if (acked.status !== 'committed') return;
    const reply = {input:{messageRef:sent.value.ref,text:'reply'},meta:{requestId:'ended-reply',expected:[messagePin(sent.value.ref,acked.value.revision)]}};
    const replied = await h.mailbox.respondMessage(h.ctxWork,reply);
    expect(replied.status).toBe('committed'); if (replied.status !== 'committed') return;
    await h.commitRun({...h.currentRun,revision:h.currentRun.revision+1,status:'ended',outcome:'completed',endedAt:AT});
    expect(await h.mailbox.sendMessage(h.ctxWork,send)).toEqual({...sent,replayed:true});
    expect(await h.mailbox.ackMessage(h.ctxWork,ack)).toEqual({...acked,replayed:true});
    expect(await h.mailbox.respondMessage(h.ctxWork,reply)).toEqual({...replied,replayed:true});
    expect(await h.mailbox.sendMessage(h.ctxWork,{...send,meta:{...send.meta,requestId:'fresh-after-end'}})).toMatchObject({status:'rejected',code:'forbidden'});
    expect(await h.mailbox.ackMessage(h.ctxWork,{...ack,meta:{...ack.meta,expected:[messagePin(sent.value.ref,99)]}})).toMatchObject({status:'rejected',code:'idempotency_conflict'});
  });

  it('rejects a formal lease successor even when the Run and Session still appear running', async () => {
    const h = await open(kind);
    const leaseRef = {aggregateType:'TaskLease',projectId:h.claim.task.projectId,goalId:h.claim.task.goalId,taskId:h.claim.task.taskId};
    const read = await h.fixture.records.readMany([key(leaseRef)]);
    expect(read.status).toBe('ready'); if(read.status !== 'ready') return;
    const row = read.value.records[0]!; const lease = JSON.parse(row.json);
    lease.revision++; lease.holderRunId='successor-run'; lease.attemptId='successor-attempt';
    expect(await h.fixture.commitRaw([{...row,revision:lease.revision,json:JSON.stringify(lease)}],[{refKey:row.refKey,expectedRevision:row.revision}])).toMatchObject({status:'committed'});
    expect(await h.mailbox.sendMessage(h.ctxWork,sendRequest(h.idleSession,'stale owner','lease-changed'))).toMatchObject({status:'rejected',code:'forbidden'});
    expect(await h.mailbox.readInbox(h.ctxHost,{recipient:h.idleSession,page:{limit:10}})).toMatchObject({status:'ready',value:{items:[]}});
  });

  it('joins the sender Session guard to the message commit rather than trusting an earlier ownership check', async () => {
    const h = await open(kind); let intercepted = false;
    const mailbox = h.makeMailbox({...h.fixture.records,async commit(batch){
      intercepted = true;
      await h.commitSession(h.busySession,record=>({...record,occupancy:null}));
      return h.fixture.records.commit(batch);
    }});
    expect(await mailbox.sendMessage(h.ctxWork,sendRequest(h.idleSession,'racing release','release-race'))).toMatchObject({status:'rejected',code:'revision_conflict'});
    expect(intercepted).toBe(true);
    expect(await h.mailbox.readInbox(h.ctxHost,{recipient:h.idleSession,page:{limit:10}})).toMatchObject({status:'ready',value:{items:[]}});
  });

  it('two responses race on the same slot; the loser cannot replace the winner and replay keeps its original receipt', async () => {
    const h = await open(kind);
    const sent = await h.mailbox.sendMessage(h.ctxHost,sendRequest(h.busySession,'race reply','race-send'));
    expect(sent.status).toBe('committed'); if(sent.status !== 'committed') return;
    let arrivals=0; let release!:()=>void;
    const barrier = new Promise<void>(resolve=>{release=resolve;});
    const mailbox = h.makeMailbox({...h.fixture.records,async commit(batch){
      if(++arrivals===2) release(); await barrier; return h.fixture.records.commit(batch);
    }});
    const requests = ['a','b'].map(text=>({input:{messageRef:sent.value.ref,text},meta:{requestId:`response-${text}`,expected:[messagePin(sent.value.ref,sent.value.revision)]}}));
    const results = await Promise.all(requests.map(request=>mailbox.respondMessage(h.ctxWork,request)));
    expect(results.filter(result=>result.status==='committed')).toHaveLength(1);
    expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
    const winner = results.findIndex(result=>result.status==='committed'); const receipt=results[winner]!;
    expect(await h.mailbox.respondMessage(h.ctxWork,requests[winner]!)).toEqual({...receipt,replayed:true});
    const original = await h.mailbox.readMessage(h.ctxHost,sent.value.ref);
    expect(original).toMatchObject({status:'ready',value:{status:'responded',revision:2}});
    const body = await h.mailbox.readMessageBody(h.ctxHost,{messageRef:sent.value.ref,part:'response'});
    expect(body).toMatchObject({status:'ready',value:{text:requests[winner]!.input.text}});
  });

  it('keyset pages bind caller, recipient and filter and perform one mailbox lookup with no event scan', async () => {
    const h=await open(kind);
    for(let i=0;i<4;i++) expect(await h.mailbox.sendMessage(h.ctxHost,sendRequest(h.busySession,`page-${i}`,`page-${i}`))).toMatchObject({status:'committed'});
    let lookups=0; let events=0; const indexes:string[]=[];
    const mailbox=h.makeMailbox({...h.fixture.records,lookup(input){lookups++;indexes.push(input.index);return h.fixture.records.lookup(input);},eventAt(cursor){events++;return h.fixture.records.eventAt(cursor);}});
    const first=await mailbox.readInbox(h.ctxHost,{recipient:h.busySession,status:'pending',page:{limit:2}});
    expect(first.status).toBe('ready'); if(first.status!=='ready')return;
    expect(first.value.items).toHaveLength(2); expect(first.value.nextCursor).not.toBeNull();
    const cursor=first.value.nextCursor!;
    // A real unrelated message must not invalidate the earlier keyset token.
    expect(await h.mailbox.sendMessage(h.ctxHost,sendRequest(h.idleSession,'unrelated','page-unrelated'))).toMatchObject({status:'committed'});
    const second=await mailbox.readInbox(h.ctxHost,{recipient:h.busySession,status:'pending',page:{limit:2,cursor}});
    expect(second.status).toBe('ready'); if(second.status!=='ready')return;
    expect(new Set([...first.value.items,...second.value.items].map(item=>item.ref.messageId)).size).toBe(4);
    expect(second.value.nextCursor).toBeNull();
    expect(lookups).toBe(2);expect(events).toBe(0);expect(indexes.every(index=>index==='session-message-by-recipient-status')).toBe(true);
    for(const [ctx,recipient,status] of [[h.ctxWork,h.busySession,'pending'],[h.ctxHost,h.idleSession,'pending'],[h.ctxHost,h.busySession,'read']] as const)
      expect(await mailbox.readInbox(ctx,{recipient,status,page:{limit:2,cursor}})).toMatchObject({status:'rejected',code:'invalid'});
  });

  it('stores the body before a failed message commit, but neither inbox nor body API publishes the orphan', async () => {
    const h=await open(kind);let stored=0; let attempted:SessionMessageRef|undefined;
    const mailbox=h.makeMailbox({...h.fixture.records,async commit(batch){
      const message=batch.records.find(row=>JSON.parse(row.refKey).aggregateType==='SessionMessage');
      if(message)attempted=JSON.parse(message.refKey) as SessionMessageRef;
      return {status:'rejected' as const,code:'unavailable' as const,reason:'injected commit failure'};
    }},{...h.materials,async storeArtifact(ctx,input){const result=await h.materials.storeArtifact(ctx,input);if(result.status==='stored')stored++;return result;}});
    expect(await mailbox.sendMessage(h.ctxHost,sendRequest(h.idleSession,'orphan','orphan-send'))).toMatchObject({status:'rejected',code:'unavailable'});
    expect(stored).toBe(1);expect(attempted).toBeDefined();
    expect(await h.mailbox.readInbox(h.ctxHost,{recipient:h.idleSession,page:{limit:10}})).toMatchObject({status:'ready',value:{items:[]}});
    expect(await h.mailbox.readMessageBody(h.ctxHost,{messageRef:attempted!,part:'message'})).toMatchObject({status:'not_found'});
  });

  it('preserves committed success when cancellation arrives after the atomic write', async()=>{
    const h=await open(kind);const controller=new AbortController();
    const mailbox=h.makeMailbox({...h.fixture.records,async commit(batch){const receipt=await h.fixture.records.commit(batch);controller.abort();return receipt;}});
    const request=sendRequest(h.idleSession,'late cancel','late-cancel');
    const result=await mailbox.sendMessage({...h.ctxHost,signal:controller.signal},request);
    expect(result).toMatchObject({status:'committed',replayed:false});expect(controller.signal.aborted).toBe(true);
    if(result.status!=='committed')return;
    expect(await h.mailbox.sendMessage(h.ctxHost,request)).toEqual({...result,replayed:true});
  });


  it('cancellation after body storage prevents metadata publication', async()=>{
    const h=await open(kind);const controller=new AbortController();let stores=0;let commits=0;
    const mailbox=h.makeMailbox({...h.fixture.records,async commit(batch){commits++;return h.fixture.records.commit(batch);}},{...h.materials,async storeArtifact(ctx,input){const result=await h.materials.storeArtifact(ctx,input);stores++;controller.abort();return result;}});
    expect(await mailbox.sendMessage({...h.ctxHost,signal:controller.signal},sendRequest(h.idleSession,'cancel before commit','precommit-cancel'))).toMatchObject({status:'rejected',code:'cancelled'});
    expect(stores).toBe(1);expect(commits).toBe(0);
    expect(await h.mailbox.readInbox(h.ctxHost,{recipient:h.idleSession,page:{limit:10}})).toMatchObject({status:'ready',value:{items:[]}});
  });

});


it('SQLite closes both body and ledger connections, reopens the message, and rejects actual stored-body corruption', async()=>{
  const h=await open('sqlite');
  const sent=await h.mailbox.sendMessage(h.ctxHost,sendRequest(h.busySession,'durable body','durable-send'));
  expect(sent.status).toBe('committed');if(sent.status!=='committed')return;
  await h.reopen();
  expect(await h.mailbox.readMessageBody(h.ctxHost,{messageRef:sent.value.ref,part:'message'})).toMatchObject({status:'ready',value:{text:'durable body'}});
  const db=new DatabaseSync(h.bodyPath);
  try{ db.prepare('UPDATE artifacts SET record = ?').run('{broken-json'); }finally{db.close();}
  expect(await h.mailbox.readMessageBody(h.ctxHost,{messageRef:sent.value.ref,part:'message'})).toMatchObject({status:'rejected',code:'unavailable'});
});


it('a released same-owner Lease denies fresh mail while restoring the original send receipt', async () => {
  const h = await open('memory');
  const request = sendRequest(h.idleSession, 'before release', 'same-owner-original');
  const sent = await h.mailbox.sendMessage(h.ctxWork, request);
  expect(sent.status).toBe('committed'); if (sent.status !== 'committed') return;
  const leaseRef = { aggregateType: 'TaskLease', projectId: h.claim.task.projectId,
    goalId: h.claim.task.goalId, taskId: h.claim.task.taskId };
  const loaded = await h.fixture.records.readMany([key(leaseRef)]);
  expect(loaded.status).toBe('ready'); if (loaded.status !== 'ready') return;
  const row = loaded.value.records[0]!;
  const lease = JSON.parse(row.json);
  // Domain anomaly seed: release does not erase historical holder/attempt IDs.
  // This tests admission independently from the B2 terminal writer.
  const released = { ...lease, revision: lease.revision + 1,
    release: { schemaVersion: 1, runRef: h.claim.runRef, attemptRef: h.claim.attemptRef,
      sessionRef: h.claim.sessionRef, generation: h.claim.generation, releasedAt: AT, eventId: 'same-owner-release' } };
  expect(await h.fixture.commitRaw([{ ...row, revision: released.revision, json: JSON.stringify(released) }],
    [{ refKey: row.refKey, expectedRevision: row.revision }])).toMatchObject({ status: 'committed' });
  expect(await h.mailbox.sendMessage(h.ctxWork, request)).toEqual({ ...sent, replayed: true });
  expect(await h.mailbox.sendMessage(h.ctxWork, sendRequest(h.idleSession, 'after release', 'same-owner-fresh')))
    .toMatchObject({ status: 'rejected', code: 'forbidden' });
  const inbox = await h.mailbox.readInbox(h.ctxHost, { recipient: h.idleSession, page: { limit: 10 } });
  expect(inbox).toMatchObject({ status: 'ready', value: { items: [sent.value] } });
});

it('a failed publication retries across a Workspace revision using the first exact body provenance', async () => {
  const h = await open('memory');
  let firstRef: import('../../src/contracts/artifact.js').ArtifactRef | undefined;
  const failing = h.makeMailbox({ ...h.fixture.records, async commit() {
    return { status: 'rejected' as const, code: 'unavailable' as const, reason: 'publication unavailable' };
  } }, { ...h.materials, async storeArtifact(ctx, input) {
    const result = await h.materials.storeArtifact(ctx, input);
    if (result.status === 'stored') firstRef = result.ref;
    return result;
  } });
  const request = sendRequest(h.idleSession, 'unchanged scoped message', 'orphan-workspace-retry');
  expect(await failing.sendMessage(h.ctxHost, request)).toMatchObject({ status: 'rejected', code: 'unavailable' });
  expect(firstRef).toBeDefined(); if (!firstRef) throw Error('the real body must exist before publication fails');
  const bodyCtx: CoreCallContext = { ...h.ctxHost, principal: { kind: 'host', actor: systemActor },
    materialReader: { kind: 'host', projectId: h.ctxHost.projectId, workspaceId: h.fixture.scope.workspaceId, actor: systemActor } };
  const originalBody = await h.materials.openArtifact(bodyCtx, { ref: firstRef, usage: 'historical_explanation' });
  expect(originalBody.status).toBe('ready'); if (originalBody.status !== 'ready') return;
  const loaded = await h.fixture.records.readMany([key(h.fixture.workspaceRef)]);
  expect(loaded.status).toBe('ready'); if (loaded.status !== 'ready') return;
  const row = loaded.value.records[0]!; const workspace = JSON.parse(row.json);
  const advanced = { ...workspace, revision: workspace.revision + 1 };
  expect(await h.fixture.commitRaw([{ ...row, revision: advanced.revision, json: JSON.stringify(advanced) }],
    [{ refKey: row.refKey, expectedRevision: row.revision }])).toMatchObject({ status: 'committed' });
  const retried = await h.mailbox.sendMessage(h.ctxHost, request);
  expect(retried).toMatchObject({ status: 'committed', replayed: false });
  if (retried.status !== 'committed') return;
  expect(retried.value.bodyRef).toEqual(firstRef);
  expect(retried.value.sourceRef).toEqual(firstRef.source);
  expect(await h.materials.openArtifact(bodyCtx, { ref: firstRef, usage: 'historical_explanation' })).toEqual(originalBody);
  expect(await h.mailbox.readMessageBody(h.ctxHost, { messageRef: retried.value.ref, part: 'message' }))
    .toMatchObject({ status: 'ready', value: { text: request.input.text, sourceRef: firstRef.source, usage: 'message' } });
});

it('mutating an inbox page during WG11 cannot transfer a Host continuation to a work Run', async () => {
  const h = await open('memory');
  for (let i = 0; i < 3; i++) expect(await h.mailbox.sendMessage(h.ctxHost,
    sendRequest(h.busySession, `isolated page ${i}`, `isolated-page-${i}`))).toMatchObject({ status: 'committed' });
  const first = await h.mailbox.readInbox(h.ctxHost, { recipient: h.busySession, page: { limit: 1 } });
  expect(first.status).toBe('ready'); if (first.status !== 'ready') return;
  expect(first.value.nextCursor).not.toBeNull();
  const cursor = first.value.nextCursor!;
  expect(await h.mailbox.readInbox(h.ctxWork, { recipient: h.busySession, page: { limit: 1, cursor } }))
    .toMatchObject({ status: 'rejected', code: 'invalid' });
  const page: { limit: number; cursor?: string } = { limit: 1, cursor };
  let changed = false;
  const mailbox = h.makeMailbox({ ...h.fixture.records, async readMany(refKeys) {
    const result = await h.fixture.records.readMany(refKeys);
    if (!changed) { changed = true; delete page.cursor; }
    return result;
  } });
  const received = await mailbox.readInbox(h.ctxWork, { recipient: h.busySession, page });
  expect(changed).toBe(true);
  // The accepted token belonged to the Host. Deleting it in caller memory may
  // not turn that request into an authorized work-Run continuation or first page.
  expect(received).toMatchObject({ status: 'rejected', code: 'invalid' });
  const valid = await h.mailbox.readInbox(h.ctxHost, { recipient: h.busySession, page: { limit: 1, cursor } });
  expect(valid.status).toBe('ready');
  if (valid.status === 'ready') expect(valid.value.items[0]?.ref).not.toEqual(first.value.items[0]?.ref);
});
