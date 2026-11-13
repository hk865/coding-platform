/**
 * XWS — multi-workspace message delivery, the mailbox layer (R1–R4).
 *
 * R1: a Host system `notify` whose recipient Session lives in ANOTHER
 * workspace of the same project is accepted, and the message record lives in
 * the RECIPIENT's workspace; the sender's workspace inbox never shows it.
 * R2: the replay identity stays the sender's (sender workspace + sender
 * identity + requestId): the same requestId replays one message, a changed
 * recipient is `idempotency_conflict`, and the message id is the sender
 * workspace's hash (hand-computed below, never `hostMessageId`).
 * R3: across workspaces only a `notify` that needs no reply is accepted, from
 * any sender; the Host system `notify` and `action_request` cross as before.
 * R4 follows from R1 (the record's event lives with the record).
 *
 * XW-1 runs on memory and SQLite (S3: the recipient index and the receipt
 * replay); XW-2 also both (S3: the receipt identity); XW-3 and XW-4 are
 * business rows on memory. XW-5 (R7) is not proven here: the two-workspace
 * world configures no Runtime and no Workflow binding for the second
 * workspace (`tests/helpers/S6A-request-fixture.ts:946–:951`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import { systemRoundContext } from '../../src/contracts/plan-round.js';
import { decodeKernelEntry } from '../../src/core/agent-runtime/kernel-turn-facts.js';
import type { SessionHistoryEntry } from '../../src/core/agent-runtime/session-operations.js';
import type {
  SessionMessage, SessionMessageSendInputV1,
} from '../../src/core/work-graph/model/communication-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import {
  openS6ATwoWorkspaceWorld, S6A_SCOPE, S6A_SECOND_SCOPE, S6A_WORK_ROLE,
  type S6AExtraBinding, type S6ARequestWorld,
} from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { claimedRunOf, ready, S7A_REPLY_TOOLS } from '../helpers/S7A-fixture.js';

const P = S6A_SCOPE.projectId;
const A_WORKSPACE = S6A_SCOPE.workspaceId;
const B_WORKSPACE = S6A_SECOND_SCOPE.workspaceId;
/** The Host system-round identity, handwritten (F8): `SYSTEM_ROUND_ACTOR` is not imported. */
const HOST_SYSTEM = { kind: 'system', id: 'host:plan-round' } as const;
/** The world's human operator, handwritten (F8). */
const OPERATOR = { kind: 'human', id: 's6a-operator' } as const;
/** L1: the cross-workspace reply refusal, handwritten from the ruling (F8), never imported from `src`. */
const L1 = 'only a notify that needs no reply may go to a line in another workspace of the project: '
  + 'replies and waits are read back in the sender\'s workspace';

/**
 * The frozen Host message-id formula (`src/contracts/plan-round.ts:112–:127`'s
 * comment): sender workspace + Host actor + requestId. It names the id, not the
 * record's workspace, so the cross-workspace rows use it to name the message.
 */
const idOf = (actor: { kind: 'human' | 'system'; id: string }, requestId: string): string =>
  'session-message-' + sha256Hex(canonicalJson({
    projectId: P, workspaceId: B_WORKSPACE, sender: { kind: 'host', actor: { ...actor } }, requestId,
  } as never));

const worlds: S6ARequestWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

async function openWorld(backend: 'memory' | 'sqlite', extraBindings: readonly S6AExtraBinding[] = []) {
  const { world } = await openS6ATwoWorkspaceWorld({ backend,
    ...(extraBindings.length === 0 ? {} : { extraBindings }) });
  worlds.push(world);
  return { world, a: s6aCardsWorkspace(world, S6A_SCOPE), b: s6aCardsWorkspace(world, S6A_SECOND_SCOPE) };
}

/** The Host system-round context of the second workspace: the cross-workspace sender. */
const senderContext = () => systemRoundContext({ ...S6A_SECOND_SCOPE }, new AbortController().signal);

/** One Host system send from the second workspace, through the public mailbox owner. */
const systemSend = (world: S6ARequestWorld, requestId: string, input: SessionMessageSendInputV1['input']) =>
  world.platform.messages.sendMessage(senderContext(), { input, meta: { requestId, expected: [] } });

