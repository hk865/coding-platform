/** Slice 1 §5.3: wait disposal, late replies and effective-handler acceptance. */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionArchiveRequestV1 } from '../../src/contracts/core/session-archive.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import { deriveSessionInputId, type SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { createArchiveServiceFixture, committed, ready, t1, type ArchiveServiceFixture } from '../helpers/S1-archive-service-fixture.js';

const opened: ArchiveServiceFixture[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
async function open(kind: 'memory' | 'sqlite', deferYield = false) {
  const f = await createArchiveServiceFixture(kind); opened.push(f);
  await f.enter();
  const message = await f.send();
  if (!deferYield) await f.yieldWait(message);
  await f.enter(f.b2.secondClaim);
  return { f, message };
}
async function transfer(f: ArchiveServiceFixture, message: SessionMessage) {
  const request = await f.register({ wait: { kind: 'transfer', runRef: f.b2.claim.runRef, messageRef: message.ref, to: f.D } });
  const receipt = committed(await f.mailbox.disposeArchiveWait(f.ctx, f.step(request, 'reply_handler', message.ref)));
  return { request, receipt };
}
async function closeWait(f: ArchiveServiceFixture, request: SessionArchiveRequestV1) {
  const step = f.step(request, 'wait_cancel', f.b2.claim.runRef);
  const receipt = committed(await f.mailbox.disposeArchiveWait(f.ctx, step));
  const control = await f.cancel(request);
  const run = (await f.execution()).run;
  expect(run.outcome).toBe('yielded');
  expect(run.controlState).toEqual({ intentRef: control.value.intent.ref, desiredState: 'cancelled' });
  expect(ready(await f.sessionFacts.readSessionFacts(f.ctx, f.S)).wait).toBeNull();
  return { step, receipt, control };
}
function acceptWrite(f: ArchiveServiceFixture, message: SessionMessage, claim: TaskClaim,
  fact: Awaited<ReturnType<ArchiveServiceFixture['kernelAccept']>>) {
  return { input: { messageRef: message.ref, part: 'response' as const, executionRef: claim.runRef,
    executionSessionRef: claim.sessionRef, kernel: fact.kernel },
    meta: { requestId: `input-accepted:${fact.kernel.kernelSessionId}:${fact.kernel.runId}:${fact.kernel.position}`, expected: [] } };
}
async function acceptedByD(f: ArchiveServiceFixture, message: SessionMessage) {
  const fact = await f.kernelAccept(f.b2.secondClaim, message);
  const write = acceptWrite(f, message, f.b2.secondClaim, fact);
  const result = committed(await f.mailbox.recordInputAccepted(f.ctx, write));
  const expected = [{ inputId: deriveSessionInputId(message.ref, 'response'), part: 'response',
    executionRef: f.b2.secondClaim.runRef, kernel: fact.kernel, acceptedAt: f.now() }];
  expect(result.value.acceptedInputs).toEqual(expected);
  expect(ready(await f.mailbox.readMessage(f.ctx, message.ref)).acceptedInputs).toEqual(expected);
  return { result, write };
}
const dispositions = (f: ArchiveServiceFixture, step: 'reply_handler' | 'wait_cancel') => f.batches.filter(({ batch }) => batch.events.some(event => {
  if (event.eventType !== 'ArchiveWaitDisposed') return false;
  const body = JSON.parse(event.json) as { archiveStep?: { step: string } };
  return body.archiveStep?.step === step;
}));
const controlSubmissions = (f: ArchiveServiceFixture) => f.batches.filter(({ batch }) =>
  batch.events.some(event => event.eventType === 'ControlIntentSubmitted'));

describe.each(['memory', 'sqlite'] as const)('wait disposal (%s)', kind => {
  it('SV30 transfers before the reply, cancels the old wait and accepts the original response exactly once in D', async () => {
    const { f, message } = await open(kind);
    const { request, receipt } = await transfer(f, message);
    expect(receipt.value.bodyRef).toEqual(message.bodyRef);
    expect(receipt.value.response).toBeNull();
    expect(receipt.value.replyHandler).toEqual({ sessionRef: f.D, archiveSessionRef: f.S,
      archiveRequestId: request.requestId, changedAt: f.now() });
    const cancelled = await closeWait(f, request);
    const replied = await f.respond(message);
    const { result, write } = await acceptedByD(f, message);
    expect(result.value.bodyRef).toEqual(message.bodyRef);
    expect(result.value.response).toEqual(replied.value.response);
    const before = f.snapshot();
    expect(await f.mailbox.recordInputAccepted(f.ctx, write)).toEqual({ ...result, replayed: true });
    expect(await f.mailbox.disposeArchiveWait(f.ctx, f.step(request, 'reply_handler', message.ref)))
      .toEqual({ ...receipt, replayed: true });
    expect(await f.mailbox.disposeArchiveWait(f.ctx, cancelled.step)).toEqual({ ...cancelled.receipt, replayed: true });
    expect(f.snapshot()).toEqual(before);
    expect(controlSubmissions(f)).toHaveLength(1);
    await f.invariants();
  });

  it('SV31 retries the failed wait_cancel on the same store and replays the original transfer and cancellation receipts', async () => {
    const { f, message } = await open(kind);
    const { request, receipt: transferReceipt } = await transfer(f, message);
    const cancelStep = f.step(request, 'wait_cancel', f.b2.claim.runRef);
    const sourceBefore = (await f.session()).record;
    const messageBefore = await f.encoded(message.ref);
    const before = f.snapshot();
    f.failNextCommit();
    const failed = await f.mailbox.disposeArchiveWait(f.ctx, cancelStep);
    expect(failed.status).toBe('rejected');
    if (failed.status !== 'rejected') throw new Error(JSON.stringify(failed));
    expect(failed.code).toBe('unavailable');
    expect(failed.reason.startsWith('fx1 injected commit failure')).toBe(true);
    expect({ records: f.writes.records, events: f.writes.events, receipts: f.writes.receipts }).toEqual({
      records: before.writes.records, events: before.writes.events, receipts: before.writes.receipts });
    expect(await f.encoded(message.ref)).toEqual(messageBefore);
    expect((await f.session()).record).toEqual(sourceBefore);
    await f.reopen();
    const retry = committed(await f.mailbox.disposeArchiveWait(f.ctx, cancelStep));
    expect(retry.replayed).toBe(false);
    const control = await f.cancel(request);
    expect((await f.execution()).run.controlState).toEqual({ intentRef: control.value.intent.ref, desiredState: 'cancelled' });
    expect(ready(await f.sessionFacts.readSessionFacts(f.ctx, f.S)).wait).toBeNull();
    const afterRecovery = f.snapshot();
    expect(await f.mailbox.disposeArchiveWait(f.ctx, f.step(request, 'reply_handler', message.ref)))
      .toEqual({ ...transferReceipt, replayed: true });
    expect(await f.mailbox.disposeArchiveWait(f.ctx, cancelStep)).toEqual({ ...retry, replayed: true });
    expect(await f.controls.submitControl(f.ctx, f.cancelRequest(request, f.b2.claim.runRef)))
      .toEqual({ ...control, replayed: true });
    expect(f.snapshot()).toEqual(afterRecovery);
    expect(dispositions(f, 'reply_handler')).toHaveLength(1);
    expect(dispositions(f, 'wait_cancel')).toHaveLength(1);
    expect(controlSubmissions(f)).toHaveLength(1);
    await f.invariants();
  });

  it('SV32 transfer after a saved response lets D consume that response without another question or answer', async () => {
    const { f, message } = await open(kind);
    const replied = await f.respond(message);
    const response = replied.value.response;
    if (!response) throw new Error('reply slot missing');
    const sentBefore = f.batches.filter(({ batch }) => batch.events.some(e => e.eventType === 'SessionMessageSent')).length;
    const repliesBefore = f.batches.filter(({ batch }) => batch.events.some(e => e.eventType === 'SessionMessageResponded')).length;
    const { request, receipt } = await transfer(f, message);
    expect(receipt.value.response).toEqual(response);
    await closeWait(f, request);
    const routed = ready(await f.mailbox.readRoutedReplies(f.ctx, { handler: f.D, page: { limit: 20 } }));
    expect(routed.items.map(m => ({ ref: m.ref, responseRef: m.response?.bodyRef })))
      .toEqual([{ ref: message.ref, responseRef: response.bodyRef }]);
    const { result } = await acceptedByD(f, message);
    expect(result.value.response).toEqual(response);
    expect(result.value.bodyRef).toEqual(message.bodyRef);
    expect(ready(await f.mailbox.readInbox(f.ctx, { recipient: f.D, page: { limit: 20 } })).items.map(m => m.ref))
      .toEqual([message.ref]);
    expect(sentBefore).toBe(1); expect(repliesBefore).toBe(1);
    expect(f.batches.filter(({ batch }) => batch.events.some(e => e.eventType === 'SessionMessageSent'))).toHaveLength(sentBefore);
    expect(f.batches.filter(({ batch }) => batch.events.some(e => e.eventType === 'SessionMessageResponded'))).toHaveLength(repliesBefore);
  });

  it('SV33 a late reply to an archived retired source with no continuation remains undelivered', async () => {
    const { f, message } = await open(kind);
    await f.retire();
    const request = await f.register({ mode: 'retired' }); // Retired exception needs no wait choice.
    const archived = committed(await f.lifecycle.finishSessionArchive(f.archiveCtx(request), f.step(request, 'archive')));
    expect(archived.value.lifecycle).toBe('archived');
    f.setNow(t1);
    const replied = await f.respond(message);
    const response = replied.value.response;
    if (!response) throw new Error('late response missing');
    const before = f.snapshot();
    const undelivered = ready(await f.mailbox.readUndeliveredReplies(f.ctx, { sessionRef: f.S, page: { limit: 20 } }));
    expect(undelivered.items).toEqual([{ kind: 'retired_reply', messageRef: message.ref, sourceSessionRef: f.S,
      responseRef: response.bodyRef, respondedAt: response.respondedAt, hasContinuation: false, requiresUserRecipient: true }]);
    const saved = ready(await f.mailbox.readMessage(f.ctx, message.ref));
    expect(saved.status).toBe('responded');
    expect(saved.replyHandler ?? null).toBeNull();
    expect(saved.acceptedInputs ?? []).toEqual([]);
    expect(saved).toEqual(replied.value);
    expect(f.snapshot()).toEqual(before);
  });

  it('SV34 a retired source with a continuation keeps the late response without pushing it into the successor Kernel', async () => {
    const { f, message } = await open(kind);
    await f.retire();
    const successor = await f.continuation();
    const request = await f.register({ mode: 'retired' });
    committed(await f.lifecycle.finishSessionArchive(f.archiveCtx(request), f.step(request, 'archive')));
    f.setNow(t1);
    const replied = await f.respond(message);
    const response = replied.value.response;
    if (!response) throw new Error('late response missing');
    const successorBefore = (await f.session(successor)).record;
    const before = f.snapshot();
    expect(ready(await f.mailbox.readUndeliveredReplies(f.ctx, { sessionRef: f.S, page: { limit: 20 } })).items)
      .toEqual([{ kind: 'retired_reply', messageRef: message.ref, sourceSessionRef: f.S, responseRef: response.bodyRef,
        respondedAt: response.respondedAt, hasContinuation: true, requiresUserRecipient: false }]);
    const saved = ready(await f.mailbox.readMessage(f.ctx, message.ref));
    expect(saved.response).toEqual(response);
    expect(saved.acceptedInputs ?? []).toEqual([]);
    expect(saved.replyHandler ?? null).toBeNull();
    expect((await f.session(successor)).record).toEqual(successorBefore);
    expect(successorBefore.lastExecutionRef).toBeNull();
    expect(f.snapshot()).toEqual(before);
  });

  it('SV54 S cannot confirm its real but unconfirmed Kernel response event once the handler is D', async () => {
    const { f, message } = await open(kind, true);
    await f.respond(message);
    // Persist the Kernel event while S is still running, but deliberately defer
    // its WG confirmation. The real Kernel then yields; transfer wins that race.
    const fact = await f.kernelAccept(f.b2.claim, message, true);
    await f.end(f.b2.claim, fact.terminal, message.ref, fact.terminalPosition);
    const { request } = await transfer(f, message);
    await closeWait(f, request);
    const saved = await f.encoded(message.ref);
    const before = f.snapshot();
    const result = await f.mailbox.recordInputAccepted(f.ctx, acceptWrite(f, message, f.b2.claim, fact));
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error(JSON.stringify(result));
    expect(result.code).toBe('forbidden');
    expect(ready(await f.mailbox.readMessage(f.ctx, message.ref)).acceptedInputs ?? []).toEqual([]);
    expect(await f.encoded(message.ref)).toEqual(saved);
    expect(f.snapshot()).toEqual(before);
    await f.invariants();
  });

  it('SV55 the real input_accepted event in D confirms exactly the original response inputId and D Run', async () => {
    const { f, message } = await open(kind);
    const replied = await f.respond(message);
    const { request } = await transfer(f, message);
    await closeWait(f, request);
    const { result } = await acceptedByD(f, message);
    expect(result.value.response).toEqual(replied.value.response);
    expect(result.value.acceptedInputs?.map(input => ({ inputId: input.inputId, part: input.part, executionRef: input.executionRef })))
      .toEqual([{ inputId: deriveSessionInputId(message.ref, 'response'), part: 'response', executionRef: f.b2.secondClaim.runRef }]);
  });
});
