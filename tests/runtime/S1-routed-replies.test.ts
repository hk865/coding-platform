/** Slice 1 §2.5: real waits, routed replies and Kernel before_model acceptance. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { SessionMailboxPort } from '../../src/core/work-graph/model/communication-contracts.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import { createMailboxInputSupply, deriveInputId } from '../../src/core/agent-runtime/execution-inputs.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { acceptedMessageInputs } from '../scenarios/support/brief.js';
import { committed, installS1DateClock, openS1RuntimeFixture, ready } from '../helpers/S1-runtime-scenario-fixture.js';

const QUESTION = 'Which file should the interrupted work write?';
const REPLY = 'Write src/s1-routed-result.txt.';
type Fixture = Awaited<ReturnType<typeof openS1RuntimeFixture>>;
const opened: Fixture[] = [];
let restoreClock: (() => void) | undefined;
beforeEach(() => { restoreClock = installS1DateClock(); });
afterEach(async () => {
  try { for (const f of opened.splice(0)) await f.close(); } finally { restoreClock?.(); }
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function workCtx(f: Fixture, claim: TaskClaim): CoreCallContext {
  return { ...f.base.ctx, principal: { kind: 'work_run', runRef: claim.runRef, roleBinding: f.base.roleBinding },
    materialReader: { kind: 'run', requester: claim.runRef } };
}
async function openWait(overlap = false, idle = false) {
  const held = deferred();
  const release = deferred();
  const send = { callId: 'send-wait', name: 'send_session_message',
    args: { recipient: {}, text: QUESTION, replyMode: 'wait' } as Record<string, unknown> };
  const extras = overlap ? [0, 1].map(i => ({ callId: `other-question-${i}`, name: 'send_session_message',
    args: { recipient: {}, text: `independent question ${i}`, intent: 'inquiry', needsReply: true } as Record<string, unknown> })) : [];
  const f = await openS1RuntimeFixture({ replies: [
    { kind: 'calls', calls: [...extras, send] },
    idle ? { kind: 'text', text: 'recipient done' } : { kind: 'calls', calls: [{ callId: 'handler-read', name: 'read', args: { path: 'safe-point.txt' } }] },
    { kind: 'text', text: 'handler done' },
  ], beforeReply: async (_request, index) => {
    if (index === 1) {
      held.resolve(); await release.promise;
      if (idle) throw new Error('S1 recipient failed after saving its response');
    }
  } });
  opened.push(f);
  await writeFile(join(f.base.directory, 'safe-point.txt'), 'safe point\n');
  const recipient = f.base.sessions.second;
  send.args['recipient'] = recipient;
  for (const item of extras) item.args['recipient'] = recipient;
  const sender = await f.claim();
  await f.run(sender);
  const yielded = await f.read(sender);
  expect(yielded.run).toMatchObject({ status: 'ended', outcome: 'yielded', continuation: { kind: 'wait_reply' } });
  const messageRef = yielded.run.continuation?.messageRef;
  if (!messageRef) throw new Error('the real Kernel did not yield a wait message');
  const message = ready(await f.messages.readMessage(f.base.ctx, messageRef));
  if (overlap) {
    // Serial tool groups yield after the wait send, so filler sends precede it.
    expect(ready(await f.messages.readOutbox!(f.base.ctx, { senderSession: sender.sessionRef, page: { limit: 20 } }))
      .items).toHaveLength(3);
  }
  const recipientClaim = await f.claim(recipient, f.base.tasks.second.taskId);
  const D = idle ? await f.createSession() : recipient;
  return { f, sender, recipientClaim, D, message, held, release };
}
type Row = Awaited<ReturnType<typeof openWait>>;
async function transfer(row: Row) {
  const { f, sender, D, message } = row;
  const source = committed(await f.lifecycle.requestSessionArchive(f.base.ctx, { input: {
    sessionRef: sender.sessionRef, reason: 'transfer the saved wait', tasks: [],
    wait: { kind: 'transfer', runRef: sender.runRef, messageRef: message.ref, to: D } },
    meta: { requestId: f.newId(), expected: [await f.base.sessionPin(sender.sessionRef)] } }));
  const request = source.archiveRequest;
  if (!request) throw new Error('the archive request did not persist');
  const dispose = f.messages.disposeArchiveWait;
  if (!dispose) throw new Error('disposeArchiveWait is missing');
  const moved = committed(await dispose(f.base.ctx, { sessionRef: sender.sessionRef, archiveRequestId: request.requestId,
    requestReceipt: request.receipt, step: 'reply_handler', subjectKey: canonicalJson(message.ref as unknown as JsonValue) }));
  expect(moved.replyHandler?.sessionRef).toEqual(D);
  // The old wait closes by the real control owner; no fabricated ConsumedWait.
  const stop = committed(await f.controls.submitControl(f.base.ctx, { input: {
    runRef: sender.runRef, kind: 'cancel', reason: request.reason },
    meta: { requestId: 's1-archive-control:' + sha256Hex(canonicalJson({ requestReceipt: request.receipt,
      runRef: sender.runRef, action: 'cancel' } as JsonValue)),
      expected: request.executionPins.filter(pin => canonicalJson(pin.ref as JsonValue) === canonicalJson(sender.runRef as JsonValue)) } }));
  ready(await f.runtime.port.deliverControl!(f.base.ctx, { intentRef: stop.intent.ref }));
  await f.checked.check();
  return moved;
}
async function respond(row: Row) {
  const { f, recipientClaim, message } = row;
  const current = ready(await f.messages.readMessage(f.base.ctx, message.ref));
  return committed(await f.messages.respondMessage(workCtx(f, recipientClaim), { input: { messageRef: message.ref, text: REPLY },
    meta: { requestId: f.newId(), expected: [{ ref: message.ref, revision: current.revision }] } }));
}
async function sourceInputs(row: Row) {
  const { f, sender } = row;
  const auth = (await f.read(sender)).run.executionAuthorization;
  if (!auth || !('schemaVersion' in auth) || auth.schemaVersion !== 2 || !auth.kernel) throw new Error('source has no Kernel binding');
  const supply = createMailboxInputSupply({ messages: f.messages, context: () => workCtx(f, sender), sessionRef: sender.sessionRef, runRef: sender.runRef });
  return supply({ sessionId: auth.kernel.kernelSessionId, runId: auth.kernel.runId, turnId: auth.kernel.turnId,
    afterEventSequence: 0, acceptedInputIds: [] }, { signal: f.base.ctx.signal });
}
async function counts(f: Fixture) {
  const world = await f.checked.check();
  return { tasks: world.taskStates.length, workRuns: world.outboxes.length, queries: world.queryRuns.length, models: f.scripted.calls() };
}
async function expectAccepted(row: Row, claim: TaskClaim) {
  const saved = ready(await row.f.messages.readMessage(row.f.base.ctx, row.message.ref));
  expect((saved.acceptedInputs ?? []).filter(input => input.part === 'response').map(input => ({
    inputId: input.inputId, executionRef: input.executionRef, part: input.part,
  }))).toEqual([{ inputId: deriveInputId(row.message.ref, 'response'), executionRef: claim.runRef, part: 'response' }]);
  expect(acceptedMessageInputs(row.f.base.directory).filter(input => input.messageId === row.message.ref.messageId && input.part === 'response')
    .map(input => input.text)).toEqual([REPLY]);
  expect({ bodyRef: saved.bodyRef, sender: saved.sender, recipient: saved.recipient })
    .toEqual({ bodyRef: row.message.bodyRef, sender: row.message.sender, recipient: row.message.recipient });
}

describe('S1 routed replies at real before_model boundaries', () => {
  it('IT28 the running handler accepts exactly one original response and the source gets none', async () => {
    const row = await openWait();
    const running = row.f.run(row.recipientClaim);
    try {
      await row.held.promise;
      const before = await counts(row.f);
      await transfer(row);
      await respond(row);
      expect(await counts(row.f)).toEqual(before);
      expect(await sourceInputs(row)).toEqual([]);
      row.release.resolve();
      await running; // read tool drains, then the NEXT real before_model accepts m.
      await expectAccepted(row, row.recipientClaim);
      expect(await sourceInputs(row)).toEqual([]);
    } finally { row.release.resolve(); await running; }
  });

  it('IT29 overlapping persisted pages supply once and formal acceptance suppresses every later supply', async () => {
    const row = await openWait(true);
    const { f } = row;
    const pages = { outbox: 0, routed: 0, overlap: 0 };
    const responsePages = { outbox: [] as string[], routed: [] as string[] };
    // The duplicate-candidate seam forwards to the REAL owners (limit one).
    // It exposes the original outbox alongside the handler index, with an
    // overlapping copy of the SAME saved reply on each source page. This is
    // an explicit reader-fault seam: strict production keysets do not overlap.
    // The actual records, advancing cursors and acceptance writer stay real.
    const messages: SessionMailboxPort = { ...f.messages,
      async readOutbox(_ctx, input) {
        pages.outbox++;
        const page = ready(await f.messages.readOutbox!(f.base.ctx, { ...input, senderSession: row.sender.sessionRef,
          page: { ...input.page, limit: 1 } }));
        const original = ready(await f.messages.readMessage(f.base.ctx, row.message.ref));
        if (input.page.cursor !== undefined) pages.overlap++;
        const items = [original, ...page.items];
        responsePages.outbox.push(...items.filter(item => item.status === 'responded').map(item => item.ref.messageId));
        return { status: 'ready', value: { ...page, items } };
      },
      async readRoutedReplies(ctx, input) {
        pages.routed++;
        const result = await f.messages.readRoutedReplies!(ctx, { ...input, page: { ...input.page, limit: 1 } });
        if (result.status === 'ready') responsePages.routed.push(...result.value.items.map(item => item.ref.messageId));
        return result;
      },
    };
    const runtime = createAgentRuntime({ ...f.deps, messages });
    const prepared = await f.prepare(row.recipientClaim);
    const running = runtime.port.startRun(f.base.ctx, { prepared, consumerId: 's1-overlap', requestId: f.newId() });
    try {
      await row.held.promise;
      const beforeReply = await counts(f);
      await transfer(row);
      await respond(row);
      expect(await counts(f)).toEqual(beforeReply);
      row.release.resolve();
      ready(await running);
      await expectAccepted(row, row.recipientClaim);
      expect(pages.outbox).toBeGreaterThanOrEqual(3);
      expect(pages.routed).toBeGreaterThan(0);
      expect(pages.overlap).toBeGreaterThan(0);
      expect(responsePages.outbox.filter(id => id === row.message.ref.messageId).length).toBeGreaterThanOrEqual(3);
      expect([...new Set(responsePages.routed)]).toEqual([row.message.ref.messageId]);
      const before = await counts(f);
      const supply = createMailboxInputSupply({ messages, context: () => workCtx(f, row.recipientClaim),
        sessionRef: row.D, runRef: row.recipientClaim.runRef });
      const auth = (await f.read(row.recipientClaim)).run.executionAuthorization;
      if (!auth || !('schemaVersion' in auth) || auth.schemaVersion !== 2 || !auth.kernel) throw new Error('D must have its real Kernel identity');
      expect(await supply({ sessionId: auth.kernel.kernelSessionId, runId: auth.kernel.runId, turnId: auth.kernel.turnId,
        afterEventSequence: 0, acceptedInputIds: [] }, { signal: f.base.ctx.signal })).toEqual([]);
      expect(await counts(f)).toEqual(before);
    } finally { row.release.resolve(); ready(await running); }
  });

  it('IT30 idle unrelated D retains the reply without new work until its next legal execution safe point', async () => {
    const row = await openWait(false, true);
    const { f } = row;
    const running = f.run(row.recipientClaim);
    try {
      await row.held.promise;
      const beforeReply = await counts(f);
      await transfer(row);
      await respond(row);
      expect(await counts(f)).toEqual(beforeReply);
      row.release.resolve();
      await running;
      const card = ready(await f.deps.sessions.readSession(f.base.ctx, row.D));
      expect(card.record.occupancy).toBeNull();
      expect(card.links.filter(link => link.until === null && link.ref.relation === 'responsible')).toEqual([]);
      const before = await counts(f);
      const message = ready(await f.messages.readMessage(f.base.ctx, row.message.ref));
      expect(message.acceptedInputs ?? []).toEqual([]);
      expect(ready(await f.messages.readRoutedReplies!(f.base.ctx, { handler: row.D, page: { limit: 20 } })).items.map(item => item.ref))
        .toEqual([message.ref]);
      expect(await counts(f)).toEqual(before);
      // E's provider failed after it saved the reply. Requeue its independent
      // Task B through the owner; D's new Work is unrelated to S's waiting A.
      expect((await f.read(row.recipientClaim)).run.outcome).toBe('crashed');
      const retry = await f.requeue(row.recipientClaim);
      const next = await f.claim(row.D, row.recipientClaim.task.taskId, retry.ref);
      await f.run(next);
      await expectAccepted(row, next);
      const world = await f.checked.check();
      expect(world.outboxes.filter(box => box.claim.sessionRef.sessionId === row.sender.sessionRef.sessionId)
        .map(box => box.claim.runRef)).toEqual([row.sender.runRef]);
    } finally { row.release.resolve(); await running; }
  });
});