/** One workspace's inbox read; `S7B-F-support.inboxOf` is A-only (it hardcodes `S6A_SCOPE`), so this takes the
 * workspace the read runs in. */
async function inboxIn(ws: S6ACardsWorkspace, recipient: SessionRef): Promise<SessionMessage[]> {
  return ready<{ items: SessionMessage[] }>(await ws.route('messages/inbox', { recipient, page: { limit: 100 } }),
    `the inbox of ${recipient.sessionId} in ${ws.scope.workspaceId}`).items;
}

async function bodyOf(ws: S6ACardsWorkspace, message: SessionMessage['ref']): Promise<string> {
  return ready<{ text: string }>(await ws.route('messages/body', { messageRef: message, part: 'message' }),
    `the body of ${message.messageId}`).text;
}

describe.each(['memory', 'sqlite'] as const)('XWS cross-workspace delivery (%s)', (backend) => {
  it('XW-1 accepts a Host system notify into the recipient workspace, replays it as one message, and keeps it out of the sender inbox', async () => {
    /* Named mutation: the cross-workspace send writes its record under the sender workspace
       (`src/core/work-graph/communication/mailbox-send.ts:574–:576`, the SessionMessage ref the send
       commits) instead of the recipient's. Then `expect(aItems).toHaveLength(1)` goes red, the body
       read finds no message, and the sender-workspace inbox turns non-empty. */
    const { world, a, b } = await openWorld(backend);
    const lineA = await createS6BLine(a, { label: 'xws-line-a', role: S6A_WORK_ROLE });
    const text = 'XWS-1 跨工作区通知';
    const expectedRef = { aggregateType: 'SessionMessage', projectId: P, workspaceId: A_WORKSPACE,
      messageId: idOf(HOST_SYSTEM, 'xws-1') } as const;

    const first = await systemSend(world, 'xws-1', { recipient: lineA.ref, intent: 'notify', text });
    expect(first.status, `the first send: ${JSON.stringify(first)}`).toBe('committed');
    if (first.status !== 'committed') throw new Error(`XW-1: the first send was not committed: ${JSON.stringify(first)}`);
    expect(first.value.ref).toEqual(expectedRef);
    expect(first.value.revision).toBe(1);

    const second = await systemSend(world, 'xws-1', { recipient: lineA.ref, intent: 'notify', text });
    expect(second.status, `the replay: ${JSON.stringify(second)}`).toBe('committed');
    if (second.status !== 'committed') throw new Error(`XW-1: the replay was not committed: ${JSON.stringify(second)}`);
    expect(second.value.ref).toEqual(expectedRef);
    expect(second.value.revision).toBe(1);

    const aItems = (await inboxIn(a, lineA.ref)).filter(item => item.ref.messageId === expectedRef.messageId);
    expect(aItems).toHaveLength(1);
    expect(await bodyOf(a, expectedRef)).toBe(text);
    expect(await inboxIn(b, lineA.ref)).toEqual([]);
  });

  it('XW-2 keeps the replay identity on the sender when the recipient changes', async () => {
    /* Named mutation: key the send receipt by the recipient workspace
       (`src/core/work-graph/communication/mailbox-send.ts:350`, `identityKeyOf('send', …)`). The second
       send is then a new identity and commits into A, so `expect(second).toMatchObject(…)` goes red and
       the A inbox gains the message id. */
    const { world, a, b } = await openWorld(backend);
    const lineA = await createS6BLine(a, { label: 'xws-line-a', role: S6A_WORK_ROLE });
    const lineB = await createS6BLine(b, { label: 'xws-line-b', role: S6A_WORK_ROLE });
    const first = await systemSend(world, 'xws-2', { recipient: lineB.ref, intent: 'notify', text: 'XWS-2' });
    expect(first.status, `the first send: ${JSON.stringify(first)}`).toBe('committed');
    if (first.status !== 'committed') throw new Error(`XW-2: the first send was not committed: ${JSON.stringify(first)}`);
    expect(first.value.ref.workspaceId).toBe('s6a-second-workspace');

    const second = await systemSend(world, 'xws-2', { recipient: lineA.ref, intent: 'notify', text: 'XWS-2' });
    expect(second).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect((await inboxIn(a, lineA.ref)).map(item => item.ref.messageId))
      .not.toContain(idOf(HOST_SYSTEM, 'xws-2'));
  });
});

describe('XWS a Host system action_request crosses', () => {
  it('XW-3b delivers a Host system action_request into the recipient workspace', async () => {
    /* Named mutation: narrow the cross-workspace condition back to `notify` only
       (`src/core/work-graph/communication/mailbox-send.ts`, the recipient-scope refusal). The send is then
       refused `not_found`, so the committed assertion and the recipient-inbox row go red. */
    const { world, a } = await openWorld('memory');
    const lineA = await createS6BLine(a, { label: 'xws-line-a', role: S6A_WORK_ROLE });
    const messageId = idOf(HOST_SYSTEM, 'xws-3b');
    const sent = await systemSend(world, 'xws-3b', { recipient: lineA.ref, intent: 'action_request', text: 'XWS-3b' });
    expect(sent.status, `the send: ${JSON.stringify(sent)}`).toBe('committed');
    if (sent.status !== 'committed') throw new Error(`XW-3b: the send was not committed: ${JSON.stringify(sent)}`);
    expect((await inboxIn(a, lineA.ref)).map(item => item.ref.messageId)).toContain(messageId);
  });
});

type XW3Case = { label: string; requestId: string; messageId: string; input: Record<string, unknown> };

const XW3_CASES: readonly XW3Case[] = [
  /* AGTX-2 (i). Today red at the rejection shape: the old guard refuses the cross-workspace
     inquiry `not_found` / `the requested record does not exist`. Green after the package because
     `message-machine.ts:556–:560` answers `invalid` with L1. Named mutation: remove the intent
     condition from `mayCross` (`src/core/work-graph/communication/mailbox-send.ts:425–:458`) →
     the inquiry commits, so the `toMatchObject` goes red (if it were bypassed, only A's inbox
     would hold the message). */
  { label: 'an inquiry', requestId: 'xws-3a', messageId: idOf(OPERATOR, 'xws-3a'),
    input: { intent: 'inquiry', text: 'XWS-3a' } },
  /* AGTX-2 (ii). Today red at the same rejection shape. Green after the package for the same
     reason: the notify still needs a reply, so it is `other_workspace` and L1 answers `invalid`.
     Named mutation: remove `!send.needsReply` from `mayCross` (`mailbox-send.ts:425–:458`) →
     the notify that needs a reply commits, so the `toMatchObject` goes red (if it were bypassed,
     only A's inbox would hold the message). */
  { label: 'a notify that needs a reply', requestId: 'xws-3b', messageId: idOf(OPERATOR, 'xws-3b'),
    input: { intent: 'notify', needsReply: true, text: 'XWS-3b' } },
];

describe('rejects: a cross-workspace send that asks for a reply (coordination)', () => {
  it.each(XW3_CASES)('XW-3 refuses $label and writes nothing', async ({ requestId, messageId, input }) => {
    const { a, b } = await openWorld('memory');
    const lineA = await createS6BLine(a, { label: 'xws-line-a', role: S6A_WORK_ROLE });
    expect(await b.post('messages/send', graphWrite(S6A_SECOND_SCOPE,
      { recipient: lineA.ref, ...input }, requestId)))
      .toMatchObject({ status: 'rejected', code: 'invalid', reason: L1 });
    for (const ws of [a, b]) {
      expect((await inboxIn(ws, lineA.ref)).map(item => item.ref.messageId)).not.toContain(messageId);
    }
  });
});

describe('XWS a human notify crosses', () => {
  it('XWS-3 lets a human notify another workspace without a reply', async () => {
    /* AGTX-2b. Today red at (a): the old guard refuses the human cross-workspace notify
       `not_found`. Green after the package because `mayCross`'s first clause accepts intent null
       (or `notify`) with `!needsReply` for any sender (Q2 甲). Named mutations: (1) require intent
       `notify` (drop `send.intent === null`) → (a) red; (2) restrict `mayCross` to Host-system
       senders → (a) red. */
    const { a, b } = await openWorld('memory');
    const lineA = await createS6BLine(a, { label: 'xws-line-a', role: S6A_WORK_ROLE });
    const sent = await b.post('messages/send', graphWrite(S6A_SECOND_SCOPE,
      { recipient: lineA.ref, text: 'XWS-3-human' }, 'xws-3-human'));
    expect(sent).toMatchObject({ status: 'committed',
      value: { ref: { workspaceId: 'ag2b-collab-workspace' } } });
    const received = await inboxIn(a, lineA.ref);
    expect(received).toHaveLength(1);
    expect(await bodyOf(a, received[0]!.ref)).toContain('XWS-3-human');
    expect(await inboxIn(b, lineA.ref)).toEqual([]);
  });
});

describe('XWS a Work Run notify crosses', () => {
  it('XW-4 commits an Agent Work Run notify into the recipient workspace', async () => {
    /* AGTX-1. Today red at step (a): the old recipient-scope guard refuses the cross-workspace
       Work Run notify `not_found`, so the tool JSON part is a rejection. Green after the package
       because `mailbox-send.ts:425–:458` admits any sender's notify that needs no reply and
       records it in the recipient line's workspace, and `message-machine.ts:556–:560` has no
       `other_workspace` refusal left for it. Named mutations: (1) narrow `mayCross` back to the
       Host system only (`mailbox-send.ts:425–:458`) → (a) red (`not_found`, the pre-package
       refusal); (2) keep `receivingWorkspaceId` on the sender workspace instead of the
       recipient's (`mailbox-send.ts:425–:458`) → the record lands in A, so (b) goes red. */
    const { world, a, b } = await openWorld('memory',
      [S7A_REPLY_TOOLS, { ...S7A_REPLY_TOOLS, mergeTools: ['send_session_message'] }]);
    const lineB = await createS6BLine(b, { label: 'xws-line-b', role: S6A_WORK_ROLE });
    await governS6B(world, a, world.goals);
    const { tasks } = await adoptS6BPlan(a, world.goals.first, { label: 'xws-4',
      taskIds: ['xws-4-task'], role: S6A_WORK_ROLE.templateId });
    const lineA = await createS6BLine(a, { label: 'xws-line-a', role: S6A_WORK_ROLE, tasks });
    world.scriptReplies([
      { kind: 'calls', calls: [{ callId: 'xws-4-send', name: 'send_session_message',
        args: { recipient: lineB.ref, intent: 'notify', text: 'XWS-4' } }] },
      { kind: 'text', text: 'XWS-4 answered' },
    ]);
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: world.goals.first, flowId: 'xws-4',
      sessionHint: lineA.ref, kind: 'select_work', taskId: tasks[0]!.taskId }, { receipts });
    const { run } = claimedRunOf(receipts, 'the XWS-4 sender');

    const history = ready<{ items: SessionHistoryEntry[] }>(
      await a.route('executions/history', { runRef: run, limit: 200 }), 'the XWS-4 execution history');
    let output: Record<string, unknown> | undefined;
    for (const entry of history.items) {
      const decoded = decodeKernelEntry(entry);
      if (decoded === null || decoded.record.recordType !== 'agent.event') continue;
      const event = decoded.record.payload.event;
      if (event.type !== 'tool.completed' && event.type !== 'tool.failed' && event.type !== 'tool.cancelled') continue;
      if (event.payload.callId !== 'xws-4-send') continue;
      output = event.payload.result.output.find(part => part.kind === 'json')?.value as
        Record<string, unknown> | undefined;
    }
    // (a) the tool commits, and the record lives in the recipient line's workspace.
    expect(output).toMatchObject({ status: 'committed', value: { ref: { workspaceId: 's6a-second-workspace' } } });
    // (b) the recipient's own workspace reads it back; (c) the sender's workspace has no copy.
    const received = await inboxIn(b, lineB.ref);
    expect(received).toHaveLength(1);
    expect(await bodyOf(b, received[0]!.ref)).toContain('XWS-4');
    expect(await inboxIn(a, lineB.ref)).toEqual([]);
  });
});
